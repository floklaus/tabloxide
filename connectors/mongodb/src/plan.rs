//! Translates a parsed statement into one database command. The session runs the
//! command. This module has no I/O, so its tests need no server.

use crate::value::{ValueError, optional_document, to_bson, to_document};
use mongodb::bson::{Bson, Document, doc};
use tabloxide_core::mongo::{Call, ShowTarget, Statement, Value};

/// How the session shows the answer of a command.
#[derive(Debug, Clone, PartialEq)]
pub enum Output {
    /// The answer is a cursor of documents. Each document is a row.
    Cursor,
    /// The answer document is one row.
    Document,
    /// The value of one field of the answer is one row with one column.
    Field { field: &'static str, column: String },
    /// The array in one field of the answer. Each element is a row.
    Array {
        field: &'static str,
        column: Option<String>,
    },
    /// The command changes data. The number in `count` (or the sum of the numbers)
    /// is the number of changed documents.
    Change { count: &'static [&'static str] },
}

/// What the session runs for one statement.
#[derive(Debug, Clone, PartialEq)]
pub enum Plan {
    Use(String),
    ShowDatabases,
    /// A command on a database.
    Command {
        database: String,
        command: Document,
        output: Output,
    },
    /// A row that needs no server, for example `db.getName()`.
    Constant(Document),
}

/// A statement that the connector cannot run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanError(pub String);

impl From<ValueError> for PlanError {
    fn from(error: ValueError) -> Self {
        Self(error.0)
    }
}

type Planned<T> = Result<T, PlanError>;

fn fail<T>(message: impl Into<String>) -> Planned<T> {
    Err(PlanError(message.into()))
}

/// Settings of the session that change a plan.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    /// The value of `maxTimeMS` for a read without its own value.
    pub max_time_ms: Option<i64>,
}

fn arg(call: &Call, index: usize) -> Option<&Value> {
    call.args.get(index)
}

fn string_arg(call: &Call, index: usize) -> Planned<String> {
    match arg(call, index) {
        Some(Value::String(text)) => Ok(text.clone()),
        _ => fail(format!(
            "`{}` needs a string as argument {}.",
            call.name,
            index + 1
        )),
    }
}

/// Copies the fields of `options` into `command`, with the names in `allowed`.
fn merge_options(command: &mut Document, options: Option<&Value>, allowed: &[&str]) -> Planned<()> {
    for (key, value) in optional_document(options)? {
        if !allowed.contains(&key.as_str()) {
            return fail(format!("The option `{key}` is not supported here."));
        }
        command.insert(key, value);
    }
    Ok(())
}

fn add_max_time(command: &mut Document, limits: Limits) {
    if let Some(max_time) = limits.max_time_ms
        && !command.contains_key("maxTimeMS")
    {
        command.insert("maxTimeMS", max_time);
    }
}

fn first_number(call: &Call) -> Planned<Bson> {
    match arg(call, 0) {
        Some(value @ Value::Number(_)) => Ok(to_bson(value)?),
        _ => fail(format!("`{}` needs a number.", call.name)),
    }
}

const COUNT_FIELD: &str = "n";

/// The calls after `find` that the connector supports.
fn apply_find_chain(command: &mut Document, chain: &[Call]) -> Planned<Option<Output>> {
    let mut output = None;
    for call in chain {
        let name = call.name.as_str();
        match name {
            "sort" | "hint" | "collation" | "min" | "max" => {
                let value =
                    arg(call, 0).ok_or_else(|| PlanError(format!("`{name}` needs a value.")))?;
                command.insert(name, to_bson(value)?);
            }
            "projection" | "project" => {
                command.insert(
                    "projection",
                    to_document(arg(call, 0).unwrap_or(&Value::Object(vec![])))?,
                );
            }
            "limit" | "skip" | "batchSize" | "maxTimeMS" => {
                command.insert(name, first_number(call)?);
            }
            "comment" => {
                command.insert("comment", string_arg(call, 0)?);
            }
            "allowDiskUse" => {
                command.insert("allowDiskUse", true);
            }
            "count" | "size" | "itcount" => {
                output = Some(Output::Field {
                    field: COUNT_FIELD,
                    column: "count".to_owned(),
                });
            }
            "explain" => output = Some(Output::Document),
            "toArray" | "pretty" => {}
            _ => return fail(format!("`.{name}()` after `find` is not supported.")),
        }
    }
    Ok(output)
}

fn find(
    collection: &str,
    method: &Call,
    chain: &[Call],
    limits: Limits,
    is_one: bool,
) -> Planned<(Document, Output)> {
    let mut command = doc! { "find": collection, "filter": optional_document(arg(method, 0))? };
    if let Some(projection) = arg(method, 1) {
        command.insert("projection", to_document(projection)?);
    }
    if is_one {
        command.insert("limit", 1);
        command.insert("singleBatch", true);
    }
    let output = apply_find_chain(&mut command, chain)?;
    match output {
        Some(Output::Field { .. }) => {
            let mut count = doc! { "count": collection, "query": command.get("filter").cloned().unwrap_or(Bson::Document(Document::new())) };
            for key in ["limit", "skip", "hint", "collation"] {
                if let Some(value) = command.get(key) {
                    count.insert(key, value.clone());
                }
            }
            add_max_time(&mut count, limits);
            Ok((
                count,
                Output::Field {
                    field: COUNT_FIELD,
                    column: "count".to_owned(),
                },
            ))
        }
        Some(Output::Document) => Ok((
            doc! { "explain": command, "verbosity": "queryPlanner" },
            Output::Document,
        )),
        _ => {
            add_max_time(&mut command, limits);
            Ok((command, Output::Cursor))
        }
    }
}

fn aggregate(
    collection: &str,
    method: &Call,
    chain: &[Call],
    limits: Limits,
) -> Planned<(Document, Output)> {
    let pipeline = match arg(method, 0) {
        Some(value @ Value::Array(_)) => to_bson(value)?,
        None => Bson::Array(Vec::new()),
        Some(_) => return fail("`aggregate` needs an array of stages."),
    };
    let mut command = doc! { "aggregate": collection, "pipeline": pipeline, "cursor": {} };
    merge_options(
        &mut command,
        arg(method, 1),
        &[
            "allowDiskUse",
            "collation",
            "hint",
            "comment",
            "maxTimeMS",
            "let",
            "batchSize",
        ],
    )?;
    if let Some(size) = command.remove("batchSize") {
        command.insert("cursor", doc! { "batchSize": size });
    }
    let mut is_explain = false;
    for call in chain {
        match call.name.as_str() {
            "explain" => is_explain = true,
            "toArray" | "pretty" => {}
            name => return fail(format!("`.{name}()` after `aggregate` is not supported.")),
        }
    }
    if is_explain {
        command.remove("cursor");
        return Ok((
            doc! { "explain": command, "verbosity": "queryPlanner" },
            Output::Document,
        ));
    }
    add_max_time(&mut command, limits);
    Ok((command, Output::Cursor))
}

/// An `update` command with one statement.
fn update(
    collection: &str,
    method: &Call,
    multi: bool,
    is_replace: bool,
) -> Planned<(Document, Output)> {
    let filter = optional_document(arg(method, 0))?;
    let change = match arg(method, 1) {
        Some(value @ Value::Array(_)) if !is_replace => to_bson(value)?,
        Some(value) => Bson::Document(to_document(value)?),
        None => return fail(format!("`{}` needs a filter and a change.", method.name)),
    };
    let mut entry = doc! { "q": filter, "u": change, "multi": multi };
    let mut options = optional_document(arg(method, 2))?;
    // The legacy `update` takes `multi` from its options.
    if let Some(Bson::Boolean(value)) = options.remove("multi") {
        entry.insert("multi", value);
    }
    for (key, value) in options {
        if !["upsert", "arrayFilters", "hint", "collation"].contains(&key.as_str()) {
            return fail(format!("The option `{key}` is not supported here."));
        }
        entry.insert(key, value);
    }
    Ok((
        doc! { "update": collection, "updates": [entry] },
        Output::Change {
            count: &["nModified", "upserted"],
        },
    ))
}

fn delete(collection: &str, method: &Call, limit: i32) -> Planned<(Document, Output)> {
    let filter = optional_document(arg(method, 0))?;
    // The legacy `remove(filter, true)` and `remove(filter, { justOne: true })` remove one.
    let limit = match arg(method, 1) {
        Some(Value::Bool(true)) => 1,
        Some(options @ Value::Object(_))
            if options.field("justOne") == Some(&Value::Bool(true)) =>
        {
            1
        }
        _ => limit,
    };
    Ok((
        doc! { "delete": collection, "deletes": [{ "q": filter, "limit": limit }] },
        Output::Change {
            count: &[COUNT_FIELD],
        },
    ))
}

fn insert(collection: &str, method: &Call) -> Planned<(Document, Output)> {
    let documents = match arg(method, 0) {
        Some(Value::Array(items)) if method.name != "insertOne" => items
            .iter()
            .map(|item| to_document(item).map(Bson::Document))
            .collect::<Result<Vec<_>, _>>()?,
        Some(value) => vec![Bson::Document(to_document(value)?)],
        None => return fail(format!("`{}` needs a document.", method.name)),
    };
    let mut command = doc! { "insert": collection, "documents": documents };
    merge_options(&mut command, arg(method, 1), &["ordered", "comment"])?;
    Ok((
        command,
        Output::Change {
            count: &[COUNT_FIELD],
        },
    ))
}

fn find_and_modify(collection: &str, method: &Call) -> Planned<(Document, Output)> {
    let mut command =
        doc! { "findAndModify": collection, "query": optional_document(arg(method, 0))? };
    let options_index = match method.name.as_str() {
        "findOneAndDelete" => {
            command.insert("remove", true);
            1
        }
        "findOneAndUpdate" | "findOneAndReplace" => {
            let change = arg(method, 1)
                .ok_or_else(|| PlanError(format!("`{}` needs a change.", method.name)))?;
            command.insert("update", to_bson(change)?);
            2
        }
        _ => {
            // `findAndModify({ query, update, … })` has all fields in one document.
            let document = to_document(arg(method, 0).unwrap_or(&Value::Object(vec![])))?;
            let mut command = doc! { "findAndModify": collection };
            command.extend(document);
            return Ok((
                command,
                Output::Array {
                    field: "value",
                    column: None,
                },
            ));
        }
    };
    for (key, value) in optional_document(arg(method, options_index))? {
        match key.as_str() {
            "returnDocument" => {
                command.insert("new", value == Bson::String("after".to_owned()));
            }
            "returnNewDocument" => {
                command.insert("new", value);
            }
            "projection" => {
                command.insert("fields", value);
            }
            "sort" | "upsert" | "arrayFilters" | "collation" | "hint" => {
                command.insert(key, value);
            }
            _ => return fail(format!("The option `{key}` is not supported here.")),
        }
    }
    Ok((
        command,
        Output::Array {
            field: "value",
            column: None,
        },
    ))
}

/// The name that MongoDB gives an index without a name, for example `a_1_b_-1`.
fn index_name(keys: &Document) -> String {
    keys.iter()
        .map(|(key, value)| {
            let direction = match value {
                Bson::String(text) => text.clone(),
                other => crate::rows::cell(other).unwrap_or_default(),
            };
            format!("{key}_{direction}")
        })
        .collect::<Vec<_>>()
        .join("_")
}

fn index_spec(keys: &Value, options: Option<&Value>) -> Planned<Document> {
    let keys = to_document(keys)?;
    let mut spec = doc! { "key": keys.clone() };
    spec.extend(optional_document(options)?);
    if !spec.contains_key("name") {
        spec.insert("name", index_name(&keys));
    }
    Ok(spec)
}

fn create_indexes(collection: &str, method: &Call) -> Planned<(Document, Output)> {
    let indexes = match (method.name.as_str(), arg(method, 0)) {
        ("createIndex", Some(keys)) => vec![Bson::Document(index_spec(keys, arg(method, 1))?)],
        ("createIndexes", Some(Value::Array(all))) => all
            .iter()
            .map(|keys| index_spec(keys, arg(method, 1)).map(Bson::Document))
            .collect::<Result<_, _>>()?,
        _ => return fail(format!("`{}` needs the keys of the index.", method.name)),
    };
    Ok((
        doc! { "createIndexes": collection, "indexes": indexes },
        Output::Document,
    ))
}

/// Translates a collection method.
fn collection_plan(
    collection: &str,
    method: &Call,
    chain: &[Call],
    limits: Limits,
    database: &str,
) -> Planned<(Document, Output, Option<String>)> {
    let name = method.name.as_str();
    let (command, output) = match name {
        "find" => find(collection, method, chain, limits, false)?,
        "findOne" => find(collection, method, chain, limits, true)?,
        "aggregate" => aggregate(collection, method, chain, limits)?,
        "countDocuments" | "count" => {
            let mut command =
                doc! { "count": collection, "query": optional_document(arg(method, 0))? };
            merge_options(
                &mut command,
                arg(method, 1),
                &["limit", "skip", "hint", "collation", "maxTimeMS"],
            )?;
            add_max_time(&mut command, limits);
            (
                command,
                Output::Field {
                    field: COUNT_FIELD,
                    column: "count".to_owned(),
                },
            )
        }
        "estimatedDocumentCount" => (
            doc! { "count": collection },
            Output::Field {
                field: COUNT_FIELD,
                column: "count".to_owned(),
            },
        ),
        "distinct" => {
            let key = string_arg(method, 0)?;
            let mut command = doc! { "distinct": collection, "key": key.clone(), "query": optional_document(arg(method, 1))? };
            add_max_time(&mut command, limits);
            (
                command,
                Output::Array {
                    field: "values",
                    column: Some(key),
                },
            )
        }
        "insertOne" | "insertMany" | "insert" => insert(collection, method)?,
        "updateOne" => update(collection, method, false, false)?,
        "updateMany" => update(collection, method, true, false)?,
        "update" => update(collection, method, false, false)?,
        "replaceOne" => update(collection, method, false, true)?,
        "deleteOne" => delete(collection, method, 1)?,
        "deleteMany" | "remove" => delete(collection, method, 0)?,
        "findOneAndUpdate" | "findOneAndReplace" | "findOneAndDelete" | "findAndModify" => {
            find_and_modify(collection, method)?
        }
        "createIndex" | "createIndexes" => create_indexes(collection, method)?,
        "dropIndex" => {
            let index = arg(method, 0).ok_or_else(|| {
                PlanError("`dropIndex` needs the name or the keys of the index.".to_owned())
            })?;
            (
                doc! { "dropIndexes": collection, "index": to_bson(index)? },
                Output::Document,
            )
        }
        "dropIndexes" => (
            doc! { "dropIndexes": collection, "index": "*" },
            Output::Document,
        ),
        "getIndexes" => (doc! { "listIndexes": collection }, Output::Cursor),
        "drop" => (doc! { "drop": collection }, Output::Change { count: &[] }),
        "stats" => (doc! { "collStats": collection }, Output::Document),
        "renameCollection" => {
            let target = string_arg(method, 0)?;
            let drop_target = matches!(arg(method, 1), Some(Value::Bool(true)));
            let command = doc! {
                "renameCollection": format!("{database}.{collection}"),
                "to": format!("{database}.{target}"),
                "dropTarget": drop_target,
            };
            return Ok((
                command,
                Output::Change { count: &[] },
                Some("admin".to_owned()),
            ));
        }
        _ => {
            return fail(format!(
                "The collection method `{name}` is not supported. Use a command document with `db.runCommand({{ … }})`."
            ));
        }
    };
    let is_find = matches!(name, "find" | "findOne" | "aggregate");
    if !is_find && !chain.is_empty() {
        return fail(format!(
            "`.{}()` after `{name}` is not supported.",
            chain[0].name
        ));
    }
    Ok((command, output, None))
}

fn user_command(method: &Call) -> Planned<Document> {
    let user = to_document(arg(method, 0).unwrap_or(&Value::Object(vec![])))?;
    let name = user
        .get_str("user")
        .map_err(|_| PlanError("`createUser` needs a document with `user`.".to_owned()))?
        .to_owned();
    let mut command = doc! { "createUser": name };
    command.extend(user.into_iter().filter(|(key, _)| key != "user"));
    Ok(command)
}

/// Translates a database method.
fn database_plan(database: &str, method: &Call) -> Planned<Plan> {
    let name = method.name.as_str();
    let command = |command: Document, output: Output| Plan::Command {
        database: database.to_owned(),
        command,
        output,
    };
    Ok(match name {
        "getName" => Plan::Constant(doc! { "name": database }),
        "dropDatabase" => command(doc! { "dropDatabase": 1 }, Output::Change { count: &[] }),
        "createCollection" => {
            let mut create = doc! { "create": string_arg(method, 0)? };
            create.extend(optional_document(arg(method, 1))?);
            command(create, Output::Change { count: &[] })
        }
        "createView" => {
            let pipeline = arg(method, 2).map_or(Ok(Bson::Array(Vec::new())), to_bson)?;
            command(
                doc! { "create": string_arg(method, 0)?, "viewOn": string_arg(method, 1)?, "pipeline": pipeline },
                Output::Change { count: &[] },
            )
        }
        "getCollectionNames" => command(
            doc! { "listCollections": 1, "nameOnly": true, "authorizedCollections": true },
            Output::Cursor,
        ),
        "getCollectionInfos" | "listCollections" => command(
            doc! { "listCollections": 1, "filter": optional_document(arg(method, 0))? },
            Output::Cursor,
        ),
        "stats" => command(doc! { "dbStats": 1 }, Output::Document),
        "version" => command(
            doc! { "buildInfo": 1 },
            Output::Field {
                field: "version",
                column: "version".to_owned(),
            },
        ),
        "serverStatus" => command(doc! { "serverStatus": 1 }, Output::Document),
        "hostInfo" => command(doc! { "hostInfo": 1 }, Output::Document),
        "getUsers" => command(
            doc! { "usersInfo": 1 },
            Output::Array {
                field: "users",
                column: None,
            },
        ),
        "getRoles" => command(
            doc! { "rolesInfo": 1 },
            Output::Array {
                field: "roles",
                column: None,
            },
        ),
        "createUser" => command(user_command(method)?, Output::Change { count: &[] }),
        "dropUser" => command(
            doc! { "dropUser": string_arg(method, 0)? },
            Output::Change { count: &[] },
        ),
        "changeUserPassword" => command(
            doc! { "updateUser": string_arg(method, 0)?, "pwd": string_arg(method, 1)? },
            Output::Change { count: &[] },
        ),
        _ => {
            return fail(format!(
                "The database method `{name}` is not supported. Use a command document with `db.runCommand({{ … }})`."
            ));
        }
    })
}

/// Commands whose answer is a cursor.
const CURSOR_COMMANDS: [&str; 4] = ["find", "aggregate", "listCollections", "listIndexes"];

fn command_plan(database: &str, document: &Value) -> Planned<Plan> {
    let mut command = to_document(document)?;
    let Some(name) = command.keys().next().cloned() else {
        return fail("The command document is empty.");
    };
    let output = if CURSOR_COMMANDS.contains(&name.as_str()) {
        if name == "aggregate"
            && !command.contains_key("cursor")
            && !command.contains_key("explain")
        {
            command.insert("cursor", Document::new());
        }
        Output::Cursor
    } else {
        Output::Document
    };
    Ok(Plan::Command {
        database: database.to_owned(),
        command,
        output,
    })
}

/// Translates a statement. `current` is the current database of the session.
///
/// # Errors
///
/// Returns an error for a method that the connector does not support, or for a value
/// that has no BSON form.
pub fn plan(statement: &Statement, current: &str, limits: Limits) -> Planned<Plan> {
    let database_of =
        |database: &Option<String>| database.clone().unwrap_or_else(|| current.to_owned());
    match statement {
        Statement::Use { database } => Ok(Plan::Use(database.clone())),
        Statement::Show(ShowTarget::Databases) => Ok(Plan::ShowDatabases),
        Statement::Show(ShowTarget::Collections) => Ok(Plan::Command {
            database: current.to_owned(),
            command: doc! { "listCollections": 1, "nameOnly": true, "authorizedCollections": true },
            output: Output::Cursor,
        }),
        Statement::Command { database, document } => command_plan(&database_of(database), document),
        Statement::Database { database, method } => database_plan(&database_of(database), method),
        Statement::Collection {
            database,
            collection,
            method,
            chain,
        } => {
            let database = database_of(database);
            let (command, output, run_on) =
                collection_plan(collection, method, chain, limits, &database)?;
            Ok(Plan::Command {
                database: run_on.unwrap_or(database),
                command,
                output,
            })
        }
    }
}

/// Collection methods that only read data.
const READ_METHODS: [&str; 9] = [
    "find",
    "findOne",
    "aggregate",
    "countDocuments",
    "count",
    "estimatedDocumentCount",
    "distinct",
    "getIndexes",
    "stats",
];

/// Database methods that only read data.
const READ_DATABASE_METHODS: [&str; 9] = [
    "getName",
    "getCollectionNames",
    "getCollectionInfos",
    "listCollections",
    "stats",
    "version",
    "serverStatus",
    "hostInfo",
    "getUsers",
];

/// Commands that only read data.
const READ_COMMANDS: [&str; 18] = [
    "find",
    "count",
    "distinct",
    "listCollections",
    "listDatabases",
    "listIndexes",
    "dbStats",
    "collStats",
    "serverStatus",
    "buildInfo",
    "hello",
    "isMaster",
    "ping",
    "connectionStatus",
    "hostInfo",
    "usersInfo",
    "rolesInfo",
    "explain",
];

fn writes_collection(stages: Option<&Value>) -> bool {
    matches!(stages, Some(Value::Array(stages)) if stages.iter().any(|stage| stage.field("$out").is_some() || stage.field("$merge").is_some()))
}

/// Returns `true` if the statement only reads data. A read-only connection runs only
/// such statements.
#[must_use]
pub fn is_read(statement: &Statement) -> bool {
    match statement {
        Statement::Use { .. } | Statement::Show(_) => true,
        Statement::Collection { method, .. } => {
            READ_METHODS.contains(&method.name.as_str())
                && !(method.name == "aggregate" && writes_collection(method.args.first()))
        }
        Statement::Database { method, .. } => READ_DATABASE_METHODS.contains(&method.name.as_str()),
        Statement::Command { document, .. } => match document {
            Value::Object(fields) => fields.first().is_some_and(|(name, _)| {
                READ_COMMANDS.contains(&name.as_str())
                    || (name == "aggregate" && !writes_collection(document.field("pipeline")))
            }),
            _ => false,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tabloxide_core::mongo::parse_statement;

    const LIMITS: Limits = Limits { max_time_ms: None };

    fn planned(text: &str) -> Plan {
        plan(&parse_statement(text).unwrap(), "app", LIMITS).unwrap()
    }

    fn command(text: &str) -> (String, Document, Output) {
        match planned(text) {
            Plan::Command {
                database,
                command,
                output,
            } => (database, command, output),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn a_find_with_a_chain_is_one_find_command() {
        let (database, command, output) =
            command("db.users.find({ a: 1 }, { name: 1 }).sort({ name: -1 }).skip(5).limit(10)");

        assert_eq!(database, "app");
        assert_eq!(
            command,
            doc! { "find": "users", "filter": { "a": 1 }, "projection": { "name": 1 }, "sort": { "name": -1 }, "skip": 5, "limit": 10 }
        );
        assert_eq!(output, Output::Cursor);
    }

    #[test]
    fn a_find_with_count_is_a_count_command() {
        let (_, command, output) = command("db.users.find({ a: 1 }).limit(3).count()");

        assert_eq!(
            command,
            doc! { "count": "users", "query": { "a": 1 }, "limit": 3 }
        );
        assert!(matches!(output, Output::Field { field: "n", .. }));
    }

    #[test]
    fn the_query_timeout_goes_into_the_reads() {
        let limits = Limits {
            max_time_ms: Some(5000),
        };
        let Plan::Command { command, .. } = plan(
            &parse_statement("db.a.aggregate([])").unwrap(),
            "app",
            limits,
        )
        .unwrap() else {
            panic!("not a command");
        };

        assert_eq!(command.get_i64("maxTimeMS").unwrap(), 5000);
    }

    #[test]
    fn writes_become_write_commands() {
        assert_eq!(
            command("db.a.insertMany([{ x: 1 }, { x: 2 }])").1,
            doc! { "insert": "a", "documents": [{ "x": 1 }, { "x": 2 }] }
        );
        assert_eq!(
            command("db.a.updateMany({ x: 1 }, { $set: { y: 2 } }, { upsert: true })").1,
            doc! { "update": "a", "updates": [{ "q": { "x": 1 }, "u": { "$set": { "y": 2 } }, "multi": true, "upsert": true }] }
        );
        assert_eq!(
            command("db.a.remove({ x: 1 }, true)").1,
            doc! { "delete": "a", "deletes": [{ "q": { "x": 1 }, "limit": 1 }] }
        );
        assert_eq!(
            command("db.a.createIndex({ a: 1, b: -1 }, { unique: true })").1,
            doc! { "createIndexes": "a", "indexes": [{ "key": { "a": 1, "b": -1 }, "unique": true, "name": "a_1_b_-1" }] }
        );
    }

    #[test]
    fn rename_runs_on_the_admin_database_with_full_names() {
        let (database, command, _) = command("db.getSiblingDB('sales').a.renameCollection('b')");

        assert_eq!(database, "admin");
        assert_eq!(
            command,
            doc! { "renameCollection": "sales.a", "to": "sales.b", "dropTarget": false }
        );
    }

    #[test]
    fn command_documents_and_shell_commands() {
        assert_eq!(
            command("{ aggregate: 'a', pipeline: [] }").1,
            doc! { "aggregate": "a", "pipeline": [], "cursor": {} }
        );
        assert_eq!(command("{ ping: 1 }").2, Output::Document);
        assert_eq!(planned("use sales"), Plan::Use("sales".to_owned()));
        assert_eq!(
            planned("db.getName()"),
            Plan::Constant(doc! { "name": "app" })
        );
    }

    #[test]
    fn refuses_what_it_does_not_support_with_a_message() {
        let error = |text: &str| {
            plan(&parse_statement(text).unwrap(), "app", LIMITS)
                .unwrap_err()
                .0
        };

        assert!(error("db.a.find().map()").contains("not supported"));
        assert!(error("db.a.watch()").contains("not supported"));
        assert!(error("db.a.insertOne({}).limit(1)").contains("not supported"));
    }

    #[test]
    fn only_reads_run_on_a_read_only_connection() {
        let read = |text: &str| is_read(&parse_statement(text).unwrap());

        assert!(read("db.a.find()"));
        assert!(read("db.a.aggregate([{ $match: {} }])"));
        assert!(read("{ count: 'a' }"));
        assert!(read("show dbs"));
        assert!(!read("db.a.aggregate([{ $out: 'b' }])"));
        assert!(!read("db.a.insertOne({})"));
        assert!(!read("{ insert: 'a', documents: [] }"));
        assert!(!read("db.dropDatabase()"));
    }
}
