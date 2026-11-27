//! The MongoDB connector of Tabloxide. Section 10 of `docs/Connector Design.md` gives
//! the design.
//!
//! The user writes a subset of the MongoDB shell syntax. The core parses it (for the
//! guardrails), and this connector translates the same parse tree into one database
//! command. The connector runs no JavaScript.

mod catalog;
mod connect;
mod plan;
mod rows;
mod session;
mod value;

use async_trait::async_trait;
use session::MongoSession;
use std::path::Path;
use tabloxide_core::{
    Capabilities, ConnectError, ConnectionProfile, DbAdapter, Engine, EngineInfo, QueryLanguage,
    Secret, ServerInfo, Session,
};

/// The default port of a MongoDB server.
pub const DEFAULT_PORT: u16 = 27017;

/// The MongoDB engine.
#[derive(Debug, Default)]
pub struct MongoAdapter;

#[async_trait]
impl DbAdapter for MongoAdapter {
    fn info(&self) -> EngineInfo {
        EngineInfo {
            engine: Engine::new("mongodb"),
            display_name: "MongoDB".to_owned(),
            language: QueryLanguage::MongodbShell,
            default_port: Some(DEFAULT_PORT),
            capabilities: Capabilities {
                cancel: true,
                unix_socket: false,
                file_database: false,
                explain_plan: true,
                measured_plan: true,
            },
        }
    }

    async fn test_connection(
        &self,
        profile: &ConnectionProfile,
        password: Option<&Secret>,
        _workspace_root: &Path,
    ) -> Result<ServerInfo, ConnectError> {
        let (client, info) = connect::open(profile, password).await?;
        client.shutdown().await;
        Ok(info)
    }

    async fn connect(
        &self,
        profile: &ConnectionProfile,
        password: Option<&Secret>,
        _workspace_root: &Path,
    ) -> Result<Box<dyn Session>, ConnectError> {
        let (client, info) = connect::open(profile, password).await?;
        Ok(Box::new(MongoSession::new(
            client,
            connect::database_name(profile),
            info,
            profile.read_only,
            profile.query_timeout_secs,
        )))
    }
}
