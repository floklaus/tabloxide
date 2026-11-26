//! Classification of statements.

use super::lexer::{Token, TokenKind, tokenize};
use serde::Serialize;

const DATA_CHANGE_WORDS: [&str; 4] = ["insert", "update", "delete", "merge"];

/// First keywords of statements that only read data.
const READ_WORDS: [&str; 8] = [
    "select",
    "table",
    "values",
    "from",
    "describe",
    "summarize",
    "pivot",
    "unpivot",
];

/// Returns `true` if the backend can read the result of `statement` in pages
/// and cancel the statement to close the result early.
///
/// This is correct only for a statement that reads data. A cancel of a statement
/// that changes data undoes the change. Thus the function accepts `SELECT`, `TABLE`,
/// `VALUES`, and `WITH` that has no data change in it. It also accepts the read
/// statements of DuckDB: `FROM`, `DESCRIBE`, `SUMMARIZE`, `PIVOT`, and `UNPIVOT`.
#[must_use]
pub fn is_pageable(statement: &str) -> bool {
    let tokens = tokenize(statement);
    let mut words = tokens.iter().filter(|t| t.kind == TokenKind::Word);
    let Some(first) = words.next() else {
        return false;
    };
    let is = |token: &Token, word: &str| token.is_word(statement, word);
    if READ_WORDS.iter().any(|w| is(first, w)) {
        return true;
    }
    is(first, "with") && !words.any(|token| DATA_CHANGE_WORDS.iter().any(|w| is(token, w)))
}

/// Returns the first keyword of `statement` in lower case. Comments before it do not count.
/// Returns `None` if the statement does not start with a word, for example if it
/// starts with a parenthesis.
#[must_use]
pub fn first_keyword(statement: &str) -> Option<String> {
    let tokens = tokenize(statement);
    let first = tokens.iter().find(|t| t.kind != TokenKind::Comment)?;
    (first.kind == TokenKind::Word).then(|| statement[first.start..first.end].to_ascii_lowercase())
}

/// Returns `true` if `statement` has the word `word` outside of comments, strings,
/// and quoted identifiers. The comparison ignores ASCII case.
#[must_use]
pub fn has_word(statement: &str, word: &str) -> bool {
    tokenize(statement)
        .iter()
        .any(|token| token.is_word(statement, word))
}

/// Why a statement needs a confirmation before it runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "kebab-case")]
pub enum Risk {
    Drop,
    Truncate,
    Alter,
    /// `DELETE` without `WHERE` removes all rows.
    DeleteWithoutWhere,
    /// `UPDATE` without `WHERE` changes all rows.
    UpdateWithoutWhere,
    /// `COPY ... TO` and `EXPORT DATABASE` write files on a disk.
    WriteFile,
    /// `INSTALL` and `LOAD` add program code to the database engine.
    LoadExtension,
    /// A MongoDB `$out` or `$merge` stage replaces or changes the documents of a collection.
    Overwrite,
    /// The application does not know the statement, so it cannot check it.
    Unchecked,
}

/// The keywords of `statement` that are not in parentheses, in lower case.
fn top_level_words(statement: &str) -> Vec<String> {
    let mut depth = 0_usize;
    let mut words = Vec::new();
    for token in tokenize(statement) {
        match token.kind {
            TokenKind::OpenParen => depth += 1,
            TokenKind::CloseParen => depth = depth.saturating_sub(1),
            TokenKind::Word if depth == 0 => {
                words.push(statement[token.start..token.end].to_ascii_lowercase());
            }
            _ => {}
        }
    }
    words
}

/// Returns the risk of a destructive statement, or `None` for a different statement.
///
/// The function reads keywords only. It does not find a destructive statement in the
/// body of a function or in dynamic SQL.
#[must_use]
pub fn classify_risk(statement: &str) -> Option<Risk> {
    let words = top_level_words(statement);
    let has_where = words.iter().any(|word| word == "where");
    // The primary verb of `WITH ... DELETE` is after the common table expressions.
    let verbs = [
        "drop", "truncate", "alter", "delete", "update", "insert", "select", "copy", "export",
        "install", "load",
    ];
    let has = |word: &str| words.iter().any(|candidate| candidate == word);
    let verb = words.iter().find(|word| verbs.contains(&word.as_str()))?;
    let first = words.first()?;
    if first != verb && first != "with" {
        return None;
    }
    match verb.as_str() {
        "drop" => Some(Risk::Drop),
        "truncate" => Some(Risk::Truncate),
        "alter" => Some(Risk::Alter),
        "delete" if !has_where => Some(Risk::DeleteWithoutWhere),
        "update" if !has_where => Some(Risk::UpdateWithoutWhere),
        // `COPY ... TO STDOUT` sends the data to the client and writes no file.
        "copy" if has("to") && !has("stdout") => Some(Risk::WriteFile),
        "export" => Some(Risk::WriteFile),
        "install" | "load" => Some(Risk::LoadExtension),
        _ => None,
    }
}

/// Returns `true` if `statement` can contain a password.
///
/// The query history does not record the text of such a statement. The function finds
/// the keyword `PASSWORD` (for example in `ALTER ROLE`) and a connection string in a
/// string literal (for example in `dblink`).
#[must_use]
pub fn can_contain_password(statement: &str) -> bool {
    tokenize(statement).iter().any(|token| match token.kind {
        TokenKind::Word => token.is_word(statement, "password"),
        TokenKind::Quoted => statement[token.start..token.end]
            .to_ascii_lowercase()
            .contains("password"),
        _ => false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_keyword_ignores_comments_and_needs_a_word() {
        assert_eq!(
            first_keyword("-- c\n/* d */ Select 1").as_deref(),
            Some("select")
        );
        assert_eq!(first_keyword("(analyze) delete from t"), None);
        assert_eq!(first_keyword("  "), None);
    }

    #[test]
    fn has_word_ignores_strings_and_comments() {
        assert!(has_word("select * INTO copy from t", "into"));
        assert!(!has_word("select 'into' from t -- into", "into"));
        assert!(!has_word("select intox from t", "into"));
    }

    #[test]
    fn classifies_statements() {
        let cases = [
            ("select * from t", true),
            ("  -- comment\n SELECT 1", true),
            ("(select 1) union (select 2)", true),
            ("table t", true),
            ("values (1), (2)", true),
            ("with a as (select 1) select * from a", true),
            ("with a as (select 'delete') select * from a", true),
            (
                "with a as (delete from t returning *) select * from a",
                false,
            ),
            (
                "WITH a AS (SELECT 1) INSERT INTO t SELECT * FROM a RETURNING *",
                false,
            ),
            ("delete from t returning *", false),
            ("update t set a = 1 returning *", false),
            ("insert into t values (1) returning *", false),
            ("explain analyze delete from t", false),
            ("show all", false),
            ("from t select a", true),
            ("FROM 'data.csv'", true),
            ("describe t", true),
            ("summarize select * from t", true),
            ("pivot t on a using sum(b)", true),
            ("copy t to 'out.csv'", false),
            ("", false),
            ("-- comment", false),
        ];
        for (statement, expected) in cases {
            assert_eq!(is_pageable(statement), expected, "{statement}");
        }
    }

    #[test]
    fn classifies_destructive_statements() {
        let cases = [
            ("DROP TABLE item", Some(Risk::Drop)),
            ("  -- cleanup\n drop schema s cascade", Some(Risk::Drop)),
            ("truncate item", Some(Risk::Truncate)),
            ("ALTER TABLE item DROP COLUMN a", Some(Risk::Alter)),
            ("delete from item", Some(Risk::DeleteWithoutWhere)),
            ("DELETE FROM item WHERE id = 1", None),
            ("update item set a = 1", Some(Risk::UpdateWithoutWhere)),
            ("update item set a = 1 where id = 2", None),
            // A `WHERE` in a subquery does not limit the rows of the statement.
            (
                "update item set a = (select b from t where c = 1)",
                Some(Risk::UpdateWithoutWhere),
            ),
            (
                "with old as (select id from t where a) delete from item",
                Some(Risk::DeleteWithoutWhere),
            ),
            ("with old as (select 1) delete from item where id = 1", None),
            ("select 'drop table item'", None),
            ("select * from item", None),
            ("insert into item values (1)", None),
            ("create table item (a int)", None),
            ("explain delete from item", None),
            ("COPY item TO 'out.csv'", Some(Risk::WriteFile)),
            (
                "copy (select * from item where a) to '/tmp/x.parquet' (format parquet)",
                Some(Risk::WriteFile),
            ),
            ("copy item to stdout", None),
            ("copy item from 'in.csv'", None),
            ("EXPORT DATABASE 'backup'", Some(Risk::WriteFile)),
            ("install httpfs", Some(Risk::LoadExtension)),
            ("LOAD 'my_extension'", Some(Risk::LoadExtension)),
            ("select load from item", None),
            ("", None),
        ];
        for (statement, expected) in cases {
            assert_eq!(classify_risk(statement), expected, "{statement}");
        }
    }

    #[test]
    fn finds_statements_that_can_contain_a_password() {
        let cases = [
            ("ALTER ROLE app PASSWORD 'secret'", true),
            ("create user u with password 'x'", true),
            (
                "SELECT * FROM dblink('host=a password=b', 'select 1') AS t(a int)",
                true,
            ),
            (
                "CREATE USER MAPPING FOR u SERVER s OPTIONS (user 'a', password 'b')",
                true,
            ),
            ("SELECT password_hash FROM account", false),
            ("SELECT 1 -- password", false),
            ("SELECT * FROM item", false),
        ];
        for (statement, expected) in cases {
            assert_eq!(can_contain_password(statement), expected, "{statement}");
        }
    }
}
