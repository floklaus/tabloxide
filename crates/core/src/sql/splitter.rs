//! Splits a script into statements.

use super::lexer::{Token, TokenKind, tokenize};

/// The byte range of one statement in a script. The range does not contain the semicolon.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Span {
    pub start: usize,
    pub end: usize,
}

/// Number of words at the start of a statement that can identify a routine definition.
const ROUTINE_PREFIX_WORDS: usize = 4;

/// State of the statement that the splitter reads.
#[derive(Default)]
struct Current {
    /// First and last token that is not a comment.
    content: Option<(usize, usize)>,
    paren_depth: usize,
    /// Depth of `BEGIN ... END` blocks in the body of an SQL routine.
    block_depth: usize,
    prefix: Vec<String>,
    is_routine: bool,
}

fn is_routine_prefix(words: &[String]) -> bool {
    let is_routine_word = |word: &String| word == "function" || word == "procedure";
    match words {
        [create, kind, ..] if create == "create" && is_routine_word(kind) => true,
        [create, or, replace, kind] => {
            create == "create" && or == "or" && replace == "replace" && is_routine_word(kind)
        }
        _ => false,
    }
}

impl Current {
    fn read_word(&mut self, word: &str) {
        let word = word.to_ascii_lowercase();
        if self.prefix.len() < ROUTINE_PREFIX_WORDS {
            self.prefix.push(word.clone());
            self.is_routine = self.is_routine || is_routine_prefix(&self.prefix);
        }
        if !self.is_routine {
            return;
        }
        // A body with `BEGIN ATOMIC ... END` contains semicolons. `CASE ... END` is in such a body.
        match word.as_str() {
            "begin" => self.block_depth += 1,
            "case" if self.block_depth > 0 => self.block_depth += 1,
            "end" => self.block_depth = self.block_depth.saturating_sub(1),
            _ => {}
        }
    }

    fn read(&mut self, sql: &str, token: &Token) {
        match token.kind {
            TokenKind::Comment | TokenKind::Semicolon => return,
            TokenKind::OpenParen => self.paren_depth += 1,
            TokenKind::CloseParen => self.paren_depth = self.paren_depth.saturating_sub(1),
            TokenKind::Word => self.read_word(&sql[token.start..token.end]),
            TokenKind::Quoted | TokenKind::Other => {}
        }
        let start = self.content.map_or(token.start, |(start, _)| start);
        self.content = Some((start, token.end));
    }

    fn can_end(&self) -> bool {
        self.paren_depth == 0 && self.block_depth == 0
    }

    fn span(&self) -> Option<Span> {
        self.content.map(|(start, end)| Span { start, end })
    }
}

/// Returns the statements of `sql` in sequence.
///
/// The splitter understands strings, quoted identifiers, dollar quotes, comments,
/// parentheses, and the `BEGIN ATOMIC` body of an SQL routine.
/// It ignores a statement that is empty or that contains only comments.
#[must_use]
pub fn split_statements(sql: &str) -> Vec<Span> {
    let mut spans = Vec::new();
    let mut current = Current::default();
    for token in tokenize(sql) {
        if token.kind == TokenKind::Semicolon && current.can_end() {
            spans.extend(current.span());
            current = Current::default();
        } else {
            current.read(sql, &token);
        }
    }
    spans.extend(current.span());
    spans
}

/// Returns the statement at the byte offset `offset` (the cursor position).
///
/// When the cursor is between two statements, the result is the statement before the cursor
/// on the same line, or else the next statement.
#[must_use]
pub fn statement_at(sql: &str, offset: usize) -> Option<Span> {
    let spans = split_statements(sql);
    if let Some(span) = spans.iter().find(|s| s.start <= offset && offset <= s.end) {
        return Some(*span);
    }
    let before = spans.iter().rev().find(|s| s.end < offset);
    let after = spans.iter().find(|s| s.start > offset);
    let is_on_cursor_line =
        |span: &Span| !sql.as_bytes()[span.end..offset.min(sql.len())].contains(&b'\n');
    match (before, after) {
        (Some(before), _) if is_on_cursor_line(before) => Some(*before),
        (_, Some(after)) => Some(*after),
        (before, None) => before.copied(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn statements(sql: &str) -> Vec<&str> {
        split_statements(sql)
            .into_iter()
            .map(|span| &sql[span.start..span.end])
            .collect()
    }

    #[test]
    fn splits_scripts() {
        let cases: &[(&str, &[&str])] = &[
            ("", &[]),
            ("  \n ", &[]),
            (";;;", &[]),
            ("select 1", &["select 1"]),
            ("select 1;", &["select 1"]),
            ("select 1; select 2", &["select 1", "select 2"]),
            ("  select 1 ;\n\n select 2 ;  ", &["select 1", "select 2"]),
            ("select ';'; select 2", &["select ';'", "select 2"]),
            (
                "select 'it''s;'; select 2",
                &["select 'it''s;'", "select 2"],
            ),
            (
                "select E'a\\';'; select 2",
                &["select E'a\\';'", "select 2"],
            ),
            ("select \"a;b\"; select 2", &["select \"a;b\"", "select 2"]),
            ("select $$a;b$$; select 2", &["select $$a;b$$", "select 2"]),
            (
                "select $x$ a; $$ ; $x$; select 2",
                &["select $x$ a; $$ ; $x$", "select 2"],
            ),
            ("select 1 -- a; b\n; select 2", &["select 1", "select 2"]),
            (
                "select /* a; /* b; */ c; */ 1; select 2",
                &["select /* a; /* b; */ c; */ 1", "select 2"],
            ),
            ("-- only a comment", &[]),
            ("select 1; -- end", &["select 1"]),
            ("/* start */ select 1", &["select 1"]),
            ("select 1 /* end */;", &["select 1"]),
            ("select $1; select $2", &["select $1", "select $2"]),
            ("select 'ü'; select 'ö'", &["select 'ü'", "select 'ö'"]),
            ("select (1; 2); select 3", &["select (1; 2)", "select 3"]),
            ("select 1); select 2", &["select 1)", "select 2"]),
            (
                "select 'not closed; select 2",
                &["select 'not closed; select 2"],
            ),
        ];
        for (sql, expected) in cases {
            assert_eq!(statements(sql), *expected, "{sql}");
        }
    }

    #[test]
    fn keeps_a_function_with_a_dollar_quoted_body() {
        let sql = "create function f() returns int as $$ begin return 1; end; $$ language plpgsql; select f()";

        assert_eq!(
            statements(sql),
            vec![
                "create function f() returns int as $$ begin return 1; end; $$ language plpgsql",
                "select f()"
            ]
        );
    }

    #[test]
    fn keeps_a_routine_with_an_atomic_body() {
        let function = "create or replace function f(a int) returns int begin atomic \
                        select 1; select case when a > 0 then 1 else 2 end; end";
        let procedure = "CREATE PROCEDURE p() BEGIN ATOMIC INSERT INTO t VALUES (1); END";
        let sql = format!("{function}; {procedure}; select 2");

        assert_eq!(statements(&sql), vec![function, procedure, "select 2"]);
    }

    #[test]
    fn begin_and_end_split_outside_a_routine() {
        assert_eq!(
            statements("begin; update t set a = 1; end; select 1"),
            vec!["begin", "update t set a = 1", "end", "select 1"]
        );
    }

    #[test]
    fn finds_the_statement_at_the_cursor() {
        let sql = "select 1;\n\nselect 2;\nselect 3";
        let at = |offset| statement_at(sql, offset).map(|span| &sql[span.start..span.end]);

        assert_eq!(at(0), Some("select 1"));
        assert_eq!(at(8), Some("select 1"));
        // After the semicolon, on the same line.
        assert_eq!(at(9), Some("select 1"));
        // On the empty line.
        assert_eq!(at(10), Some("select 2"));
        assert_eq!(at(15), Some("select 2"));
        assert_eq!(at(sql.len()), Some("select 3"));
    }

    #[test]
    fn the_cursor_after_the_last_statement_selects_it() {
        assert_eq!(
            statement_at("select 1;\n\n", 11),
            Some(Span { start: 0, end: 8 })
        );
        assert_eq!(statement_at("  ", 1), None);
    }
}
