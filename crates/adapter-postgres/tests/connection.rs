//! Integration tests against a real PostgreSQL server in a Docker container.
//!
//! These tests need Docker. Run them with:
//! `cargo test -p tabloxide-adapter-postgres -- --ignored`

mod common;

use common::{DATABASE, PASSWORD, POSTGRES_TAG, USER, start_server};
use std::collections::BTreeMap;
use tabloxide_adapter_postgres::test_connection;
use tabloxide_core::{
    ConnectErrorKind, ConnectionId, ConnectionProfile, Environment, Secret, SecretSource, TlsMode,
};

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
        read_only: false,
        engine: tabloxide_core::Engine::postgres(),
        params: BTreeMap::new(),
        secret: SecretSource::None,
    };

    assert_eq!(
        error_kind(&profile, None).await,
        ConnectErrorKind::Unreachable
    );
}
