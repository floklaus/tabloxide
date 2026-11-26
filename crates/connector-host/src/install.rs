//! The download and the install of connector packages.
//!
//! A package is a `.tar.gz` file with `connector.toml` and the program at its top
//! level. The install unpacks it into a staging folder, checks the manifest, moves the
//! folder to `<root>/<engine>/<version>/`, and writes the install record last.

use crate::index::{IndexEntry, IndexError, IndexPackage};
use crate::manifest::Manifest;
use crate::process::supports_protocol;
use crate::registry::{INSTALL_RECORD_FILE, InstallRecord};
use crate::signature::{trusted_keys, verify};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::io::AsyncWriteExt;

/// The largest size of all files of an unpacked package.
const MAX_UNPACKED_BYTES: u64 = 1024 * 1024 * 1024;

/// The folders in the root for the work of the install. A dot makes them different
/// from each engine name.
const STAGING_FOLDER: &str = ".staging";
const DOWNLOAD_FOLDER: &str = ".downloads";

/// What a package is. The UI shows it before the install.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct PackageInfo {
    pub engine: String,
    pub display_name: String,
    pub version: String,
    pub publisher: Option<String>,
    /// `true` if the package has a signature of the Tabloxide project.
    pub is_official: bool,
    /// The SHA-256 checksum of the package file, in hexadecimal.
    pub sha256: String,
}

/// A failure of a download or an install. Nothing of the package stays on the disk.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum InstallError {
    #[error(transparent)]
    Index(#[from] IndexError),
    #[error("The download failed: {0}")]
    Download(String),
    #[error(
        "The checksum of the download does not agree with the list of connectors. Tabloxide did not keep the file. Expected {expected}, received {actual}."
    )]
    Checksum { expected: String, actual: String },
    #[error("The package is not valid: {0}")]
    Invalid(String),
    #[error(
        "The package does not have a signature of the Tabloxide project. Confirm the install to continue."
    )]
    NotConfirmed,
    #[error("The package file changed after the check. Select the file again.")]
    Changed,
    #[error("A file operation failed: {0}")]
    Io(String),
}

impl From<std::io::Error> for InstallError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error.to_string())
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs())
}

/// Returns `true` if `path` is one plain file name, without a folder.
fn is_top_level_name(path: &Path) -> bool {
    let mut components = path.components();
    matches!(components.next(), Some(Component::Normal(_))) && components.next().is_none()
}

/// Unpacks a package into `folder`. Only regular files at the top level are allowed.
fn unpack(archive: &[u8], folder: &Path) -> Result<(), InstallError> {
    let mut tar = tar::Archive::new(flate2::read::GzDecoder::new(archive));
    let mut total: u64 = 0;
    for entry in tar
        .entries()
        .map_err(|error| InstallError::Invalid(error.to_string()))?
    {
        let mut entry = entry.map_err(|error| InstallError::Invalid(error.to_string()))?;
        let path = entry
            .path()
            .map_err(|error| InstallError::Invalid(error.to_string()))?
            .into_owned();
        let path = path.strip_prefix("./").unwrap_or(&path).to_owned();
        let kind = entry.header().entry_type();
        if kind.is_dir() && path.as_os_str().is_empty() {
            continue;
        }
        if !kind.is_file() || !is_top_level_name(&path) {
            return Err(InstallError::Invalid(format!(
                "the package can have only files at its top level, not `{}`",
                path.display()
            )));
        }
        total = total.saturating_add(entry.size());
        if total > MAX_UNPACKED_BYTES {
            return Err(InstallError::Invalid("the package is too large".to_owned()));
        }
        let mut data = Vec::new();
        entry.read_to_end(&mut data)?;
        std::fs::write(folder.join(&path), data)?;
    }
    Ok(())
}

#[cfg(unix)]
fn make_executable(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755))
}

#[cfg(not(unix))]
fn make_executable(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

/// A package that is unpacked into a staging folder. The folder is removed when this
/// value is dropped, unless the install moved it.
struct Staged {
    folder: PathBuf,
    manifest: Manifest,
}

impl Drop for Staged {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.folder);
    }
}

fn stage(archive: &[u8], root: &Path) -> Result<Staged, InstallError> {
    let folder = root
        .join(STAGING_FOLDER)
        .join(uuid::Uuid::new_v4().simple().to_string());
    std::fs::create_dir_all(&folder)?;
    let staged = |manifest| Staged {
        folder: folder.clone(),
        manifest,
    };
    // A failure removes the folder through the drop of a staged value without a
    // manifest check.
    if let Err(error) = unpack(archive, &folder) {
        let _ = std::fs::remove_dir_all(&folder);
        return Err(error);
    }
    let manifest = match Manifest::read(&folder) {
        Ok(manifest) => manifest,
        Err(error) => {
            let _ = std::fs::remove_dir_all(&folder);
            return Err(InstallError::Invalid(error.to_string()));
        }
    };
    let staged = staged(manifest);
    if !supports_protocol(staged.manifest.protocol) {
        return Err(InstallError::Invalid(format!(
            "the connector uses protocol version {}, and this version of Tabloxide uses version 1",
            staged.manifest.protocol
        )));
    }
    let program = staged.manifest.program_path(&staged.folder);
    if !program.is_file() {
        return Err(InstallError::Invalid(format!(
            "the program `{}` is not in the package",
            staged.manifest.program
        )));
    }
    make_executable(&program)?;
    Ok(staged)
}

/// Moves a staged package to its version folder and writes the install record.
fn commit(
    mut staged: Staged,
    root: &Path,
    record: &InstallRecord,
) -> Result<PathBuf, InstallError> {
    let target = root
        .join(&staged.manifest.engine)
        .join(&staged.manifest.version);
    if target.exists() {
        std::fs::remove_dir_all(&target)?;
    }
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::rename(&staged.folder, &target)?;
    // The folder moved. The drop of `staged` must not remove the new folder.
    staged.folder = PathBuf::new();
    let text = serde_json::to_string_pretty(record)
        .map_err(|error| InstallError::Io(error.to_string()))?;
    std::fs::write(target.join(INSTALL_RECORD_FILE), text)?;
    Ok(target)
}

fn signature_path(package: &Path) -> PathBuf {
    let mut name = package.as_os_str().to_owned();
    name.push(".minisig");
    PathBuf::from(name)
}

/// Returns `true` if the file `<package>.minisig` is a signature of the project for `data`.
fn has_project_signature(package: &Path, data: &[u8]) -> bool {
    let Ok(signature) = std::fs::read_to_string(signature_path(package)) else {
        return false;
    };
    trusted_keys().is_ok_and(|keys| verify(data, &signature, &keys).is_ok())
}

fn package_info(staged: &Staged, is_official: bool, sha256: String) -> PackageInfo {
    PackageInfo {
        engine: staged.manifest.engine.clone(),
        display_name: staged.manifest.display_name.clone(),
        version: staged.manifest.version.clone(),
        publisher: staged.manifest.publisher.clone(),
        is_official,
        sha256,
    }
}

/// Reads a package file and tells what it is. It installs nothing.
///
/// # Errors
///
/// Returns an error if the file is not a valid package.
pub fn inspect_file(package: &Path, root: &Path) -> Result<PackageInfo, InstallError> {
    let data = std::fs::read(package)?;
    let sha256 = hex(&Sha256::digest(&data));
    let staged = stage(&data, root)?;
    Ok(package_info(
        &staged,
        has_project_signature(package, &data),
        sha256,
    ))
}

/// Installs a package file. `expected_sha256` is the checksum that `inspect_file`
/// gave, so that the user confirms the same file that the install uses.
///
/// # Errors
///
/// Returns an error if the file changed, if the package is not official and the user
/// did not confirm it, or if the package is not valid.
pub fn install_file(
    package: &Path,
    expected_sha256: &str,
    is_confirmed: bool,
    root: &Path,
) -> Result<PackageInfo, InstallError> {
    let data = std::fs::read(package)?;
    let sha256 = hex(&Sha256::digest(&data));
    if sha256 != expected_sha256 {
        return Err(InstallError::Changed);
    }
    let is_official = has_project_signature(package, &data);
    if !is_official && !is_confirmed {
        return Err(InstallError::NotConfirmed);
    }
    let staged = stage(&data, root)?;
    let info = package_info(&staged, is_official, sha256.clone());
    let record = InstallRecord {
        is_official,
        publisher: staged.manifest.publisher.clone(),
        sha256,
        installed_at: now_secs(),
    };
    commit(staged, root, &record)?;
    Ok(info)
}

/// Downloads the package of an index entry, checks its size and checksum, and
/// installs it. `progress` gets the number of bytes so far.
///
/// # Errors
///
/// Returns an error if the download fails, if the size or the checksum does not
/// agree with the index, or if the package is not valid.
pub async fn download(
    client: &reqwest::Client,
    entry: &IndexEntry,
    package: &IndexPackage,
    root: &Path,
    progress: impl Fn(u64),
) -> Result<PackageInfo, InstallError> {
    let mut response = client
        .get(&package.url)
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|error| InstallError::Download(error.to_string()))?;
    let folder = root.join(DOWNLOAD_FOLDER);
    tokio::fs::create_dir_all(&folder).await?;
    let path = folder.join(format!(
        "{}-{}.part",
        entry.engine,
        uuid::Uuid::new_v4().simple()
    ));
    let result = async {
        let mut file = tokio::fs::File::create(&path).await?;
        let mut hasher = Sha256::new();
        let mut received: u64 = 0;
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| InstallError::Download(error.to_string()))?
        {
            received += chunk.len() as u64;
            if received > package.size {
                return Err(InstallError::Download(
                    "the file is larger than the list of connectors says".to_owned(),
                ));
            }
            hasher.update(&chunk);
            file.write_all(&chunk).await?;
            progress(received);
        }
        file.flush().await?;
        let actual = hex(&hasher.finalize());
        if received != package.size || actual != package.sha256.to_ascii_lowercase() {
            return Err(InstallError::Checksum {
                expected: package.sha256.clone(),
                actual,
            });
        }
        Ok(actual)
    }
    .await;
    let installed = match result {
        Ok(sha256) => {
            let data = tokio::fs::read(&path).await?;
            let root = root.to_owned();
            let entry = entry.clone();
            tokio::task::spawn_blocking(move || install_downloaded(&data, &root, &entry, sha256))
                .await
                .map_err(|error| InstallError::Io(error.to_string()))?
        }
        Err(error) => Err(error),
    };
    let _ = tokio::fs::remove_file(&path).await;
    installed
}

fn install_downloaded(
    data: &[u8],
    root: &Path,
    entry: &IndexEntry,
    sha256: String,
) -> Result<PackageInfo, InstallError> {
    let staged = stage(data, root)?;
    if staged.manifest.engine != entry.engine || staged.manifest.version != entry.version {
        return Err(InstallError::Invalid(format!(
            "the package is {} {}, but the list of connectors says {} {}",
            staged.manifest.engine, staged.manifest.version, entry.engine, entry.version
        )));
    }
    let info = package_info(&staged, true, sha256.clone());
    let record = InstallRecord {
        is_official: true,
        publisher: Some(entry.publisher.clone()),
        sha256,
        installed_at: now_secs(),
    };
    commit(staged, root, &record)?;
    Ok(info)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    const MANIFEST: &str = "engine = \"mongodb\"\ndisplay_name = \"MongoDB\"\nversion = \"1.0.0\"\nprotocol = 1\nprogram = \"run\"\nlanguage = \"mongodb-shell\"\n";

    /// Makes a `.tar.gz` package from `(path, content)` pairs.
    pub(crate) fn package(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut builder = tar::Builder::new(flate2::write::GzEncoder::new(
            Vec::new(),
            flate2::Compression::fast(),
        ));
        for (path, content) in files {
            let mut header = tar::Header::new_gnu();
            header.set_size(content.len() as u64);
            header.set_mode(0o644);
            header.set_entry_type(tar::EntryType::Regular);
            // `append_data` refuses `..`, so the test writes the name into the header.
            let name = header.as_old_mut().name.as_mut();
            name[..path.len()].copy_from_slice(path.as_bytes());
            header.set_cksum();
            builder.append(&header, *content).unwrap();
        }
        builder.into_inner().unwrap().finish().unwrap()
    }

    fn valid() -> Vec<u8> {
        package(&[
            ("connector.toml", MANIFEST.as_bytes()),
            ("run", b"#!/bin/sh\n"),
        ])
    }

    #[test]
    fn installs_an_unsigned_package_only_after_the_confirmation() {
        let root = tempfile::tempdir().unwrap();
        let file = root.path().join("mongodb.tar.gz");
        std::fs::write(&file, valid()).unwrap();

        let info = inspect_file(&file, root.path()).unwrap();
        let refused = install_file(&file, &info.sha256, false, root.path());
        let installed = install_file(&file, &info.sha256, true, root.path()).unwrap();

        assert!(!info.is_official);
        assert_eq!(refused, Err(InstallError::NotConfirmed));
        assert_eq!(installed.engine, "mongodb");
        let folder = root.path().join("mongodb/1.0.0");
        assert!(folder.join("run").is_file());
        assert!(folder.join(INSTALL_RECORD_FILE).is_file());
        assert!(
            std::fs::read_dir(root.path().join(STAGING_FOLDER))
                .unwrap()
                .next()
                .is_none()
        );
    }

    #[test]
    fn refuses_a_file_that_changed_after_the_check() {
        let root = tempfile::tempdir().unwrap();
        let file = root.path().join("p.tar.gz");
        std::fs::write(&file, valid()).unwrap();
        let info = inspect_file(&file, root.path()).unwrap();
        std::fs::write(
            &file,
            package(&[("connector.toml", MANIFEST.as_bytes()), ("run", b"other")]),
        )
        .unwrap();

        assert_eq!(
            install_file(&file, &info.sha256, true, root.path()),
            Err(InstallError::Changed)
        );
    }

    #[test]
    fn refuses_paths_outside_the_package_and_missing_programs() {
        let root = tempfile::tempdir().unwrap();
        let cases = [
            package(&[("../evil", b"x")]),
            package(&[("sub/file", b"x")]),
            package(&[("/etc/passwd", b"x")]),
            package(&[("connector.toml", MANIFEST.as_bytes())]),
            b"not a package".to_vec(),
        ];
        for data in cases {
            assert!(matches!(
                stage(&data, root.path()),
                Err(InstallError::Invalid(_))
            ));
        }
        assert!(!root.path().join("evil").exists());
        assert!(
            std::fs::read_dir(root.path().join(STAGING_FOLDER))
                .unwrap()
                .next()
                .is_none()
        );
    }

    fn test_client() -> reqwest::Client {
        let _ = rustls::crypto::ring::default_provider().install_default();
        reqwest::Client::new()
    }

    /// Serves `body` once for each connection, as an HTTP response.
    async fn serve(body: Vec<u8>) -> String {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            while let Ok((mut socket, _)) = listener.accept().await {
                let mut request = [0_u8; 1024];
                let _ = socket.read(&mut request).await;
                let head = format!(
                    "HTTP/1.1 200 OK\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
                    body.len()
                );
                let _ = socket.write_all(head.as_bytes()).await;
                let _ = socket.write_all(&body).await;
            }
        });
        format!("http://{address}/p.tar.gz")
    }

    fn entry(url: String, data: &[u8], sha256: String) -> (IndexEntry, IndexPackage) {
        let package = IndexPackage {
            url,
            size: data.len() as u64,
            sha256,
        };
        let entry = IndexEntry {
            engine: "mongodb".to_owned(),
            display_name: "MongoDB".to_owned(),
            version: "1.0.0".to_owned(),
            protocol: 1,
            publisher: "Tabloxide project".to_owned(),
            packages: std::collections::BTreeMap::new(),
        };
        (entry, package)
    }

    #[tokio::test]
    async fn a_download_with_the_correct_checksum_installs_as_official() {
        let root = tempfile::tempdir().unwrap();
        let data = valid();
        let (entry, package) = entry(
            serve(data.clone()).await,
            &data,
            hex(&Sha256::digest(&data)),
        );
        let seen = std::sync::Mutex::new(0);

        let info = download(&test_client(), &entry, &package, root.path(), |bytes| {
            *seen.lock().unwrap() = bytes;
        })
        .await
        .unwrap();

        assert!(info.is_official);
        assert_eq!(*seen.lock().unwrap(), data.len() as u64);
        let record =
            std::fs::read_to_string(root.path().join("mongodb/1.0.0").join(INSTALL_RECORD_FILE))
                .unwrap();
        assert!(record.contains("\"isOfficial\": true"), "{record}");
    }

    #[tokio::test]
    async fn a_download_with_a_different_checksum_keeps_nothing() {
        let root = tempfile::tempdir().unwrap();
        let data = valid();
        let (entry, package) = entry(serve(data.clone()).await, &data, "00".repeat(32));

        let result = download(&test_client(), &entry, &package, root.path(), |_| {}).await;

        assert!(matches!(result, Err(InstallError::Checksum { .. })));
        assert!(!root.path().join("mongodb").exists());
        assert!(
            std::fs::read_dir(root.path().join(DOWNLOAD_FOLDER))
                .unwrap()
                .next()
                .is_none()
        );
    }
}
