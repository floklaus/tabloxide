//! Makes a MongoDB client from a connection profile, and maps the driver errors.

use mongodb::bson::doc;
use mongodb::error::{Error, ErrorKind};
use mongodb::options::{ClientOptions, Credential, Tls, TlsOptions};
use mongodb::{Client, Database};
use std::time::Duration;
use tabloxide_core::{
    ConnectError, ConnectErrorKind, ConnectionProfile, QueryError, QueryErrorKind, Secret,
    ServerInfo, TlsMode,
};

/// The profile parameter that selects a DNS seed list (`mongodb+srv://`), for MongoDB Atlas.
pub const SRV_PARAM: &str = "srv";
const AUTH_SOURCE_PARAM: &str = "authSource";
const AUTH_MECHANISM_PARAM: &str = "authMechanism";

/// Parameters that go into the connection string without a change.
const URI_PARAMS: [&str; 9] = [
    "replicaSet",
    "directConnection",
    "readPreference",
    "retryWrites",
    "retryReads",
    "w",
    "appName",
    "compressors",
    "loadBalanced",
];

/// The MongoDB error code for a statement that used all of its `maxTimeMS`.
const MAX_TIME_EXPIRED: i32 = 50;

fn invalid(message: impl Into<String>) -> ConnectError {
    ConnectError::new(ConnectErrorKind::InvalidConfiguration, message)
}

fn is_valid_host(host: &str) -> bool {
    !host.is_empty()
        && host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ':' | ','))
}

/// Puts an IPv6 address in brackets, as a connection string needs it.
fn host_part(host: &str) -> String {
    if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]")
    } else {
        host.to_owned()
    }
}

fn query_part(profile: &ConnectionProfile) -> Result<String, ConnectError> {
    let mut pairs = Vec::new();
    for (key, value) in &profile.params {
        if key == SRV_PARAM || key == AUTH_SOURCE_PARAM || key == AUTH_MECHANISM_PARAM {
            continue;
        }
        if !URI_PARAMS.contains(&key.as_str()) {
            return Err(invalid(format!(
                "The parameter `{key}` is not supported. Use one of: authSource, authMechanism, srv, {}.",
                URI_PARAMS.join(", ")
            )));
        }
        let is_plain = value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ',' | ':'));
        if !is_plain {
            return Err(invalid(format!(
                "The value of `{key}` has characters that are not allowed."
            )));
        }
        pairs.push(format!("{key}={value}"));
    }
    Ok(pairs.join("&"))
}

/// Returns the connection string without the user, the password, and the TLS settings.
fn connection_string(profile: &ConnectionProfile) -> Result<String, ConnectError> {
    if !is_valid_host(&profile.host) {
        return Err(invalid("Enter a host name or an IP address."));
    }
    let is_srv = profile
        .params
        .get(SRV_PARAM)
        .is_some_and(|value| value == "true");
    let query = query_part(profile)?;
    let address = if is_srv {
        format!("mongodb+srv://{}", host_part(&profile.host))
    } else {
        format!("mongodb://{}:{}", host_part(&profile.host), profile.port)
    };
    Ok(if query.is_empty() {
        format!("{address}/")
    } else {
        format!("{address}/?{query}")
    })
}

fn tls(mode: TlsMode, is_srv: bool) -> Tls {
    let options = |allow_invalid: bool| {
        Tls::Enabled(
            TlsOptions::builder()
                .allow_invalid_certificates(allow_invalid)
                .build(),
        )
    };
    match mode {
        TlsMode::Disable => Tls::Disabled,
        // MongoDB has no TLS that falls back to a plain connection. Thus `prefer` is a
        // plain connection, except for a DNS seed list, which needs TLS.
        TlsMode::Prefer if is_srv => options(false),
        TlsMode::Prefer => Tls::Disabled,
        TlsMode::Require => options(true),
        TlsMode::VerifyFull => options(false),
    }
}

/// Makes the client options of a profile.
///
/// # Errors
///
/// Returns an error if a setting is not valid, or if the DNS seed list cannot be read.
pub async fn client_options(
    profile: &ConnectionProfile,
    password: Option<&Secret>,
) -> Result<ClientOptions, ConnectError> {
    let uri = connection_string(profile)?;
    let mut options = ClientOptions::parse(&uri)
        .await
        .map_err(|error| connect_error(&error))?;
    let timeout = Duration::from_secs(u64::from(profile.connect_timeout_secs.max(1)));
    options.connect_timeout = Some(timeout);
    options.server_selection_timeout = Some(timeout);
    options.app_name = Some("Tabloxide".to_owned());
    let is_srv = profile
        .params
        .get(SRV_PARAM)
        .is_some_and(|value| value == "true");
    options.tls = Some(tls(profile.tls_mode, is_srv));
    if !profile.user.is_empty() {
        let mechanism =
            match profile.params.get(AUTH_MECHANISM_PARAM) {
                Some(name) => Some(name.parse().map_err(|_| {
                    invalid(format!("`{name}` is not an authentication mechanism."))
                })?),
                None => None,
            };
        options.credential = Some(
            Credential::builder()
                .username(profile.user.clone())
                .password(password.map(|secret| secret.expose().to_owned()))
                .source(profile.params.get(AUTH_SOURCE_PARAM).cloned())
                .mechanism(mechanism)
                .build(),
        );
    }
    Ok(options)
}

/// Opens a client and checks the connection and the authentication.
///
/// # Errors
///
/// Returns an error if the server does not answer or refuses the user.
pub async fn open(
    profile: &ConnectionProfile,
    password: Option<&Secret>,
) -> Result<(Client, ServerInfo), ConnectError> {
    let options = client_options(profile, password).await?;
    let client = Client::with_options(options).map_err(|error| connect_error(&error))?;
    let database = client.database(&database_name(profile));
    let info = server_info(&database)
        .await
        .map_err(|error| connect_error(&error))?;
    Ok((client, info))
}

/// The database of the profile, or `test` as in the MongoDB shell.
#[must_use]
pub fn database_name(profile: &ConnectionProfile) -> String {
    if profile.database.trim().is_empty() {
        "test".to_owned()
    } else {
        profile.database.trim().to_owned()
    }
}

/// Reads the server version. The `ping` before it checks the authentication.
async fn server_info(database: &Database) -> Result<ServerInfo, Error> {
    database.run_command(doc! { "ping": 1 }).await?;
    let build = database.run_command(doc! { "buildInfo": 1 }).await?;
    Ok(ServerInfo {
        version: build.get_str("version").unwrap_or("unknown").to_owned(),
    })
}

/// Maps a driver error of a connection to a connection error with advice.
#[must_use]
pub fn connect_error(error: &Error) -> ConnectError {
    let kind = match error.kind.as_ref() {
        ErrorKind::Authentication { .. } => ConnectErrorKind::Authentication,
        ErrorKind::InvalidArgument { .. } => ConnectErrorKind::InvalidConfiguration,
        ErrorKind::DnsResolve { .. } | ErrorKind::Io(_) => ConnectErrorKind::Unreachable,
        ErrorKind::ServerSelection { message, .. } => {
            if message.to_ascii_lowercase().contains("certificate") || message.contains("TLS") {
                ConnectErrorKind::Tls
            } else if message.to_ascii_lowercase().contains("timed out") {
                ConnectErrorKind::Timeout
            } else {
                ConnectErrorKind::Unreachable
            }
        }
        ErrorKind::Command(command) if command.code == 18 => ConnectErrorKind::Authentication,
        _ => ConnectErrorKind::Other,
    };
    ConnectError::new(kind, error.to_string())
}

/// Maps a driver error of a statement to a query error.
#[must_use]
pub fn query_error(error: &Error) -> QueryError {
    match error.kind.as_ref() {
        ErrorKind::Command(command) => QueryError {
            code: Some(format!("{} ({})", command.code_name, command.code)),
            ..QueryError::new(
                if command.code == MAX_TIME_EXPIRED {
                    QueryErrorKind::Timeout
                } else {
                    QueryErrorKind::Database
                },
                command.message.clone(),
            )
        },
        ErrorKind::Write(_) | ErrorKind::InsertMany(_) | ErrorKind::BulkWrite(_) => {
            QueryError::new(QueryErrorKind::Database, error.to_string())
        }
        ErrorKind::Io(_)
        | ErrorKind::ServerSelection { .. }
        | ErrorKind::ConnectionPoolCleared { .. } => {
            QueryError::new(QueryErrorKind::ConnectionLost, error.to_string())
        }
        _ => QueryError::new(QueryErrorKind::Other, error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile() -> ConnectionProfile {
        let mut profile = ConnectionProfile::template();
        profile.host = "db.example.com".to_owned();
        profile.port = 27018;
        profile
    }

    #[test]
    fn the_connection_string_has_the_host_the_port_and_the_parameters() {
        let mut profile = profile();
        profile
            .params
            .insert("replicaSet".to_owned(), "rs0".to_owned());
        profile
            .params
            .insert(AUTH_SOURCE_PARAM.to_owned(), "admin".to_owned());

        assert_eq!(
            connection_string(&profile).unwrap(),
            "mongodb://db.example.com:27018/?replicaSet=rs0"
        );
    }

    #[test]
    fn a_seed_list_has_no_port_and_an_ipv6_address_has_brackets() {
        let mut srv = profile();
        srv.params.insert(SRV_PARAM.to_owned(), "true".to_owned());
        let mut ipv6 = profile();
        ipv6.host = "::1".to_owned();

        assert_eq!(
            connection_string(&srv).unwrap(),
            "mongodb+srv://db.example.com/"
        );
        assert_eq!(connection_string(&ipv6).unwrap(), "mongodb://[::1]:27018/");
    }

    #[test]
    fn refuses_parameters_and_hosts_that_could_change_the_connection_string() {
        let mut unknown = profile();
        unknown
            .params
            .insert("tlsInsecure".to_owned(), "true".to_owned());
        let mut injected = profile();
        injected
            .params
            .insert("appName".to_owned(), "x&tls=false".to_owned());
        let mut host = profile();
        host.host = "user:pw@evil/".to_owned();

        for profile in [unknown, injected, host] {
            assert_eq!(
                connection_string(&profile).unwrap_err().kind,
                ConnectErrorKind::InvalidConfiguration
            );
        }
    }

    #[test]
    fn prefer_is_a_plain_connection_except_for_a_seed_list() {
        assert!(matches!(tls(TlsMode::Prefer, false), Tls::Disabled));
        assert!(matches!(tls(TlsMode::Prefer, true), Tls::Enabled(_)));
        assert!(matches!(tls(TlsMode::Require, false), Tls::Enabled(_)));
    }

    #[test]
    fn an_empty_database_is_the_test_database() {
        let mut profile = profile();
        profile.database = " ".to_owned();

        assert_eq!(database_name(&profile), "test");
    }
}
