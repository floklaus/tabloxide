//! The Git console: one Git command that the user types. The checks and the run are
//! in the `git` crate. This module keeps the history and the stop of a command.

use crate::commands::git::{GitRemoteEvent, remote_git, repository};
use crate::commands::local::workspace_key;
use crate::commands::workspace::state_dir;
use crate::error::CommandError;
use crate::state::{AppState, blocking};
use serde::Serialize;
use specta::Type;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex, PoisonError};
use tabloxide_git::{ConsoleCheck, ConsoleNames, ConsoleOutput, Git, parse_console_line};
use tauri::ipc::Channel;
use tauri::{AppHandle, State};

/// The history keeps this number of commands of each workspace.
const MAX_HISTORY: usize = 200;

/// The identifier of a console command. The UI makes it.
pub type ConsoleRunId = u32;

/// The stop flag of each command that runs.
static RUNNING: LazyLock<Mutex<HashMap<ConsoleRunId, Arc<AtomicBool>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn running() -> std::sync::MutexGuard<'static, HashMap<ConsoleRunId, Arc<AtomicBool>>> {
    RUNNING.lock().unwrap_or_else(PoisonError::into_inner)
}

/// The result of a line of the console.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum ConsoleResult {
    /// The command did not run, because of `reason`.
    Refused { reason: String },
    /// The command can remove work. It runs only after a confirmation.
    Confirm { effect: String },
    /// The command ran.
    Done { output: ConsoleOutput },
}

fn history_key(workspace: &str) -> String {
    format!("git-console-history:{workspace}")
}

/// Returns `history` with `line` at the end. The same line does not come two times
/// in sequence, and the list has a maximum length.
fn with_line(mut history: Vec<String>, line: &str) -> Vec<String> {
    if history.last().map(String::as_str) != Some(line) {
        history.push(line.to_owned());
    }
    let excess = history.len().saturating_sub(MAX_HISTORY);
    history.drain(..excess);
    history
}

/// Checks a line of the Git console, and runs it if the check permits it.
///
/// A command that can remove work runs only with `confirmed`. The command runs in the
/// root of the repository of the workspace. The line goes into the history.
#[tauri::command]
#[specta::specta]
pub async fn git_console_run(
    app: AppHandle,
    state: State<'_, AppState>,
    id: ConsoleRunId,
    line: String,
    confirmed: bool,
    on_event: Channel<GitRemoteEvent>,
) -> Result<ConsoleResult, CommandError> {
    let workspace = state.workspace()?;
    let local = state.local(&state_dir(&app)?)?;
    let remote = remote_git(&state, on_event);
    let cancel = Arc::new(AtomicBool::new(false));
    running().insert(id, Arc::clone(&cancel));
    let result = blocking(move || {
        let key = history_key(&workspace_key(&workspace));
        let history: Vec<String> = local
            .load_cache(&key)?
            .and_then(|json| serde_json::from_str(&json).ok())
            .unwrap_or_default();
        let json = serde_json::to_string(&with_line(history, line.trim()))
            .map_err(|error| CommandError::internal(error.to_string()))?;
        local.save_cache(&key, &json)?;

        let git = &remote.git;
        let root = repository(git, workspace.root())?;
        let check = git.console_check(&root, &line)?;
        let command = match (check, confirmed) {
            (ConsoleCheck::Refused { reason }, _) => return Ok(ConsoleResult::Refused { reason }),
            (ConsoleCheck::Confirm { effect }, false) => {
                return Ok(ConsoleResult::Confirm { effect });
            }
            (ConsoleCheck::Confirm { .. } | ConsoleCheck::Ready, _) => {
                // The check above accepted the line. Thus the parse cannot fail here.
                parse_console_line(&line).map_err(CommandError::internal)?
            }
        };
        let output = git.console_run(&root, &command, &cancel)?;
        Ok(ConsoleResult::Done { output })
    })
    .await;
    running().remove(&id);
    result
}

/// Stops a console command that runs. The command then returns `is_cancelled`.
#[tauri::command]
#[specta::specta]
pub fn git_console_cancel(id: ConsoleRunId) {
    if let Some(flag) = running().get(&id) {
        flag.store(true, Ordering::Relaxed);
    }
}

/// Returns the earlier lines of the console of the workspace. The oldest is first.
#[tauri::command]
#[specta::specta]
pub async fn git_console_history(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<String>, CommandError> {
    let workspace = state.workspace()?;
    let local = state.local(&state_dir(&app)?)?;
    blocking(move || {
        Ok(local
            .load_cache(&history_key(&workspace_key(&workspace)))?
            .and_then(|json| serde_json::from_str(&json).ok())
            .unwrap_or_default())
    })
    .await
}

/// Returns the names that the console completes: branches, remotes, tags, and files.
#[tauri::command]
#[specta::specta]
pub async fn git_console_names(state: State<'_, AppState>) -> Result<ConsoleNames, CommandError> {
    let workspace = state.workspace()?;
    blocking(move || {
        let git = Git::new();
        let root = repository(&git, workspace.root())?;
        Ok(git.console_names(&root)?)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_history_has_no_repeat_in_sequence_and_a_maximum_length() {
        let history = with_line(vec!["status".to_owned()], "status");
        assert_eq!(history, ["status"]);

        let full: Vec<String> = (0..MAX_HISTORY).map(|i| i.to_string()).collect();
        let history = with_line(full, "log");

        assert_eq!(history.len(), MAX_HISTORY);
        assert_eq!(history.first().map(String::as_str), Some("1"));
        assert_eq!(history.last().map(String::as_str), Some("log"));
    }

    #[test]
    fn a_cancel_sets_the_flag_of_the_command() {
        let flag = Arc::new(AtomicBool::new(false));
        running().insert(9_001, Arc::clone(&flag));

        git_console_cancel(9_001);
        git_console_cancel(9_002);

        assert!(flag.load(Ordering::Relaxed));
        running().remove(&9_001);
    }
}
