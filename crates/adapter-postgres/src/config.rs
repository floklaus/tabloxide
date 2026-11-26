//! Conversion of a connection profile to a driver configuration.

use std::collections::BTreeMap;
use std::time::Duration;
use tabloxide_core::{ConnectError, ConnectErrorKind, ConnectionProfile, Secret, TlsMode};
use tokio_postgres::Config;
use tokio_postgres::config::SslMode;

const APPLICATION_NAME: &str = "Tabloxide";

fn invalid(detail: impl Into<String>) -> ConnectError {
    ConnectError::new(ConnectErrorKind::InvalidConfiguration, detail)
}

fn is_valid_param_name(name: &str) -> bool {
    !name.is_empty() && name.chars().all(|c| c.is_ascii_lowercase() || c == '_')
}

fn quote_value(value: &str) -> String {
    let escaped = value.replace('\\', "\\\\").replace('\'', "\\'");
    format!("'{escaped}'")
}

/// Builds a `key='value'` connection string from the extra parameters.
/// The driver parses it, so the driver decides which parameters it supports.
fn params_to_conninfo(params: &BTreeMap<String, String>) -> Result<String, ConnectError> {
    params
        .iter()
        .map(|(name, value)| {
            if is_valid_param_name(name) {
                Ok(format!("{name}={}", quote_value(value)))
            } else {
                Err(invalid(format!("`{name}` is not a valid parameter name.")))
            }
        })
        .collect::<Result<Vec<_>, _>>()
        .map(|pairs| pairs.join(" "))
}

fn ssl_mode(mode: TlsMode) -> SslMode {
    match mode {
        TlsMode::Disable => SslMode::Disable,
        TlsMode::Prefer => SslMode::Prefer,
        TlsMode::Require | TlsMode::VerifyFull => SslMode::Require,
    }
}

#[cfg(unix)]
fn set_socket_dir(config: &mut Config, dir: &str) -> Result<(), ConnectError> {
    config.host_path(dir);
    Ok(())
}

#[cfg(not(unix))]
fn set_socket_dir(_: &mut Config, _: &str) -> Result<(), ConnectError> {
    Err(invalid(
        "This operating system does not support Unix socket connections. Remove the socket directory.",
    ))
}

pub(crate) fn build_config(
    profile: &ConnectionProfile,
    password: Option<&Secret>,
) -> Result<Config, ConnectError> {
    let mut config: Config = params_to_conninfo(&profile.params)?
        .parse()
        .map_err(|e: tokio_postgres::Error| invalid(format!("Extra parameters: {e}")))?;

    match profile
        .socket_path
        .as_deref()
        .filter(|p| !p.trim().is_empty())
    {
        Some(dir) => set_socket_dir(&mut config, dir)?,
        None => {
            config.host(&profile.host);
        }
    }
    config
        .port(profile.port)
        .dbname(&profile.database)
        .user(&profile.user)
        .ssl_mode(ssl_mode(profile.tls_mode))
        .connect_timeout(Duration::from_secs(u64::from(profile.connect_timeout_secs)));
    if config.get_application_name().is_none() {
        config.application_name(APPLICATION_NAME);
    }
    if let Some(password) = password {
        config.password(password.expose());
    }
    Ok(config)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tabloxide_core::{ConnectionId, Environment, SecretSource};
    use tokio_postgres::config::Host;

    fn profile() -> ConnectionProfile {
        ConnectionProfile {
            id: ConnectionId::from("a"),
            name: "Test".to_owned(),
            environment: Environment::Development,
            host: "db.example.com".to_owned(),
            port: 6543,
            database: "app".to_owned(),
            user: "app_user".to_owned(),
            tls_mode: TlsMode::Require,
            socket_path: None,
            connect_timeout_secs: 7,
            query_timeout_secs: None,
            read_only: false,
            engine: tabloxide_core::Engine::postgres(),
            params: BTreeMap::new(),
            secret: SecretSource::Keychain,
        }
    }

    fn with_params(pairs: &[(&str, &str)]) -> ConnectionProfile {
        ConnectionProfile {
            params: pairs
                .iter()
                .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
                .collect(),
            ..profile()
        }
    }

    #[test]
    fn sets_the_profile_fields_on_the_driver_configuration() {
        let config = build_config(&profile(), Some(&Secret::new("pw"))).unwrap();

        assert_eq!(config.get_hosts(), [Host::Tcp("db.example.com".to_owned())]);
        assert_eq!(config.get_ports(), [6543]);
        assert_eq!(config.get_dbname(), Some("app"));
        assert_eq!(config.get_user(), Some("app_user"));
        assert_eq!(config.get_password(), Some(b"pw".as_slice()));
        assert_eq!(config.get_ssl_mode(), SslMode::Require);
        assert_eq!(config.get_connect_timeout(), Some(&Duration::from_secs(7)));
        assert_eq!(config.get_application_name(), Some("Tabloxide"));
    }

    #[test]
    fn sets_no_password_when_the_connection_has_none() {
        let config = build_config(&profile(), None).unwrap();

        assert_eq!(config.get_password(), None);
    }

    #[test]
    fn an_extra_parameter_replaces_the_default_application_name() {
        let config =
            build_config(&with_params(&[("application_name", "it's \\ mine")]), None).unwrap();

        assert_eq!(config.get_application_name(), Some("it's \\ mine"));
    }

    #[test]
    fn rejects_a_parameter_that_the_driver_does_not_support() {
        let error = build_config(&with_params(&[("no_such_parameter", "1")]), None).unwrap_err();

        assert_eq!(error.kind, ConnectErrorKind::InvalidConfiguration);
    }

    #[test]
    fn rejects_a_parameter_name_that_has_invalid_characters() {
        let error = build_config(&with_params(&[("a b", "1")]), None).unwrap_err();

        assert_eq!(error.kind, ConnectErrorKind::InvalidConfiguration);
    }

    #[cfg(unix)]
    #[test]
    fn uses_the_socket_directory_as_the_host() {
        let profile = ConnectionProfile {
            socket_path: Some("/var/run/postgresql".to_owned()),
            ..profile()
        };

        let config = build_config(&profile, None).unwrap();

        assert_eq!(
            config.get_hosts(),
            [Host::Unix("/var/run/postgresql".into())]
        );
    }
}
