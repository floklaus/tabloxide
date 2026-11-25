//! The models of an AI service. This part does not depend on one service.

use crate::AssistantError;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tabloxide_core::Secret;

/// The features of a model that the application uses.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ModelFeatures {
    /// The model can think before it answers.
    pub thinking: bool,
    /// The model can read images.
    pub image_input: bool,
}

/// One model that an AI service has. A service does not give each value. Then the
/// value is `None`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ModelInfo {
    /// The identifier that a request uses, for example `claude-opus-5-5`.
    pub id: String,
    /// The name for the user, for example "Claude Opus 5.5".
    pub display_name: String,
    /// The release date of the model as an RFC 3339 text.
    pub created_at: Option<String>,
    /// The maximum number of input tokens (the context window).
    pub context_tokens: Option<u32>,
    /// The maximum number of output tokens of one answer.
    pub max_output_tokens: Option<u32>,
    pub features: ModelFeatures,
}

/// An AI service that gives the list of its models.
#[async_trait]
pub trait ModelLister: Send + Sync {
    /// Gets the models that `api_key` can use, the newest model first.
    ///
    /// # Errors
    ///
    /// Returns an error if the service does not accept the key, if the connection
    /// fails, or if the answer is not in the expected format.
    async fn list_models(&self, api_key: &Secret) -> Result<Vec<ModelInfo>, AssistantError>;
}
