//! Helpers for the tests of the DuckDB adapter. The tests need no server.
#![allow(dead_code)]

use std::collections::BTreeMap;
use std::path::Path;
use tabloxide_adapter_duckdb::DuckDbAdapter;
use tabloxide_core::{
    ConnectError, ConnectionId, ConnectionProfile, DbAdapter, Engine, Environment, Page,
    QueryError, SecretSource, Session, TlsMode,
};

pub fn profile(database: &str) -> ConnectionProfile {
    ConnectionProfile {
        id: ConnectionId::from("duck"),
        name: "Duck".to_owned(),
        engine: Engine::duckdb(),
        environment: Environment::Development,
        host: String::new(),
        port: 0,
        database: database.to_owned(),
        user: String::new(),
        tls_mode: TlsMode::Disable,
        socket_path: None,
        connect_timeout_secs: 10,
        query_timeout_secs: None,
        read_only: false,
        params: BTreeMap::new(),
        secret: SecretSource::None,
    }
}

pub async fn try_connect(
    adapter: &DuckDbAdapter,
    profile: &ConnectionProfile,
    root: &Path,
) -> Result<Box<dyn Session>, ConnectError> {
    adapter.connect(profile, None, root).await
}

pub async fn connect(
    adapter: &DuckDbAdapter,
    profile: &ConnectionProfile,
    root: &Path,
) -> Box<dyn Session> {
    try_connect(adapter, profile, root)
        .await
        .expect("the session must open")
}

/// Runs a statement and reads its complete result.
pub async fn run(session: &mut dyn Session, statement: &str) -> Result<Page, QueryError> {
    let mut stream = session.execute(statement).await?;
    let mut rows = Vec::new();
    loop {
        let page = stream.next_page(1000).await?;
        rows.extend(page.rows);
        if page.end.is_some() {
            return Ok(Page {
                rows,
                end: page.end,
            });
        }
    }
}

/// Runs a statement and returns its rows.
pub async fn rows(session: &mut dyn Session, statement: &str) -> Vec<Vec<Option<String>>> {
    run(session, statement).await.unwrap().rows
}

pub fn text(value: &str) -> Option<String> {
    Some(value.to_owned())
}
