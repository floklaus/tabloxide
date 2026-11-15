//! Tests of database files: one instance for each file, the read-only mode,
//! paths, and the files that a statement names.

mod common;

use common::{connect, profile, rows, run, text, try_connect};
use tabloxide_adapter_duckdb::DuckDbAdapter;
use tabloxide_core::{ConnectErrorKind, ConnectionProfile, DbAdapter, QueryErrorKind};

fn read_only(database: &str) -> ConnectionProfile {
    ConnectionProfile {
        read_only: true,
        ..profile(database)
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn two_sessions_of_one_file_see_the_changes_of_each_other() {
    let folder = tempfile::tempdir().unwrap();
    let adapter = DuckDbAdapter::default();
    // The same file with a relative path and with an absolute path.
    let relative = profile("data.duckdb");
    let absolute = profile(&folder.path().join("data.duckdb").display().to_string());
    let mut first = connect(&adapter, &relative, folder.path()).await;
    let mut second = connect(&adapter, &absolute, folder.path()).await;

    run(first.as_mut(), "CREATE TABLE item AS SELECT 1 AS id")
        .await
        .unwrap();
    run(second.as_mut(), "INSERT INTO item VALUES (2)")
        .await
        .unwrap();

    assert_eq!(
        rows(first.as_mut(), "SELECT count(*) FROM item").await,
        vec![vec![text("2")]]
    );
    assert!(folder.path().join("data.duckdb").exists());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_cancel_stops_only_its_own_session() {
    let folder = tempfile::tempdir().unwrap();
    let adapter = DuckDbAdapter::default();
    let mut first = connect(&adapter, &profile("data.duckdb"), folder.path()).await;
    let second = connect(&adapter, &profile("data.duckdb"), folder.path()).await;
    let mut stream = first.execute("SELECT * FROM range(100000)").await.unwrap();
    stream.next_page(10).await.unwrap();

    second.cancel_handle().cancel().await.unwrap();

    let mut total = 10;
    loop {
        let page = stream.next_page(50_000).await.unwrap();
        total += page.rows.len();
        if page.end.is_some() {
            break;
        }
    }
    assert_eq!(total, 100_000);
}

#[tokio::test(flavor = "multi_thread")]
async fn the_file_closes_with_its_last_session_and_keeps_its_data() {
    let folder = tempfile::tempdir().unwrap();
    let adapter = DuckDbAdapter::default();
    let file = profile("data.duckdb");
    let mut first = connect(&adapter, &file, folder.path()).await;
    let second = connect(&adapter, &file, folder.path()).await;
    run(first.as_mut(), "CREATE TABLE item AS SELECT 7 AS id")
        .await
        .unwrap();

    drop(first);
    drop(second);
    // The session threads close the database a short time after the drop.
    let mut reopened = None;
    for _ in 0..100 {
        match try_connect(&adapter, &read_only("data.duckdb"), folder.path()).await {
            Ok(session) => {
                reopened = Some(session);
                break;
            }
            Err(_) => tokio::time::sleep(std::time::Duration::from_millis(20)).await,
        }
    }
    let mut reopened = reopened.expect("the file must open in the read-only mode after the close");

    assert_eq!(
        rows(reopened.as_mut(), "SELECT id FROM item").await,
        vec![vec![text("7")]]
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn refuses_a_second_mode_for_a_file_that_is_open() {
    let folder = tempfile::tempdir().unwrap();
    let adapter = DuckDbAdapter::default();
    let _writer = connect(&adapter, &profile("data.duckdb"), folder.path()).await;

    let error = try_connect(&adapter, &read_only("data.duckdb"), folder.path())
        .await
        .err()
        .expect("the second mode must fail");

    assert_eq!(error.kind, ConnectErrorKind::InvalidConfiguration);
    assert!(
        error.detail.contains("read-only setting"),
        "{}",
        error.detail
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_read_only_connection_refuses_changes_and_cannot_change_its_mode() {
    let folder = tempfile::tempdir().unwrap();
    {
        let adapter = DuckDbAdapter::default();
        let mut writer = connect(&adapter, &profile("data.duckdb"), folder.path()).await;
        run(writer.as_mut(), "CREATE TABLE item AS SELECT 1 AS id")
            .await
            .unwrap();
    }
    let adapter = DuckDbAdapter::default();
    let mut session = None;
    for _ in 0..100 {
        match try_connect(&adapter, &read_only("data.duckdb"), folder.path()).await {
            Ok(opened) => {
                session = Some(opened);
                break;
            }
            Err(_) => tokio::time::sleep(std::time::Duration::from_millis(20)).await,
        }
    }
    let mut session = session.expect("the read-only session must open");
    let session = session.as_mut();

    let insert = run(session, "INSERT INTO item VALUES (2)")
        .await
        .unwrap_err();
    let drop_table = run(session, "DROP TABLE item").await.unwrap_err();
    let mode = run(session, "SET access_mode = 'read_write'")
        .await
        .unwrap_err();

    assert_eq!(insert.kind, QueryErrorKind::Database);
    assert!(insert.message.contains("read-only"), "{}", insert.message);
    assert!(
        drop_table.message.contains("read-only"),
        "{}",
        drop_table.message
    );
    assert!(mode.message.contains("access_mode"), "{}", mode.message);
    assert_eq!(
        rows(session, "SELECT count(*) FROM item").await,
        vec![vec![text("1")]]
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn explains_a_missing_file_and_a_missing_folder() {
    let folder = tempfile::tempdir().unwrap();
    let adapter = DuckDbAdapter::default();

    let no_file = try_connect(&adapter, &read_only("none.duckdb"), folder.path())
        .await
        .err()
        .unwrap();
    let no_folder = try_connect(&adapter, &profile("no/such/folder/a.duckdb"), folder.path())
        .await
        .err()
        .unwrap();
    std::fs::write(folder.path().join("text.duckdb"), "this is not a database").unwrap();
    let not_a_database = try_connect(&adapter, &profile("text.duckdb"), folder.path())
        .await
        .err()
        .unwrap();

    assert_eq!(no_file.kind, ConnectErrorKind::DatabaseNotFound);
    assert!(no_file.detail.contains("none.duckdb"));
    assert_eq!(no_folder.kind, ConnectErrorKind::InvalidConfiguration);
    assert_eq!(not_a_database.kind, ConnectErrorKind::Other);
    assert!(!folder.path().join("none.duckdb").exists());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_connection_test_reads_the_version_and_does_not_make_a_file() {
    let folder = tempfile::tempdir().unwrap();
    let adapter = DuckDbAdapter::default();

    let new_file = adapter
        .test_connection(&profile("new.duckdb"), None, folder.path())
        .await
        .unwrap();
    let memory = adapter
        .test_connection(&profile(":memory:"), None, folder.path())
        .await
        .unwrap();
    let missing = adapter
        .test_connection(&read_only("new.duckdb"), None, folder.path())
        .await;

    assert!(
        new_file.version.starts_with("DuckDB v"),
        "{}",
        new_file.version
    );
    assert_eq!(memory.version, new_file.version);
    assert!(!folder.path().join("new.duckdb").exists());
    assert_eq!(
        missing.unwrap_err().kind,
        ConnectErrorKind::DatabaseNotFound
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn the_tabs_of_one_memory_connection_share_their_data() {
    let adapter = DuckDbAdapter::default();
    let mut first = connect(&adapter, &profile(":memory:"), std::path::Path::new(".")).await;
    let mut second = connect(&adapter, &profile(":memory:"), std::path::Path::new(".")).await;

    run(first.as_mut(), "CREATE TABLE item AS SELECT 5 AS id")
        .await
        .unwrap();

    assert_eq!(
        rows(second.as_mut(), "SELECT id FROM item").await,
        vec![vec![text("5")]]
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn reads_csv_and_parquet_files_of_the_workspace_with_a_relative_name() {
    let folder = tempfile::tempdir().unwrap();
    std::fs::write(folder.path().join("people.csv"), "id,name\n1,ada\n2,\n").unwrap();
    let adapter = DuckDbAdapter::default();
    let mut session = connect(&adapter, &profile(":memory:"), folder.path()).await;
    let session = session.as_mut();

    let csv = rows(session, "SELECT * FROM 'people.csv' ORDER BY id").await;
    // The Parquet and JSON extensions are in the build. DuckDB does not get them
    // from the network.
    let out = folder.path().join("out.parquet").display().to_string();
    run(
        session,
        &format!("COPY (SELECT 1 AS a) TO '{out}' (FORMAT parquet)"),
    )
    .await
    .unwrap();
    let parquet = rows(session, "SELECT a FROM 'out.parquet'").await;
    let json = rows(session, "SELECT json_extract('{\"a\": 1}', '$.a')").await;

    assert_eq!(
        csv,
        vec![vec![text("1"), text("ada")], vec![text("2"), None]]
    );
    assert_eq!(parquet, vec![vec![text("1")]]);
    assert_eq!(json, vec![vec![text("1")]]);
}

#[tokio::test(flavor = "multi_thread")]
async fn does_not_get_an_extension_from_the_network_without_a_request() {
    let adapter = DuckDbAdapter::default();
    let mut session = connect(&adapter, &profile(":memory:"), std::path::Path::new(".")).await;

    let setting = rows(
        session.as_mut(),
        "SELECT current_setting('autoinstall_known_extensions')",
    )
    .await;

    assert_eq!(setting, vec![vec![text("false")]]);
}
