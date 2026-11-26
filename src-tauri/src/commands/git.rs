use crate::commands::local::workspace_key;
use crate::commands::workspace::state_dir;
use crate::credentials::{ANSWER_TIMEOUT, RequestId};
use crate::error::CommandError;
use crate::state::{AppState, blocking};
use serde::Serialize;
use specta::Type;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tabloxide_git::{
    AskpassSession, BranchDeletion, BranchInfo, CommitFile, CommitInfo, ConflictSides, FileDiff,
    Git, GitError, Prompt, RemoteBranchInfo, StatusReport,
};
use tauri::ipc::Channel;
use tauri::{AppHandle, State};

/// The Git state of the workspace.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(tag = "state", rename_all = "kebab-case")]
pub enum GitOverview {
    /// The user disabled Git for this workspace.
    Disabled,
    /// The `git` executable is not available. `message` gives the install instructions.
    NotInstalled { message: String },
    /// The workspace folder is not in a repository.
    NoRepository { version: String },
    Repository {
        version: String,
        /// Root of the repository. The file paths of the status are relative to it.
        root: String,
        status: StatusReport,
        branches: Vec<BranchInfo>,
        /// The branches of the remote repositories, newest commit first.
        remote_branches: Vec<RemoteBranchInfo>,
        /// The message for the merge commit. `None` if no merge is in progress.
        merge_message: Option<String>,
    },
}

/// Largest number of commits that one request for the history returns.
const MAX_LOG_PAGE: u32 = 200;

/// A message from a remote operation (fetch, pull, push, clone) to the UI.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum GitRemoteEvent {
    /// One progress line that Git wrote.
    Progress { line: String },
    /// Git or SSH needs an answer from the user. The UI answers with
    /// `git_credential_answer`.
    Credential {
        id: RequestId,
        prompt: String,
        /// `true` if the UI must hide the answer while the user types it.
        is_secret: bool,
    },
}

/// A Git for one remote operation. It sends the progress lines and the credential
/// prompts to the UI.
pub(crate) struct RemoteGit {
    pub(crate) git: Git,
    /// Keeps the registration for the prompts until the operation ends.
    _prompts: Option<AskpassSession>,
}

/// Registers the UI as the receiver of the prompts of one operation.
/// Returns `None` if the prompt server or the helper program is not available.
/// Then Git fails when it needs a credential, with a message for the user.
fn register_prompts(
    state: &AppState,
    on_event: &Channel<GitRemoteEvent>,
) -> Option<(AskpassSession, PathBuf)> {
    // The application is its own helper program. Refer to `run` in `lib.rs`.
    let helper = std::env::current_exe().ok()?;
    let credentials = state.credentials();
    let channel = on_event.clone();
    let handler = Arc::new(move |prompt: Prompt| {
        let Prompt { text, is_secret } = prompt;
        let announce = |id| {
            let event = GitRemoteEvent::Credential {
                id,
                prompt: text,
                is_secret,
            };
            channel.send(event).is_ok()
        };
        credentials.ask(announce, ANSWER_TIMEOUT)
    });
    let session = state.askpass().ok()?.register(handler).ok()?;
    Some((session, helper))
}

pub(crate) fn remote_git(state: &AppState, on_event: Channel<GitRemoteEvent>) -> RemoteGit {
    let prompts = register_prompts(state, &on_event);
    let git = Git::new().with_progress(Arc::new(move |line: &str| {
        let line = line.to_owned();
        // The UI is gone when the send fails. Then no one needs the line.
        let _ = on_event.send(GitRemoteEvent::Progress { line });
    }));
    match prompts {
        Some((session, helper)) => RemoteGit {
            git: git.with_askpass(session.env(&helper)),
            _prompts: Some(session),
        },
        None => RemoteGit {
            git,
            _prompts: None,
        },
    }
}

/// Runs a remote operation on the repository of the workspace.
async fn with_remote<F>(
    state: &AppState,
    on_event: Channel<GitRemoteEvent>,
    operation: F,
) -> Result<String, CommandError>
where
    F: FnOnce(&Git, &Path) -> Result<String, GitError> + Send + 'static,
{
    let workspace = state.workspace()?;
    let remote = remote_git(state, on_event);
    blocking(move || {
        let root = repository(&remote.git, workspace.root())?;
        Ok(operation(&remote.git, &root)?)
    })
    .await
}

/// Gives the answer of the user to a credential prompt. `answer` is `null` if the
/// user cancelled. Then Git stops the operation.
#[tauri::command]
#[specta::specta]
pub fn git_credential_answer(state: State<'_, AppState>, id: RequestId, answer: Option<String>) {
    // No operation waits if the prompt timed out. Then the answer is of no use.
    state.credentials().answer(id, answer);
}

/// Finds the repository of the workspace.
pub(crate) fn repository(git: &Git, workspace_root: &Path) -> Result<PathBuf, GitError> {
    git.find_root(workspace_root)?
        .ok_or_else(|| GitError::NotARepository(workspace_root.to_owned()))
}

fn overview(git: &Git, workspace_root: &Path) -> Result<GitOverview, GitError> {
    let version = match git.version() {
        Ok(version) => version,
        Err(error @ GitError::NotInstalled) => {
            return Ok(GitOverview::NotInstalled {
                message: error.to_string(),
            });
        }
        Err(error) => return Err(error),
    };
    let Some(root) = git.find_root(workspace_root)? else {
        return Ok(GitOverview::NoRepository { version });
    };
    Ok(GitOverview::Repository {
        version,
        status: git.status(&root)?,
        branches: git.branches(&root)?,
        remote_branches: git.remote_branches(&root)?,
        merge_message: git.merge_message(&root)?,
        root: root.display().to_string(),
    })
}

/// Runs a Git operation on the repository of the workspace.
async fn with_repository<T, F>(state: &AppState, operation: F) -> Result<T, CommandError>
where
    T: Send + 'static,
    F: FnOnce(&Git, &Path) -> Result<T, GitError> + Send + 'static,
{
    let workspace = state.workspace()?;
    blocking(move || {
        let git = Git::new();
        let root = repository(&git, workspace.root())?;
        Ok(operation(&git, &root)?)
    })
    .await
}

/// Returns the Git state of the workspace: the branch, the upstream counts,
/// the changed files, and the branches.
#[tauri::command]
#[specta::specta]
pub async fn git_overview(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<GitOverview, CommandError> {
    let workspace = state.workspace()?;
    let local = state.local(&state_dir(&app)?)?;
    blocking(move || {
        if !local.is_git_enabled(&workspace_key(&workspace))? {
            return Ok(GitOverview::Disabled);
        }
        Ok(overview(&Git::new(), workspace.root())?)
    })
    .await
}

/// Enables or disables Git for the workspace on this machine.
#[tauri::command]
#[specta::specta]
pub async fn git_set_enabled(
    app: AppHandle,
    state: State<'_, AppState>,
    is_enabled: bool,
) -> Result<(), CommandError> {
    let workspace = state.workspace()?;
    let local = state.local(&state_dir(&app)?)?;
    blocking(move || Ok(local.set_git_enabled(&workspace_key(&workspace), is_enabled)?)).await
}

/// Makes a repository in the workspace folder, with a starter `.gitignore`.
#[tauri::command]
#[specta::specta]
pub async fn git_init(state: State<'_, AppState>) -> Result<(), CommandError> {
    let workspace = state.workspace()?;
    blocking(move || Ok(Git::new().init(workspace.root())?)).await
}

/// Clones `url` into a new folder `name` in the folder `parent`. Returns the path of the clone.
/// This command does not need an open workspace.
#[tauri::command]
#[specta::specta]
pub async fn git_clone(
    state: State<'_, AppState>,
    url: String,
    parent: String,
    name: String,
    on_event: Channel<GitRemoteEvent>,
) -> Result<String, CommandError> {
    let remote = remote_git(&state, on_event);
    blocking(move || {
        let is_plain_name =
            !name.is_empty() && !name.starts_with('.') && !name.contains(['/', '\\']);
        if !is_plain_name {
            return Err(GitError::InvalidName(name).into());
        }
        let destination = PathBuf::from(parent).join(name);
        remote.git.clone_repository(&url, &destination)?;
        Ok(destination.display().to_string())
    })
    .await
}

/// Adds the changes of the files to the index.
#[tauri::command]
#[specta::specta]
pub async fn git_stage(state: State<'_, AppState>, paths: Vec<String>) -> Result<(), CommandError> {
    with_repository(&state, move |git, root| git.stage(root, &paths)).await
}

/// Removes the changes of the files from the index.
#[tauri::command]
#[specta::specta]
pub async fn git_unstage(
    state: State<'_, AppState>,
    paths: Vec<String>,
) -> Result<(), CommandError> {
    with_repository(&state, move |git, root| git.unstage(root, &paths)).await
}

/// Discards the changes of one file in the working tree. This deletes an untracked file.
/// The user cannot undo this. The UI asks for confirmation first.
#[tauri::command]
#[specta::specta]
pub async fn git_discard(
    state: State<'_, AppState>,
    path: String,
    is_untracked: bool,
) -> Result<(), CommandError> {
    with_repository(&state, move |git, root| {
        git.discard(root, &path, is_untracked)
    })
    .await
}

/// Returns the two sides of the diff of one file.
#[tauri::command]
#[specta::specta]
pub async fn git_diff(
    state: State<'_, AppState>,
    path: String,
    staged: bool,
) -> Result<FileDiff, CommandError> {
    with_repository(&state, move |git, root| git.diff(root, &path, staged)).await
}

/// Commits the index with `message`.
#[tauri::command]
#[specta::specta]
pub async fn git_commit(state: State<'_, AppState>, message: String) -> Result<(), CommandError> {
    with_repository(&state, move |git, root| git.commit(root, &message)).await
}

/// Makes a branch at the current commit and switches to it.
#[tauri::command]
#[specta::specta]
pub async fn git_branch_create(
    state: State<'_, AppState>,
    name: String,
) -> Result<(), CommandError> {
    with_repository(&state, move |git, root| git.create_branch(root, &name)).await
}

/// Switches to a branch. Git refuses the switch if it would lose a change in the working tree.
#[tauri::command]
#[specta::specta]
pub async fn git_branch_switch(
    state: State<'_, AppState>,
    name: String,
) -> Result<(), CommandError> {
    with_repository(&state, move |git, root| git.switch_branch(root, &name)).await
}

/// Gets the new commits of the remote. Returns the text that Git wrote.
#[tauri::command]
#[specta::specta]
pub async fn git_fetch(
    state: State<'_, AppState>,
    on_event: Channel<GitRemoteEvent>,
) -> Result<String, CommandError> {
    with_remote(&state, on_event, |git, root| git.fetch(root)).await
}

/// Gets and merges the new commits of the upstream branch. Returns the text that Git wrote.
#[tauri::command]
#[specta::specta]
pub async fn git_pull(
    state: State<'_, AppState>,
    on_event: Channel<GitRemoteEvent>,
) -> Result<String, CommandError> {
    with_remote(&state, on_event, |git, root| git.pull(root)).await
}

/// Sends the commits of the current branch to the remote. Returns the text that Git wrote.
#[tauri::command]
#[specta::specta]
pub async fn git_push(
    state: State<'_, AppState>,
    on_event: Channel<GitRemoteEvent>,
) -> Result<String, CommandError> {
    with_remote(&state, on_event, |git, root| git.push(root)).await
}

/// Gives a branch a new name.
#[tauri::command]
#[specta::specta]
pub async fn git_branch_rename(
    state: State<'_, AppState>,
    old_name: String,
    new_name: String,
) -> Result<(), CommandError> {
    with_repository(&state, move |git, root| {
        git.rename_branch(root, &old_name, &new_name)
    })
    .await
}

/// Deletes a branch. Without `force`, a branch with commits that are in no other branch
/// stays, and the result tells the UI to ask the user.
#[tauri::command]
#[specta::specta]
pub async fn git_branch_delete(
    state: State<'_, AppState>,
    name: String,
    force: bool,
) -> Result<BranchDeletion, CommandError> {
    with_repository(&state, move |git, root| {
        git.delete_branch(root, &name, force)
    })
    .await
}

/// Lists the commits of the current branch from new to old. `skip` gives the next page.
#[tauri::command]
#[specta::specta]
pub async fn git_log(
    state: State<'_, AppState>,
    limit: u32,
    skip: u32,
) -> Result<Vec<CommitInfo>, CommandError> {
    with_repository(&state, move |git, root| {
        git.log(root, limit.min(MAX_LOG_PAGE), skip)
    })
    .await
}

/// Lists the files that a commit changed.
#[tauri::command]
#[specta::specta]
pub async fn git_commit_files(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<CommitFile>, CommandError> {
    with_repository(&state, move |git, root| git.commit_files(root, &id)).await
}

/// Returns the two sides of the diff of one file in a commit.
#[tauri::command]
#[specta::specta]
pub async fn git_commit_diff(
    state: State<'_, AppState>,
    id: String,
    path: String,
    original_path: Option<String>,
) -> Result<FileDiff, CommandError> {
    with_repository(&state, move |git, root| {
        git.commit_diff(root, &id, &path, original_path.as_deref())
    })
    .await
}

/// Returns the versions of a file that has a merge conflict.
#[tauri::command]
#[specta::specta]
pub async fn git_conflict(
    state: State<'_, AppState>,
    path: String,
) -> Result<ConflictSides, CommandError> {
    with_repository(&state, move |git, root| git.conflict(root, &path)).await
}

/// Resolves the conflict of one file: writes `text` to the file and stages it.
#[tauri::command]
#[specta::specta]
pub async fn git_resolve_text(
    state: State<'_, AppState>,
    path: String,
    text: String,
) -> Result<(), CommandError> {
    with_repository(&state, move |git, root| {
        git.resolve_with_text(root, &path, &text)
    })
    .await
}

/// Resolves the conflict of one file: deletes the file.
#[tauri::command]
#[specta::specta]
pub async fn git_resolve_delete(
    state: State<'_, AppState>,
    path: String,
) -> Result<(), CommandError> {
    with_repository(&state, move |git, root| git.resolve_by_delete(root, &path)).await
}

/// Stops the merge and restores the state before the merge. The UI asks for confirmation first.
#[tauri::command]
#[specta::specta]
pub async fn git_merge_abort(state: State<'_, AppState>) -> Result<(), CommandError> {
    with_repository(&state, |git, root| git.abort_merge(root)).await
}
