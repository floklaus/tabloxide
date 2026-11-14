//! Classification of statements.

use super::lexer::{Token, TokenKind, tokenize};

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
}
