//! A secret value that cannot go into a log or an error message by accident.

use std::fmt;
use zeroize::Zeroizing;

const REDACTED: &str = "[REDACTED]";

/// A password or a token.
///
/// `Debug` and `Display` print a placeholder. The memory is set to zero when the value drops.
/// This type does not implement `Serialize`. Thus it cannot go into a file or an IPC response.
#[derive(Clone, PartialEq, Eq)]
pub struct Secret(Zeroizing<String>);

impl Secret {
    #[must_use]
    pub fn new(value: impl Into<String>) -> Self {
        Self(Zeroizing::new(value.into()))
    }

    /// Returns the secret value. Call this only where the value goes to the database driver
    /// or to the credential store.
    #[must_use]
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(REDACTED)
    }
}

impl fmt::Display for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(REDACTED)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_and_display_do_not_show_the_value() {
        let secret = Secret::new("hunter2");

        assert_eq!(format!("{secret:?}"), "[REDACTED]");
        assert_eq!(format!("{secret}"), "[REDACTED]");
    }

    #[test]
    fn expose_returns_the_value() {
        let secret = Secret::new("hunter2");

        assert_eq!(secret.expose(), "hunter2");
    }
}
