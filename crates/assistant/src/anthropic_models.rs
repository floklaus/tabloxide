//! The list of models of the Claude API (`GET /v1/models`).

use crate::anthropic::{network_error, status_error};
use crate::{
    AnthropicProvider, AssistantError, AssistantErrorKind, ModelFeatures, ModelInfo, ModelLister,
};
use async_trait::async_trait;
use serde_json::Value;
use tabloxide_core::Secret;

/// The number of models on one page. The service permits up to 1,000.
const PAGE_LIMIT: u32 = 100;
/// More pages show an answer that does not come from the service. The client
/// stops there and keeps the models that it has.
const MAX_PAGES: usize = 20;

/// One page of the list of models.
#[derive(Debug, PartialEq, Eq)]
struct Page {
    models: Vec<ModelInfo>,
    /// The identifier after which the next page starts. `None` on the last page.
    next_after: Option<String>,
}

fn format_error() -> AssistantError {
    AssistantError::new(
        AssistantErrorKind::Other,
        "The list of models from the AI service is not in the expected format.",
    )
}

fn as_u32(value: &Value) -> Option<u32> {
    value.as_u64().and_then(|number| u32::try_from(number).ok())
}

fn is_supported(capability: &Value) -> bool {
    capability["supported"].as_bool().unwrap_or(false)
}

/// Makes a model from one entry of the list. Returns `None` for an entry without
/// an identifier.
fn model_from(entry: &Value) -> Option<ModelInfo> {
    let id = entry["id"].as_str().filter(|id| !id.is_empty())?;
    let capabilities = &entry["capabilities"];
    Some(ModelInfo {
        id: id.to_owned(),
        display_name: entry["display_name"].as_str().unwrap_or(id).to_owned(),
        created_at: entry["created_at"].as_str().map(str::to_owned),
        context_tokens: as_u32(&entry["max_input_tokens"]),
        max_output_tokens: as_u32(&entry["max_tokens"]),
        features: ModelFeatures {
            thinking: is_supported(&capabilities["thinking"]),
            image_input: is_supported(&capabilities["image_input"]),
        },
    })
}

/// Returns `true` if `id` can go into the address without encoding.
fn is_safe_identifier(id: &str) -> bool {
    !id.is_empty()
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'@'))
}

fn parse_page(body: &Value) -> Result<Page, AssistantError> {
    let entries = body["data"].as_array().ok_or_else(format_error)?;
    let models = entries.iter().filter_map(model_from).collect();
    let next_after = if body["has_more"].as_bool() == Some(true) {
        body["last_id"]
            .as_str()
            .filter(|id| is_safe_identifier(id))
            .map(str::to_owned)
    } else {
        None
    };
    Ok(Page { models, next_after })
}

impl AnthropicProvider {
    async fn fetch_page(
        &self,
        api_key: &Secret,
        after: Option<&str>,
    ) -> Result<Page, AssistantError> {
        let mut path = format!("/v1/models?limit={PAGE_LIMIT}");
        if let Some(id) = after {
            path.push_str("&after_id=");
            path.push_str(id);
        }
        let response = self
            .request(reqwest::Method::GET, &path, api_key)?
            .send()
            .await
            .map_err(|e| network_error(&e))?;
        let status = response.status();
        let text = response.text().await.map_err(|e| network_error(&e))?;
        if !status.is_success() {
            return Err(status_error(status.as_u16(), &text));
        }
        let body: Value = serde_json::from_str(&text).map_err(|_| format_error())?;
        parse_page(&body)
    }
}

#[async_trait]
impl ModelLister for AnthropicProvider {
    async fn list_models(&self, api_key: &Secret) -> Result<Vec<ModelInfo>, AssistantError> {
        let mut models: Vec<ModelInfo> = Vec::new();
        let mut after: Option<String> = None;
        for _ in 0..MAX_PAGES {
            let page = self.fetch_page(api_key, after.as_deref()).await?;
            for model in page.models {
                if !models.iter().any(|known| known.id == model.id) {
                    models.push(model);
                }
            }
            match page.next_after {
                // The same identifier again would give the same page again.
                Some(id) if after.as_deref() != Some(id.as_str()) => after = Some(id),
                _ => break,
            }
        }
        Ok(models)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_server::{json_response, serve};
    use serde_json::json;

    fn opus() -> Value {
        json!({
            "type": "model",
            "id": "claude-opus-5-5",
            "display_name": "Claude Opus 5.5",
            "created_at": "2026-10-01T00:00:00Z",
            "max_input_tokens": 1_000_000,
            "max_tokens": 128_000,
            "capabilities": {
                "image_input": { "supported": true },
                "thinking": { "supported": true, "types": { "adaptive": { "supported": true } } },
                "structured_outputs": { "supported": true },
            },
        })
    }

    fn opus_info() -> ModelInfo {
        ModelInfo {
            id: "claude-opus-5-5".to_owned(),
            display_name: "Claude Opus 5.5".to_owned(),
            created_at: Some("2026-10-01T00:00:00Z".to_owned()),
            context_tokens: Some(1_000_000),
            max_output_tokens: Some(128_000),
            features: ModelFeatures {
                thinking: true,
                image_input: true,
            },
        }
    }

    #[test]
    fn a_page_gives_the_models_and_the_start_of_the_next_page() {
        let body = json!({
            "data": [opus()],
            "has_more": true,
            "first_id": "claude-opus-5-5",
            "last_id": "claude-opus-5-5",
        });

        let page = parse_page(&body).unwrap();

        assert_eq!(
            page,
            Page {
                models: vec![opus_info()],
                next_after: Some("claude-opus-5-5".to_owned()),
            }
        );
    }

    #[test]
    fn the_last_page_has_no_next_page() {
        let body = json!({ "data": [], "has_more": false, "last_id": null });

        let page = parse_page(&body).unwrap();

        assert_eq!(page.next_after, None);
    }

    #[test]
    fn a_model_without_optional_fields_has_no_values_for_them() {
        let body = json!({ "data": [{ "id": "claude-test" }], "has_more": false });

        let page = parse_page(&body).unwrap();

        assert_eq!(
            page.models,
            vec![ModelInfo {
                id: "claude-test".to_owned(),
                display_name: "claude-test".to_owned(),
                created_at: None,
                context_tokens: None,
                max_output_tokens: None,
                features: ModelFeatures::default(),
            }]
        );
    }

    #[test]
    fn an_entry_without_an_identifier_is_ignored() {
        let body = json!({ "data": [{ "display_name": "No id" }, 7, opus()], "has_more": false });

        let page = parse_page(&body).unwrap();

        assert_eq!(page.models, vec![opus_info()]);
    }

    #[test]
    fn a_next_page_identifier_with_unexpected_characters_stops_the_list() {
        let body = json!({ "data": [opus()], "has_more": true, "last_id": "a&b=c" });

        let page = parse_page(&body).unwrap();

        assert_eq!(page.next_after, None);
    }

    #[test]
    fn a_body_without_a_data_list_is_a_format_error() {
        let error = parse_page(&json!({ "models": [] })).unwrap_err();

        assert_eq!(error.kind, AssistantErrorKind::Other);
        assert_eq!(error, format_error());
    }

    #[tokio::test]
    async fn the_client_reads_all_pages_with_the_key_and_the_version() {
        let first = json!({ "data": [opus()], "has_more": true, "last_id": "claude-opus-5-5" });
        let second = json!({
            "data": [{ "id": "claude-haiku-4-5", "display_name": "Claude Haiku 4.5" }],
            "has_more": false,
            "last_id": "claude-haiku-4-5",
        });
        let (address, server) = serve(vec![
            json_response("200 OK", &first.to_string()),
            json_response("200 OK", &second.to_string()),
        ])
        .await;
        let provider = AnthropicProvider::with_base_url(&address);

        let models = provider
            .list_models(&Secret::new("test-key"))
            .await
            .unwrap();
        let sent = server.await.unwrap();

        let ids: Vec<&str> = models.iter().map(|model| model.id.as_str()).collect();
        assert_eq!(ids, ["claude-opus-5-5", "claude-haiku-4-5"]);
        assert!(sent[0].starts_with("GET /v1/models?limit=100 HTTP/1.1"));
        assert!(sent[1].starts_with("GET /v1/models?limit=100&after_id=claude-opus-5-5 HTTP/1.1"));
        let first_request = sent[0].to_lowercase();
        assert!(first_request.contains("x-api-key: test-key"));
        assert!(first_request.contains("anthropic-version: 2026-10-21"));
    }

    #[tokio::test]
    async fn the_client_returns_the_error_of_an_error_status() {
        let body = r#"{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}"#;
        let (address, _server) = serve(vec![json_response("401 Unauthorized", body)]).await;
        let provider = AnthropicProvider::with_base_url(&address);

        let error = provider
            .list_models(&Secret::new("secret-key-value"))
            .await
            .unwrap_err();

        assert_eq!(error.kind, AssistantErrorKind::Authentication);
        assert!(!error.message.contains("secret-key-value"));
    }

    #[tokio::test]
    async fn a_body_that_is_not_json_is_a_format_error() {
        let (address, _server) = serve(vec![json_response("200 OK", "<html>proxy</html>")]).await;
        let provider = AnthropicProvider::with_base_url(&address);

        let error = provider.list_models(&Secret::new("k")).await.unwrap_err();

        assert_eq!(error, format_error());
    }

    #[tokio::test]
    async fn a_server_that_is_not_there_gives_a_network_error() {
        let provider = AnthropicProvider::with_base_url("http://127.0.0.1:1");

        let error = provider.list_models(&Secret::new("k")).await.unwrap_err();

        assert_eq!(error.kind, AssistantErrorKind::Network);
    }
}
