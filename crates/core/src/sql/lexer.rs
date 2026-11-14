//! A small SQL lexer. It finds the token borders that the splitter and the classifier need.
//! It does not check the syntax.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TokenKind {
    /// A keyword or an identifier without quotes.
    Word,
    Semicolon,
    OpenParen,
    CloseParen,
    /// A line comment or a block comment.
    Comment,
    /// A string, a quoted identifier, or a dollar-quoted string.
    Quoted,
    /// A number, an operator, or a different character.
    Other,
}

/// One token. `start` and `end` are byte offsets.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Token {
    pub kind: TokenKind,
    pub start: usize,
    pub end: usize,
}

impl Token {
    /// Returns `true` if the token is the word `word`. The comparison ignores ASCII case.
    pub(crate) fn is_word(&self, sql: &str, word: &str) -> bool {
        self.kind == TokenKind::Word && sql[self.start..self.end].eq_ignore_ascii_case(word)
    }
}

fn is_word_start(byte: u8) -> bool {
    byte.is_ascii_alphabetic() || byte == b'_' || byte >= 0x80
}

fn is_word_part(byte: u8) -> bool {
    is_word_start(byte) || byte.is_ascii_digit() || byte == b'$'
}

/// Returns the offset after a quoted section that starts at `start`.
/// A doubled quote is an escaped quote. With `backslash`, a backslash escapes the next byte.
/// A section without an end continues to the end of the text.
fn quoted_end(bytes: &[u8], start: usize, quote: u8, backslash: bool) -> usize {
    let mut i = start + 1;
    while i < bytes.len() {
        if backslash && bytes[i] == b'\\' {
            i += 2;
        } else if bytes[i] != quote {
            i += 1;
        } else if bytes.get(i + 1) == Some(&quote) {
            i += 2;
        } else {
            return i + 1;
        }
    }
    bytes.len()
}

fn line_comment_end(bytes: &[u8], start: usize) -> usize {
    bytes[start..]
        .iter()
        .position(|&b| b == b'\n')
        .map_or(bytes.len(), |offset| start + offset)
}

/// PostgreSQL block comments can contain block comments.
fn block_comment_end(bytes: &[u8], start: usize) -> usize {
    let mut depth = 0_usize;
    let mut i = start;
    while i < bytes.len() {
        if bytes[i..].starts_with(b"/*") {
            depth += 1;
            i += 2;
        } else if bytes[i..].starts_with(b"*/") {
            depth -= 1;
            i += 2;
            if depth == 0 {
                return i;
            }
        } else {
            i += 1;
        }
    }
    bytes.len()
}

/// Returns the offset after the opening tag (`$$` or `$tag$`) that starts at `start`.
fn dollar_tag_end(bytes: &[u8], start: usize) -> Option<usize> {
    let mut i = start + 1;
    while i < bytes.len() {
        let byte = bytes[i];
        if byte == b'$' {
            return Some(i + 1);
        }
        let is_first = i == start + 1;
        let is_tag_byte = is_word_start(byte) || (!is_first && byte.is_ascii_digit());
        if !is_tag_byte {
            return None;
        }
        i += 1;
    }
    None
}

/// Returns the offset after a dollar-quoted string that starts at `start`,
/// or `None` if the `$` does not start a dollar quote.
fn dollar_quote_end(bytes: &[u8], start: usize) -> Option<usize> {
    let body_start = dollar_tag_end(bytes, start)?;
    let tag = &bytes[start..body_start];
    let end = bytes[body_start..]
        .windows(tag.len())
        .position(|window| window == tag)
        .map_or(bytes.len(), |offset| body_start + offset + tag.len());
    Some(end)
}

fn word_end(bytes: &[u8], start: usize) -> usize {
    bytes[start..]
        .iter()
        .position(|&b| !is_word_part(b))
        .map_or(bytes.len(), |offset| start + offset)
}

fn number_end(bytes: &[u8], start: usize) -> usize {
    bytes[start..]
        .iter()
        .position(|&b| !(is_word_part(b) || b == b'.'))
        .map_or(bytes.len(), |offset| start + offset)
}

/// A string can have a one-letter prefix. Only the prefix `E` enables backslash escapes.
fn prefixed_string_end(bytes: &[u8], start: usize, end: usize) -> Option<usize> {
    if end - start != 1 || bytes.get(end) != Some(&b'\'') {
        return None;
    }
    match bytes[start].to_ascii_lowercase() {
        b'e' => Some(quoted_end(bytes, end, b'\'', true)),
        b'b' | b'x' | b'n' => Some(quoted_end(bytes, end, b'\'', false)),
        _ => None,
    }
}

fn next_token(bytes: &[u8], start: usize) -> Token {
    let token = |kind, end| Token { kind, start, end };
    let rest = &bytes[start..];
    match bytes[start] {
        b';' => token(TokenKind::Semicolon, start + 1),
        b'(' => token(TokenKind::OpenParen, start + 1),
        b')' => token(TokenKind::CloseParen, start + 1),
        b'\'' => token(TokenKind::Quoted, quoted_end(bytes, start, b'\'', false)),
        b'"' => token(TokenKind::Quoted, quoted_end(bytes, start, b'"', false)),
        b'-' if rest.starts_with(b"--") => {
            token(TokenKind::Comment, line_comment_end(bytes, start))
        }
        b'/' if rest.starts_with(b"/*") => {
            token(TokenKind::Comment, block_comment_end(bytes, start))
        }
        b'$' => match dollar_quote_end(bytes, start) {
            Some(end) => token(TokenKind::Quoted, end),
            // A parameter such as `$1`.
            None => token(TokenKind::Other, number_end(bytes, start + 1)),
        },
        byte if is_word_start(byte) => {
            let end = word_end(bytes, start);
            match prefixed_string_end(bytes, start, end) {
                Some(string_end) => token(TokenKind::Quoted, string_end),
                None => token(TokenKind::Word, end),
            }
        }
        byte if byte.is_ascii_digit() => token(TokenKind::Other, number_end(bytes, start)),
        _ => token(TokenKind::Other, start + 1),
    }
}

/// Splits `sql` into tokens. The result does not contain whitespace.
pub(crate) fn tokenize(sql: &str) -> Vec<Token> {
    let bytes = sql.as_bytes();
    let mut tokens = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i].is_ascii_whitespace() {
            i += 1;
            continue;
        }
        let token = next_token(bytes, i);
        // An escape at the end of the text can put the end after the last byte.
        let end = token.end.min(bytes.len());
        tokens.push(Token { end, ..token });
        i = end;
    }
    tokens
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(sql: &str) -> Vec<(TokenKind, &str)> {
        tokenize(sql)
            .into_iter()
            .map(|t| (t.kind, &sql[t.start..t.end]))
            .collect()
    }

    #[test]
    fn finds_words_and_punctuation() {
        assert_eq!(
            kinds("select (a1);"),
            vec![
                (TokenKind::Word, "select"),
                (TokenKind::OpenParen, "("),
                (TokenKind::Word, "a1"),
                (TokenKind::CloseParen, ")"),
                (TokenKind::Semicolon, ";"),
            ]
        );
    }

    #[test]
    fn one_quoted_token_for_each_string_form() {
        let cases = [
            "'a;b'",
            "'it''s;'",
            "E'a\\';b'",
            "e'\\\\'",
            "\"a;\"\"b\"",
            "$$a;b$$",
            "$fn$ a; $$ b; $fn$",
            "$_t1$;$_t1$",
            "N'a;'",
            "'not closed; select 1",
            "$$not closed; select 1",
        ];
        for case in cases {
            assert_eq!(kinds(case), vec![(TokenKind::Quoted, case)], "{case}");
        }
    }

    #[test]
    fn backslash_is_not_an_escape_in_a_standard_string() {
        assert_eq!(
            kinds("'a\\';"),
            vec![(TokenKind::Quoted, "'a\\'"), (TokenKind::Semicolon, ";")]
        );
    }

    #[test]
    fn comments_end_correctly() {
        assert_eq!(
            kinds("-- a;\nx /* b; /* c; */ d; */ y"),
            vec![
                (TokenKind::Comment, "-- a;"),
                (TokenKind::Word, "x"),
                (TokenKind::Comment, "/* b; /* c; */ d; */"),
                (TokenKind::Word, "y"),
            ]
        );
    }

    #[test]
    fn a_parameter_is_not_a_dollar_quote() {
        assert_eq!(
            kinds("$1;$2"),
            vec![
                (TokenKind::Other, "$1"),
                (TokenKind::Semicolon, ";"),
                (TokenKind::Other, "$2"),
            ]
        );
    }

    #[test]
    fn a_dollar_in_an_identifier_is_not_a_dollar_quote() {
        assert_eq!(
            kinds("a$b$;"),
            vec![(TokenKind::Word, "a$b$"), (TokenKind::Semicolon, ";")]
        );
    }

    #[test]
    fn text_that_is_not_ascii_does_not_break_the_borders() {
        assert_eq!(
            kinds("sélect 'ü;' ;"),
            vec![
                (TokenKind::Word, "sélect"),
                (TokenKind::Quoted, "'ü;'"),
                (TokenKind::Semicolon, ";"),
            ]
        );
    }

    #[test]
    fn an_escape_at_the_end_stays_in_the_text() {
        assert_eq!(kinds("E'a\\"), vec![(TokenKind::Quoted, "E'a\\")]);
    }
}
