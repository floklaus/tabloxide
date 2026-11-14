use crate::error::CommandError;
use crate::state::{AppState, SessionId};
use tabloxide_core::{RelationDetail, RelationInfo, SchemaInfo, StatementReport};
use tauri::State;

/// Number of rows in the sample of a table.
const SAMPLE_ROWS: u32 = 100;

/// Lists the schemas of the database of a session.
#[tauri::command]
#[specta::specta]
pub async fn schema_list(
    state: State<'_, AppState>,
    session_id: SessionId,
) -> Result<Vec<SchemaInfo>, CommandError> {
    let session = state.session(session_id)?;
    Ok(session.schemas().await?)
}

/// Lists the tables and the views of one schema.
#[tauri::command]
#[specta::specta]
pub async fn schema_relations(
    state: State<'_, AppState>,
    session_id: SessionId,
    schema: String,
) -> Result<Vec<RelationInfo>, CommandError> {
    let session = state.session(session_id)?;
    Ok(session.relations(&schema).await?)
}

/// Reads the columns, the indexes, and the constraints of one table or view.
#[tauri::command]
#[specta::specta]
pub async fn schema_relation_detail(
    state: State<'_, AppState>,
    session_id: SessionId,
    schema: String,
    relation: String,
) -> Result<RelationDetail, CommandError> {
    let session = state.session(session_id)?;
    Ok(session.relation_detail(&schema, &relation).await?)
}

/// Reads the first rows of one table or view. The query history does not record this read.
#[tauri::command]
#[specta::specta]
pub async fn schema_sample(
    state: State<'_, AppState>,
    session_id: SessionId,
    schema: String,
    relation: String,
) -> Result<StatementReport, CommandError> {
    let session = state.session(session_id)?;
    session
        .sample(&schema, &relation, SAMPLE_ROWS)
        .await
        .ok_or_else(|| CommandError::internal("The sample statement did not run."))
}
