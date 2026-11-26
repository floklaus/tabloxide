//! Starts a connector process and uses it through the `DbAdapter` interface.
//!
//! The test executable is also the connector: with the environment variable
//! `CHILD_ENV`, the test `child_connector` serves a `ScriptedAdapter` with the SDK.

use std::path::Path;
use std::sync::Arc;
use tabloxide_connector_host::{
    ConnectorProcess, RemoteAdapter, StartError, connect_client, describe,
};
use tabloxide_core::testing::{ScriptedAdapter, WRONG_PASSWORD};
use tabloxide_core::{
    ConnectErrorKind, ConnectionProfile, DbAdapter, QueryErrorKind, Secret, Session,
};

const CHILD_ENV: &str = "TABLOXIDE_HOST_TEST_CHILD";

#[test]
fn child_connector() {
    if std::env::var(CHILD_ENV).is_err() {
        return;
    }
    let runtime = tokio::runtime::Runtime::new().unwrap();
    runtime
        .block_on(tabloxide_connector_sdk::serve(
            Arc::new(ScriptedAdapter::default()),
            "9.9.9",
        ))
        .unwrap();
}

async fn start() -> RemoteAdapter {
    let program = std::env::current_exe().unwrap();
    let process = ConnectorProcess::start(
        &program,
        &[
            "child_connector",
            "--exact",
            "--nocapture",
            "--test-threads=1",
        ],
        &[(CHILD_ENV, "1")],
        "scripted",
    )
    .await
    .expect("the connector must start");
    RemoteAdapter::new(Arc::new(process))
}

async fn session(adapter: &RemoteAdapter) -> Box<dyn Session> {
    adapter
        .connect(&ConnectionProfile::template(), None, Path::new("/tmp"))
        .await
        .expect("the session must open")
}

#[tokio::test(flavor = "multi_thread")]
async fn describe_gives_the_engine_of_the_connector() {
    let adapter = start().await;

    let info = adapter.info();

    assert_eq!(info.engine.as_str(), "scripted");
    assert_eq!(info.display_name, "Scripted");
    assert!(adapter.is_running());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_large_result_comes_in_pages_on_request() {
    let adapter = start().await;
    let mut session = session(&adapter).await;

    let mut stream = session.execute("rows 1200").await.unwrap();
    let first = stream.next_page(100).await.unwrap();
    let second = stream.next_page(1000).await.unwrap();
    let last = stream.next_page(1000).await.unwrap();

    assert_eq!(stream.columns().unwrap()[0].name, "n");
    assert_eq!(first.rows.len(), 100);
    assert_eq!(first.rows[0], vec![Some("1".to_owned())]);
    assert!(first.end.is_none());
    assert_eq!(second.rows.len(), 1000);
    assert_eq!(last.rows.len(), 100);
    assert_eq!(last.end.unwrap().affected_rows, 1200);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_closed_result_frees_the_session_for_the_next_statement() {
    let adapter = start().await;
    let mut session = session(&adapter).await;

    let mut stream = session.execute("rows 100000").await.unwrap();
    stream.next_page(10).await.unwrap();
    stream.close().await;
    let mut next = session.execute("command 3").await.unwrap();
    let page = next.next_page(10).await.unwrap();

    assert!(next.columns().is_none());
    assert_eq!(page.end.unwrap().affected_rows, 3);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_failed_statement_keeps_its_message_and_position() {
    let adapter = start().await;
    let mut session = session(&adapter).await;

    let error = match session.execute("error syntax error at x").await {
        Err(error) => error,
        Ok(_) => panic!("the statement must fail"),
    };

    assert_eq!(error.kind, QueryErrorKind::Database);
    assert_eq!(error.message, "syntax error at x");
    assert_eq!(error.position, Some(1));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_wrong_password_is_an_authentication_error() {
    let adapter = start().await;
    let password = Secret::new(WRONG_PASSWORD);

    let error = adapter
        .test_connection(
            &ConnectionProfile::template(),
            Some(&password),
            Path::new("/"),
        )
        .await
        .unwrap_err();

    assert_eq!(error.kind, ConnectErrorKind::Authentication);
}

#[tokio::test(flavor = "multi_thread")]
async fn the_catalog_and_the_sample_statement_come_from_the_connector() {
    let adapter = start().await;
    let mut session = session(&adapter).await;

    let schemas = session.schemas().await.unwrap();
    let relations = session.relations("public").await.unwrap();
    let detail = session.relation_detail("public", "t").await.unwrap();
    let sample = session.sample_statement("public", "t", 5).await;

    assert_eq!(schemas[0].name, "public");
    assert_eq!(relations[0].name, "public_table");
    assert_eq!(detail.columns[0].name, "t_id");
    assert_eq!(sample, "select * from public.t limit 5");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_cancel_stops_the_open_result() {
    let adapter = start().await;
    let mut session = session(&adapter).await;
    let cancel = session.cancel_handle();

    let mut stream = session.execute("rows 100000").await.unwrap();
    stream.next_page(10).await.unwrap();
    cancel.cancel().await.unwrap();
    let mut result = Ok(());
    for _ in 0..200 {
        if let Err(error) = stream.next_page(1000).await {
            result = Err(error);
            break;
        }
    }

    assert_eq!(result.unwrap_err().kind, QueryErrorKind::Cancelled);
}

#[tokio::test(flavor = "multi_thread")]
async fn the_connector_refuses_a_client_with_a_different_token() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(tabloxide_connector_sdk::serve_on(
        listener,
        "right".to_owned(),
        Arc::new(ScriptedAdapter::default()),
        "1.0.0",
        std::future::pending(),
    ));

    let mut wrong = connect_client(port, "wrong").await.unwrap();
    let mut right = connect_client(port, "right").await.unwrap();

    assert!(matches!(
        describe(&mut wrong, "scripted").await,
        Err(StartError::Protocol(_))
    ));
    assert!(describe(&mut right, "scripted").await.is_ok());
    assert!(matches!(
        describe(&mut right, "mongodb").await,
        Err(StartError::Protocol(_))
    ));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_program_that_gives_no_port_does_not_start() {
    let error = ConnectorProcess::start(Path::new("/bin/true"), &[], &[], "scripted")
        .await
        .err()
        .unwrap();

    assert_eq!(error, StartError::Stopped);
}
