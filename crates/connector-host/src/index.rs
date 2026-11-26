//! The signed index of the official connectors at tabloxide.org. Section 5 of
//! `docs/Connector Design.md` gives the rules.

use crate::signature::{SignatureError, trusted_keys, verify};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

/// The address of the index. The signature is at the same address with `.minisig`.
pub const INDEX_URL: &str = "https://tabloxide.org/connectors/v1/index.json";

/// The target triple of this build, for example `x86_64-unknown-linux-gnu`.
pub const TARGET: &str = env!("TABLOXIDE_TARGET");

/// The format version of the index that this application reads.
const FORMAT: u32 = 1;

/// The file that keeps the `issued` time of the last index that the application accepted.
const STATE_FILE: &str = "index-state.json";

/// The package of one connector version for one target.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IndexPackage {
    pub url: String,
    pub size: u64,
    /// The SHA-256 checksum, in lower-case hexadecimal.
    pub sha256: String,
}

/// One connector version in the index.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IndexEntry {
    pub engine: String,
    pub display_name: String,
    pub version: String,
    pub protocol: u32,
    pub publisher: String,
    /// The packages, with the target triple as the key.
    pub packages: BTreeMap<String, IndexPackage>,
}

/// The content of `index.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Index {
    pub format: u32,
    /// Seconds since 1970-01-01 UTC.
    pub issued: u64,
    /// Seconds since 1970-01-01 UTC. The application refuses the index after this time.
    pub expires: u64,
    pub connectors: Vec<IndexEntry>,
}

/// A failure to get or to accept the index.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum IndexError {
    #[error("Tabloxide cannot load the list of connectors: {0}")]
    Network(String),
    #[error("The list of connectors does not have a correct signature. {0}")]
    Signature(#[from] SignatureError),
    #[error("The list of connectors is not valid: {0}")]
    Invalid(String),
    #[error("The list of connectors has format {0}. Update Tabloxide to read it.")]
    Format(u32),
    #[error("The list of connectors expired. The project must publish a new list.")]
    Expired,
    #[error("The list of connectors is older than the list that Tabloxide accepted before.")]
    Rollback,
    #[error("No connector for `{engine}` is available for this computer ({target}).")]
    NotAvailable { engine: String, target: String },
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct IndexState {
    last_issued: u64,
}

fn read_state(folder: &Path) -> IndexState {
    std::fs::read_to_string(folder.join(STATE_FILE))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// Checks the signature and the content of an index, and records its `issued` time.
///
/// # Errors
///
/// Returns an error if the signature is not correct, if the index expired, or if it
/// is older than the last index that the application accepted.
pub fn accept(
    data: &[u8],
    signature: &str,
    state_folder: &Path,
    now: u64,
) -> Result<Index, IndexError> {
    verify(data, signature, &trusted_keys()?)?;
    check_content(data, state_folder, now)
}

/// The checks of `accept` after the signature check.
fn check_content(data: &[u8], state_folder: &Path, now: u64) -> Result<Index, IndexError> {
    let index: Index =
        serde_json::from_slice(data).map_err(|error| IndexError::Invalid(error.to_string()))?;
    if index.format != FORMAT {
        return Err(IndexError::Format(index.format));
    }
    if index.expires <= now {
        return Err(IndexError::Expired);
    }
    let state = read_state(state_folder);
    if index.issued < state.last_issued {
        return Err(IndexError::Rollback);
    }
    let text = serde_json::to_string(&IndexState {
        last_issued: index.issued,
    })
    .map_err(|error| IndexError::Invalid(error.to_string()))?;
    // A failure to keep the state does not stop the install. The next check uses the
    // older state.
    let _ = std::fs::create_dir_all(state_folder)
        .and_then(|()| std::fs::write(state_folder.join(STATE_FILE), text));
    Ok(index)
}

impl Index {
    /// Returns the newest version of the connector for `engine` and the package for
    /// this computer.
    ///
    /// # Errors
    ///
    /// Returns an error if the index has no package of the engine for this target.
    pub fn package_for(
        &self,
        engine: &str,
        target: &str,
    ) -> Result<(IndexEntry, IndexPackage), IndexError> {
        self.connectors
            .iter()
            .filter(|entry| {
                entry.engine == engine && crate::process::supports_protocol(entry.protocol)
            })
            .filter_map(|entry| Some((entry, entry.packages.get(target)?)))
            .max_by_key(|(entry, _)| semver::Version::parse(&entry.version).ok())
            .map(|(entry, package)| (entry.clone(), package.clone()))
            .ok_or_else(|| IndexError::NotAvailable {
                engine: engine.to_owned(),
                target: target.to_owned(),
            })
    }
}

/// Makes an HTTP client with the TLS library of the application.
///
/// # Errors
///
/// Returns an error if the client cannot start.
pub fn http_client() -> Result<reqwest::Client, IndexError> {
    // An earlier call can have set the provider. Then this call changes nothing.
    let _ = rustls::crypto::ring::default_provider().install_default();
    reqwest::Client::builder()
        .https_only(true)
        .connect_timeout(std::time::Duration::from_secs(15))
        .user_agent(concat!("tabloxide/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| IndexError::Network(error.to_string()))
}

/// Largest size of the index and of its signature.
const MAX_INDEX_BYTES: usize = 1024 * 1024;

async fn get_small(client: &reqwest::Client, url: &str) -> Result<Vec<u8>, IndexError> {
    let response = client
        .get(url)
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|error| IndexError::Network(error.to_string()))?;
    let bytes = response
        .bytes()
        .await
        .map_err(|error| IndexError::Network(error.to_string()))?;
    if bytes.len() > MAX_INDEX_BYTES {
        return Err(IndexError::Invalid("the file is too large".to_owned()));
    }
    Ok(bytes.to_vec())
}

/// Loads and accepts the index at `url`.
///
/// # Errors
///
/// Returns an error if the download fails or if the index is not accepted.
pub async fn fetch(
    client: &reqwest::Client,
    url: &str,
    state_folder: &Path,
    now: u64,
) -> Result<Index, IndexError> {
    let data = get_small(client, url).await?;
    let signature = get_small(client, &format!("{url}.minisig")).await?;
    let signature = String::from_utf8(signature)
        .map_err(|_| IndexError::Invalid("the signature is not text".to_owned()))?;
    accept(&data, &signature, state_folder, now)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(version: &str, target: &str) -> IndexEntry {
        IndexEntry {
            engine: "mongodb".to_owned(),
            display_name: "MongoDB".to_owned(),
            version: version.to_owned(),
            protocol: 1,
            publisher: "Tabloxide project".to_owned(),
            packages: BTreeMap::from([(
                target.to_owned(),
                IndexPackage {
                    url: format!("https://example.org/{version}.tar.gz"),
                    size: 10,
                    sha256: "00".to_owned(),
                },
            )]),
        }
    }

    #[test]
    fn selects_the_newest_version_for_the_target() {
        let index = Index {
            format: 1,
            issued: 1,
            expires: 2,
            connectors: vec![
                entry("0.9.0", "t"),
                entry("0.10.0", "t"),
                entry("1.0.0", "other"),
            ],
        };

        let (found, package) = index.package_for("mongodb", "t").unwrap();

        assert_eq!(found.version, "0.10.0");
        assert!(package.url.ends_with("0.10.0.tar.gz"));
        assert!(matches!(
            index.package_for("redis", "t"),
            Err(IndexError::NotAvailable { .. })
        ));
    }

    #[test]
    fn refuses_an_index_without_the_signature_of_the_project() {
        let dir = tempfile::tempdir().unwrap();
        // A valid minisign signature from a key that is not a key of the project.
        let signature = "untrusted comment: signature from minisign secret key\n\
            RUQf6LRCGA9i559r3g7V1qNyJDApGip8MfqcadIgT9CuhV3EMhHoN1mGTkUidF/z7SrlQgXdy8ofjb7bNJJylDOocrCo8KLzZwo=\n\
            trusted comment: timestamp:1556193335\tfile:test\n\
            y/rUw2y8/hOUYjZU71eHp/Wo1KZ40fGy2VJEDl34XMJM+TX48Ss/17u3IvIfbVR1FkZZSNCisQbuQY+bHwhEBg==";

        let result = accept(b"test", signature, dir.path(), 0);

        assert!(matches!(
            result,
            Err(IndexError::Signature(SignatureError::NotTrusted))
        ));
    }

    fn index_text(issued: u64, expires: u64) -> Vec<u8> {
        serde_json::to_vec(&Index {
            format: 1,
            issued,
            expires,
            connectors: vec![entry("1.0.0", "t")],
        })
        .unwrap()
    }

    #[test]
    fn refuses_an_expired_index_and_an_older_index_than_the_last_one() {
        let dir = tempfile::tempdir().unwrap();

        assert_eq!(
            check_content(&index_text(10, 20), dir.path(), 25),
            Err(IndexError::Expired)
        );
        assert!(check_content(&index_text(10, 100), dir.path(), 15).is_ok());
        assert_eq!(
            check_content(&index_text(9, 100), dir.path(), 15),
            Err(IndexError::Rollback)
        );
        assert!(check_content(&index_text(10, 100), dir.path(), 15).is_ok());
        assert!(check_content(&index_text(11, 100), dir.path(), 15).is_ok());
    }

    #[test]
    fn refuses_an_unknown_format_and_unknown_fields() {
        let dir = tempfile::tempdir().unwrap();
        let future = br#"{"format":2,"issued":1,"expires":9,"connectors":[]}"#;
        let extra = br#"{"format":1,"issued":1,"expires":9,"connectors":[],"script":"x"}"#;

        assert_eq!(
            check_content(future, dir.path(), 1),
            Err(IndexError::Format(2))
        );
        assert!(matches!(
            check_content(extra, dir.path(), 1),
            Err(IndexError::Invalid(_))
        ));
    }

    #[test]
    fn the_target_of_this_build_is_known() {
        assert!(!TARGET.is_empty());
    }
}
