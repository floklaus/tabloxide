//! Connection errors that tell the user what to correct.

use serde::Serialize;

/// Category of a connection failure.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "kebab-case")]
pub enum ConnectErrorKind {
    Authentication,
    MissingSecret,
    DatabaseNotFound,
    Tls,
    Unreachable,
    Timeout,
    InvalidConfiguration,
    Other,
}

impl ConnectErrorKind {
    /// Short instruction that tells the user what to correct.
    #[must_use]
    pub fn advice(self) -> &'static str {
        match self {
            Self::Authentication => "Check the user and the password.",
            Self::MissingSecret => "Enter a password, or set the environment variable.",
            Self::DatabaseNotFound => "Check the database name.",
            Self::Tls => "Check the TLS mode and the server certificate.",
            Self::Unreachable => "Check the host, the port, and that the server is running.",
            Self::Timeout => "Check the network, or increase the connection timeout.",
            Self::InvalidConfiguration => "Correct the connection settings.",
            Self::Other => "Read the server message for details.",
        }
    }
}

/// A connection failure. `detail` is the message from the driver or the server.
/// It never contains the password.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, thiserror::Error)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
#[error("{detail}")]
pub struct ConnectError {
    pub kind: ConnectErrorKind,
    pub advice: String,
    pub detail: String,
}

impl ConnectError {
    #[must_use]
    pub fn new(kind: ConnectErrorKind, detail: impl Into<String>) -> Self {
        Self {
            kind,
            advice: kind.advice().to_owned(),
            detail: detail.into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_sets_the_advice_of_the_kind() {
        let error = ConnectError::new(ConnectErrorKind::Authentication, "password failed");

        assert_eq!(error.advice, "Check the user and the password.");
        assert_eq!(error.to_string(), "password failed");
    }
}
