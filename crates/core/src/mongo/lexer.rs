//! The tokens of the MongoDB shell syntax that Tabloxide accepts.

/// The category of a token.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenKind {
    /// A name, for example `db`, `find`, or `ObjectId`. It can contain `$`.
    Ident,
    /// A number without its sign, for example `42` or `1.5e3`.
    Number,
    /// A string in single quotes, double quotes, or back quotes.
    String,
    /// A regular expression, for example `/^a/i`.
    Regex,
    /// A comment with `//` or `/* */`.
    Comment,
    /// One character that is not in a different category, for example `.` or `{`.
    Punct,
}

/// One token. `start` and `end` are byte offsets in the text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Token {
    pub kind: TokenKind,
    pub start: usize,
    pub end: usize,
}

impl Token {
    #[must_use]
    pub fn text<'a>(&self, source: &'a str) -> &'a str {
        &source[self.start..self.end]
    }

    /// Returns `true` if the token is the punctuation character `c`.
    #[must_use]
    pub fn is_punct(&self, source: &str, c: char) -> bool {
        self.kind == TokenKind::Punct && source[self.start..].starts_with(c)
    }
}

fn is_ident_start(c: char) -> bool {
    c.is_alphabetic() || c == '_' || c == '$'
}

fn is_ident_part(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '$'
}

/// A `/` starts a regular expression only where a value can start. Elsewhere it is
/// a division, which the accepted syntax does not use.
fn can_start_regex(previous: Option<&Token>, source: &str) -> bool {
    match previous {
        None => true,
        Some(token) if token.kind == TokenKind::Punct => {
            matches!(
                &source[token.start..token.end],
                "(" | "," | ":" | "[" | "{" | "=" | "!"
            )
        }
        Some(_) => false,
    }
}

struct Lexer<'a> {
    source: &'a str,
    chars: Vec<(usize, char)>,
    index: usize,
    tokens: Vec<Token>,
}

impl Lexer<'_> {
    fn peek(&self, ahead: usize) -> Option<char> {
        self.chars.get(self.index + ahead).map(|(_, c)| *c)
    }

    fn offset(&self) -> usize {
        self.chars
            .get(self.index)
            .map_or(self.source.len(), |(offset, _)| *offset)
    }

    fn push(&mut self, kind: TokenKind, start: usize) {
        self.tokens.push(Token {
            kind,
            start,
            end: self.offset(),
        });
    }

    fn take_while(&mut self, accept: impl Fn(char) -> bool) {
        while self.peek(0).is_some_and(&accept) {
            self.index += 1;
        }
    }

    /// Reads to the closing `quote`. A backslash escapes the next character.
    /// An open string ends at the end of the text.
    fn read_quoted(&mut self, quote: char) {
        self.index += 1;
        while let Some(c) = self.peek(0) {
            self.index += 1;
            if c == '\\' {
                self.index += 1;
            } else if c == quote {
                return;
            }
        }
        self.index = self.index.min(self.chars.len());
    }

    fn read_regex(&mut self) {
        self.index += 1;
        let mut in_class = false;
        while let Some(c) = self.peek(0) {
            if c == '\n' {
                break;
            }
            self.index += 1;
            match c {
                '\\' => self.index += 1,
                '[' => in_class = true,
                ']' => in_class = false,
                '/' if !in_class => break,
                _ => {}
            }
        }
        self.index = self.index.min(self.chars.len());
        self.take_while(char::is_alphabetic);
    }

    fn read_comment(&mut self) {
        if self.peek(1) == Some('/') {
            self.take_while(|c| c != '\n');
            return;
        }
        self.index += 2;
        while let Some(c) = self.peek(0) {
            if c == '*' && self.peek(1) == Some('/') {
                self.index += 2;
                return;
            }
            self.index += 1;
        }
    }

    fn read_number(&mut self) {
        self.take_while(|c| c.is_ascii_digit() || c == '.' || c == '_');
        if matches!(self.peek(0), Some('e' | 'E')) {
            self.index += 1;
            if matches!(self.peek(0), Some('+' | '-')) {
                self.index += 1;
            }
            self.take_while(|c| c.is_ascii_digit());
        }
    }

    fn run(mut self) -> Vec<Token> {
        while let Some(c) = self.peek(0) {
            let start = self.offset();
            if c.is_whitespace() {
                self.index += 1;
                continue;
            }
            let kind = if c == '/' && matches!(self.peek(1), Some('/' | '*')) {
                self.read_comment();
                TokenKind::Comment
            } else if c == '/' && can_start_regex(self.tokens.last(), self.source) {
                self.read_regex();
                TokenKind::Regex
            } else if matches!(c, '"' | '\'' | '`') {
                self.read_quoted(c);
                TokenKind::String
            } else if c.is_ascii_digit()
                || (c == '.' && self.peek(1).is_some_and(|n| n.is_ascii_digit()))
            {
                self.read_number();
                TokenKind::Number
            } else if is_ident_start(c) {
                self.take_while(is_ident_part);
                TokenKind::Ident
            } else {
                self.index += 1;
                TokenKind::Punct
            };
            self.push(kind, start);
        }
        self.tokens
    }
}

/// Returns the tokens of `source`. The function accepts each text. A character that
/// the syntax does not use becomes a `Punct` token, and the parser rejects it.
#[must_use]
pub fn tokenize(source: &str) -> Vec<Token> {
    Lexer {
        source,
        chars: source.char_indices().collect(),
        index: 0,
        tokens: Vec::new(),
    }
    .run()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(source: &str) -> Vec<(TokenKind, &str)> {
        tokenize(source)
            .into_iter()
            .map(|token| (token.kind, token.text(source)))
            .collect()
    }

    #[test]
    fn reads_a_find_call() {
        assert_eq!(
            kinds("db.users.find({ a: 'x' })"),
            vec![
                (TokenKind::Ident, "db"),
                (TokenKind::Punct, "."),
                (TokenKind::Ident, "users"),
                (TokenKind::Punct, "."),
                (TokenKind::Ident, "find"),
                (TokenKind::Punct, "("),
                (TokenKind::Punct, "{"),
                (TokenKind::Ident, "a"),
                (TokenKind::Punct, ":"),
                (TokenKind::String, "'x'"),
                (TokenKind::Punct, "}"),
                (TokenKind::Punct, ")"),
            ]
        );
    }

    #[test]
    fn reads_comments_regexes_numbers_and_operators() {
        assert_eq!(
            kinds("// c\n{ $gt: 1.5e3, n: /a\\/b[/]/gi } /* d */"),
            vec![
                (TokenKind::Comment, "// c"),
                (TokenKind::Punct, "{"),
                (TokenKind::Ident, "$gt"),
                (TokenKind::Punct, ":"),
                (TokenKind::Number, "1.5e3"),
                (TokenKind::Punct, ","),
                (TokenKind::Ident, "n"),
                (TokenKind::Punct, ":"),
                (TokenKind::Regex, "/a\\/b[/]/gi"),
                (TokenKind::Punct, "}"),
                (TokenKind::Comment, "/* d */"),
            ]
        );
    }

    #[test]
    fn a_string_keeps_escaped_quotes_and_an_open_string_ends_at_the_end() {
        assert_eq!(kinds(r#""a\"b""#), vec![(TokenKind::String, r#""a\"b""#)]);
        assert_eq!(kinds("'open"), vec![(TokenKind::String, "'open")]);
    }

    #[test]
    fn accepts_text_that_is_not_ascii() {
        assert_eq!(kinds("{ name: 'Zoë' }")[3], (TokenKind::String, "'Zoë'"));
    }
}
