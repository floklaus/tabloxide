//! The query languages that the core knows. The guardrails stay in the core, so the
//! core must read the statements of each language.

use crate::mongo;
use crate::sql::{self, Risk, Span};
use serde::{Deserialize, Serialize};

/// The query language of a database engine.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "kebab-case")]
pub enum QueryLanguage {
    #[default]
    Sql,
    /// The subset of the MongoDB shell syntax in `crate::mongo`.
    MongodbShell,
    /// A language that this version of the application does not know. Each statement
    /// needs a confirmation, and the history does not record it.
    #[serde(other)]
    Unknown,
}

impl QueryLanguage {
    /// Returns the language for its name in the connector protocol.
    #[must_use]
    pub fn from_name(name: &str) -> Self {
        match name {
            "sql" => Self::Sql,
            "mongodb-shell" => Self::MongodbShell,
            _ => Self::Unknown,
        }
    }

    /// Returns the name of the language in the connector protocol.
    #[must_use]
    pub fn name(self) -> &'static str {
        match self {
            Self::Sql => "sql",
            Self::MongodbShell => "mongodb-shell",
            Self::Unknown => "unknown",
        }
    }

    /// Returns the statements of `text` in sequence.
    #[must_use]
    pub fn split(self, text: &str) -> Vec<Span> {
        match self {
            Self::Sql => sql::split_statements(text),
            Self::MongodbShell => mongo::split_statements(text),
            Self::Unknown => whole_text(text).into_iter().collect(),
        }
    }

    /// Returns the statement at the byte offset `offset` (the cursor position).
    ///
    /// When the cursor is between two statements, the result is the statement before
    /// the cursor on the same line, or else the next statement.
    #[must_use]
    pub fn statement_at(self, text: &str, offset: usize) -> Option<Span> {
        sql::span_at(text, &self.split(text), offset)
    }

    /// Returns the risk of a destructive statement, or `None` for a different statement.
    #[must_use]
    pub fn classify_risk(self, statement: &str) -> Option<Risk> {
        match self {
            Self::Sql => sql::classify_risk(statement),
            Self::MongodbShell => mongo::classify_risk(statement),
            Self::Unknown => Some(Risk::Unchecked),
        }
    }

    /// Returns `true` if the result of `statement` can stay open for paged reads.
    #[must_use]
    pub fn is_pageable(self, statement: &str) -> bool {
        match self {
            Self::Sql => sql::is_pageable(statement),
            Self::MongodbShell => mongo::is_pageable(statement),
            Self::Unknown => false,
        }
    }

    /// Returns `true` if `statement` can contain a password.
    #[must_use]
    pub fn can_contain_password(self, statement: &str) -> bool {
        match self {
            Self::Sql => sql::can_contain_password(statement),
            Self::MongodbShell => mongo::can_contain_password(statement),
            Self::Unknown => true,
        }
    }
}

/// The text without the white space at its start and its end, or `None` if the text is empty.
fn whole_text(text: &str) -> Option<Span> {
    let start = text.len() - text.trim_start().len();
    let end = text.trim_end().len();
    (start < end).then_some(Span { start, end })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_read_and_write_without_a_change() {
        for language in [QueryLanguage::Sql, QueryLanguage::MongodbShell] {
            assert_eq!(QueryLanguage::from_name(language.name()), language);
        }
        assert_eq!(QueryLanguage::from_name("cypher"), QueryLanguage::Unknown);
        let read: QueryLanguage = serde_json::from_str("\"cypher\"").unwrap();
        assert_eq!(read, QueryLanguage::Unknown);
    }

    #[test]
    fn an_unknown_language_is_one_statement_that_needs_a_confirmation() {
        let text = "  MATCH (n)\nRETURN n;  ";

        let spans = QueryLanguage::Unknown.split(text);

        assert_eq!(spans, vec![Span { start: 2, end: 21 }]);
        assert_eq!(
            QueryLanguage::Unknown.classify_risk("x"),
            Some(Risk::Unchecked)
        );
        assert!(QueryLanguage::Unknown.can_contain_password("x"));
        assert!(!QueryLanguage::Unknown.is_pageable("x"));
    }

    #[test]
    fn each_language_uses_its_own_splitter() {
        let text = "db.a.find()\ndb.b.find()";

        assert_eq!(QueryLanguage::Sql.split(text).len(), 1);
        assert_eq!(QueryLanguage::MongodbShell.split(text).len(), 2);
        assert_eq!(
            QueryLanguage::MongodbShell.statement_at(text, 14),
            Some(Span { start: 12, end: 23 })
        );
    }
}
