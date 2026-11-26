//! The check of the signature of a connector index file.
//!
//! The signature format is the format of minisign (Ed25519). The private key is not in
//! the repository. The project signs each index file on a machine of its own.

use minisign_verify::{PublicKey, Signature};

/// The public keys of the Tabloxide project, as minisign wrote them.
///
/// It is a list, so that a release can add a new key before a later release removes
/// the old one.
const TRUSTED_KEYS: &[&str] = &[include_str!("../keys/tabloxide-connectors.pub")];

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum SignatureError {
    #[error("A public key of the application is not valid: {0}")]
    InvalidKey(String),
    #[error("The signature file is not valid: {0}")]
    InvalidSignature(String),
    #[error("The signature does not agree with a key of the Tabloxide project.")]
    NotTrusted,
}

/// Returns the public keys of the Tabloxide project.
///
/// # Errors
///
/// Returns an error if a key in the application is not a minisign public key.
pub fn trusted_keys() -> Result<Vec<PublicKey>, SignatureError> {
    TRUSTED_KEYS
        .iter()
        .map(|text| {
            PublicKey::decode(text).map_err(|error| SignatureError::InvalidKey(error.to_string()))
        })
        .collect()
}

/// Checks that `signature` (the text of a `.minisig` file) is a signature of `data`
/// with one of `keys`.
///
/// # Errors
///
/// Returns an error if the signature file is not valid, or if no key agrees with it.
pub fn verify(data: &[u8], signature: &str, keys: &[PublicKey]) -> Result<(), SignatureError> {
    let signature = Signature::decode(signature)
        .map_err(|error| SignatureError::InvalidSignature(error.to_string()))?;
    let accepted = keys
        .iter()
        // `false` refuses the legacy format, which signs the data without a hash first.
        .any(|key| key.verify(data, &signature, false).is_ok());
    if accepted {
        Ok(())
    } else {
        Err(SignatureError::NotTrusted)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A public key and a signature from the tests of the minisign-verify crate.
    /// They are not keys of the Tabloxide project. The signature is in the current
    /// (prehashed) format, which `minisign -S` writes.
    const TEST_KEY: &str = "untrusted comment: minisign public key E7620F1842B4E81F\n\
        RWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3";
    const TEST_SIGNATURE: &str = "untrusted comment: signature from minisign secret key\n\
        RUQf6LRCGA9i559r3g7V1qNyJDApGip8MfqcadIgT9CuhV3EMhHoN1mGTkUidF/z7SrlQgXdy8ofjb7bNJJylDOocrCo8KLzZwo=\n\
        trusted comment: timestamp:1556193335\tfile:test\n\
        y/rUw2y8/hOUYjZU71eHp/Wo1KZ40fGy2VJEDl34XMJM+TX48Ss/17u3IvIfbVR1FkZZSNCisQbuQY+bHwhEBg==";
    const TEST_DATA: &[u8] = b"test";

    fn test_key() -> PublicKey {
        PublicKey::decode(TEST_KEY).unwrap()
    }

    #[test]
    fn the_keys_of_the_project_are_valid() {
        let keys = trusted_keys().unwrap();

        assert_eq!(keys.len(), TRUSTED_KEYS.len());
        assert!(!keys.is_empty());
    }

    #[test]
    fn a_correct_signature_is_accepted() {
        assert_eq!(verify(TEST_DATA, TEST_SIGNATURE, &[test_key()]), Ok(()));
    }

    #[test]
    fn changed_data_is_refused() {
        assert_eq!(
            verify(b"tesT", TEST_SIGNATURE, &[test_key()]),
            Err(SignatureError::NotTrusted)
        );
    }

    #[test]
    fn a_signature_with_a_different_key_is_refused() {
        let keys = trusted_keys().unwrap();

        assert_eq!(
            verify(TEST_DATA, TEST_SIGNATURE, &keys),
            Err(SignatureError::NotTrusted)
        );
    }

    #[test]
    fn a_text_that_is_not_a_signature_is_refused() {
        assert!(matches!(
            verify(TEST_DATA, "no signature", &[test_key()]),
            Err(SignatureError::InvalidSignature(_))
        ));
    }
}
