//! Helpers for the tests against real repositories.
#![allow(dead_code)]

use std::path::{Path, PathBuf};
use tabloxide_git::Git;
use tempfile::TempDir;

/// A Git that ignores the configuration of the machine and has a test identity.
pub fn git(home: &Path) -> Git {
    let empty = home.join("empty-gitconfig");
    std::fs::write(&empty, "").unwrap();
    Git::new()
        .with_env("GIT_CONFIG_GLOBAL", &empty.display().to_string())
        .with_env("GIT_CONFIG_NOSYSTEM", "1")
        .with_env("GIT_AUTHOR_NAME", "Test")
        .with_env("GIT_AUTHOR_EMAIL", "test@example.com")
        .with_env("GIT_COMMITTER_NAME", "Test")
        .with_env("GIT_COMMITTER_EMAIL", "test@example.com")
        .with_env("GIT_CONFIG_COUNT", "3")
        .with_env("GIT_CONFIG_KEY_0", "user.name")
        .with_env("GIT_CONFIG_VALUE_0", "Test")
        .with_env("GIT_CONFIG_KEY_1", "user.email")
        .with_env("GIT_CONFIG_VALUE_1", "test@example.com")
        .with_env("GIT_CONFIG_KEY_2", "init.defaultBranch")
        .with_env("GIT_CONFIG_VALUE_2", "main")
}

pub struct Fixture {
    _home: TempDir,
    pub git: Git,
    pub root: PathBuf,
}

impl Fixture {
    pub fn new() -> Self {
        let home = tempfile::tempdir().unwrap();
        let git = git(home.path());
        let root = home.path().join("repo");
        std::fs::create_dir(&root).unwrap();
        git.init(&root).unwrap();
        Self {
            _home: home,
            git,
            root,
        }
    }

    pub fn write(&self, path: &str, text: &str) {
        std::fs::write(self.root.join(path), text).unwrap();
    }

    pub fn commit_file(&self, path: &str, text: &str) {
        self.write(path, text);
        self.git.stage(&self.root, &[path.to_owned()]).unwrap();
        self.git.commit(&self.root, &format!("add {path}")).unwrap();
    }

    pub fn paths(&self) -> Vec<String> {
        let status = self.git.status(&self.root).unwrap();
        status.files.into_iter().map(|f| f.path).collect()
    }
}

/// Makes a bare remote and two clones of it. The first clone has one commit that is pushed.
pub fn two_clones() -> (TempDir, Git, PathBuf, PathBuf) {
    let home = tempfile::tempdir().unwrap();
    let git = git(home.path());
    let remote = home.path().join("remote.git");
    std::fs::create_dir(&remote).unwrap();
    git.init(&remote).unwrap();
    std::fs::remove_file(remote.join(".gitignore")).unwrap();
    // A push to the current branch of a repository with a working tree is refused.
    let first = home.path().join("first");
    let second = home.path().join("second");
    let bare = home.path().join("bare.git");
    git.clone_repository(&remote.display().to_string(), &first)
        .unwrap();
    std::fs::write(first.join("a.sql"), "select 1\n").unwrap();
    git.stage(&first, &["a.sql".to_owned()]).unwrap();
    git.commit(&first, "first").unwrap();
    // Make the real remote as a bare copy of the first clone, then point the clones at it.
    std::process::Command::new("git")
        .args(["clone", "--quiet", "--bare"])
        .arg(&first)
        .arg(&bare)
        .status()
        .unwrap();
    std::process::Command::new("git")
        .current_dir(&first)
        .args(["remote", "set-url", "origin"])
        .arg(&bare)
        .status()
        .unwrap();
    git.push(&first).unwrap();
    git.clone_repository(&bare.display().to_string(), &second)
        .unwrap();
    (home, git, first, second)
}

/// Commits a new text of `a.sql` in a clone.
pub fn commit_change(git: &Git, clone: &Path, text: &str) {
    std::fs::write(clone.join("a.sql"), text).unwrap();
    git.stage(clone, &["a.sql".to_owned()]).unwrap();
    git.commit(clone, "change").unwrap();
}

/// Makes two clones and a pull in the second clone that stops with a conflict in `a.sql`.
/// The first clone has `ours_remote` and the second clone has `local`.
pub fn conflicted_clone(remote_text: &str, local_text: &str) -> (TempDir, Git, PathBuf) {
    let (home, git, first, second) = two_clones();
    commit_change(&git, &first, remote_text);
    commit_change(&git, &second, local_text);
    git.push(&first).unwrap();
    git.pull(&second).unwrap_err();
    (home, git, second)
}
