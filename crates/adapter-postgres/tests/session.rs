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
        .connect(
            profile,
            Some(&Secret::new(PASSWORD)),
            std::path::Path::new("."),
        )
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

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs Docker"]
async fn runs_a_script_and_exports_a_result() {
    use tabloxide_core::{Outcome, QuerySession, RunLimits, RunTarget};

    let limits = RunLimits {
        page_rows: 100,
        buffered_rows: 250,
    };
    let (_container, profile) = start_server(false).await;
    let session = QuerySession::new(connect(&profile).await, tabloxide_core::QueryLanguage::Sql);

    // A script runs in sequence. The last statement stays open for paged reads.
    let script = "CREATE TABLE n AS SELECT i FROM generate_series(1, 1000) AS i;\n\
                  UPDATE n SET i = i WHERE i <= 10 RETURNING i;\n\
                  SELECT i, 'ü,\"x\"' AS t, NULL AS e FROM n ORDER BY i";
    let report = session.run(script, RunTarget::All, limits).await;
    assert_eq!(report.statements.len(), 3);
    assert!(matches!(
        report.statements[0].outcome,
        Outcome::Command {
            affected_rows: 1000
        }
    ));
    assert!(matches!(
        &report.statements[1].outcome,
        Outcome::Rows { rows, is_complete: true, total_rows: Some(10), .. } if rows.len() == 10
    ));
    assert!(matches!(
        &report.statements[2].outcome,
        Outcome::Rows { rows, is_complete: false, .. } if rows.len() == 100
    ));
    let open = report.open_result.expect("the last result must be open");
    let page = session.fetch(open, 100).await.unwrap();
    assert_eq!(page.rows[0][0], text("101"));

    // The export runs the statement again and writes all rows.
    let mut out: Vec<u8> = Vec::new();
    let statement = "SELECT i, 'ü,\"x\"' AS t, NULL AS e FROM n WHERE i <= 2 ORDER BY i";
    let count = session.export_csv(statement, &mut out, 100).await.unwrap();
    assert_eq!(count, 2);
    assert_eq!(
        String::from_utf8(out).unwrap(),
        "i,t,e\n1,\"ü,\"\"x\"\"\",\n2,\"ü,\"\"x\"\"\",\n"
    );
    // The export closed the open result.
    assert_eq!(session.fetch(open, 100).await, None);

    // A failure stops the script and gives the position in the script.
    let script = "SELECT 1;\nSELECT ü, nope FROM n;\nSELECT 3";
    let report = session.run(script, RunTarget::All, limits).await;
    assert_eq!(report.statements.len(), 2);
    let Outcome::Failed { location, .. } = &report.statements[1].outcome else {
        panic!("the second statement must fail");
    };
    let location = location.expect("the server gives the position");
    assert_eq!((location.line, location.column), (2, 8));
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs Docker"]
async fn reads_the_structure_of_the_database() {
    use tabloxide_core::{ConstraintKind, Outcome, QuerySession, RelationKind};

    let (_container, profile) = start_server(false).await;
    let mut setup = connect(&profile).await;
    for statement in [
        "CREATE SCHEMA \"Shop\"",
        "CREATE TABLE \"Shop\".customer (id int PRIMARY KEY, email text NOT NULL UNIQUE)",
        "CREATE TABLE \"Shop\".\"Order Item\" (
            id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            customer_id int NOT NULL REFERENCES \"Shop\".customer (id),
            quantity numeric(10, 2) DEFAULT 1 CHECK (quantity > 0),
            note varchar(40))",
        "CREATE INDEX item_note ON \"Shop\".\"Order Item\" (note)",
        "CREATE VIEW \"Shop\".big AS SELECT * FROM \"Shop\".\"Order Item\" WHERE quantity > 10",
        "INSERT INTO \"Shop\".customer VALUES (1, 'a@example.com')",
        "INSERT INTO \"Shop\".\"Order Item\" (customer_id, note)
            SELECT 1, 'n' || i FROM generate_series(1, 30) AS i",
    ] {
        run(setup.as_mut(), statement).await.unwrap();
    }
    let session = QuerySession::new(connect(&profile).await, tabloxide_core::QueryLanguage::Sql);

    // User schemas are before the system schemas.
    let schemas = session.schemas().await.unwrap();
    let names: Vec<&str> = schemas.iter().map(|s| s.name.as_str()).collect();
    assert_eq!(names[..2], ["Shop", "public"]);
    assert!(
        schemas
            .iter()
            .any(|s| s.name == "pg_catalog" && s.is_system)
    );
    assert!(!schemas[0].is_system);

    let relations = session.relations("Shop").await.unwrap();
    let listed: Vec<(&str, RelationKind)> = relations
        .iter()
        .map(|r| (r.name.as_str(), r.kind))
        .collect();
    assert_eq!(
        listed,
        vec![
            ("Order Item", RelationKind::Table),
            ("big", RelationKind::View),
            ("customer", RelationKind::Table),
        ]
    );
    assert!(
        session
            .relations("no_such_schema")
            .await
            .unwrap()
            .is_empty()
    );

    let detail = session.relation_detail("Shop", "Order Item").await.unwrap();
    let columns: Vec<(&str, &str, bool, bool)> = detail
        .columns
        .iter()
        .map(|c| {
            (
                c.name.as_str(),
                c.data_type.as_str(),
                c.is_nullable,
                c.is_primary_key,
            )
        })
        .collect();
    assert_eq!(
        columns,
        vec![
            ("id", "bigint", false, true),
            ("customer_id", "integer", false, false),
            ("quantity", "numeric(10,2)", true, false),
            ("note", "character varying(40)", true, false),
        ]
    );
    assert_eq!(detail.columns[2].default.as_deref(), Some("1"));
    let indexes: Vec<(&str, bool)> = detail
        .indexes
        .iter()
        .map(|i| (i.name.as_str(), i.is_primary))
        .collect();
    assert_eq!(
        indexes,
        vec![("Order Item_pkey", true), ("item_note", false)]
    );
    assert!(detail.indexes[1].definition.contains("(note)"));
    let kinds: Vec<ConstraintKind> = detail.constraints.iter().map(|c| c.kind).collect();
    assert!(kinds.contains(&ConstraintKind::PrimaryKey));
    assert!(kinds.contains(&ConstraintKind::ForeignKey));
    assert!(kinds.contains(&ConstraintKind::Check));

    // A view has columns, but no indexes.
    let view = session.relation_detail("Shop", "big").await.unwrap();
    assert_eq!(view.columns.len(), 4);
    assert!(view.indexes.is_empty());

    // The sample has a row limit and uses quoted identifiers.
    let sample = session.sample("Shop", "Order Item", 10).await.unwrap();
    assert!(matches!(
        &sample.outcome,
        Outcome::Rows { rows, is_complete: true, .. } if rows.len() == 10
    ));
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs Docker"]
async fn a_read_only_session_refuses_changes_and_a_lost_connection_is_reported() {
    let (_container, profile) = start_server(false).await;
    let mut admin = connect(&profile).await;
    run(admin.as_mut(), "CREATE TABLE item (id int)")
        .await
        .unwrap();

    // A read-only session can read, but the server refuses a change.
    let read_only = ConnectionProfile {
        read_only: true,
        ..profile.clone()
    };
    let mut session = connect(&read_only).await;
    run(session.as_mut(), "SELECT * FROM item").await.unwrap();
    let error = run(session.as_mut(), "INSERT INTO item VALUES (1)")
        .await
        .unwrap_err();
    assert_eq!(error.code.as_deref(), Some("25006"));
    let error = run(session.as_mut(), "DROP TABLE item").await.unwrap_err();
    assert_eq!(error.code.as_deref(), Some("25006"));

    // When an administrator ends the session, the next statement reports a lost connection.
    let terminate = "SELECT pg_terminate_backend(pid) FROM pg_stat_activity \
                     WHERE pid <> pg_backend_pid() AND application_name = 'Tabloxide'";
    run(admin.as_mut(), terminate).await.unwrap();
    tokio::time::sleep(Duration::from_millis(300)).await;
    let error = run(session.as_mut(), "SELECT 1").await.unwrap_err();
    assert_eq!(error.kind, QueryErrorKind::ConnectionLost, "{error:?}");
}

#[tokio::test]
#[ignore = "needs Docker"]
async fn reads_the_plan_as_json_with_and_without_a_measure() {
    let (_container, profile) = start_server(false).await;
    let mut session = connect(&profile).await;
    let session = session.as_mut();
    let statement = "SELECT count(*) FROM generate_series(1, 1000) AS i WHERE i % 7 = 0";

    let estimate = session.read_plan(statement, false).await.unwrap();
    let measured = session.read_plan(statement, true).await.unwrap();

    assert_eq!(
        estimate.statement,
        format!("EXPLAIN (VERBOSE, FORMAT JSON) {statement}")
    );
    assert!(
        estimate.text.trim_start().starts_with('['),
        "{}",
        estimate.text
    );
    assert!(!estimate.text.contains("Execution Time"));
    assert!(
        measured.text.contains("Execution Time"),
        "{}",
        measured.text
    );
    assert!(measured.plan.is_none());
}
