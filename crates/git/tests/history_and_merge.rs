//! Tests of the commit history, the branch management, and the conflict resolution.
//! They need the `git` executable.

mod common;

use common::{Fixture, commit_change, conflicted_clone, two_clones};
use tabloxide_git::{BranchDeletion, ChangeKind, GitError};

#[test]
fn a_repository_without_commits_has_an_empty_log() {
    let fixture = Fixture::new();

    assert_eq!(fixture.git.log(&fixture.root, 50, 0).unwrap(), vec![]);
}

#[test]
fn lists_the_commits_from_new_to_old_in_pages() {
    let fixture = Fixture::new();
    fixture.commit_file("a.sql", "select 1\n");
    fixture.commit_file("b.sql", "select 2\n");
    fixture.commit_file("c.sql", "select 3\n");

    let all = fixture.git.log(&fixture.root, 50, 0).unwrap();
    let second_page = fixture.git.log(&fixture.root, 2, 2).unwrap();

    let subjects: Vec<_> = all.iter().map(|c| c.subject.as_str()).collect();
    assert_eq!(subjects, vec!["add c.sql", "add b.sql", "add a.sql"]);
    assert_eq!(all[0].author, "Test");
    assert_eq!(all[0].id.len(), 40);
    assert!(all[0].id.starts_with(&all[0].short_id));
    assert!(all[0].date.contains('T'), "{}", all[0].date);
    assert_eq!(second_page.len(), 1);
    assert_eq!(second_page[0].subject, "add a.sql");
}

#[test]
fn shows_the_files_and_the_diff_of_a_commit() {
    let fixture = Fixture::new();
    fixture.commit_file("a.sql", "select 1\n");
    fixture.write("a.sql", "select 2\n");
    fixture.write("new file.sql", "select 3\n");
    let paths = ["a.sql".to_owned(), "new file.sql".to_owned()];
    fixture.git.stage(&fixture.root, &paths).unwrap();
    fixture.git.commit(&fixture.root, "two files").unwrap();
    let log = fixture.git.log(&fixture.root, 50, 0).unwrap();

    let files = fixture.git.commit_files(&fixture.root, &log[0].id).unwrap();
    let root_files = fixture.git.commit_files(&fixture.root, &log[1].id).unwrap();
    let diff = fixture
        .git
        .commit_diff(&fixture.root, &log[0].id, "a.sql", None)
        .unwrap();
    let added = fixture
        .git
        .commit_diff(&fixture.root, &log[0].id, "new file.sql", None)
        .unwrap();

    let summary: Vec<_> = files.iter().map(|f| (f.path.as_str(), f.kind)).collect();
    assert_eq!(
        summary,
        vec![
            ("a.sql", ChangeKind::Modified),
            ("new file.sql", ChangeKind::Added)
        ]
    );
    // The first commit of a repository has no parent. All its files are new.
    assert_eq!(root_files.len(), 1);
    assert_eq!(root_files[0].kind, ChangeKind::Added);
    assert_eq!(
        (diff.original.as_str(), diff.modified.as_str()),
        ("select 1\n", "select 2\n")
    );
    assert_eq!(
        (added.original.as_str(), added.modified.as_str()),
        ("", "select 3\n")
    );
}

#[test]
fn shows_a_rename_in_a_commit_with_its_original_path() {
    let fixture = Fixture::new();
    fixture.commit_file("old.sql", "select 1 from a_long_table_name\n");
    std::fs::rename(fixture.root.join("old.sql"), fixture.root.join("new.sql")).unwrap();
    let paths = ["old.sql".to_owned(), "new.sql".to_owned()];
    fixture.git.stage(&fixture.root, &paths).unwrap();
    fixture.git.commit(&fixture.root, "rename").unwrap();
    let id = fixture.git.log(&fixture.root, 1, 0).unwrap()[0].id.clone();

    let files = fixture.git.commit_files(&fixture.root, &id).unwrap();
    let diff = fixture
        .git
        .commit_diff(&fixture.root, &id, "new.sql", Some("old.sql"))
        .unwrap();

    assert_eq!(files.len(), 1);
    assert_eq!(files[0].kind, ChangeKind::Renamed);
    assert_eq!(files[0].path, "new.sql");
    assert_eq!(files[0].original_path.as_deref(), Some("old.sql"));
    assert_eq!(diff.original, diff.modified);
}

#[test]
fn rejects_a_commit_identifier_that_is_not_hexadecimal() {
    let fixture = Fixture::new();
    fixture.commit_file("a.sql", "select 1\n");

    for id in ["", "--output=x", "HEAD", "main", "abc"] {
        let files = fixture.git.commit_files(&fixture.root, id);
        let diff = fixture.git.commit_diff(&fixture.root, id, "a.sql", None);
        assert!(matches!(files, Err(GitError::InvalidName(_))), "{id}");
        assert!(matches!(diff, Err(GitError::InvalidName(_))), "{id}");
    }
}

#[test]
fn renames_a_branch() {
    let fixture = Fixture::new();
    fixture.commit_file("a.sql", "select 1\n");
    fixture.git.create_branch(&fixture.root, "feature").unwrap();

    fixture
        .git
        .rename_branch(&fixture.root, "feature", "feature/new-name")
        .unwrap();

    let names: Vec<_> = fixture
        .git
        .branches(&fixture.root)
        .unwrap()
        .into_iter()
        .map(|b| (b.name, b.is_current))
        .collect();
    assert_eq!(
        names,
        vec![
            ("feature/new-name".to_owned(), true),
            ("main".to_owned(), false)
        ]
    );
    let invalid = fixture.git.rename_branch(&fixture.root, "main", "--force");
    assert!(matches!(invalid, Err(GitError::InvalidName(_))));
}

#[test]
fn deletes_a_merged_branch_and_asks_before_it_deletes_an_unmerged_branch() {
    let fixture = Fixture::new();
    fixture.commit_file("a.sql", "select 1\n");
    fixture.git.create_branch(&fixture.root, "merged").unwrap();
    fixture
        .git
        .create_branch(&fixture.root, "unmerged")
        .unwrap();
    fixture.commit_file("b.sql", "select 2\n");
    fixture.git.switch_branch(&fixture.root, "main").unwrap();
    let delete = |name: &str, force: bool| fixture.git.delete_branch(&fixture.root, name, force);

    assert_eq!(delete("merged", false).unwrap(), BranchDeletion::Deleted);
    assert_eq!(
        delete("unmerged", false).unwrap(),
        BranchDeletion::NotMerged
    );
    assert_eq!(fixture.git.branches(&fixture.root).unwrap().len(), 2);
    assert_eq!(delete("unmerged", true).unwrap(), BranchDeletion::Deleted);
    assert_eq!(fixture.git.branches(&fixture.root).unwrap().len(), 1);

    // Git refuses to delete the current branch.
    assert!(matches!(delete("main", true), Err(GitError::Failed { .. })));
}

#[test]
fn reads_the_sides_of_a_conflict() {
    let (_home, git, clone) = conflicted_clone("from remote\n", "from local\n");

    let sides = git.conflict(&clone, "a.sql").unwrap();
    let message = git.merge_message(&clone).unwrap();

    assert_eq!(sides.base.as_deref(), Some("select 1\n"));
    assert_eq!(sides.ours.as_deref(), Some("from local\n"));
    assert_eq!(sides.theirs.as_deref(), Some("from remote\n"));
    assert!(sides.working.unwrap().contains("<<<<<<<"));
    let message = message.expect("a merge is in progress");
    assert!(message.starts_with("Merge "), "{message}");
    assert!(!message.contains('#'), "{message}");
}

#[test]
fn no_merge_message_without_a_merge() {
    let fixture = Fixture::new();
    fixture.commit_file("a.sql", "select 1\n");

    assert_eq!(fixture.git.merge_message(&fixture.root).unwrap(), None);
}

#[test]
fn resolves_a_conflict_with_a_text_and_completes_the_merge() {
    let (_home, git, clone) = conflicted_clone("from remote\n", "from local\n");

    git.resolve_with_text(&clone, "a.sql", "from the two\n")
        .unwrap();

    let status = git.status(&clone).unwrap();
    let file = status.files.iter().find(|f| f.path == "a.sql").unwrap();
    assert!(!file.is_conflicted);
    assert_eq!(file.staged, Some(ChangeKind::Modified));
    let message = git.merge_message(&clone).unwrap().unwrap();
    git.commit(&clone, &message).unwrap();
    assert_eq!(git.merge_message(&clone).unwrap(), None);
    assert_eq!(
        std::fs::read_to_string(clone.join("a.sql")).unwrap(),
        "from the two\n"
    );
    // The merge commit has two parents. The log shows it first.
    assert_eq!(git.log(&clone, 1, 0).unwrap()[0].subject, message);
    git.push(&clone).unwrap();
}

#[test]
fn resolves_a_conflict_between_a_change_and_a_deletion() {
    let (_home, git, first, second) = two_clones();
    std::fs::remove_file(first.join("a.sql")).unwrap();
    git.stage(&first, &["a.sql".to_owned()]).unwrap();
    git.commit(&first, "delete").unwrap();
    git.push(&first).unwrap();
    commit_change(&git, &second, "from local\n");
    git.pull(&second).unwrap_err();

    let sides = git.conflict(&second, "a.sql").unwrap();
    git.resolve_by_delete(&second, "a.sql").unwrap();

    assert_eq!(sides.ours.as_deref(), Some("from local\n"));
    assert_eq!(sides.theirs, None);
    assert!(!second.join("a.sql").exists());
    let status = git.status(&second).unwrap();
    assert!(status.files.iter().all(|f| !f.is_conflicted));
}

#[test]
fn aborts_a_merge() {
    let (_home, git, clone) = conflicted_clone("from remote\n", "from local\n");

    git.abort_merge(&clone).unwrap();

    assert_eq!(git.merge_message(&clone).unwrap(), None);
    assert_eq!(git.status(&clone).unwrap().files, vec![]);
    assert_eq!(
        std::fs::read_to_string(clone.join("a.sql")).unwrap(),
        "from local\n"
    );
}

#[cfg(unix)]
#[test]
fn does_not_write_a_resolution_through_a_symbolic_link() {
    let (home, git, clone) = conflicted_clone("from remote\n", "from local\n");
    let outside = home.path().join("outside.txt");
    std::fs::write(&outside, "keep\n").unwrap();
    std::fs::remove_file(clone.join("a.sql")).unwrap();
    std::os::unix::fs::symlink(&outside, clone.join("a.sql")).unwrap();

    let result = git.resolve_with_text(&clone, "a.sql", "overwritten\n");

    assert!(matches!(result, Err(GitError::InvalidName(_))));
    assert_eq!(std::fs::read_to_string(&outside).unwrap(), "keep\n");
}
