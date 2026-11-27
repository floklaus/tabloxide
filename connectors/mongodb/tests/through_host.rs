//! Runs the connector program through the connector host against MongoDB in a
//! Docker container. These tests need Docker, as the PostgreSQL tests do:
//! `cargo test -p tabloxide-connector-mongodb -- --ignored`

use std::path::Path;
use std::sync::Arc;
use tabloxide_connector_host::{ConnectorProcess, RemoteAdapter};
use tabloxide_core::{
    ConnectErrorKind, ConnectionProfile, DbAdapter, Engine, Outcome, QueryErrorKind, QueryLanguage,
    QuerySession, RunLimits, RunTarget, Secret, TlsMode,
};
use testcontainers_modules::mongo::Mongo;
use testcontainers_modules::testcontainers::runners::AsyncRunner;
use testcontainers_modules::testcontainers::{ContainerAsync, ImageExt};

const MONGO_TAG: &str = "8.0";
const LIMITS: RunLimits = RunLimits {
    page_rows: 500,
    buffered_rows: 1000,
};

async fn start_server(env: &[(&str, &str)]) -> (ContainerAsync<Mongo>, ConnectionProfile) {
    let mut image = Mongo::default().with_tag(MONGO_TAG);
    for (key, value) in env {
        image = image.with_env_var(*key, *value);
    }
    let container = image
        .start()
        .await
        .expect("the MongoDB container must start");
    let mut profile = ConnectionProfile::template();
    profile.engine = Engine::new("mongodb");
    profile.host = container.get_host().await.unwrap().to_string();
    profile.port = container.get_host_port_ipv4(27017).await.unwrap();
    profile.database = "app".to_owned();
    profile.tls_mode = TlsMode::Disable;
    profile.connect_timeout_secs = 10;
    (container, profile)
}

async fn start_connector() -> RemoteAdapter {
    let program = Path::new(env!("CARGO_BIN_EXE_tabloxide-connector-mongodb"));
    let process = ConnectorProcess::start(program, &[], &[], "mongodb")
        .await
        .expect("the connector must start");
    RemoteAdapter::new(Arc::new(process))
}

async fn open(
    adapter: &RemoteAdapter,
    profile: &ConnectionProfile,
    password: Option<&Secret>,
) -> QuerySession {
    let session = adapter
        .connect(profile, password, Path::new("/"))
        .await
        .expect("the session must open");
    QuerySession::new(session, QueryLanguage::MongodbShell)
}

fn rows(outcome: &Outcome) -> (Vec<String>, Vec<Vec<Option<String>>>) {
    match outcome {
        Outcome::Rows { columns, rows, .. } => (
            columns.iter().map(|column| column.name.clone()).collect(),
            rows.clone(),
        ),
        other => panic!("not rows: {other:?}"),
    }
}

fn affected(outcome: &Outcome) -> u64 {
    match outcome {
        Outcome::Command { affected_rows } => *affected_rows,
        other => panic!("not a command: {other:?}"),
    }
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs Docker"]
async fn statements_results_and_the_catalog_through_the_connector() {
    let (_container, profile) = start_server(&[]).await;
    let adapter = start_connector().await;
    let session = open(&adapter, &profile, None).await;
    assert!(session.server_info().version.starts_with("8."));

    // Writes.
    let script = "db.users.insertMany([{ _id: 1, name: 'Ann', age: 31 }, { _id: 2, name: 'Bob', tags: ['x'] }])\n\
                  db.users.updateOne({ _id: 2 }, { $set: { age: 40 } })\n\
                  db.users.createIndex({ name: 1 }, { unique: true })";
    let report = session.run(script, RunTarget::All, LIMITS).await;
    assert_eq!(report.statements.len(), 3, "{report:?}");
    assert_eq!(affected(&report.statements[0].outcome), 2);
    assert_eq!(affected(&report.statements[1].outcome), 1);

    // A find with a chain: the columns come from the documents, `_id` first.
    let report = session
        .run(
            "db.users.find({ age: { $gt: 30 } }).sort({ name: -1 })",
            RunTarget::All,
            LIMITS,
        )
        .await;
    let (columns, found) = rows(&report.statements[0].outcome);
    // `$set` adds `age` to the end of the document of Bob, which is first.
    assert_eq!(columns, ["_id", "name", "tags", "age"]);
    assert_eq!(
        found[0],
        vec![
            Some("2".into()),
            Some("Bob".into()),
            Some("[\"x\"]".into()),
            Some("40".into())
        ]
    );
    assert_eq!(found[1][2], None);

    // A count and a distinct.
    let report = session
        .run("db.users.countDocuments({})", RunTarget::All, LIMITS)
        .await;
    assert_eq!(
        rows(&report.statements[0].outcome).1,
        vec![vec![Some("2".to_owned())]]
    );
    let report = session
        .run("db.users.distinct('name')", RunTarget::All, LIMITS)
        .await;
    assert_eq!(rows(&report.statements[0].outcome).1.len(), 2);

    // A write error of the server is a failure with its code.
    let report = session
        .run(
            "db.users.insertOne({ _id: 3, name: 'Ann' })",
            RunTarget::All,
            LIMITS,
        )
        .await;
    match &report.statements[0].outcome {
        Outcome::Failed { error, .. } => {
            assert_eq!(error.kind, QueryErrorKind::Database);
            assert!(error.message.contains("duplicate key"), "{}", error.message);
        }
        other => panic!("{other:?}"),
    }

    // A syntax error has its position in the script.
    let report = session
        .run("db.users.find({ a: b })", RunTarget::All, LIMITS)
        .await;
    match &report.statements[0].outcome {
        Outcome::Failed { error, location } => {
            assert_eq!(error.position, Some(20));
            assert!(location.is_some());
        }
        other => panic!("{other:?}"),
    }

    // `use` changes the database of the next statements.
    let report = session
        .run(
            "use other\ndb.things.insertOne({ a: 1 })\nshow collections",
            RunTarget::All,
            LIMITS,
        )
        .await;
    assert_eq!(
        rows(&report.statements[2].outcome).1[0][0].as_deref(),
        Some("things")
    );

    // The catalog.
    let schemas = session.schemas().await.unwrap();
    let names: Vec<&str> = schemas.iter().map(|schema| schema.name.as_str()).collect();
    assert!(
        names.contains(&"app") && names.contains(&"other"),
        "{names:?}"
    );
    assert!(
        schemas
            .iter()
            .find(|schema| schema.name == "admin")
            .unwrap()
            .is_system
    );
    let relations = session.relations("app").await.unwrap();
    assert_eq!(relations[0].name, "users");
    let detail = session.relation_detail("app", "users").await.unwrap();
    assert_eq!(detail.columns[0].name, "_id");
    assert!(
        detail
            .indexes
            .iter()
            .any(|index| index.name == "name_1" && index.is_unique)
    );
    let sample = session.sample("app", "users", 1).await.unwrap();
    assert_eq!(rows(&sample.outcome).1.len(), 1);

    // The plan comes in the common form through the protocol.
    let plan = session
        .read_plan("db.users.find({ name: 'Ann' }).sort({ age: -1 })", true)
        .await
        .unwrap();
    let common = plan.plan.expect("a plan in the common form");
    assert!(common.is_measured);
    assert!(plan.text.contains("executionStats"));
    assert!(!common.root.operation.is_empty());
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs Docker"]
async fn a_large_result_stays_open_and_comes_in_pages() {
    let (_container, profile) = start_server(&[]).await;
    let adapter = start_connector().await;
    let session = open(&adapter, &profile, None).await;
    let insert = "db.big.insertMany([".to_owned()
        + &(1..=1200)
            .map(|n| format!("{{ _id: {n} }}"))
            .collect::<Vec<_>>()
            .join(",")
        + "])";
    session.run(&insert, RunTarget::All, LIMITS).await;

    let report = session
        .run("db.big.find().sort({ _id: 1 })", RunTarget::All, LIMITS)
        .await;
    let result = report.open_result.expect("the result stays open");
    let next = session.fetch(result, 500).await.unwrap();
    let last = session.fetch(result, 500).await.unwrap();

    assert_eq!(rows(&report.statements[0].outcome).1.len(), 500);
    assert_eq!(next.rows[0][0].as_deref(), Some("501"));
    assert!(last.is_complete);
    assert_eq!(last.total_rows, Some(1200));
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs Docker"]
async fn a_read_only_connection_refuses_writes() {
    let (_container, mut profile) = start_server(&[]).await;
    profile.read_only = true;
    let adapter = start_connector().await;
    let session = open(&adapter, &profile, None).await;

    let report = session
        .run(
            "db.a.find()\ndb.a.insertOne({ x: 1 })",
            RunTarget::All,
            LIMITS,
        )
        .await;

    assert!(matches!(report.statements[0].outcome, Outcome::Rows { .. }));
    match &report.statements[1].outcome {
        Outcome::Failed { error, .. } => assert!(error.message.contains("read-only")),
        other => panic!("{other:?}"),
    }
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs Docker"]
async fn the_server_checks_the_user_and_the_password() {
    let (_container, mut profile) = start_server(&[
        ("MONGO_INITDB_ROOT_USERNAME", "root"),
        ("MONGO_INITDB_ROOT_PASSWORD", "s3cret"),
    ])
    .await;
    profile.user = "root".to_owned();
    profile
        .params
        .insert("authSource".to_owned(), "admin".to_owned());
    let adapter = start_connector().await;

    let wrong = adapter
        .test_connection(&profile, Some(&Secret::new("wrong")), Path::new("/"))
        .await
        .unwrap_err();
    let right = adapter
        .test_connection(&profile, Some(&Secret::new("s3cret")), Path::new("/"))
        .await;

    assert_eq!(wrong.kind, ConnectErrorKind::Authentication, "{wrong:?}");
    assert!(
        !wrong.detail.contains("wrong"),
        "the detail must not contain the password"
    );
    assert!(right.is_ok(), "{right:?}");
}
