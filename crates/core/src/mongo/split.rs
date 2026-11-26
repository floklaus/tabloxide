//! Splits a MongoDB script into statements.

use super::lexer::{Token, TokenKind, tokenize};
use crate::sql::Span;

#[derive(Default)]
struct Current {
    /// First and last token that is not a comment.
    content: Option<(usize, usize)>,
    /// The last token that is not a comment.
    last: Option<Token>,
    depth: usize,
}

impl Current {
    fn span(&self) -> Option<Span> {
        self.content.map(|(start, end)| Span { start, end })
    }

    /// A line break ends the statement if the statement is complete on its line.
    /// A line that starts with `.` continues the statement, for example `.limit(5)`.
    fn ends_at_line_break(&self, source: &str, next: &Token) -> bool {
        let Some(last) = self.last else {
            return false;
        };
        self.depth == 0
            && source[last.end..next.start].contains('\n')
            && !next.is_punct(source, '.')
            && !last.is_punct(source, '.')
            && !last.is_punct(source, ',')
    }

    fn read(&mut self, source: &str, token: Token) {
        if token.kind == TokenKind::Comment {
            return;
        }
        if token.kind == TokenKind::Punct {
            match &source[token.start..token.end] {
                "(" | "[" | "{" => self.depth += 1,
                ")" | "]" | "}" => self.depth = self.depth.saturating_sub(1),
                _ => {}
            }
        }
        let start = self.content.map_or(token.start, |(start, _)| start);
        self.content = Some((start, token.end));
        self.last = Some(token);
    }
}

/// Returns the statements of `source` in sequence. A `;` or a line break ends a
/// statement, outside of brackets. The spans do not contain the `;`.
#[must_use]
pub fn split_statements(source: &str) -> Vec<Span> {
    let mut spans = Vec::new();
    let mut current = Current::default();
    for token in tokenize(source) {
        if token.is_punct(source, ';') && current.depth == 0 {
            spans.extend(current.span());
            current = Current::default();
            continue;
        }
        if token.kind != TokenKind::Comment && current.ends_at_line_break(source, &token) {
            spans.extend(current.span());
            current = Current::default();
        }
        current.read(source, token);
    }
    spans.extend(current.span());
    spans
}

#[cfg(test)]
mod tests {
    use super::*;

    fn statements(source: &str) -> Vec<&str> {
        split_statements(source)
            .into_iter()
            .map(|span| &source[span.start..span.end])
            .collect()
    }

    #[test]
    fn a_semicolon_or_a_line_break_ends_a_statement() {
        assert_eq!(
            statements("use sales\ndb.a.find(); db.b.find()\n\n// note\nshow dbs"),
            vec!["use sales", "db.a.find()", "db.b.find()", "show dbs"]
        );
    }

    #[test]
    fn a_statement_continues_in_brackets_and_on_a_line_with_a_dot() {
        let source = "db.orders.aggregate([\n  { $match: { a: 1 } },\n  { $limit: 2 }\n])\n  .toArray()\ndb.x.\n  find()";

        assert_eq!(
            statements(source),
            vec![
                "db.orders.aggregate([\n  { $match: { a: 1 } },\n  { $limit: 2 }\n])\n  .toArray()",
                "db.x.\n  find()",
            ]
        );
    }

    #[test]
    fn semicolons_and_line_breaks_in_strings_and_comments_do_not_split() {
        assert_eq!(
            statements("db.a.find({ s: 'x;y' }) /* ;\n */ ;"),
            vec!["db.a.find({ s: 'x;y' })"]
        );
    }

    #[test]
    fn an_empty_script_has_no_statements() {
        assert!(statements("  ;\n// only a comment\n").is_empty());
    }
}
