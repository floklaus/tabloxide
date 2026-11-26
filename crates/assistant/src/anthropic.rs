//! The client for the Messages API of Anthropic (Claude).
//!
//! No official Rust SDK is available. Thus this module sends the HTTP request itself.

use crate::sse::{SseEvent, SseParser};
use crate::{
    AssistantError, AssistantErrorKind, ChatOutcome, ChatProvider, ChatRequest, Effort, Role,
    StopKind, TextSink,
};
use async_trait::async_trait;
use serde_json::{Value, json};
use std::time::Duration;
use tabloxide_core::Secret;

const DEFAULT_BASE_URL: &str = "https://api.anthropic.com";
const API_VERSION: &str = "2026-10-21";
/// The server runs a declined request again on a different model.
const FALLBACK_BETA: &str = "server-side-fallback-2026-07-01";
/// The answer comes as a stream. Thus a large limit does not cause an HTTP timeout.
const MAX_TOKENS: u32 = 64_000;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
/// The service sends keep-alive events while the model thinks. A longer silence
/// shows a connection that does not work.
const READ_TIMEOUT: Duration = Duration::from_secs(300);
/// One event of the service is much smaller. More bytes without the end of an event
/// show an answer that does not come from the service.
const MAX_EVENT_BYTES: usize = 1024 * 1024;

/// Calls the Claude API. The API key comes with each request. This type does not keep it.
#[derive(Debug, Clone)]
pub struct AnthropicProvider {
    client: reqwest::Client,
    base_url: String,
}

impl Default for AnthropicProvider {
    fn default() -> Self {
        Self::with_base_url(DEFAULT_BASE_URL)
    }
}

impl AnthropicProvider {
    /// Makes a client for the service at `base_url`. Tests use a local server.
    ///
    /// # Panics
    ///
    /// Panics if the TLS library of the application cannot start.
    #[must_use]
    pub fn with_base_url(base_url: &str) -> Self {
        // An earlier call can have set the provider. Then this call changes nothing.
        let _ = rustls::crypto::ring::default_provider().install_default();
        let client = reqwest::Client::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .read_timeout(READ_TIMEOUT)
            .user_agent(concat!("tabloxide/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("the HTTP client must start");
        Self {
            client,
            base_url: base_url.trim_end_matches('/').to_owned(),
        }
    }

    /// Makes a request to `path` with the API key and the API version.
    ///
    /// # Errors
    ///
    /// Returns an error if the API key has a character that cannot go into an
    /// HTTP header.
    pub(crate) fn request(
        &self,
        method: reqwest::Method,
        path: &str,
        api_key: &Secret,
    ) -> Result<reqwest::RequestBuilder, AssistantError> {
        let mut key_header =
            reqwest::header::HeaderValue::from_str(api_key.expose()).map_err(|_| {
                AssistantError::new(
                    AssistantErrorKind::Authentication,
                    "The API key has a character that is not permitted. Enter the key again \
                     in the preferences.",
                )
            })?;
        // The HTTP library does not write a sensitive value to a log.
        key_header.set_sensitive(true);
        Ok(self
            .client
            .request(method, format!("{}{path}", self.base_url))
            .header("x-api-key", key_header)
            .header("anthropic-version", API_VERSION))
    }
}

/// Returns `true` if the service can run a declined request of `model` again on a
/// different model.
fn supports_fallback(model: &str) -> bool {
    !model.starts_with("claude-haiku")
}

fn effort_text(effort: Effort) -> &'static str {
    match effort {
        Effort::Medium => "medium",
        Effort::High => "high",
    }
}

/// Makes the JSON body of the request.
pub(crate) fn request_body(request: &ChatRequest) -> Value {
    let system: Vec<Value> = request
        .system
        .iter()
        .map(|part| {
            let mut block = json!({ "type": "text", "text": part.text });
            if part.is_cache_end {
                block["cache_control"] = json!({ "type": "ephemeral" });
            }
            block
        })
        .collect();
    let messages: Vec<Value> = request
        .messages
        .iter()
        .map(|message| {
            let role = match message.role {
                Role::User => "user",
                Role::Assistant => "assistant",
            };
            json!({ "role": role, "content": message.text })
        })
        .collect();
    // The request has no `thinking` field. Then each supported model selects itself
    // how much it thinks, and `effort` sets the depth.
    let mut body = json!({
        "model": request.model,
        "max_tokens": MAX_TOKENS,
        "stream": true,
        "output_config": { "effort": effort_text(request.effort) },
        "system": system,
        "messages": messages,
    });
    if supports_fallback(&request.model) {
        body["fallbacks"] = json!("default");
    }
    body
}

fn kind_of_status(status: u16) -> AssistantErrorKind {
    match status {
        401 | 403 => AssistantErrorKind::Authentication,
        402 => AssistantErrorKind::Billing,
        429 => AssistantErrorKind::RateLimit,
        400 | 404 | 413 | 422 => AssistantErrorKind::InvalidRequest,
        500..=599 => AssistantErrorKind::Unavailable,
        _ => AssistantErrorKind::Other,
    }
}

fn kind_of_type(error_type: &str) -> Option<AssistantErrorKind> {
    Some(match error_type {
        "authentication_error" | "permission_error" => AssistantErrorKind::Authentication,
        "billing_error" => AssistantErrorKind::Billing,
        "rate_limit_error" => AssistantErrorKind::RateLimit,
        "overloaded_error" | "api_error" | "timeout_error" => AssistantErrorKind::Unavailable,
        "invalid_request_error" | "not_found_error" | "request_too_large" => {
            AssistantErrorKind::InvalidRequest
        }
        _ => return None,
    })
}

fn advice(kind: AssistantErrorKind) -> &'static str {
    match kind {
        AssistantErrorKind::MissingKey => "Enter the API key in the preferences.",
        AssistantErrorKind::Authentication => "Check the API key in the preferences.",
        AssistantErrorKind::Billing => "Check the credit of the account of the API key.",
        AssistantErrorKind::RateLimit => "Wait a minute, then send the request again.",
        AssistantErrorKind::Unavailable => "Send the request again later.",
        AssistantErrorKind::Network => "Check the network connection and the proxy settings.",
        AssistantErrorKind::InvalidRequest | AssistantErrorKind::Other => "",
    }
}

/// Makes the error from an error object of the API (`{"type": ..., "message": ...}`).
fn api_error(fallback_kind: AssistantErrorKind, error: &Value) -> AssistantError {
    let kind = error["type"]
        .as_str()
        .and_then(kind_of_type)
        .unwrap_or(fallback_kind);
    let detail = error["message"].as_str().unwrap_or("no details");
    let message = format!(
        "The AI service returned an error: {detail} {}",
        advice(kind)
    );
    AssistantError::new(kind, message.trim_end())
}

pub(crate) fn status_error(status: u16, body: &str) -> AssistantError {
    let fallback_kind = kind_of_status(status);
    match serde_json::from_str::<Value>(body) {
        Ok(json) if json["error"].is_object() => api_error(fallback_kind, &json["error"]),
        _ => {
            let message = format!(
                "The AI service returned the HTTP status {status}. {}",
                advice(fallback_kind)
            );
            AssistantError::new(fallback_kind, message.trim_end())
        }
    }
}

pub(crate) fn network_error(error: &reqwest::Error) -> AssistantError {
    // The text of the error has the address of the service, but not the request
    // headers. Thus it cannot contain the API key.
    let message = format!(
        "The request to the AI service failed: {error}. {}",
        advice(AssistantErrorKind::Network)
    );
    AssistantError::new(AssistantErrorKind::Network, message)
}

fn as_u32(value: &Value) -> u32 {
    value
        .as_u64()
        .and_then(|number| u32::try_from(number).ok())
        .unwrap_or(0)
}

/// Collects the data of the answer from the events of the stream.
#[derive(Debug, Default)]
pub(crate) struct Answer {
    model: String,
    input_tokens: u32,
    output_tokens: u32,
    stop_reason: Option<String>,
    is_done: bool,
}

impl Answer {
    /// Reads one event. Calls `on_text` if the event has answer text.
    pub(crate) fn accept(
        &mut self,
        event: &SseEvent,
        on_text: &mut TextSink<'_>,
    ) -> Result<(), AssistantError> {
        let Ok(data) = serde_json::from_str::<Value>(&event.data) else {
            // An event that is not JSON has no data for the answer.
            return Ok(());
        };
        match data["type"].as_str().unwrap_or(&event.name) {
            "message_start" => {
                let message = &data["message"];
                if let Some(model) = message["model"].as_str() {
                    model.clone_into(&mut self.model);
                }
                let usage = &message["usage"];
                self.input_tokens = as_u32(&usage["input_tokens"])
                    + as_u32(&usage["cache_read_input_tokens"])
                    + as_u32(&usage["cache_creation_input_tokens"]);
            }
            "content_block_start" => {
                // A fallback block shows that a different model continues the answer.
                if let Some(model) = data["content_block"]["to"]["model"].as_str() {
                    model.clone_into(&mut self.model);
                }
            }
            "content_block_delta" => {
                let delta = &data["delta"];
                if delta["type"] == "text_delta"
                    && let Some(text) = delta["text"].as_str()
                {
                    on_text(text);
                }
            }
            "message_delta" => {
                if let Some(reason) = data["delta"]["stop_reason"].as_str() {
                    self.stop_reason = Some(reason.to_owned());
                }
                let output = &data["usage"]["output_tokens"];
                if !output.is_null() {
                    self.output_tokens = as_u32(output);
                }
            }
            "message_stop" => self.is_done = true,
            "error" => return Err(api_error(AssistantErrorKind::Other, &data["error"])),
            _ => {}
        }
        Ok(())
    }

    pub(crate) fn finish(self, requested_model: &str) -> Result<ChatOutcome, AssistantError> {
        if !self.is_done {
            return Err(AssistantError::new(
                AssistantErrorKind::Network,
                "The connection to the AI service closed before the end of the answer. \
                 Send the request again.",
            ));
        }
        let stop = match self.stop_reason.as_deref() {
            Some("max_tokens" | "model_context_window_exceeded") => StopKind::Truncated,
            Some("refusal") => StopKind::Refused,
            _ => StopKind::Complete,
        };
        Ok(ChatOutcome {
            stop,
            model: if self.model.is_empty() {
                requested_model.to_owned()
            } else {
                self.model
            },
            input_tokens: self.input_tokens,
            output_tokens: self.output_tokens,
        })
    }
}

#[async_trait]
impl ChatProvider for AnthropicProvider {
    async fn stream(
        &self,
        request: &ChatRequest,
        api_key: &Secret,
        on_text: &mut TextSink<'_>,
    ) -> Result<ChatOutcome, AssistantError> {
        let body = serde_json::to_vec(&request_body(request)).map_err(|error| {
            AssistantError::new(
                AssistantErrorKind::Other,
                format!("The application cannot make the request: {error}"),
            )
        })?;
        let mut call = self
            .request(reqwest::Method::POST, "/v1/messages", api_key)?
            .header("content-type", "application/json")
            .body(body);
        if supports_fallback(&request.model) {
            call = call.header("anthropic-beta", FALLBACK_BETA);
        }
        let mut response = call.send().await.map_err(|e| network_error(&e))?;
        let status = response.status();
        if !status.is_success() {
            let text = response.text().await.unwrap_or_default();
            return Err(status_error(status.as_u16(), &text));
        }
        let mut parser = SseParser::default();
        let mut answer = Answer::default();
        while let Some(chunk) = response.chunk().await.map_err(|e| network_error(&e))? {
            for event in parser.push(&chunk) {
                answer.accept(&event, on_text)?;
            }
            if parser.pending_len() > MAX_EVENT_BYTES {
                return Err(AssistantError::new(
                    AssistantErrorKind::Other,
                    "The answer of the AI service is not in the expected format.",
                ));
            }
        }
        answer.finish(&request.model)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_server::{json_response, serve};
    use crate::{ChatMessage, SystemPart};

    fn request(model: &str) -> ChatRequest {
        ChatRequest {
            model: model.to_owned(),
            effort: Effort::Medium,
            system: vec![
                SystemPart {
                    text: "instructions".to_owned(),
                    is_cache_end: false,
                },
                SystemPart {
                    text: "schema".to_owned(),
                    is_cache_end: true,
                },
            ],
            messages: vec![
                ChatMessage::new(Role::User, "one"),
                ChatMessage::new(Role::Assistant, "two"),
                ChatMessage::new(Role::User, "three"),
            ],
        }
    }

    #[test]
    fn the_body_has_the_model_the_effort_the_system_parts_and_the_messages() {
        let body = request_body(&request("claude-opus-5-5"));

        assert_eq!(
            body,
            json!({
                "model": "claude-opus-5-5",
                "max_tokens": 64000,
                "stream": true,
                "output_config": { "effort": "medium" },
                "fallbacks": "default",
                "system": [
                    { "type": "text", "text": "instructions" },
                    { "type": "text", "text": "schema",
                      "cache_control": { "type": "ephemeral" } },
                ],
                "messages": [
                    { "role": "user", "content": "one" },
                    { "role": "assistant", "content": "two" },
                    { "role": "user", "content": "three" },
                ],
            })
        );
    }

    #[test]
    fn the_body_for_a_model_without_fallback_has_no_fallback_field() {
        let body = request_body(&request("claude-haiku-5-5"));

        assert!(body.get("fallbacks").is_none());
    }

    const STREAM: &str = "\
event: message_start\n\
data: {\"type\":\"message_start\",\"message\":{\"model\":\"claude-opus-5-5\",\"usage\":{\"input_tokens\":10,\"cache_read_input_tokens\":90}}}\n\n\
event: content_block_start\n\
data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"thinking\",\"thinking\":\"\"}}\n\n\
event: ping\n\
data: {\"type\":\"ping\"}\n\n\
event: content_block_delta\n\
data: {\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"text_delta\",\"text\":\"SELECT \"}}\n\n\
event: content_block_delta\n\
data: {\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"text_delta\",\"text\":\"1\"}}\n\n\
event: message_delta\n\
data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":7}}\n\n\
event: message_stop\n\
data: {\"type\":\"message_stop\"}\n\n";

    fn read_events(stream: &str) -> (Result<ChatOutcome, AssistantError>, String) {
        let mut text = String::new();
        let mut answer = Answer::default();
        let mut on_text = |part: &str| text.push_str(part);
        for event in SseParser::default().push(stream.as_bytes()) {
            if let Err(error) = answer.accept(&event, &mut on_text) {
                return (Err(error), text);
            }
        }
        (answer.finish("requested"), text)
    }

    #[test]
    fn the_events_give_the_text_and_the_outcome() {
        let (outcome, text) = read_events(STREAM);

        assert_eq!(text, "SELECT 1");
        assert_eq!(
            outcome.unwrap(),
            ChatOutcome {
                stop: StopKind::Complete,
                model: "claude-opus-5-5".to_owned(),
                input_tokens: 100,
                output_tokens: 7,
            }
        );
    }

    #[test]
    fn a_refusal_and_a_length_stop_have_their_own_stop_kinds() {
        for (reason, stop) in [
            ("refusal", StopKind::Refused),
            ("max_tokens", StopKind::Truncated),
            ("model_context_window_exceeded", StopKind::Truncated),
        ] {
            let stream = STREAM.replace("end_turn", reason);

            let (outcome, _) = read_events(&stream);

            assert_eq!(outcome.unwrap().stop, stop);
        }
    }

    #[test]
    fn a_fallback_block_changes_the_model_of_the_outcome() {
        let stream = STREAM.replace(
            "{\"type\":\"thinking\",\"thinking\":\"\"}",
            "{\"type\":\"fallback\",\"from\":{\"model\":\"claude-opus-5-5\"},\"to\":{\"model\":\"claude-opus-4-8\"}}",
        );

        let (outcome, _) = read_events(&stream);

        assert_eq!(outcome.unwrap().model, "claude-opus-4-8");
    }

    #[test]
    fn an_error_event_stops_the_answer() {
        let stream = "event: error\ndata: {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"Overloaded\"}}\n\n";

        let (outcome, _) = read_events(stream);

        let error = outcome.unwrap_err();
        assert_eq!(error.kind, AssistantErrorKind::Unavailable);
        assert_eq!(
            error.message,
            "The AI service returned an error: Overloaded Send the request again later."
        );
    }

    #[test]
    fn a_stream_without_its_end_is_an_error() {
        let stream = STREAM.replace(
            "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n",
            "",
        );

        let (outcome, text) = read_events(&stream);

        assert_eq!(text, "SELECT 1");
        assert_eq!(outcome.unwrap_err().kind, AssistantErrorKind::Network);
    }

    #[test]
    fn an_error_status_gives_the_kind_and_the_message_of_the_service() {
        let body = r#"{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}"#;

        let error = status_error(401, body);

        assert_eq!(error.kind, AssistantErrorKind::Authentication);
        assert_eq!(
            error.message,
            "The AI service returned an error: invalid x-api-key Check the API key in the preferences."
        );
        assert_eq!(
            status_error(529, "busy").kind,
            AssistantErrorKind::Unavailable
        );
        assert_eq!(status_error(429, "").kind, AssistantErrorKind::RateLimit);
    }

    #[tokio::test]
    async fn the_client_sends_the_headers_and_reads_the_stream() {
        let response = format!(
            "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\nconnection: close\r\n\r\n{STREAM}"
        );
        let (address, server) = serve(vec![response]).await;
        let provider = AnthropicProvider::with_base_url(&address);
        let mut text = String::new();
        let mut on_text = |part: &str| text.push_str(part);

        let outcome = provider
            .stream(
                &request("claude-opus-5-5"),
                &Secret::new("test-key"),
                &mut on_text,
            )
            .await
            .unwrap();
        let sent = server.await.unwrap()[0].to_lowercase();

        assert_eq!(text, "SELECT 1");
        assert_eq!(outcome.stop, StopKind::Complete);
        assert!(sent.starts_with("post /v1/messages http/1.1"));
        assert!(sent.contains("x-api-key: test-key"));
        assert!(sent.contains("anthropic-version: 2026-10-21"));
        assert!(sent.contains("anthropic-beta: server-side-fallback-2026-07-01"));
    }

    #[tokio::test]
    async fn the_client_returns_the_error_of_an_error_status() {
        let body = r#"{"type":"error","error":{"type":"rate_limit_error","message":"slow down"}}"#;
        let (address, _server) = serve(vec![json_response("429 Too Many Requests", body)]).await;
        let provider = AnthropicProvider::with_base_url(&address);

        let error = provider
            .stream(
                &request("claude-opus-5-5"),
                &Secret::new("secret-key-value"),
                &mut |_| {},
            )
            .await
            .unwrap_err();

        assert_eq!(error.kind, AssistantErrorKind::RateLimit);
        assert!(error.message.contains("slow down"));
        assert!(!error.message.contains("secret-key-value"));
    }

    #[tokio::test]
    async fn an_api_key_with_a_line_break_does_not_go_into_a_request() {
        let provider = AnthropicProvider::with_base_url("http://127.0.0.1:1");

        let error = provider
            .stream(
                &request("claude-opus-5-5"),
                &Secret::new("a\nb"),
                &mut |_| {},
            )
            .await
            .unwrap_err();

        assert_eq!(error.kind, AssistantErrorKind::Authentication);
        assert!(!error.message.contains("a\nb"));
    }

    #[tokio::test]
    async fn a_server_that_is_not_there_gives_a_network_error() {
        let provider = AnthropicProvider::with_base_url("http://127.0.0.1:1");

        let error = provider
            .stream(&request("claude-opus-5-5"), &Secret::new("k"), &mut |_| {})
            .await
            .unwrap_err();

        assert_eq!(error.kind, AssistantErrorKind::Network);
    }
}
