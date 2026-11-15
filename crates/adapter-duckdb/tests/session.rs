//! Tests of statement execution against a real DuckDB database.

mod common;

use common::{connect, profile, rows, run, text};
use std::time::{Duration, Instant};
use tabloxide_adapter_duckdb::DuckDbAdapter;
use tabloxide_core::{
    ColumnKind, ConnectionProfile, ConstraintKind, MEMORY_DATABASE, Outcome, QueryErrorKind,
    QuerySession, RelationKind, RunLimits, RunTarget,
};

const LARGE_QUERY: &str = "SELECT i, md5(i::varchar) FROM range(3000000) AS t(i)";
/// A statement that runs for a long time and returns no row early.
const SLOW_QUERY: &str =
    "SELECT count(*) FROM range(100000000000) AS a, range(1000) AS b WHERE a.range % 7 = b.range";

fn memory() -> ConnectionProfile {
    profile(MEMORY_DATABASE)
}

fn here() -> &'static std::path::Path {
    std::path::Path::new(".")
}

#[tokio::test(flavor = "multi_thread")]
async fn runs_statements_that_change_data_and_reports_the_changed_rows() {
    let adapter = DuckDbAdapter::default();
    let mut session = connect(&adapter, &memory(), here()).await;
    let session = session.as_mut();
    assert!(session.server_info().version.starts_with("DuckDB v"));

    let created = session
        .execute("CREATE TABLE item (id INTEGER PRIMARY KEY, name VARCHAR)")
        .await
        .unwrap();
    assert!(created.columns().is_none());
    created.close().await;

    let inserted = run(
        session,
        "INSERT INTO item VALUES (1, 'a'), (2, NULL), (3, '')",
    )
    .await
    .unwrap();
    let updated = run(session, "UPDATE item SET name = 'z' WHERE id < 3")
        .await
        .unwrap();
    let setting = run(session, "SET threads = 2").await.unwrap();

    assert_eq!(inserted.end.unwrap().affected_rows, 3);
    assert!(inserted.rows.is_empty());
    assert_eq!(updated.end.unwrap().affected_rows, 2);
    assert_eq!(setting.end.unwrap().affected_rows, 0);

    // A statement with RETURNING gives rows.
    let mut returning = session
        .execute("DELETE FROM item WHERE id = 3 RETURNING id, name")
        .await
        .unwrap();
    assert_eq!(returning.columns().unwrap().len(), 2);
    let page = returning.next_page(10).await.unwrap();
    assert_eq!(page.rows, vec![vec![text("3"), text("")]]);
}

#[tokio::test(flavor = "multi_thread")]
async fn gives_the_values_as_the_text_of_duckdb_with_the_column_types() {
    let adapter = DuckDbAdapter::default();
    let mut session = connect(&adapter, &memory(), here()).await;
    let statement = "SELECT 1.50::DECIMAL(10,2) AS amount, NULL AS nothing, '' AS empty, \
                     true AS flag, TIMESTAMPTZ '2026-11-14 10:00:00+02' AS moment, \
                     [1, 2, NULL] AS list, {'x': 1, 'y': 'text'} AS structure, \
                     'ä€😀' AS unicode, 1 AS twice, 2 AS twice -- a comment at the end";

    let mut stream = session.execute(statement).await.unwrap();
    let columns = stream.columns().unwrap().to_vec();
    let page = stream.next_page(10).await.unwrap();

    let described: Vec<_> = columns
        .iter()
        .map(|c| (c.name.as_str(), c.type_name.as_deref().unwrap(), c.kind))
        .collect();
    assert_eq!(
        described,
        vec![
            ("amount", "DECIMAL(10,2)", ColumnKind::Number),
            ("nothing", "\"NULL\"", ColumnKind::Other),
            ("empty", "VARCHAR", ColumnKind::Text),
            ("flag", "BOOLEAN", ColumnKind::Boolean),
            ("moment", "TIMESTAMP WITH TIME ZONE", ColumnKind::Temporal),
            ("list", "INTEGER[]", ColumnKind::Other),
            (
                "structure",
                "STRUCT(x INTEGER, y VARCHAR)",
                ColumnKind::Other
            ),
            ("unicode", "VARCHAR", ColumnKind::Text),
            // The two columns keep the name that the user gave them.
            ("twice", "INTEGER", ColumnKind::Number),
            ("twice", "INTEGER", ColumnKind::Number),
        ]
    );
    assert_eq!(
        page.rows,
        vec![vec![
            text("1.50"),
            None,
            text(""),
            text("true"),
            text("2026-11-14 08:00:00+00"),
            text("[1, 2, NULL]"),
            text("{'x': 1, 'y': text}"),
            text("ä€😀"),
            text("1"),
            text("2"),
        ]]
    );
    assert_eq!(page.end.unwrap().affected_rows, 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn runs_the_read_statements_of_duckdb() {
    let adapter = DuckDbAdapter::default();
    let mut session = connect(&adapter, &memory(), here()).await;
    let session = session.as_mut();
    run(
        session,
        "CREATE TABLE item AS SELECT * FROM range(3) AS t(id)",
    )
    .await
    .unwrap();

    assert_eq!(
        rows(session, "FROM item SELECT id WHERE id > 0")
            .await
            .len(),
        2
    );
    assert_eq!(
        rows(session, "DESCRIBE item").await[0][..2],
        [text("id"), text("BIGINT")]
    );
    assert_eq!(rows(session, "SHOW TABLES").await, vec![vec![text("item")]]);
    assert_eq!(rows(session, "SUMMARIZE item").await.len(), 1);
    // A statement without the text conversion of DuckDB also gives its values.
    let pragma = rows(session, "PRAGMA table_info('item')").await;
    assert_eq!(pragma[0][1], text("id"));
    let explain = rows(session, "EXPLAIN SELECT * FROM item").await;
    assert!(explain[0][1].as_deref().unwrap().contains("item"));
}

#[tokio::test(flavor = "multi_thread")]
async fn reads_a_large_result_in_pages_and_closes_it_early() {
    let adapter = DuckDbAdapter::default();
    let mut session = connect(&adapter, &memory(), here()).await;

    let start = Instant::now();
    let mut stream = session.execute(LARGE_QUERY).await.unwrap();
    let first = stream.next_page(500).await.unwrap();
    let first_page_time = start.elapsed();
    let second = stream.next_page(5000).await.unwrap();

    assert_eq!(first.rows.len(), 500);
    assert!(first.end.is_none());
    assert_eq!(first.rows[0][0], text("0"));
    // A page can be larger than one batch of DuckDB.
    assert_eq!(second.rows.len(), 5000);
    assert_eq!(second.rows[0][0], text("500"));
    assert_eq!(second.rows[4999][0], text("5499"));
    assert!(
        first_page_time < Duration::from_secs(2),
        "{first_page_time:?}"
    );

    // The close of the open result does not wait for the other rows.
    let start = Instant::now();
    stream.close().await;
    let after = rows(session.as_mut(), "SELECT 42").await;
    assert_eq!(after, vec![vec![text("42")]]);
    assert!(start.elapsed() < Duration::from_secs(2));
}

#[tokio::test(flavor = "multi_thread")]
async fn reads_a_complete_result_and_counts_its_rows() {
    let adapter = DuckDbAdapter::default();
    let mut session = connect(&adapter, &memory(), here()).await;

    let page = run(session.as_mut(), "SELECT * FROM range(4500)")
        .await
        .unwrap();
    let empty = run(session.as_mut(), "SELECT 1 WHERE false").await.unwrap();

    assert_eq!(page.rows.len(), 4500);
    assert_eq!(page.end.unwrap().affected_rows, 4500);
    assert!(empty.rows.is_empty());
    assert_eq!(empty.end.unwrap().affected_rows, 0);
}

#[tokio::test(flavor = "multi_thread")]
async fn reports_errors_with_the_position_in_the_statement_of_the_user() {
    let adapter = DuckDbAdapter::default();
    let mut session = connect(&adapter, &memory(), here()).await;
    let session = session.as_mut();
    let error = |statement: &'static str| async move {
        let mut session = connect(&DuckDbAdapter::default(), &memory(), here()).await;
        run(session.as_mut(), statement).await.unwrap_err()
    };

    let missing = error("SELECT * FROM no_such_table").await;
    let syntax = error("SELECT 1 +\n  FROM x").await;
    let typo = error("SELEC 1").await;
    let change = error("INSERT INTO no_such_table VALUES (1)").await;
    // This error occurs while DuckDB runs the statement with the text conversion.
    let runtime = error("SELECT 1 AS a, CAST(name AS INTEGER) FROM (SELECT 'x' AS name)").await;

    assert_eq!(missing.kind, QueryErrorKind::Database);
    assert!(
        missing.message.contains("no_such_table"),
        "{}",
        missing.message
    );
    assert_eq!(missing.position, Some(15));
    assert!(missing.hint.is_some());
    assert_eq!(syntax.position, Some(14));
    assert_eq!(typo.position, Some(1));
    // DuckDB gives no position for this error.
    assert_eq!(change.position, None);
    assert!(change.message.contains("no_such_table"));
    assert_eq!(runtime.position, Some(16), "{}", runtime.message);
    assert!(!runtime.message.contains('{'), "{}", runtime.message);

    // The session is usable after an error.
    assert_eq!(rows(session, "SELECT 1").await, vec![vec![text("1")]]);
}

#[tokio::test(flavor = "multi_thread")]
async fn cancels_a_statement_and_keeps_the_session() {
    let adapter = DuckDbAdapter::default();
    let mut session = connect(&adapter, &memory(), here()).await;
    let cancel = session.cancel_handle();

    // A cancel without an active statement does not stop the next statement.
    cancel.cancel().await.unwrap();
    assert_eq!(
        rows(session.as_mut(), "SELECT 1").await,
        vec![vec![text("1")]]
    );

    let canceller = tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(300)).await;
        cancel.cancel().await.unwrap();
    });
    let start = Instant::now();
    let error = run(session.as_mut(), SLOW_QUERY).await.unwrap_err();
    canceller.await.unwrap();

    assert_eq!(error.kind, QueryErrorKind::Cancelled);
    assert!(
        start.elapsed() < Duration::from_secs(5),
        "{:?}",
        start.elapsed()
    );
    assert_eq!(
        rows(session.as_mut(), "SELECT 2").await,
        vec![vec![text("2")]]
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn cancels_a_result_that_is_open() {
    let adapter = DuckDbAdapter::default();
    let mut session = connect(&adapter, &memory(), here()).await;
    let mut stream = session.execute(LARGE_QUERY).await.unwrap();
    stream.next_page(10).await.unwrap();

    session.cancel_handle().cancel().await.unwrap();
    // The rows that the adapter has already are available. Then the cancel shows.
    let mut outcome = stream.next_page(100_000).await;
    while matches!(&outcome, Ok(page) if page.end.is_none()) {
        outcome = stream.next_page(100_000).await;
    }

    assert_eq!(outcome.unwrap_err().kind, QueryErrorKind::Cancelled);
    assert_eq!(
        rows(session.as_mut(), "SELECT 3").await,
        vec![vec![text("3")]]
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn stops_a_statement_after_the_query_timeout() {
    let adapter = DuckDbAdapter::default();
    let profile = ConnectionProfile {
        query_timeout_secs: Some(1),
        ..memory()
    };
    let mut session = connect(&adapter, &profile, here()).await;

    let start = Instant::now();
    let error = run(session.as_mut(), SLOW_QUERY).await.unwrap_err();

    assert_eq!(error.kind, QueryErrorKind::Timeout);
    assert!(error.message.contains("1 seconds"), "{}", error.message);
    assert!(
        start.elapsed() < Duration::from_secs(5),
        "{:?}",
        start.elapsed()
    );
    assert_eq!(
        rows(session.as_mut(), "SELECT 4").await,
        vec![vec![text("4")]]
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn reads_the_structure_of_the_database() {
    let adapter = DuckDbAdapter::default();
    let mut session = connect(&adapter, &memory(), here()).await;
    let session = session.as_mut();
    for statement in [
        "CREATE TABLE owner (id INTEGER PRIMARY KEY)",
        "CREATE TABLE item (id INTEGER PRIMARY KEY, name VARCHAR NOT NULL DEFAULT 'new', \
         owner_id INTEGER REFERENCES owner (id), CONSTRAINT short_name CHECK (length(name) < 20))",
        "CREATE UNIQUE INDEX item_name ON item (name)",
        "CREATE VIEW item_view AS SELECT * FROM item",
        "CREATE SCHEMA other",
        "CREATE TABLE other.\"it's a \"\"table\"\"\" (a INTEGER)",
    ] {
        run(session, statement).await.unwrap();
    }

    let schemas = session.schemas().await.unwrap();
    let relations = session.relations("main").await.unwrap();
    let detail = session.relation_detail("main", "item").await.unwrap();
    let odd = session.relations("other").await.unwrap();
    let odd_detail = session
        .relation_detail("other", "it's a \"table\"")
        .await
        .unwrap();
    let nothing = session.relation_detail("main", "no_such").await.unwrap();

    let user_schemas: Vec<_> = schemas
        .iter()
        .filter(|s| !s.is_system)
        .map(|s| s.name.as_str())
        .collect();
    assert_eq!(user_schemas, vec!["main", "other"]);
    let listed: Vec<_> = relations
        .iter()
        .map(|r| (r.name.as_str(), r.kind))
        .collect();
    assert_eq!(
        listed,
        vec![
            ("item", RelationKind::Table),
            ("item_view", RelationKind::View),
            ("owner", RelationKind::Table)
        ]
    );
    let columns: Vec<_> = detail
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
            ("id", "INTEGER", false, true),
            ("name", "VARCHAR", false, false),
            ("owner_id", "INTEGER", true, false)
        ]
    );
    assert_eq!(detail.columns[1].default.as_deref(), Some("'new'"));
    assert_eq!(detail.indexes.len(), 1);
    assert_eq!(detail.indexes[0].name, "item_name");
    assert!(detail.indexes[0].is_unique);
    assert!(detail.indexes[0].definition.contains("item_name"));
    let kinds: Vec<_> = detail.constraints.iter().map(|c| c.kind).collect();
    assert_eq!(
        kinds,
        vec![
            ConstraintKind::Check,
            ConstraintKind::ForeignKey,
            ConstraintKind::PrimaryKey
        ]
    );
    assert!(
        detail.constraints[0]
            .definition
            .contains("length(\"name\")")
            || detail.constraints[0].definition.contains("length(name)")
    );
    assert_eq!(odd[0].name, "it's a \"table\"");
    assert_eq!(odd_detail.columns.len(), 1);
    assert_eq!(nothing.columns.len(), 0);

    // The sample statement has the identifiers in quotes and runs.
    let sample = session.sample_statement("other", "it's a \"table\"", 5);
    assert!(run(session, &sample).await.is_ok(), "{sample}");
}

#[tokio::test(flavor = "multi_thread")]
async fn runs_a_script_through_the_query_session_and_exports_csv() {
    let adapter = DuckDbAdapter::default();
    let session = QuerySession::new(connect(&adapter, &memory(), here()).await);
    let limits = RunLimits {
        page_rows: 100,
        buffered_rows: 1000,
    };
    let script = "CREATE TABLE item AS SELECT i AS id, 'n' || i AS name FROM range(250) AS t(i);\n\
                  UPDATE item SET name = NULL WHERE id = 1;\n\
                  SELECT * FROM item ORDER BY id;";

    let report = session.run(script, RunTarget::All, limits).await;

    assert_eq!(report.statements.len(), 3);
    assert!(matches!(
        report.statements[0].outcome,
        Outcome::Command { affected_rows: 250 }
    ));
    assert!(matches!(
        report.statements[1].outcome,
        Outcome::Command { affected_rows: 1 }
    ));
    let Outcome::Rows {
        rows, is_complete, ..
    } = &report.statements[2].outcome
    else {
        panic!("the last statement must return rows");
    };
    assert_eq!(rows.len(), 100);
    assert!(!is_complete);
    let open = report.open_result.expect("the result must stay open");
    let rest = session.fetch(open, 1000).await.unwrap();
    assert_eq!(rest.rows.len(), 150);
    assert!(rest.is_complete);
    assert_eq!(rest.total_rows, Some(250));

    let mut csv = Vec::new();
    let exported = session
        .export_csv(
            "FROM item SELECT id, name WHERE id < 3 ORDER BY id",
            &mut csv,
            100,
        )
        .await
        .unwrap();
    assert_eq!(exported, 3);
    assert_eq!(String::from_utf8(csv).unwrap(), "id,name\n0,n0\n1,\n2,n2\n");

    // An error in a script has its position in the script.
    let failed = session
        .run(
            "SELECT 1;\nSELECT * FROM missing_table;",
            RunTarget::All,
            limits,
        )
        .await;
    let Outcome::Failed { location, .. } = &failed.statements[1].outcome else {
        panic!("the second statement must fail");
    };
    let location = location.expect("the error must have a position");
    assert_eq!((location.line, location.column), (2, 15));
}
