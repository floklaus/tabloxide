//! The Git data of the AI actions. The backend reads it from the repository of the
//! workspace. The UI sends only the path of a file, so that no other text goes into
//! the request in place of the data.

use crate::commands::git::repository;
use crate::state::{AppState, blocking};
use std::path::Path;
use tabloxide_assistant::{
    ActionContext, AssistantError, AssistantErrorKind, ChatMessage, ConflictVersions,
    MAX_CONFLICT_CHARS, MAX_DIFF_CHARS, limit_diff, unified_diff,
};
use tabloxide_git::{Git, GitError};

/// The number of earlier commit subjects that a commit message request sends.
const SUBJECT_COUNT: u32 = 10;

fn is_git(context: Option<&ActionContext>) -> bool {
    matches!(
        context,
        Some(
            ActionContext::StagedChanges { .. }
                | ActionContext::FileDiff { .. }
                | ActionContext::Conflict { .. }
        )
    )
}

fn invalid(message: &str) -> AssistantError {
    AssistantError::new(AssistantErrorKind::InvalidRequest, message)
}

fn git_error(error: &GitError) -> AssistantError {
    AssistantError::new(
        AssistantErrorKind::Other,
        format!("The application cannot read the Git data: {error}"),
    )
}

/// Returns the context with the data from the repository at `root`.
fn read_one(
    git: &Git,
    root: &Path,
    context: &ActionContext,
) -> Result<ActionContext, AssistantError> {
    match context {
        ActionContext::StagedChanges { .. } => {
            let patch = git.staged_patch(root).map_err(|e| git_error(&e))?;
            if patch.trim().is_empty() {
                return Err(invalid(
                    "Stage the changes first. The commit message comes from the staged changes.",
                ));
            }
            let (diff, is_cut) = limit_diff(&patch, MAX_DIFF_CHARS);
            let subjects = git
                .log(root, SUBJECT_COUNT, 0)
                .map_err(|e| git_error(&e))?
                .into_iter()
                .map(|commit| commit.subject)
                .collect();
            Ok(ActionContext::StagedChanges {
                diff: Some(diff),
                is_cut,
                subjects,
            })
        }
        ActionContext::FileDiff { path, staged, .. } => {
            let sides = git.diff(root, path, *staged).map_err(|e| git_error(&e))?;
            let diff = unified_diff(path, &sides.original, &sides.modified);
            if diff.is_empty() {
                return Err(invalid("The file has no changes."));
            }
            let (diff, _) = limit_diff(&diff, MAX_DIFF_CHARS);
            Ok(ActionContext::FileDiff {
                path: path.clone(),
                staged: *staged,
                diff: Some(diff),
            })
        }
        ActionContext::Conflict { path, .. } => {
            let sides = git.conflict(root, path).map_err(|e| git_error(&e))?;
            let versions = ConflictVersions {
                base: sides.base,
                current: sides.ours,
                incoming: sides.theirs,
            };
            if versions.len() > MAX_CONFLICT_CHARS {
                return Err(invalid(
                    "The file is too large for a proposal of the AI. The three versions \
                     have a limit of 60 000 characters.",
                ));
            }
            Ok(ActionContext::Conflict {
                path: path.clone(),
                versions: Some(versions),
            })
        }
        other => Ok(other.clone()),
    }
}

/// Reads the Git data of each message with a Git action. Each request reads it again,
/// because the UI does not keep it. Messages without a Git action do not change.
///
/// The outer error is a failure of the application. The inner error goes to the user.
pub async fn read_git_data(
    state: &AppState,
    messages: Vec<ChatMessage>,
) -> Result<Result<Vec<ChatMessage>, AssistantError>, crate::error::CommandError> {
    if !messages
        .iter()
        .any(|message| is_git(message.context.as_ref()))
    {
        return Ok(Ok(messages));
    }
    let Ok(workspace) = state.workspace() else {
        return Ok(Err(invalid(
            "Open a workspace. The request needs its Git data.",
        )));
    };
    blocking(move || {
        let git = Git::new();
        let root = match repository(&git, workspace.root()) {
            Ok(root) => root,
            Err(error) => return Ok(Err(git_error(&error))),
        };
        Ok(read_all(&git, &root, messages))
    })
    .await
}

fn read_all(
    git: &Git,
    root: &Path,
    messages: Vec<ChatMessage>,
) -> Result<Vec<ChatMessage>, AssistantError> {
    messages
        .into_iter()
        .map(|message| match &message.context {
            Some(context) if is_git(Some(context)) => Ok(ChatMessage {
                context: Some(read_one(git, root, context)?),
                ..message
            }),
            _ => Ok(message),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tabloxide_assistant::Role;

    /// A repository with one commit, and a staged change of `report.sql`.
    fn repository_with_a_staged_change() -> (tempfile::TempDir, Git) {
        let home = tempfile::tempdir().unwrap();
        let empty = home.path().join("empty-gitconfig");
        std::fs::write(&empty, "").unwrap();
        let git = Git::new()
            .with_env("GIT_CONFIG_GLOBAL", &empty.display().to_string())
            .with_env("GIT_CONFIG_NOSYSTEM", "1")
            .with_env("GIT_CONFIG_COUNT", "2")
            .with_env("GIT_CONFIG_KEY_0", "user.name")
            .with_env("GIT_CONFIG_VALUE_0", "Test")
            .with_env("GIT_CONFIG_KEY_1", "user.email")
            .with_env("GIT_CONFIG_VALUE_1", "test@example.com");
        let root = home.path();
        git.init(root).unwrap();
        std::fs::write(root.join("report.sql"), "select 1\n").unwrap();
        git.stage(root, &["report.sql".to_owned()]).unwrap();
        git.commit(root, "Add the report").unwrap();
        std::fs::write(root.join("report.sql"), "select 2\n").unwrap();
        git.stage(root, &["report.sql".to_owned()]).unwrap();
        (home, git)
    }

    fn with(context: ActionContext) -> Vec<ChatMessage> {
        vec![ChatMessage {
            context: Some(context),
            ..ChatMessage::new(Role::User, "x")
        }]
    }

    #[test]
    fn reads_the_staged_diff_and_the_subjects() {
        let (home, git) = repository_with_a_staged_change();

        let read = read_all(
            &git,
            home.path(),
            with(ActionContext::StagedChanges {
                diff: None,
                is_cut: false,
                subjects: vec![],
            }),
        )
        .unwrap();

        let Some(ActionContext::StagedChanges { diff, subjects, .. }) = &read[0].context else {
            panic!("{read:?}");
        };
        assert!(diff.as_deref().unwrap().contains("+select 2"));
        assert_eq!(subjects, &["Add the report"]);
    }

    #[test]
    fn reads_the_diff_of_one_file() {
        let (home, git) = repository_with_a_staged_change();

        let read = read_all(
            &git,
            home.path(),
            with(ActionContext::FileDiff {
                path: "report.sql".to_owned(),
                staged: true,
                diff: None,
            }),
        )
        .unwrap();

        let Some(ActionContext::FileDiff { diff, .. }) = &read[0].context else {
            panic!("{read:?}");
        };
        assert_eq!(
            diff.as_deref(),
            Some("--- a/report.sql\n+++ b/report.sql\n@@ -1 +1 @@\n-select 1\n+select 2\n")
        );
    }

    #[test]
    fn a_commit_message_needs_staged_changes() {
        let (home, git) = repository_with_a_staged_change();
        git.commit(home.path(), "Change the report").unwrap();

        let error = read_all(
            &git,
            home.path(),
            with(ActionContext::StagedChanges {
                diff: None,
                is_cut: false,
                subjects: vec![],
            }),
        )
        .unwrap_err();

        assert!(error.message.contains("Stage the changes first"));
    }

    #[test]
    fn messages_without_git_data_do_not_change() {
        let messages = vec![ChatMessage::new(Role::User, "x")];

        let read = read_all(&Git::new(), Path::new("/nowhere"), messages.clone()).unwrap();

        assert_eq!(read, messages);
    }
}
