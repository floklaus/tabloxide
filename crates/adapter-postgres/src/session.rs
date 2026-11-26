//! A session and its cancel handle.

use crate::stream::PgStream;
use crate::{columns, error, introspect, tls};
use async_trait::async_trait;
use std::sync::Arc;
use std::time::Duration;
use tabloxide_core::{
    CancelHandle, QueryError, QueryErrorKind, RelationDetail, RelationInfo, ResultStream,
    SchemaInfo, ServerInfo, Session, TlsMode,
};
use tokio_postgres::{CancelToken, Client, NoTls};

/// Sends a cancel request on a new connection, as the PostgreSQL protocol specifies.
pub(crate) struct PgCancel {
    token: CancelToken,
    tls_mode: TlsMode,
}

#[async_trait]
impl CancelHandle for PgCancel {
    async fn cancel(&self) -> Result<(), QueryError> {
        let result = match self.tls_mode {
            TlsMode::Disable => self.token.cancel_query(NoTls).await,
            mode => {
                let connector = tls::connector(mode)
                    .map_err(|e| QueryError::new(QueryErrorKind::Other, e.detail))?;
                self.token.cancel_query(connector).await
            }
        };
        result.map_err(|e| error::map_query_error(&e))
    }
}

pub(crate) struct PgSession {
    client: Client,
    info: ServerInfo,
    cancel: Arc<PgCancel>,
    query_timeout: Option<Duration>,
}

impl PgSession {
    pub(crate) fn new(
        client: Client,
        info: ServerInfo,
        tls_mode: TlsMode,
        query_timeout: Option<Duration>,
    ) -> Self {
        let cancel = Arc::new(PgCancel {
            token: client.cancel_token(),
            tls_mode,
        });
        Self {
            client,
            info,
            cancel,
            query_timeout,
        }
    }
}

#[async_trait]
impl Session for PgSession {
    fn server_info(&self) -> &ServerInfo {
        &self.info
    }

    fn cancel_handle(&self) -> Arc<dyn CancelHandle> {
        Arc::clone(&self.cancel) as Arc<dyn CancelHandle>
    }

    async fn execute(&mut self, statement: &str) -> Result<Box<dyn ResultStream>, QueryError> {
        let types = columns::column_types(&self.client, statement).await;
        let messages = self
            .client
            .simple_query_raw(statement)
            .await
            .map_err(|e| error::map_query_error(&e))?;
        let cancel = Arc::clone(&self.cancel) as Arc<dyn CancelHandle>;
        let stream = PgStream::start(messages, types, cancel, self.query_timeout).await?;
        Ok(Box::new(stream))
    }

    async fn schemas(&mut self) -> Result<Vec<SchemaInfo>, QueryError> {
        introspect::schemas(&self.client).await
    }

    async fn relations(&mut self, schema: &str) -> Result<Vec<RelationInfo>, QueryError> {
        introspect::relations(&self.client, schema).await
    }

    async fn relation_detail(
        &mut self,
        schema: &str,
        relation: &str,
    ) -> Result<RelationDetail, QueryError> {
        introspect::relation_detail(&self.client, schema, relation).await
    }

    async fn sample_statement(&self, schema: &str, relation: &str, limit: u32) -> String {
        introspect::sample_statement(schema, relation, limit)
    }
}
