//! Tests of the credential prompts with the real `git` executable.
//!
//! `git credential fill` asks for a user name and a password in the same way as a
//! fetch from an HTTPS remote. Thus the test needs no server.

mod common;

use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use tabloxide_git::{AskpassServer, Prompt};

/// The helper program of this crate. Cargo builds it for the test run.
fn helper() -> PathBuf {
    PathBuf::from(env!("CARGO_BIN_EXE_tabloxide-askpass"))
}

/// Runs `git credential fill` for an HTTPS host and returns the output and the result.
fn credential_fill(env: Vec<(String, String)>) -> (String, bool) {
    let home = tempfile::tempdir().unwrap();
    let empty = home.path().join("gitconfig");
    std::fs::write(&empty, "").unwrap();
    let mut child = Command::new("git")
        .current_dir(home.path())
        .args(["credential", "fill"])
        .env("GIT_CONFIG_GLOBAL", &empty)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .envs(env)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(b"protocol=https\nhost=example.com\n\n")
        .unwrap();
    let output = child.wait_with_output().unwrap();
    (
        String::from_utf8_lossy(&output.stdout).into_owned(),
        output.status.success(),
    )
}

#[test]
fn git_gets_the_user_name_and_the_password_from_the_handler() {
    let server = AskpassServer::start().unwrap();
    let prompts = Arc::new(Mutex::new(Vec::new()));
    let record = Arc::clone(&prompts);
    let session = server
        .register(Arc::new(move |prompt: Prompt| {
            let answer = if prompt.is_secret { "s3cr3t" } else { "ada" };
            record.lock().unwrap().push((prompt.text, prompt.is_secret));
            Some(answer.to_owned())
        }))
        .unwrap();

    let (output, is_success) = credential_fill(session.env(&helper()));

    assert!(is_success, "{output}");
    assert!(output.contains("username=ada\n"), "{output}");
    assert!(output.contains("password=s3cr3t\n"), "{output}");
    assert_eq!(
        *prompts.lock().unwrap(),
        vec![
            ("Username for 'https://example.com':".to_owned(), false),
            ("Password for 'https://ada@example.com':".to_owned(), true),
        ]
    );
}

#[test]
fn git_stops_when_the_user_gives_no_answer() {
    let server = AskpassServer::start().unwrap();
    let session = server.register(Arc::new(|_| None)).unwrap();

    let (output, is_success) = credential_fill(session.env(&helper()));

    assert!(!is_success);
    assert!(!output.contains("password="), "{output}");
}

#[test]
fn git_gets_no_answer_after_the_session_ended() {
    let server = AskpassServer::start().unwrap();
    let session = server
        .register(Arc::new(|_| Some("answer".to_owned())))
        .unwrap();
    let env = session.env(&helper());
    drop(session);

    let (output, is_success) = credential_fill(env);

    assert!(!is_success);
    assert!(!output.contains("answer"), "{output}");
}
