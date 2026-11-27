//! The file `connector.toml` that each connector package has.

use serde::Deserialize;
use std::path::{Path, PathBuf};
use tabloxide_core::{Capabilities, Engine, EngineInfo, QueryLanguage};

/// The name of the manifest file in a connector folder.
pub const MANIFEST_FILE: &str = "connector.toml";

/// The content of `connector.toml`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    /// The engine name in connection profiles, for example `mongodb`.
    pub engine: String,
    /// The name of the engine for the user, for example `MongoDB`.
    pub display_name: String,
    /// The version of the connector, in the form `1.2.3`.
    pub version: String,
    /// The major version of the protocol, for example `1`.
    pub protocol: u32,
    /// The file name of the program in the same folder. On Windows, `.exe` is added
    /// if the name does not have it.
    pub program: String,
    /// The query language, for example `mongodb-shell`.
    pub language: String,
    #[serde(default)]
    pub default_port: Option<u16>,
    #[serde(default)]
    pub file_database: bool,
    /// The name of the person or the organization that made the connector.
    #[serde(default)]
    pub publisher: Option<String>,
}

/// A manifest that is not valid.
#[derive(Debug, thiserror::Error)]
pub enum ManifestError {
    #[error("Cannot read {path}: {source}")]
    Read {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("The connector manifest {path} is not valid: {message}")]
    Invalid { path: PathBuf, message: String },
}

impl Manifest {
    /// Reads and checks the manifest in `folder`.
    ///
    /// # Errors
    ///
    /// Returns an error if the file is missing or if a value is not valid.
    pub fn read(folder: &Path) -> Result<Self, ManifestError> {
        let path = folder.join(MANIFEST_FILE);
        let text = std::fs::read_to_string(&path).map_err(|source| ManifestError::Read {
            path: path.clone(),
            source,
        })?;
        Self::parse(&text).map_err(|message| ManifestError::Invalid { path, message })
    }

    /// Reads and checks the text of a manifest.
    ///
    /// # Errors
    ///
    /// Returns a message if the text is not valid.
    pub fn parse(text: &str) -> Result<Self, String> {
        let manifest: Self = toml::from_str(text).map_err(|error| error.to_string())?;
        manifest.check()?;
        Ok(manifest)
    }

    fn check(&self) -> Result<(), String> {
        if !Engine::is_valid_name(&self.engine) {
            return Err(format!("`{}` is not a valid engine name.", self.engine));
        }
        semver::Version::parse(&self.version)
            .map_err(|error| format!("`{}` is not a version: {error}", self.version))?;
        let is_plain_name = !self.program.is_empty()
            && Path::new(&self.program).file_name() == Some(self.program.as_ref())
            && self.program != ".."
            && self.program != ".";
        if !is_plain_name {
            return Err("`program` must be a file name without a folder.".to_owned());
        }
        if self.display_name.trim().is_empty() {
            return Err("`display_name` is empty.".to_owned());
        }
        Ok(())
    }

    /// The path of the program in `folder`.
    #[must_use]
    pub fn program_path(&self, folder: &Path) -> PathBuf {
        let path = folder.join(&self.program);
        if cfg!(windows) && path.extension().is_none() {
            path.with_extension("exe")
        } else {
            path
        }
    }

    /// What the manifest tells about the engine. The connector confirms it with
    /// `Describe` when it starts.
    #[must_use]
    pub fn engine_info(&self) -> EngineInfo {
        EngineInfo {
            engine: Engine::new(self.engine.clone()),
            display_name: self.display_name.clone(),
            language: QueryLanguage::from_name(&self.language),
            default_port: self.default_port,
            capabilities: Capabilities {
                cancel: true,
                unix_socket: false,
                file_database: self.file_database,
                explain_plan: false,
                measured_plan: false,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const VALID: &str = r#"
engine = "mongodb"
display_name = "MongoDB"
version = "0.1.0"
protocol = 1
program = "tabloxide-connector-mongodb"
language = "mongodb-shell"
default_port = 27017
publisher = "Tabloxide project"
"#;

    #[test]
    fn reads_a_valid_manifest() {
        let manifest = Manifest::parse(VALID).unwrap();

        assert_eq!(manifest.engine, "mongodb");
        assert_eq!(manifest.engine_info().language, QueryLanguage::MongodbShell);
        assert_eq!(manifest.engine_info().default_port, Some(27017));
    }

    #[test]
    fn refuses_a_program_in_a_different_folder_and_bad_names() {
        for (from, to) in [
            ("\"tabloxide-connector-mongodb\"", "\"../evil\""),
            ("\"tabloxide-connector-mongodb\"", "\"/bin/sh\""),
            ("\"tabloxide-connector-mongodb\"", "\"\""),
            ("engine = \"mongodb\"", "engine = \"Mongo DB\""),
            ("version = \"0.1.0\"", "version = \"latest\""),
            ("protocol = 1", "protocol = 1\nscript = \"x\""),
        ] {
            let text = VALID.replace(from, to);
            assert!(Manifest::parse(&text).is_err(), "{to}");
        }
    }
}
