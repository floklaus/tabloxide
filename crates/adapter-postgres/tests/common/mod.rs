//! A PostgreSQL server in a Docker container for the integration tests.
#![allow(
    dead_code,
    reason = "each test file uses a different part of this module"
)]

use std::collections::BTreeMap;
use tabloxide_core::{ConnectionId, ConnectionProfile, Environment, SecretSource, TlsMode};
use testcontainers_modules::postgres::Postgres;
use testcontainers_modules::testcontainers::runners::AsyncRunner;
use testcontainers_modules::testcontainers::{ContainerAsync, ImageExt};

pub const POSTGRES_TAG: &str = "17";
pub const USER: &str = "postgres";
pub const PASSWORD: &str = "postgres";
pub const DATABASE: &str = "postgres";

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

pub async fn start_server(with_tls: bool) -> (ContainerAsync<Postgres>, ConnectionProfile) {
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
        read_only: false,
        engine: tabloxide_core::Engine::postgres(),
        params: BTreeMap::new(),
        secret: SecretSource::Keychain,
    };
    (container, profile)
}
