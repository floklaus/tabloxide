//! Classification of statements.

use super::lexer::{Token, TokenKind, tokenize};
use serde::Serialize;

const DATA_CHANGE_WORDS: [&str; 4] = ["insert", "update", "delete", "merge"];

/// Returns `true` if the backend can read the result of `statement` in pages
/// and cancel the statement to close the result early.
///
/// This is correct only for a statement that reads data. A cancel of a statement
/// that changes data undoes the change. Thus the function accepts `SELECT`, `TABLE`,
/// `VALUES`, and `WITH` that has no data change in it.
#[must_use]
pub fn is_pageable(statement: &str) -> bool {
    let tokens = tokenize(statement);
    let mut words = tokens.iter().filter(|t| t.kind == TokenKind::Word);
    let Some(first) = words.next() else {
        return false;
    };
    let is = |token: &Token, word: &str| token.is_word(statement, word);
    if ["select", "table", "values"].iter().any(|w| is(first, w)) {
        return true;
    }
    is(first, "with") && !words.any(|token| DATA_CHANGE_WORDS.iter().any(|w| is(token, w)))
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
        "drop", "truncate", "alter", "delete", "update", "insert", "select",
    ];
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
