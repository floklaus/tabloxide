//! Connection profiles. A profile contains no secret, so Git can track it.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fmt;

pub const DEFAULT_PORT: u16 = 5432;
pub const DEFAULT_CONNECT_TIMEOUT_SECS: u32 = 10;

const COPY_SUFFIX: &str = " (copy)";

/// Stable identifier of a connection profile.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(transparent)]
pub struct ConnectionId(String);

impl ConnectionId {
    /// Makes a new random identifier.
    #[must_use]
    pub fn generate() -> Self {
        Self(uuid::Uuid::new_v4().to_string())
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl From<&str> for ConnectionId {
    fn from(value: &str) -> Self {
        Self(value.to_owned())
    }
}

impl fmt::Display for ConnectionId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// The name of the database engine of a connection, for example `postgres`.
///
/// It is a name and not a fixed list, because a connector can add an engine.
/// Lower case letters, digits, and `-`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(transparent)]
pub struct Engine(String);

impl Engine {
    /// The name of the built-in PostgreSQL engine.
    pub const POSTGRES: &str = "postgres";
    /// The name of the built-in DuckDB engine.
    pub const DUCKDB: &str = "duckdb";

    #[must_use]
    pub fn new(name: impl Into<String>) -> Self {
        Self(name.into())
    }

    #[must_use]
    pub fn postgres() -> Self {
        Self::new(Self::POSTGRES)
    }

    #[must_use]
    pub fn duckdb() -> Self {
        Self::new(Self::DUCKDB)
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Returns `true` for the engine that a profile has when it does not name one.
    #[must_use]
    pub fn is_default(&self) -> bool {
        self.0 == Self::POSTGRES
    }

    /// Returns `true` if the name has only lower case letters, digits, and `-`,
    /// and starts with a letter.
    #[must_use]
    pub fn is_valid_name(name: &str) -> bool {
        let mut chars = name.chars();
        chars.next().is_some_and(|c| c.is_ascii_lowercase())
            && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
            && name.len() <= 40
    }
}

impl Default for Engine {
    fn default() -> Self {
        Self::postgres()
    }
}

impl fmt::Display for Engine {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// The value of `database` that makes a DuckDB database in memory, without a file.
pub const MEMORY_DATABASE: &str = ":memory:";

/// Environment marker. The UI shows it before the user runs SQL.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "kebab-case")]
pub enum Environment {
    #[default]
    Development,
    Staging,
    Production,
}

/// TLS behaviour. The names and the meanings are the same as the PostgreSQL `sslmode` values.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "kebab-case")]
pub enum TlsMode {
    /// No TLS.
    Disable,
    /// Use TLS if the server supports it. Do not verify the certificate.
    #[default]
    Prefer,
    /// Always use TLS. Do not verify the certificate.
    Require,
    /// Always use TLS. Verify the certificate chain and the host name.
    VerifyFull,
}

/// Where the password of a connection comes from. The password itself is never in a profile.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum SecretSource {
    /// The connection has no password.
    #[default]
    None,
    /// The password is in the credential store of the operating system.
    Keychain,
    /// The password is in an environment variable.
    EnvVar { name: String },
}

fn default_port() -> u16 {
    DEFAULT_PORT
}

fn default_connect_timeout_secs() -> u32 {
    DEFAULT_CONNECT_TIMEOUT_SECS
}

/// Definition of one database connection.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ConnectionProfile {
    pub id: ConnectionId,
    pub name: String,
    /// A profile without this field is a PostgreSQL connection.
    #[serde(default, skip_serializing_if = "Engine::is_default")]
    pub engine: Engine,
    #[serde(default)]
    pub environment: Environment,
    #[serde(default)]
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    /// The database name. For a file engine, the path of the database file. A relative
    /// path starts at the workspace folder.
    pub database: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub user: String,
    #[serde(default)]
    pub tls_mode: TlsMode,
    /// Directory of the Unix socket. When this field has a value, the driver ignores `host`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub socket_path: Option<String>,
    #[serde(default = "default_connect_timeout_secs")]
    pub connect_timeout_secs: u32,
    /// Maximum time for one query. `None` means no limit.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub query_timeout_secs: Option<u32>,
    /// The session refuses statements that change data or the schema.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub read_only: bool,
    /// Extra connection parameters of the database driver.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub params: BTreeMap<String, String>,
    #[serde(default)]
    pub secret: SecretSource,
}

impl ConnectionProfile {
    /// Returns an empty profile that has a new identifier and the default settings.
    /// The UI uses it as the start of a new connection.
    #[must_use]
    pub fn template() -> Self {
        Self {
            id: ConnectionId::generate(),
            name: String::new(),
            engine: Engine::default(),
            environment: Environment::default(),
            host: "localhost".to_owned(),
            port: DEFAULT_PORT,
            database: String::new(),
            user: String::new(),
            tls_mode: TlsMode::default(),
            socket_path: None,
            connect_timeout_secs: DEFAULT_CONNECT_TIMEOUT_SECS,
            query_timeout_secs: None,
            read_only: false,
            params: BTreeMap::new(),
            secret: SecretSource::Keychain,
        }
    }

    /// Returns a copy that has a new identifier and a name that shows it is a copy.
    #[must_use]
    pub fn duplicate(&self) -> Self {
        Self {
            id: ConnectionId::generate(),
            name: format!("{}{COPY_SUFFIX}", self.name),
            ..self.clone()
        }
    }
}

/// Data about the server that a successful connection test returns.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ServerInfo {
    pub version: String,
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub(crate) fn sample_profile() -> ConnectionProfile {
        ConnectionProfile {
            id: ConnectionId::from("11111111-1111-4111-8111-111111111111"),
            name: "Local".to_owned(),
            engine: Engine::postgres(),
            environment: Environment::Development,
            host: "localhost".to_owned(),
            port: DEFAULT_PORT,
            database: "app".to_owned(),
            user: "app_user".to_owned(),
            tls_mode: TlsMode::Prefer,
            socket_path: None,
            connect_timeout_secs: DEFAULT_CONNECT_TIMEOUT_SECS,
            query_timeout_secs: None,
            read_only: false,
            params: BTreeMap::new(),
            secret: SecretSource::Keychain,
        }
    }

    #[test]
    fn duplicate_has_a_new_id_and_a_copy_name() {
        let original = sample_profile();

        let copy = original.duplicate();

        assert_ne!(copy.id, original.id);
        assert_eq!(copy.name, "Local (copy)");
        assert_eq!(copy.host, original.host);
    }

    #[test]
    fn template_has_a_new_id_and_the_default_settings() {
        let first = ConnectionProfile::template();
        let second = ConnectionProfile::template();

        assert_ne!(first.id, second.id);
        assert_eq!(first.port, DEFAULT_PORT);
        assert_eq!(first.secret, SecretSource::Keychain);
    }

    #[test]
    fn generated_ids_are_different() {
        assert_ne!(ConnectionId::generate(), ConnectionId::generate());
    }

    #[test]
    fn deserialize_uses_defaults_for_missing_optional_fields() {
        let json = r#"{"id":"a","name":"n","database":"d","user":"u"}"#;

        let profile: ConnectionProfile = serde_json::from_str(json).unwrap();

        assert_eq!(profile.port, DEFAULT_PORT);
        assert_eq!(profile.tls_mode, TlsMode::Prefer);
        assert_eq!(profile.environment, Environment::Development);
        assert_eq!(profile.secret, SecretSource::None);
        assert_eq!(profile.connect_timeout_secs, DEFAULT_CONNECT_TIMEOUT_SECS);
    }

    #[test]
    fn a_profile_without_an_engine_is_a_postgres_profile() {
        let json = r#"{"id":"a","name":"n","database":"d","user":"u"}"#;

        let profile: ConnectionProfile = serde_json::from_str(json).unwrap();
        let written = serde_json::to_string(&profile).unwrap();

        assert_eq!(profile.engine, Engine::postgres());
        assert!(!written.contains("engine"), "{written}");
    }

    #[test]
    fn a_duckdb_profile_needs_no_user_and_writes_its_engine() {
        let json = r#"{"id":"a","name":"n","engine":"duckdb","database":"data/app.duckdb"}"#;

        let profile: ConnectionProfile = serde_json::from_str(json).unwrap();
        let written = serde_json::to_string(&profile).unwrap();

        assert_eq!(profile.engine, Engine::duckdb());
        assert_eq!(profile.user, "");
        assert!(written.contains(r#""engine":"duckdb""#), "{written}");
        assert!(!written.contains(r#""user""#), "{written}");
    }

    #[test]
    fn an_unknown_engine_name_reads_and_writes_without_a_change() {
        let json = r#"{"id":"a","name":"n","engine":"mongodb","database":"app"}"#;

        let profile: ConnectionProfile = serde_json::from_str(json).unwrap();
        let written = serde_json::to_string(&profile).unwrap();

        assert_eq!(profile.engine.as_str(), "mongodb");
        assert!(written.contains(r#""engine":"mongodb""#), "{written}");
    }

    #[test]
    fn engine_names_have_lower_case_letters_digits_and_dashes() {
        assert!(Engine::is_valid_name("mongodb"));
        assert!(Engine::is_valid_name("sql-server-2"));
        assert!(!Engine::is_valid_name(""));
        assert!(!Engine::is_valid_name("2db"));
        assert!(!Engine::is_valid_name("Mongo"));
        assert!(!Engine::is_valid_name("../evil"));
    }

    #[test]
    fn secret_source_serializes_with_a_type_tag() {
        let source = SecretSource::EnvVar {
            name: "PGPASSWORD".to_owned(),
        };

        let json = serde_json::to_string(&source).unwrap();

        assert_eq!(json, r#"{"type":"env-var","name":"PGPASSWORD"}"#);
    }
}
