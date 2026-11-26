//! Tests of the Git console against real repositories. They need the `git` executable.

mod common;

use common::Fixture;
use std::sync::atomic::AtomicBool;
use std::time::{Duration, Instant};
use tabloxide_git::{ConsoleCheck, parse_console_line};

fn run(fixture: &Fixture, line: &str) -> tabloxide_git::ConsoleOutput {
    let command = parse_console_line(line).unwrap();
    fixture
        .git
        .console_run(&fixture.root, &command, &AtomicBool::new(false))
        .unwrap()
}

#[test]
fn runs_a_command_and_returns_its_output() {
    let fixture = Fixture::new();
    fixture.commit_file("report.sql", "select 1\n");

    let output = run(&fixture, "log --format=%s");

    assert!(output.is_success);
    assert_eq!(output.stdout, "add report.sql\n");
    assert!(!output.is_cut);
    assert_eq!(output.note, None);
}

#[test]
fn a_failed_command_has_its_error_text() {
    let fixture = Fixture::new();

    let output = run(&fixture, "checkout no-such-branch");

    assert!(!output.is_success);
    assert!(
        output.stderr.contains("no-such-branch"),
        "{}",
        output.stderr
    );
}

#[test]
fn a_command_that_wants_an_editor_fails_at_once_with_a_note() {
    let fixture = Fixture::new();
    fixture.write("report.sql", "select 1\n");
    fixture
        .git
        .stage(&fixture.root, &["report.sql".to_owned()])
        .unwrap();
    let start = Instant::now();

    let output = run(&fixture, "commit");

    assert!(start.elapsed() < Duration::from_secs(10));
    assert!(!output.is_success);
    assert!(
        output
            .note
            .unwrap()
            .contains("Git wanted to open an editor")
    );
}

#[test]
fn reset_hard_tells_the_files_and_the_commits_that_it_removes() {
    let fixture = Fixture::new();
    fixture.commit_file("a.sql", "select 1\n");
    fixture.commit_file("b.sql", "select 2\n");
    fixture.write("a.sql", "select 3\n");

    let check = fixture
        .git
        .console_check(&fixture.root, "reset --hard HEAD~1")
        .unwrap();

    assert_eq!(
        check,
        ConsoleCheck::Confirm {
            effect: "This command removes the changes in 1 file and moves main back by \
                     1 commit. You cannot undo it in Tabloxide."
                .to_owned()
        }
    );
}

#[test]
fn clean_lists_the_files_that_it_deletes_and_needs_no_confirmation_without_files() {
    let fixture = Fixture::new();
    fixture.commit_file(".gitignore", "");

    let empty = fixture
        .git
        .console_check(&fixture.root, "clean -fd")
        .unwrap();
    fixture.write("scratch.sql", "select 1\n");
    let one = fixture
        .git
        .console_check(&fixture.root, "clean -fd")
        .unwrap();

    assert_eq!(empty, ConsoleCheck::Ready);
    assert_eq!(
        one,
        ConsoleCheck::Confirm {
            effect: "This command deletes 1 file that Git does not track: scratch.sql. You \
                     cannot undo it in Tabloxide."
                .to_owned()
        }
    );
    assert!(fixture.root.join("scratch.sql").exists());
}

#[test]
fn refuses_an_alias_that_runs_a_shell_command() {
    let fixture = Fixture::new();
    let config = fixture.root.join(".git").join("config");
    let mut text = std::fs::read_to_string(&config).unwrap();
    text.push_str("[alias]\n\tbad = !echo hi\n\tst = status\n");
    std::fs::write(&config, text).unwrap();

    let bad = fixture.git.console_check(&fixture.root, "bad").unwrap();
    let plain = fixture.git.console_check(&fixture.root, "st").unwrap();

    assert!(matches!(bad, ConsoleCheck::Refused { reason } if reason.contains("alias bad")));
    assert_eq!(plain, ConsoleCheck::Ready);
}

#[test]
fn a_shell_character_is_refused_before_git_runs() {
    let fixture = Fixture::new();

    let check = fixture
        .git
        .console_check(&fixture.root, "log | head")
        .unwrap();

    assert!(matches!(check, ConsoleCheck::Refused { reason } if reason.contains("no shell")));
}

#[test]
fn the_names_have_the_branches_the_tags_and_the_files() {
    let fixture = Fixture::new();
    fixture.commit_file("report.sql", "select 1\n");
    fixture.write("new.sql", "select 2\n");
    fixture.git.create_branch(&fixture.root, "feature").unwrap();
    run(&fixture, "tag v1");

    let names = fixture.git.console_names(&fixture.root).unwrap();

    assert_eq!(names.branches, ["feature", "main"]);
    assert_eq!(names.tags, ["v1"]);
    assert!(names.remotes.is_empty());
    assert!(names.files.contains(&"report.sql".to_owned()));
    assert!(names.files.contains(&"new.sql".to_owned()));
}
