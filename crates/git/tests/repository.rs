//! Tests against real repositories in temporary directories. They need the `git` executable.

mod common;

use common::{Fixture, git, two_clones};
use tabloxide_git::{ChangeKind, Git, GitError, STARTER_GITIGNORE};

#[test]
fn reports_the_version() {
    let version = Git::new().version().unwrap();

    assert!(
        version.chars().next().unwrap().is_ascii_digit(),
        "{version}"
    );
}

#[test]
fn init_makes_a_repository_with_the_starter_gitignore() {
    let fixture = Fixture::new();

    let ignore = std::fs::read_to_string(fixture.root.join(".gitignore")).unwrap();
    let status = fixture.git.status(&fixture.root).unwrap();

    assert_eq!(ignore, STARTER_GITIGNORE);
    assert_eq!(status.branch.as_deref(), Some("main"));
    assert!(!status.has_commits);
    assert_eq!(fixture.paths(), vec![".gitignore"]);
}

#[test]
fn init_keeps_a_gitignore_that_exists() {
    let home = tempfile::tempdir().unwrap();
    std::fs::write(home.path().join(".gitignore"), "mine\n").unwrap();

    git(home.path()).init(home.path()).unwrap();

    let ignore = std::fs::read_to_string(home.path().join(".gitignore")).unwrap();
    assert_eq!(ignore, "mine\n");
}

#[test]
fn finds_the_root_from_a_subdirectory() {
    let fixture = Fixture::new();
    let sub = fixture.root.join("queries");
    std::fs::create_dir(&sub).unwrap();
    let outside = tempfile::tempdir().unwrap();

    let found = fixture.git.find_root(&sub).unwrap().unwrap();

    assert_eq!(
        found.canonicalize().unwrap(),
        fixture.root.canonicalize().unwrap()
    );
    assert_eq!(fixture.git.find_root(outside.path()).unwrap(), None);
}

#[test]
fn stages_unstages_and_commits() {
    let fixture = Fixture::new();
    fixture.write("my query.sql", "select 1");
    let path = vec!["my query.sql".to_owned()];

    // Stage and unstage work before the first commit.
    fixture.git.stage(&fixture.root, &path).unwrap();
    let staged = fixture.git.status(&fixture.root).unwrap();
    let file = staged.files.iter().find(|f| f.path == path[0]).unwrap();
    assert_eq!(file.staged, Some(ChangeKind::Added));

    fixture.git.unstage(&fixture.root, &path).unwrap();
    let unstaged = fixture.git.status(&fixture.root).unwrap();
    assert!(
        unstaged
            .files
            .iter()
            .any(|f| f.path == path[0] && f.is_untracked)
    );

    fixture.git.stage(&fixture.root, &path).unwrap();
    fixture.git.commit(&fixture.root, "add the query").unwrap();
    let after = fixture.git.status(&fixture.root).unwrap();
    assert!(after.has_commits);
    assert_eq!(fixture.paths(), vec![".gitignore"]);

    // A change of a committed file shows as modified.
    fixture.write("my query.sql", "select 2");
    let changed = fixture.git.status(&fixture.root).unwrap();
    let file = changed.files.iter().find(|f| f.path == path[0]).unwrap();
    assert_eq!(file.unstaged, Some(ChangeKind::Modified));
}

#[test]
fn rejects_an_empty_commit_message() {
    let fixture = Fixture::new();
    fixture
        .git
        .stage(&fixture.root, &[".gitignore".to_owned()])
        .unwrap();

    let error = fixture.git.commit(&fixture.root, "  ").unwrap_err();

    assert!(error.to_string().contains("commit message"));
}

#[test]
fn explains_a_missing_identity() {
    let home = tempfile::tempdir().unwrap();
    let empty = home.path().join("empty");
    std::fs::write(&empty, "").unwrap();
    let anonymous = Git::new()
        .with_env("GIT_CONFIG_GLOBAL", &empty.display().to_string())
        .with_env("GIT_CONFIG_NOSYSTEM", "1");
    let root = home.path().join("repo");
    std::fs::create_dir(&root).unwrap();
    anonymous.init(&root).unwrap();
    anonymous.stage(&root, &[".gitignore".to_owned()]).unwrap();

    let error = anonymous.commit(&root, "first").unwrap_err();

    assert!(matches!(error, GitError::MissingIdentity));
    assert!(error.to_string().contains("git config --global user.name"));
}

#[test]
fn shows_the_two_sides_of_a_diff() {
    let fixture = Fixture::new();
    fixture.commit_file("a.sql", "select 1\n");
    fixture.write("a.sql", "select 2\n");

    let unstaged = fixture.git.diff(&fixture.root, "a.sql", false).unwrap();
    assert_eq!(
        (unstaged.original.as_str(), unstaged.modified.as_str()),
        ("select 1\n", "select 2\n")
    );

    fixture
        .git
        .stage(&fixture.root, &["a.sql".to_owned()])
        .unwrap();
    fixture.write("a.sql", "select 3\n");
    let staged = fixture.git.diff(&fixture.root, "a.sql", true).unwrap();
    let unstaged = fixture.git.diff(&fixture.root, "a.sql", false).unwrap();
    assert_eq!(
        (staged.original.as_str(), staged.modified.as_str()),
        ("select 1\n", "select 2\n")
    );
    assert_eq!(
        (unstaged.original.as_str(), unstaged.modified.as_str()),
        ("select 2\n", "select 3\n")
    );

    // A new file has an empty original side. A deleted file has an empty modified side.
    fixture.write("new.sql", "select 9\n");
    let new = fixture.git.diff(&fixture.root, "new.sql", false).unwrap();
    assert_eq!(
        (new.original.as_str(), new.modified.as_str()),
        ("", "select 9\n")
    );
    std::fs::remove_file(fixture.root.join("a.sql")).unwrap();
    let deleted = fixture.git.diff(&fixture.root, "a.sql", false).unwrap();
    assert_eq!(deleted.modified, "");
}

#[test]
fn does_not_show_a_binary_file() {
    let fixture = Fixture::new();
    std::fs::write(fixture.root.join("image.bin"), [0_u8, 159, 146, 150]).unwrap();

    let error = fixture
        .git
        .diff(&fixture.root, "image.bin", false)
        .unwrap_err();

    assert!(matches!(error, GitError::NotText(_)));
}

#[test]
fn discards_changes_and_deletes_untracked_files() {
    let fixture = Fixture::new();
    fixture.commit_file("a.sql", "select 1\n");
    fixture.write("a.sql", "changed\n");
    fixture.write("new.sql", "new\n");

    fixture.git.discard(&fixture.root, "a.sql", false).unwrap();
    fixture.git.discard(&fixture.root, "new.sql", true).unwrap();

    let text = std::fs::read_to_string(fixture.root.join("a.sql")).unwrap();
    assert_eq!(text, "select 1\n");
    assert!(!fixture.root.join("new.sql").exists());
}

#[test]
fn rejects_paths_that_are_options_or_go_out_of_the_repository() {
    let fixture = Fixture::new();

    for path in ["--force", "../outside.sql", "/etc/passwd", ""] {
        let stage = fixture.git.stage(&fixture.root, &[path.to_owned()]);
        let discard = fixture.git.discard(&fixture.root, path, true);
        let diff = fixture.git.diff(&fixture.root, path, false);
        assert!(matches!(stage, Err(GitError::InvalidName(_))), "{path}");
        assert!(matches!(discard, Err(GitError::InvalidName(_))), "{path}");
        assert!(matches!(diff, Err(GitError::InvalidName(_))), "{path}");
    }
}

#[test]
fn creates_and_switches_branches() {
    let fixture = Fixture::new();
    fixture.commit_file("a.sql", "select 1\n");

    fixture
        .git
        .create_branch(&fixture.root, "feature/report")
        .unwrap();
    let branches = fixture.git.branches(&fixture.root).unwrap();
    let listed: Vec<(&str, bool)> = branches
        .iter()
        .map(|b| (b.name.as_str(), b.is_current))
        .collect();
    assert_eq!(listed, vec![("feature/report", true), ("main", false)]);

    // An unsaved change of the working tree stays after a switch.
    fixture.write("a.sql", "changed\n");
    fixture.git.switch_branch(&fixture.root, "main").unwrap();
    let status = fixture.git.status(&fixture.root).unwrap();
    assert_eq!(status.branch.as_deref(), Some("main"));
    assert_eq!(
        std::fs::read_to_string(fixture.root.join("a.sql")).unwrap(),
        "changed\n"
    );
}

#[test]
fn rejects_invalid_branch_names() {
    let fixture = Fixture::new();
    fixture.commit_file("a.sql", "select 1\n");

    for name in ["--orphan", "has space", "a..b", ""] {
        let result = fixture.git.create_branch(&fixture.root, name);
        assert!(
            matches!(result, Err(GitError::InvalidName(_))),
            "{name}: {result:?}"
        );
    }
    let missing = fixture.git.switch_branch(&fixture.root, "no-such-branch");
    assert!(matches!(missing, Err(GitError::Failed { .. })));
}

#[test]
fn pushes_fetches_and_pulls_between_two_clones() {
    let (_home, git, first, second) = two_clones();

    // The first push sets the upstream.
    let status = git.status(&first).unwrap();
    assert_eq!(status.upstream.as_deref(), Some("origin/main"));
    assert_eq!((status.ahead, status.behind), (0, 0));

    // A new commit in the first clone is one commit ahead, then the push sends it.
    std::fs::write(first.join("a.sql"), "select 2\n").unwrap();
    git.stage(&first, &["a.sql".to_owned()]).unwrap();
    git.commit(&first, "second").unwrap();
    assert_eq!(git.status(&first).unwrap().ahead, 1);
    git.push(&first).unwrap();
    assert_eq!(git.status(&first).unwrap().ahead, 0);

    // The second clone sees the commit after a fetch and gets it with a pull.
    git.fetch(&second).unwrap();
    assert_eq!(git.status(&second).unwrap().behind, 1);
    git.pull(&second).unwrap();
    assert_eq!(
        std::fs::read_to_string(second.join("a.sql")).unwrap(),
        "select 2\n"
    );
    assert_eq!(git.status(&second).unwrap().behind, 0);
}

#[test]
fn reports_a_merge_conflict_after_a_pull() {
    let (_home, git, first, second) = two_clones();
    for (clone, text) in [(&first, "from first\n"), (&second, "from second\n")] {
        std::fs::write(clone.join("a.sql"), text).unwrap();
        git.stage(clone, &["a.sql".to_owned()]).unwrap();
        git.commit(clone, "change").unwrap();
    }
    git.push(&first).unwrap();

    // The push of the second clone fails because the remote has a new commit.
    assert!(matches!(git.push(&second), Err(GitError::Failed { .. })));

    let error = git.pull(&second).unwrap_err();
    assert!(
        error.to_string().to_lowercase().contains("conflict"),
        "{error}"
    );
    let status = git.status(&second).unwrap();
    let file = status.files.iter().find(|f| f.path == "a.sql").unwrap();
    assert!(file.is_conflicted);
}

#[test]
fn clone_rejects_a_url_that_is_an_option() {
    let home = tempfile::tempdir().unwrap();

    let result = git(home.path()).clone_repository("--upload-pack=evil", &home.path().join("x"));

    assert!(matches!(result, Err(GitError::InvalidName(_))));
    assert!(!home.path().join("x").exists());
}

#[test]
fn a_failed_command_gives_the_message_of_git() {
    let home = tempfile::tempdir().unwrap();

    let error = git(home.path()).status(home.path()).unwrap_err();

    assert!(
        error.to_string().contains("not a git repository"),
        "{error}"
    );
}
