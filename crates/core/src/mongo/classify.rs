//! The risk check of MongoDB statements. Section 10.2 of `docs/Connector Design.md`
//! gives the rules.

use super::lexer::{TokenKind, tokenize};
use super::parse::{Call, Statement, Value, parse_statement};
use crate::sql::Risk;

/// Collection methods that read data or add data without a change of other data.
const SAFE_COLLECTION_METHODS: [&str; 18] = [
    "find",
    "findOne",
    "countDocuments",
    "estimatedDocumentCount",
    "count",
    "distinct",
    "getIndexes",
    "stats",
    "dataSize",
    "storageSize",
    "totalIndexSize",
    "isCapped",
    "insertOne",
    "insertMany",
    "insert",
    "createIndex",
    "createIndexes",
    "explain",
];

/// Collection methods that change one document that a filter selects.
const SINGLE_CHANGE_METHODS: [&str; 6] = [
    "updateOne",
    "deleteOne",
    "findOneAndUpdate",
    "findOneAndReplace",
    "findOneAndDelete",
    "findAndModify",
];

const SAFE_DATABASE_METHODS: [&str; 14] = [
    "getCollectionNames",
    "getCollectionInfos",
    "listCollections",
    "createCollection",
    "createView",
    "stats",
    "version",
    "serverStatus",
    "hostInfo",
    "getName",
    "getUsers",
    "getRoles",
    "createUser",
    "createRole",
];

/// Commands that read data or the state of the server.
const READ_COMMANDS: [&str; 22] = [
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
    "buildinfo",
    "hello",
    "isMaster",
    "ismaster",
    "ping",
    "explain",
    "connectionStatus",
    "hostInfo",
    "usersInfo",
    "rolesInfo",
    "getParameter",
    "validate",
];

/// Commands that add data or an object without a change of other data.
const ADD_COMMANDS: [&str; 5] = [
    "insert",
    "create",
    "createIndexes",
    "createUser",
    "createRole",
];

const DROP_NAMES: [&str; 6] = [
    "drop",
    "dropDatabase",
    "dropIndex",
    "dropIndexes",
    "dropUser",
    "dropRole",
];

const ALTER_NAMES: [&str; 2] = ["renameCollection", "collMod"];

/// Returns `true` if a filter selects all documents: no filter, or `{}`.
fn selects_all(filter: Option<&Value>) -> bool {
    filter.is_none_or(Value::is_empty_object)
}

/// Returns `true` if a pipeline has a `$out` or a `$merge` stage.
fn writes_collection(pipeline: Option<&Value>) -> bool {
    let Some(Value::Array(stages)) = pipeline else {
        return false;
    };
    stages
        .iter()
        .any(|stage| stage.field("$out").is_some() || stage.field("$merge").is_some())
}

fn collection_risk(method: &Call) -> Option<Risk> {
    let name = method.name.as_str();
    let filter = method.args.first();
    match name {
        _ if DROP_NAMES.contains(&name) => Some(Risk::Drop),
        _ if ALTER_NAMES.contains(&name) => Some(Risk::Alter),
        "deleteMany" | "remove" if selects_all(filter) => Some(Risk::DeleteWithoutWhere),
        "updateMany" | "update" | "replaceOne" if selects_all(filter) => {
            Some(Risk::UpdateWithoutWhere)
        }
        "aggregate" if writes_collection(filter) => Some(Risk::Overwrite),
        "deleteMany" | "remove" | "updateMany" | "update" | "replaceOne" | "aggregate" => None,
        _ if SAFE_COLLECTION_METHODS.contains(&name) || SINGLE_CHANGE_METHODS.contains(&name) => {
            None
        }
        _ => Some(Risk::Unchecked),
    }
}

/// Returns `true` if one of the statements of a `delete` or an `update` command
/// (in the array `field`) has an empty filter `q`.
fn has_unfiltered_entry(document: &Value, field: &str) -> bool {
    match document.field(field) {
        Some(Value::Array(entries)) => entries.iter().any(|entry| selects_all(entry.field("q"))),
        _ => true,
    }
}

fn command_risk(document: &Value) -> Option<Risk> {
    let Value::Object(fields) = document else {
        return Some(Risk::Unchecked);
    };
    let Some((name, _)) = fields.first() else {
        return Some(Risk::Unchecked);
    };
    let name = name.as_str();
    match name {
        _ if DROP_NAMES.contains(&name) => Some(Risk::Drop),
        _ if ALTER_NAMES.contains(&name) => Some(Risk::Alter),
        "delete" if has_unfiltered_entry(document, "deletes") => Some(Risk::DeleteWithoutWhere),
        "update" if has_unfiltered_entry(document, "updates") => Some(Risk::UpdateWithoutWhere),
        "aggregate" if writes_collection(document.field("pipeline")) => Some(Risk::Overwrite),
        "delete" | "update" | "aggregate" => None,
        _ if READ_COMMANDS.contains(&name) || ADD_COMMANDS.contains(&name) => None,
        _ => Some(Risk::Unchecked),
    }
}

fn database_risk(method: &Call) -> Option<Risk> {
    let name = method.name.as_str();
    if DROP_NAMES.contains(&name) {
        Some(Risk::Drop)
    } else if SAFE_DATABASE_METHODS.contains(&name) {
        None
    } else {
        Some(Risk::Unchecked)
    }
}

/// Returns the risk of a destructive statement, or `None` for a different statement.
///
/// A statement that the parser cannot read gets `None`, because the connector
/// refuses it before it can run.
#[must_use]
pub fn classify_risk(statement: &str) -> Option<Risk> {
    match parse_statement(statement).ok()? {
        Statement::Use { .. } | Statement::Show(_) => None,
        Statement::Command { document, .. } => command_risk(&document),
        Statement::Database { method, .. } => database_risk(&method),
        Statement::Collection { method, .. } => collection_risk(&method),
    }
}

/// Chained calls after `find` or `aggregate` that change the result into a value
/// that is not a list of documents.
const NOT_A_CURSOR: [&str; 5] = ["count", "size", "itcount", "explain", "hasNext"];

/// Returns `true` if the result of `statement` is a cursor that the grid can read in
/// pages, and that a cancel can close without a change of data.
#[must_use]
pub fn is_pageable(statement: &str) -> bool {
    match parse_statement(statement) {
        Ok(Statement::Collection { method, chain, .. }) => {
            let is_cursor = !chain
                .iter()
                .any(|call| NOT_A_CURSOR.contains(&call.name.as_str()));
            match method.name.as_str() {
                "find" => is_cursor,
                "aggregate" => is_cursor && !writes_collection(method.args.first()),
                _ => false,
            }
        }
        Ok(Statement::Command { document, .. }) => match &document {
            Value::Object(fields) => match fields.first().map(|(name, _)| name.as_str()) {
                Some("find") => true,
                Some("aggregate") => !writes_collection(document.field("pipeline")),
                _ => false,
            },
            _ => false,
        },
        _ => false,
    }
}

/// Returns `true` if `statement` can contain a password. The query history does not
/// record the text of such a statement.
///
/// The check finds `pwd` and `password` in names and in strings, and a connection
/// string with a user in a string.
#[must_use]
pub fn can_contain_password(statement: &str) -> bool {
    tokenize(statement).iter().any(|token| {
        let text = token.text(statement).to_ascii_lowercase();
        match token.kind {
            TokenKind::Ident => text.contains("pwd") || text.contains("password"),
            TokenKind::String => {
                text.contains("pwd")
                    || text.contains("password")
                    || (text.contains("mongodb") && text.contains('@'))
            }
            _ => false,
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_risks_of_section_10_2() {
        let cases = [
            ("db.users.drop()", Some(Risk::Drop)),
            ("db.dropDatabase()", Some(Risk::Drop)),
            ("db.users.dropIndex('a_1')", Some(Risk::Drop)),
            ("{ drop: 'users' }", Some(Risk::Drop)),
            ("db.users.deleteMany({})", Some(Risk::DeleteWithoutWhere)),
            ("db.users.deleteMany()", Some(Risk::DeleteWithoutWhere)),
            ("db.users.remove({})", Some(Risk::DeleteWithoutWhere)),
            (
                "db.users.updateMany({}, { $set: { a: 1 } })",
                Some(Risk::UpdateWithoutWhere),
            ),
            (
                "db.users.replaceOne({}, { a: 1 })",
                Some(Risk::UpdateWithoutWhere),
            ),
            ("db.users.renameCollection('people')", Some(Risk::Alter)),
            ("db.runCommand({ collMod: 'users' })", Some(Risk::Alter)),
            (
                "db.a.aggregate([{ $match: {} }, { $out: 'b' }])",
                Some(Risk::Overwrite),
            ),
            (
                "{ aggregate: 'a', pipeline: [{ $merge: 'b' }], cursor: {} }",
                Some(Risk::Overwrite),
            ),
            (
                "{ delete: 'a', deletes: [{ q: {}, limit: 0 }] }",
                Some(Risk::DeleteWithoutWhere),
            ),
            ("{ update: 'a', updates: [{ q: { x: 1 }, u: {} }] }", None),
            ("db.users.bulkWrite([])", Some(Risk::Unchecked)),
            ("db.eval('x')", Some(Risk::Unchecked)),
            ("{ shutdown: 1 }", Some(Risk::Unchecked)),
            ("db.users.deleteMany({ a: 1 })", None),
            ("db.users.deleteOne({})", None),
            ("db.users.find({}).limit(5)", None),
            ("db.users.insertOne({ a: 1 })", None),
            ("db.createCollection('logs')", None),
            ("{ ping: 1 }", None),
            ("use sales", None),
            ("show collections", None),
            ("this is not valid", None),
        ];
        for (statement, expected) in cases {
            assert_eq!(classify_risk(statement), expected, "{statement}");
        }
    }

    #[test]
    fn only_cursors_without_a_write_are_pageable() {
        let cases = [
            ("db.users.find({ a: 1 }).sort({ b: 1 })", true),
            ("db.users.aggregate([{ $match: {} }])", true),
            ("{ find: 'users', filter: {} }", true),
            ("db.users.find().count()", false),
            ("db.users.find().explain()", false),
            ("db.a.aggregate([{ $out: 'b' }])", false),
            ("db.users.countDocuments({})", false),
            ("db.users.insertOne({})", false),
            ("show dbs", false),
        ];
        for (statement, expected) in cases {
            assert_eq!(is_pageable(statement), expected, "{statement}");
        }
    }

    #[test]
    fn finds_statements_that_can_contain_a_password() {
        let cases = [
            (
                "db.createUser({ user: 'a', pwd: 'secret', roles: [] })",
                true,
            ),
            ("db.changeUserPassword('a', 'b')", true),
            ("db.x.insertOne({ uri: 'mongodb://u:p@host' })", true),
            ("db.users.find({ name: 'a' })", false),
        ];
        for (statement, expected) in cases {
            assert_eq!(can_contain_password(statement), expected, "{statement}");
        }
    }
}
