//! Integration tests for statement execution against a real PostgreSQL server.
//!
//! These tests need Docker. Run them with:
//! `cargo test -p tabloxide-adapter-postgres -- --ignored`

mod common;

use common::{PASSWORD, start_server};
use std::time::{Duration, Instant};
use tabloxide_adapter_postgres::PostgresAdapter;
use tabloxide_core::{
    ColumnKind, ConnectionProfile, DbAdapter, Page, QueryError, QueryErrorKind, Secret, Session,
};

const LARGE_QUERY: &str = "SELECT i, md5(i::text) FROM generate_series(1, 3000000) AS i";

async fn connect(profile: &ConnectionProfile) -> Box<dyn Session> {
    PostgresAdapter
        .connect(profile, Some(&Secret::new(PASSWORD)))
        .await
        .expect("the session must open")
}

/// Runs a statement and reads its complete result.
async fn run(session: &mut dyn Session, statement: &str) -> Result<Page, QueryError> {
    let mut stream = session.execute(statement).await?;
    let mut rows = Vec::new();
    loop {
        let page = stream.next_page(1000).await?;
        rows.extend(page.rows);
        if page.end.is_some() {
            return Ok(Page {
                rows,
                end: page.end,
            });
        }
    }
}

fn text(value: &str) -> Option<String> {
    Some(value.to_owned())
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs Docker"]
async fn runs_statements_and_reports_errors() {
    let (_container, profile) = start_server(false).await;
    let mut session = connect(&profile).await;
    let session = session.as_mut();
    assert!(
        session
            .server_info()
            .version
            .starts_with(common::POSTGRES_TAG)
    );

    // A statement without rows gives the number of changed rows.
    let created = session
        .execute("CREATE TABLE item (id int PRIMARY KEY, name text)")
        .await
        .unwrap();
    assert!(created.columns().is_none());
    let inserted = run(
        session,
        "INSERT INTO item VALUES (1, 'a'), (2, NULL), (3, '')",
    )
    .await
    .unwrap();
    assert_eq!(inserted.end.unwrap().affected_rows, 3);

    // A query gives the column types, and the values in the text form. NULL is `None`.
    let query = "SELECT id, name, id > 1 AS big, now() AS at, '{\"a\": 1}'::jsonb AS doc, \
                 ARRAY[id] AS list FROM item ORDER BY id";
    let mut stream = session.execute(query).await.unwrap();
    let described: Vec<(String, Option<String>, ColumnKind)> = stream
        .columns()
        .unwrap()
        .iter()
        .map(|c| (c.name.clone(), c.type_name.clone(), c.kind))
        .collect();
    assert_eq!(
        described,
        vec![
            ("id".to_owned(), text("int4"), ColumnKind::Number),
            ("name".to_owned(), text("text"), ColumnKind::Text),
            ("big".to_owned(), text("bool"), ColumnKind::Boolean),
            ("at".to_owned(), text("timestamptz"), ColumnKind::Temporal),
            ("doc".to_owned(), text("jsonb"), ColumnKind::Json),
            ("list".to_owned(), text("_int4"), ColumnKind::Other),
        ]
    );
    let page = stream.next_page(1000).await.unwrap();
    assert_eq!(page.end.unwrap().affected_rows, 3);
    assert_eq!(page.rows[0][..3], [text("1"), text("a"), text("f")]);
    assert_eq!(page.rows[1][..3], [text("2"), None, text("t")]);
    assert_eq!(page.rows[2][1], text(""));
    assert_eq!(page.rows[0][4..], [text("{\"a\": 1}"), text("{1}")]);

    // A query without rows has columns.
    let empty = session
        .execute("SELECT * FROM item WHERE id < 0")
        .await
        .unwrap();
    assert_eq!(empty.columns().unwrap().len(), 2);

    // A server error has the SQLSTATE code and the position in the statement.
    let error = run(session, "SELECT idd FROM item").await.unwrap_err();
    assert_eq!(error.kind, QueryErrorKind::Database);
    assert_eq!(error.code.as_deref(), Some("42703"));
    assert_eq!(error.position, Some(8));
    assert!(error.message.contains("idd"), "{}", error.message);

    // An error during the fetch arrives after the first rows.
    let late = run(session, "SELECT 10 / (3 - id) FROM item ORDER BY id")
        .await
        .unwrap_err();
    assert_eq!(late.code.as_deref(), Some("22012"));

    // The session is usable after an error.
    let after = run(session, "SELECT 1").await.unwrap();
    assert_eq!(after.rows, vec![vec![text("1")]]);

    // An empty statement is complete without rows.
    let nothing = run(session, "-- only a comment").await.unwrap();
    assert_eq!(nothing.end.unwrap().affected_rows, 0);
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs Docker"]
async fn reads_a_large_result_in_pages() {
    let (_container, profile) = start_server(false).await;
    let mut session = connect(&profile).await;
    let mut monitor = connect(&profile).await;

    // The first page arrives before the server made all rows.
    let start = Instant::now();
    let mut stream = session.execute(LARGE_QUERY).await.unwrap();
    let page = stream.next_page(500).await.unwrap();
    assert_eq!(page.rows.len(), 500);
    assert!(page.end.is_none());
    assert!(
        start.elapsed() < Duration::from_secs(2),
        "{:?}",
        start.elapsed()
    );

    // While the stream waits, the driver does not read. Thus the server waits for the client.
    tokio::time::sleep(Duration::from_secs(1)).await;
    let waiting = run(
        monitor.as_mut(),
        "SELECT wait_event FROM pg_stat_activity \
         WHERE state = 'active' AND query LIKE 'SELECT i, md5%'",
    )
    .await
    .unwrap();
    assert_eq!(waiting.rows, vec![vec![text("ClientWrite")]]);

    // The next page continues where the first page stopped.
    let page = stream.next_page(500).await.unwrap();
    assert_eq!(page.rows[0][0], text("501"));

    // An early close cancels the statement. The next statement does not wait for the rows.
    let start = Instant::now();
    stream.close().await;
    let after = run(session.as_mut(), "SELECT 1").await.unwrap();
    assert_eq!(after.rows, vec![vec![text("1")]]);
    assert!(
        start.elapsed() < Duration::from_secs(2),
        "{:?}",
        start.elapsed()
    );
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs Docker"]
async fn cancels_and_stops_statements() {
    let (_container, profile) = start_server(false).await;
    let mut session = connect(&profile).await;
    let cancel = session.cancel_handle();

    // Cancel while the statement runs on the server.
    let canceller = tokio::spawn({
        let cancel = cancel.clone();
        async move {
            tokio::time::sleep(Duration::from_millis(300)).await;
            cancel.cancel().await
        }
    });
    let start = Instant::now();
    let error = run(session.as_mut(), "SELECT pg_sleep(30)")
        .await
        .unwrap_err();
    assert_eq!(error.kind, QueryErrorKind::Cancelled);
    assert!(
        start.elapsed() < Duration::from_secs(5),
        "{:?}",
        start.elapsed()
    );
    canceller.await.unwrap().unwrap();

    // Cancel during the fetch of a large result.
    let mut stream = session.execute(LARGE_QUERY).await.unwrap();
    stream.next_page(500).await.unwrap();
    cancel.cancel().await.unwrap();
    let error = loop {
        match stream.next_page(500).await {
            Ok(page) => assert!(page.end.is_none(), "the cancel must stop the fetch"),
            Err(error) => break error,
        }
    };
    assert_eq!(error.kind, QueryErrorKind::Cancelled);
    drop(stream);

    // The session is usable after a cancel.
    let after = run(session.as_mut(), "SELECT 1").await.unwrap();
    assert_eq!(after.rows, vec![vec![text("1")]]);

    // The query timeout of the connection stops a statement that does not answer.
    let with_timeout = ConnectionProfile {
        query_timeout_secs: Some(1),
        ..profile.clone()
    };
    let mut limited = connect(&with_timeout).await;
    let start = Instant::now();
    let error = run(limited.as_mut(), "SELECT pg_sleep(30)")
        .await
        .unwrap_err();
    assert_eq!(error.kind, QueryErrorKind::Timeout);
    assert!(
        start.elapsed() < Duration::from_secs(5),
        "{:?}",
        start.elapsed()
    );
    let after = run(limited.as_mut(), "SELECT 1").await.unwrap();
    assert_eq!(after.rows, vec![vec![text("1")]]);
}
