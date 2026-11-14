use crate::error::CommandError;
use crate::state::{AppState, SessionId};
use serde::Serialize;
use specta::Type;
use std::path::{Path, PathBuf};
use tabloxide_core::{
    FetchedPage, QueryError, QueryErrorKind, QuerySession, ResultId, RunLimits, RunReport,
    RunTarget,
};
use tauri::State;
use tokio::io::BufWriter;

/// Number of rows in one page of a result.
const PAGE_ROWS: usize = 500;

/// Maximum number of rows that the application keeps from a result that it cannot page.
const BUFFERED_ROWS: usize = 1000;

const LIMITS: RunLimits = RunLimits {
    page_rows: PAGE_ROWS,
    buffered_rows: BUFFERED_ROWS,
};

/// Result of a CSV export. A failed statement is a normal result, not a command error.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum ExportResult {
    Exported {
        #[specta(type = u32)]
        rows: u64,
    },
    Failed {
        error: QueryError,
    },
}

/// Runs the statements that `target` selects from `sql`, in sequence.
/// The run stops at the first failure. The report has one entry for each statement that ran.
#[tauri::command]
#[specta::specta]
pub async fn query_run(
    state: State<'_, AppState>,
    session_id: SessionId,
    sql: String,
    target: RunTarget,
) -> Result<RunReport, CommandError> {
    let session = state.session(session_id)?;
    Ok(session.run(&sql, target, LIMITS).await)
}

/// Cancels the active statement of a session. The run or the fetch then returns
/// a failure of the kind `cancelled`.
#[tauri::command]
#[specta::specta]
pub async fn query_cancel(
    state: State<'_, AppState>,
    session_id: SessionId,
) -> Result<(), CommandError> {
    let session = state.session(session_id)?;
    Ok(session.cancel().await?)
}

/// Reads the next page of an open result. Returns `null` if the result is not open.
#[tauri::command]
#[specta::specta]
pub async fn result_fetch(
    state: State<'_, AppState>,
    session_id: SessionId,
    result_id: ResultId,
) -> Result<Option<FetchedPage>, CommandError> {
    let session = state.session(session_id)?;
    Ok(session.fetch(result_id, PAGE_ROWS).await)
}

/// Closes an open result. This cancels its statement on the server.
#[tauri::command]
#[specta::specta]
pub async fn result_close(
    state: State<'_, AppState>,
    session_id: SessionId,
    result_id: ResultId,
) -> Result<(), CommandError> {
    let session = state.session(session_id)?;
    session.close_result(result_id).await;
    Ok(())
}

fn part_path(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(".part");
    PathBuf::from(name)
}

fn file_error(path: &Path, error: &std::io::Error) -> QueryError {
    QueryError::new(
        QueryErrorKind::Other,
        format!("Cannot write the file {}: {error}", path.display()),
    )
}

/// Writes the result to a temporary file, then moves it to `path`.
/// Thus a failed export does not leave a file that is only partly written.
async fn export_to_file(
    session: &QuerySession,
    statement: &str,
    path: &Path,
) -> Result<u64, QueryError> {
    let part = part_path(path);
    let file = tokio::fs::File::create(&part)
        .await
        .map_err(|e| file_error(&part, &e))?;
    let mut out = BufWriter::new(file);
    let result = session.export_csv(statement, &mut out, PAGE_ROWS).await;
    drop(out);
    match result {
        Ok(rows) => tokio::fs::rename(&part, path)
            .await
            .map(|()| rows)
            .map_err(|e| file_error(path, &e)),
        Err(error) => {
            // The statement error is more important than a failure to remove the file.
            let _ = tokio::fs::remove_file(&part).await;
            Err(error)
        }
    }
}

/// Runs `statement` again and writes its complete result to the CSV file `path`.
/// This closes the open result of the session. Only a statement that reads data is permitted.
#[tauri::command]
#[specta::specta]
pub async fn result_export_csv(
    state: State<'_, AppState>,
    session_id: SessionId,
    statement: String,
    path: String,
) -> Result<ExportResult, CommandError> {
    let session = state.session(session_id)?;
    Ok(
        match export_to_file(&session, &statement, Path::new(&path)).await {
            Ok(rows) => ExportResult::Exported { rows },
            Err(error) => ExportResult::Failed { error },
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use tabloxide_core::testing::{Scripted, ScriptedSession};

    fn session(answers: Vec<Scripted>) -> QuerySession {
        let (session, _) = ScriptedSession::new(answers);
        QuerySession::new(Box::new(session))
    }

    fn temp_file(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("tabloxide-export-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir.join(name)
    }

    #[tokio::test]
    async fn the_export_writes_the_file() {
        let path = temp_file("ok.csv");
        let session = session(vec![Scripted::Rows(3)]);

        let rows = export_to_file(&session, "select 1", &path).await.unwrap();

        assert_eq!(rows, 3);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "n\n1\n2\n3\n");
        assert!(!part_path(&path).exists());
    }

    #[tokio::test]
    async fn a_failed_export_leaves_no_file() {
        let path = temp_file("failed.csv");
        let session = session(vec![Scripted::Error {
            message: "failed".to_owned(),
            position: None,
        }]);

        let error = export_to_file(&session, "select 1", &path)
            .await
            .unwrap_err();

        assert_eq!(error.message, "failed");
        assert!(!path.exists());
        assert!(!part_path(&path).exists());
    }
}
