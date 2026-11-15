//! The database interface that the other parts of the application use.

use crate::{
    Column, ConnectError, ConnectionProfile, Page, QueryError, RelationDetail, RelationInfo,
    SchemaInfo, Secret, ServerInfo,
};
use async_trait::async_trait;
use serde::Serialize;
use std::path::Path;
use std::sync::Arc;

/// Functions that a database engine supports. The UI hides a function that is not supported.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct Capabilities {
    pub cancel: bool,
    pub unix_socket: bool,
}

/// A database engine.
#[async_trait]
pub trait DbAdapter: Send + Sync {
    fn capabilities(&self) -> Capabilities;

    /// Opens a connection, reads the server version, and closes the connection.
    ///
    /// `workspace_root` is the folder of the workspace. A file engine uses it as the
    /// start of a relative path. A server engine ignores it.
    async fn test_connection(
        &self,
        profile: &ConnectionProfile,
        password: Option<&Secret>,
        workspace_root: &Path,
    ) -> Result<ServerInfo, ConnectError>;

    /// Opens a session. One session runs one statement at a time.
    async fn connect(
        &self,
        profile: &ConnectionProfile,
        password: Option<&Secret>,
        workspace_root: &Path,
    ) -> Result<Box<dyn Session>, ConnectError>;
}

/// One connection to a database.
#[async_trait]
pub trait Session: Send {
    fn server_info(&self) -> &ServerInfo;

    /// Returns a handle that can cancel the active statement while `execute` or a
    /// result stream uses the session.
    fn cancel_handle(&self) -> Arc<dyn CancelHandle>;

    /// Starts one statement and waits for the start of its result.
    ///
    /// Read the result stream to its end, or close it, before the next call.
    async fn execute(&mut self, statement: &str) -> Result<Box<dyn ResultStream>, QueryError>;

    /// Lists the schemas of the database. User schemas are first.
    async fn schemas(&mut self) -> Result<Vec<SchemaInfo>, QueryError>;

    /// Lists the tables and the views of one schema, in alphabetical sequence.
    async fn relations(&mut self, schema: &str) -> Result<Vec<RelationInfo>, QueryError>;

    /// Reads the columns, the indexes, and the constraints of one table or view.
    async fn relation_detail(
        &mut self,
        schema: &str,
        relation: &str,
    ) -> Result<RelationDetail, QueryError>;

    /// Returns a statement that reads a maximum of `limit` rows of a table or view.
    /// The statement has the identifiers in quotes.
    fn sample_statement(&self, schema: &str, relation: &str, limit: u32) -> String;
}

/// Cancels the active statement of a session.
#[async_trait]
pub trait CancelHandle: Send + Sync {
    async fn cancel(&self) -> Result<(), QueryError>;
}

/// The result of one statement. The stream reads rows from the server only on request.
#[async_trait]
pub trait ResultStream: Send {
    /// The columns of the result, or `None` if the statement does not return rows.
    fn columns(&self) -> Option<&[Column]>;

    /// Reads a maximum of `max_rows` rows.
    async fn next_page(&mut self, max_rows: usize) -> Result<Page, QueryError>;

    /// Closes the result. If the statement is not complete, this cancels it.
    async fn close(self: Box<Self>);
}
