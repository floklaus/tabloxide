use crate::commands::local::workspace_key;
use crate::commands::workspace::state_dir;
use crate::error::CommandError;
use crate::state::{AppState, blocking};
use serde::Serialize;
use specta::Type;
use std::path::{Path, PathBuf};
use tabloxide_git::{BranchInfo, FileDiff, Git, GitError, StatusReport};
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
    },
}

/// Finds the repository of the workspace.
fn repository(git: &Git, workspace_root: &Path) -> Result<PathBuf, GitError> {
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
pub async fn git_clone(url: String, parent: String, name: String) -> Result<String, CommandError> {
    blocking(move || {
        let is_plain_name =
            !name.is_empty() && !name.starts_with('.') && !name.contains(['/', '\\']);
        if !is_plain_name {
            return Err(GitError::InvalidName(name).into());
        }
        let destination = PathBuf::from(parent).join(name);
        Git::new().clone_repository(&url, &destination)?;
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
pub async fn git_fetch(state: State<'_, AppState>) -> Result<String, CommandError> {
    with_repository(&state, |git, root| git.fetch(root)).await
}

/// Gets and merges the new commits of the upstream branch. Returns the text that Git wrote.
#[tauri::command]
#[specta::specta]
pub async fn git_pull(state: State<'_, AppState>) -> Result<String, CommandError> {
    with_repository(&state, |git, root| git.pull(root)).await
}

/// Sends the commits of the current branch to the remote. Returns the text that Git wrote.
#[tauri::command]
#[specta::specta]
pub async fn git_push(state: State<'_, AppState>) -> Result<String, CommandError> {
    with_repository(&state, |git, root| git.push(root)).await
}
