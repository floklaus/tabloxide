//! Integration tests against a real PostgreSQL server in a Docker container.
//!
//! These tests need Docker. Run them with:
//! `cargo test -p tabloxide-adapter-postgres -- --ignored`

use std::collections::BTreeMap;
use tabloxide_adapter_postgres::test_connection;
use tabloxide_core::{
    ConnectErrorKind, ConnectionId, ConnectionProfile, Environment, Secret, SecretSource, TlsMode,
};
use testcontainers_modules::postgres::Postgres;
use testcontainers_modules::testcontainers::runners::AsyncRunner;
use testcontainers_modules::testcontainers::{ContainerAsync, ImageExt};

const POSTGRES_TAG: &str = "17";
const USER: &str = "postgres";
const PASSWORD: &str = "postgres";
const DATABASE: &str = "postgres";

/// The Debian image contains a self-signed certificate that the server can use.
const TLS_ARGS: [&str; 7] = [
    "postgres",
    "-c",
    "ssl=on",
    "-c",
    "ssl_cert_file=/etc/ssl/certs/ssl-cert-snakeoil.pem",
    "-c",
    "ssl_key_file=/etc/ssl/private/ssl-cert-snakeoil.key",
];

async fn start_server(with_tls: bool) -> (ContainerAsync<Postgres>, ConnectionProfile) {
    let image = Postgres::default().with_tag(POSTGRES_TAG);
    let container = if with_tls {
        image.with_cmd(TLS_ARGS).start().await
    } else {
        image.start().await
    }
    .expect("the PostgreSQL container must start");
    let profile = ConnectionProfile {
        id: ConnectionId::from("test"),
        name: "Test".to_owned(),
        environment: Environment::Development,
        host: container.get_host().await.unwrap().to_string(),
        port: container.get_host_port_ipv4(5432).await.unwrap(),
        database: DATABASE.to_owned(),
        user: USER.to_owned(),
        tls_mode: TlsMode::Disable,
        socket_path: None,
        connect_timeout_secs: 5,
        query_timeout_secs: None,
        params: BTreeMap::new(),
        secret: SecretSource::Keychain,
    };
    (container, profile)
}

async fn error_kind(profile: &ConnectionProfile, password: Option<&str>) -> ConnectErrorKind {
    let secret = password.map(Secret::new);
    test_connection(profile, secret.as_ref())
        .await
        .expect_err("the connection must fail")
        .kind
}

#[tokio::test]
#[ignore = "needs Docker"]
async fn server_without_tls() {
    let (_container, profile) = start_server(false).await;
    let password = Secret::new(PASSWORD);

    // A correct profile connects and returns the server version.
    let info = test_connection(&profile, Some(&password)).await.unwrap();
    assert!(info.version.starts_with(POSTGRES_TAG), "{}", info.version);

    // `prefer` continues without TLS when the server does not support TLS.
    let prefer = ConnectionProfile {
        tls_mode: TlsMode::Prefer,
        ..profile.clone()
    };
    assert!(test_connection(&prefer, Some(&password)).await.is_ok());

    // `require` fails when the server does not support TLS.
    let require = ConnectionProfile {
        tls_mode: TlsMode::Require,
        ..profile.clone()
    };
    assert_eq!(
        error_kind(&require, Some(PASSWORD)).await,
        ConnectErrorKind::Tls
    );

    // An incorrect password is an authentication error.
    assert_eq!(
        error_kind(&profile, Some("wrong")).await,
        ConnectErrorKind::Authentication
    );

    // No password is a missing-secret error.
    assert_eq!(
        error_kind(&profile, None).await,
        ConnectErrorKind::MissingSecret
    );

    // An unknown database is a database-not-found error.
    let wrong_database = ConnectionProfile {
        database: "no_such_database".to_owned(),
        ..profile.clone()
    };
    assert_eq!(
        error_kind(&wrong_database, Some(PASSWORD)).await,
        ConnectErrorKind::DatabaseNotFound
    );

    // An extra parameter goes to the server.
    let with_param = ConnectionProfile {
        params: BTreeMap::from([("application_name".to_owned(), "integration".to_owned())]),
        ..profile.clone()
    };
    assert!(test_connection(&with_param, Some(&password)).await.is_ok());

    // The error detail never contains the password.
    let error = test_connection(&wrong_database, Some(&Secret::new("s3cr3t-value")))
        .await
        .unwrap_err();
    assert!(!format!("{error:?}").contains("s3cr3t-value"));
}

#[tokio::test]
#[ignore = "needs Docker"]
async fn server_with_a_self_signed_certificate() {
    let (_container, profile) = start_server(true).await;
    let password = Secret::new(PASSWORD);

    // `require` encrypts the connection and does not verify the certificate.
    let require = ConnectionProfile {
        tls_mode: TlsMode::Require,
        ..profile.clone()
    };
    assert!(test_connection(&require, Some(&password)).await.is_ok());

    // `prefer` uses TLS when the server supports it.
    let prefer = ConnectionProfile {
        tls_mode: TlsMode::Prefer,
        ..profile.clone()
    };
    assert!(test_connection(&prefer, Some(&password)).await.is_ok());

    // `verify-full` rejects a certificate that no trusted authority signed.
    let verify_full = ConnectionProfile {
        tls_mode: TlsMode::VerifyFull,
        ..profile.clone()
    };
    assert_eq!(
        error_kind(&verify_full, Some(PASSWORD)).await,
        ConnectErrorKind::Tls
    );
}

#[tokio::test]
async fn closed_port_is_an_unreachable_error() {
    // Bind a port and release it, so that no server listens on it.
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    let profile = ConnectionProfile {
        id: ConnectionId::from("test"),
        name: "Test".to_owned(),
        environment: Environment::Development,
        host: "127.0.0.1".to_owned(),
        port,
        database: DATABASE.to_owned(),
        user: USER.to_owned(),
        tls_mode: TlsMode::Disable,
        socket_path: None,
        connect_timeout_secs: 2,
        query_timeout_secs: None,
        params: BTreeMap::new(),
        secret: SecretSource::None,
    };

    assert_eq!(
        error_kind(&profile, None).await,
        ConnectErrorKind::Unreachable
    );
}
