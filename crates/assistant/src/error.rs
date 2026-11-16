//! Failures of a request to the AI service.

use serde::Serialize;

/// Category of a failure. The UI uses it to select the instruction for the user.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "kebab-case")]
pub enum AssistantErrorKind {
    /// The credential store has no API key.
    MissingKey,
    /// The AI service rejected the API key, or the key has no permission.
    Authentication,
    /// The account has no credit.
    Billing,
    /// The account sent too many requests or tokens.
    RateLimit,
    /// The AI service has too much load, or it has an internal error.
    Unavailable,
    /// The application did not get a connection, or the connection closed.
    Network,
    /// The AI service did not accept the request.
    InvalidRequest,
    Other,
}

/// A failed request. `message` is for the user. It never contains the API key.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, thiserror::Error)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[error("{message}")]
pub struct AssistantError {
    pub kind: AssistantErrorKind,
    pub message: String,
}

impl AssistantError {
    #[must_use]
    pub fn new(kind: AssistantErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    #[must_use]
    pub fn missing_key() -> Self {
        Self::new(
            AssistantErrorKind::MissingKey,
            "No API key is stored. Enter the API key in the preferences.",
        )
    }
}
