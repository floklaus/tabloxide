//! The interface to an AI service. It does not depend on one service.

use crate::AssistantError;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tabloxide_core::Secret;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "kebab-case")]
pub enum Role {
    User,
    Assistant,
}

/// One message of the conversation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ChatMessage {
    pub role: Role,
    pub text: String,
}

/// The type of work that the user asks for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "kebab-case")]
pub enum Task {
    /// Write or change SQL.
    Sql,
    /// Analyze an execution plan.
    Plan,
}

/// How much work the model does for one answer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Effort {
    Medium,
    High,
}

/// One part of the system prompt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SystemPart {
    pub text: String,
    /// `true` if the service can keep the prompt up to this part for the next request.
    pub is_cache_end: bool,
}

/// A request to the AI service.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChatRequest {
    pub model: String,
    pub effort: Effort,
    pub system: Vec<SystemPart>,
    pub messages: Vec<ChatMessage>,
}

/// Why the answer ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "kebab-case")]
pub enum StopKind {
    /// The answer is complete.
    Complete,
    /// The answer got to the maximum length. It is not complete.
    Truncated,
    /// The AI service declined the request.
    Refused,
}

/// Data about an answer that ended.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ChatOutcome {
    pub stop: StopKind,
    /// The model that wrote the answer.
    pub model: String,
    pub input_tokens: u32,
    pub output_tokens: u32,
}

/// The function that gets each part of the answer text.
pub type TextSink<'s> = dyn for<'a> FnMut(&'a str) + Send + 's;

/// An AI service that answers a conversation.
#[async_trait]
pub trait ChatProvider: Send + Sync {
    /// Sends `request` and calls `on_text` for each part of the answer text, in sequence.
    ///
    /// # Errors
    ///
    /// Returns an error if the service does not accept the request or if the
    /// connection fails. Text that `on_text` got before the error is not complete.
    async fn stream(
        &self,
        request: &ChatRequest,
        api_key: &Secret,
        on_text: &mut TextSink<'_>,
    ) -> Result<ChatOutcome, AssistantError>;
}
