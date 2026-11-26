//! Reads one statement of the MongoDB shell syntax into a tree.
//!
//! Tabloxide runs no JavaScript. The parser accepts only the forms of section 10.2
//! of `docs/Connector Design.md`, and it rejects each other text with a position.

use super::lexer::{Token, TokenKind, tokenize};

/// A value in a statement. The parser keeps numbers as text, so that the connector
/// can select the correct numeric type.
#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    /// The text of the number, with a `-` if it is negative.
    Number(String),
    String(String),
    Array(Vec<Value>),
    /// The fields in their sequence.
    Object(Vec<(String, Value)>),
    Regex {
        pattern: String,
        flags: String,
    },
    /// A constructor such as `ObjectId("…")` or `new Date()`.
    Constructor {
        name: String,
        args: Vec<Value>,
    },
}

impl Value {
    /// Returns `true` for `{}`.
    #[must_use]
    pub fn is_empty_object(&self) -> bool {
        matches!(self, Self::Object(fields) if fields.is_empty())
    }

    /// Returns the value of the field `name` of an object.
    #[must_use]
    pub fn field(&self, name: &str) -> Option<&Value> {
        match self {
            Self::Object(fields) => fields.iter().find(|(key, _)| key == name).map(|(_, v)| v),
            _ => None,
        }
    }
}

/// A method call, for example `limit(10)`.
#[derive(Debug, Clone, PartialEq)]
pub struct Call {
    pub name: String,
    pub args: Vec<Value>,
}

/// What `show` lists.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShowTarget {
    Databases,
    Collections,
}

/// One statement. `database` is `None` for the current database of the session.
#[derive(Debug, Clone, PartialEq)]
pub enum Statement {
    /// `use sales`
    Use { database: String },
    /// `show dbs`, `show collections`
    Show(ShowTarget),
    /// `{ "count": "users" }`
    Command {
        database: Option<String>,
        document: Value,
    },
    /// `db.dropDatabase()`
    Database {
        database: Option<String>,
        method: Call,
    },
    /// `db.users.find({}).limit(5)`. `chain` has the calls after the first call.
    Collection {
        database: Option<String>,
        collection: String,
        method: Call,
        chain: Vec<Call>,
    },
}

/// A statement that the parser cannot read. `position` is the character position in
/// the statement. The first character is 1.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{message}")]
pub struct ParseError {
    pub message: String,
    pub position: u32,
}

struct Parser<'a> {
    source: &'a str,
    tokens: Vec<Token>,
    index: usize,
}

type Parsed<T> = Result<T, ParseError>;

impl<'a> Parser<'a> {
    fn new(source: &'a str) -> Self {
        let tokens = tokenize(source)
            .into_iter()
            .filter(|token| token.kind != TokenKind::Comment)
            .collect();
        Self {
            source,
            tokens,
            index: 0,
        }
    }

    fn peek(&self) -> Option<&Token> {
        self.tokens.get(self.index)
    }

    fn peek_at(&self, ahead: usize) -> Option<&Token> {
        self.tokens.get(self.index + ahead)
    }

    fn text(&self, token: &Token) -> &'a str {
        token.text(self.source)
    }

    fn error_at(&self, offset: usize, message: impl Into<String>) -> ParseError {
        let position = self.source[..offset.min(self.source.len())].chars().count() + 1;
        ParseError {
            message: message.into(),
            position: u32::try_from(position).unwrap_or(u32::MAX),
        }
    }

    fn error(&self, message: impl Into<String>) -> ParseError {
        let offset = self.peek().map_or(self.source.len(), |token| token.start);
        self.error_at(offset, message)
    }

    fn is_punct(&self, c: char) -> bool {
        self.peek()
            .is_some_and(|token| token.is_punct(self.source, c))
    }

    fn is_ident(&self, name: &str) -> bool {
        self.peek()
            .is_some_and(|token| token.kind == TokenKind::Ident && self.text(token) == name)
    }

    fn expect_punct(&mut self, c: char) -> Parsed<()> {
        if self.is_punct(c) {
            self.index += 1;
            Ok(())
        } else {
            Err(self.error(format!("Expected `{c}`.")))
        }
    }

    fn ident(&mut self) -> Parsed<String> {
        match self.peek() {
            Some(token) if token.kind == TokenKind::Ident => {
                let name = self.text(token).to_owned();
                self.index += 1;
                Ok(name)
            }
            _ => Err(self.error("Expected a name.")),
        }
    }

    fn string(&mut self) -> Parsed<String> {
        match self.peek().copied() {
            Some(token) if token.kind == TokenKind::String => {
                self.index += 1;
                unquote(self.text(&token))
                    .ok_or_else(|| self.error_at(token.start, "The string has no end."))
            }
            _ => Err(self.error("Expected a string.")),
        }
    }

    fn finish(&self) -> Parsed<()> {
        if self.is_punct(';') && self.index + 1 == self.tokens.len() {
            return Ok(());
        }
        match self.peek() {
            None => Ok(()),
            Some(_) => Err(self.error("Expected the end of the statement.")),
        }
    }

    fn statement(&mut self) -> Parsed<Statement> {
        let statement = if self.is_punct('{') {
            Statement::Command {
                database: None,
                document: self.value()?,
            }
        } else if self.is_ident("use") {
            self.index += 1;
            let database = if self.peek().is_some_and(|t| t.kind == TokenKind::String) {
                self.string()?
            } else {
                self.ident()?
            };
            Statement::Use { database }
        } else if self.is_ident("show") {
            self.index += 1;
            let start = self.peek().map_or(self.source.len(), |t| t.start);
            match self.ident()?.as_str() {
                "dbs" | "databases" => Statement::Show(ShowTarget::Databases),
                "collections" | "tables" => Statement::Show(ShowTarget::Collections),
                _ => return Err(self.error_at(start, "Use `show dbs` or `show collections`.")),
            }
        } else if self.is_ident("db") {
            self.index += 1;
            self.db_expression()?
        } else {
            return Err(self.error(
                "A statement starts with `db.`, `use`, `show`, or a command document `{ … }`.",
            ));
        };
        self.finish()?;
        Ok(statement)
    }

    fn db_expression(&mut self) -> Parsed<Statement> {
        let mut database = None;
        if self.is_punct('.')
            && self
                .peek_at(1)
                .is_some_and(|t| self.text(t) == "getSiblingDB")
        {
            self.index += 2;
            self.expect_punct('(')?;
            database = Some(self.string()?);
            self.expect_punct(')')?;
        }
        let mut names = Vec::new();
        loop {
            if self.is_punct('[') {
                self.index += 1;
                names.push(self.string()?);
                self.expect_punct(']')?;
                continue;
            }
            self.expect_punct('.')?;
            let name = self.ident()?;
            if !self.is_punct('(') {
                names.push(name);
                continue;
            }
            if names.is_empty() && name == "getCollection" {
                self.index += 1;
                names.push(self.string()?);
                self.expect_punct(')')?;
                continue;
            }
            let method = Call {
                name,
                args: self.arguments()?,
            };
            if names.is_empty() {
                if method.name == "runCommand" || method.name == "adminCommand" {
                    return self.run_command(database, method);
                }
                return Ok(Statement::Database { database, method });
            }
            return Ok(Statement::Collection {
                database,
                collection: names.join("."),
                method,
                chain: self.chain()?,
            });
        }
    }

    fn run_command(&mut self, database: Option<String>, method: Call) -> Parsed<Statement> {
        let database = if method.name == "adminCommand" {
            Some("admin".to_owned())
        } else {
            database
        };
        match <[Value; 1]>::try_from(method.args) {
            Ok([document @ Value::Object(_)]) => Ok(Statement::Command { database, document }),
            _ => Err(self.error("`runCommand` needs one command document.")),
        }
    }

    fn chain(&mut self) -> Parsed<Vec<Call>> {
        let mut calls = Vec::new();
        while self.is_punct('.') {
            self.index += 1;
            let name = self.ident()?;
            calls.push(Call {
                name,
                args: self.arguments()?,
            });
        }
        Ok(calls)
    }

    fn arguments(&mut self) -> Parsed<Vec<Value>> {
        self.expect_punct('(')?;
        let mut args = Vec::new();
        while !self.is_punct(')') {
            args.push(self.value()?);
            if !self.is_punct(')') {
                self.expect_punct(',')?;
            }
        }
        self.index += 1;
        Ok(args)
    }

    fn value(&mut self) -> Parsed<Value> {
        let Some(token) = self.peek().copied() else {
            return Err(self.error("Expected a value."));
        };
        let text = self.text(&token);
        match token.kind {
            TokenKind::String => self.string().map(Value::String),
            TokenKind::Number => {
                self.index += 1;
                Ok(Value::Number(text.replace('_', "")))
            }
            TokenKind::Regex => {
                self.index += 1;
                Ok(regex(text))
            }
            TokenKind::Punct if text == "{" => self.object(),
            TokenKind::Punct if text == "[" => self.array(),
            TokenKind::Punct if text == "-" => self.negative(),
            TokenKind::Ident => self.ident_value(text),
            _ => Err(self.error("Expected a value.")),
        }
    }

    fn negative(&mut self) -> Parsed<Value> {
        self.index += 1;
        match self.peek().copied() {
            Some(token) if token.kind == TokenKind::Number => {
                self.index += 1;
                Ok(Value::Number(format!(
                    "-{}",
                    self.text(&token).replace('_', "")
                )))
            }
            _ => Err(self.error("Expected a number after `-`.")),
        }
    }

    fn ident_value(&mut self, text: &str) -> Parsed<Value> {
        self.index += 1;
        match text {
            "null" | "undefined" => return Ok(Value::Null),
            "true" => return Ok(Value::Bool(true)),
            "false" => return Ok(Value::Bool(false)),
            "Infinity" | "NaN" => return Ok(Value::Number(text.to_owned())),
            _ => {}
        }
        let name = if text == "new" {
            self.ident()?
        } else {
            text.to_owned()
        };
        if !self.is_punct('(') {
            return Err(self.error_at(
                self.tokens[self.index - 1].start,
                format!("`{name}` is not a value. Put a string in quotes."),
            ));
        }
        Ok(Value::Constructor {
            name,
            args: self.arguments()?,
        })
    }

    fn object(&mut self) -> Parsed<Value> {
        self.expect_punct('{')?;
        let mut fields = Vec::new();
        while !self.is_punct('}') {
            let key = match self.peek().copied() {
                Some(t) if t.kind == TokenKind::String => self.string()?,
                Some(t) if matches!(t.kind, TokenKind::Ident | TokenKind::Number) => {
                    self.index += 1;
                    self.text(&t).to_owned()
                }
                _ => return Err(self.error("Expected a field name.")),
            };
            self.expect_punct(':')?;
            fields.push((key, self.value()?));
            if !self.is_punct('}') {
                self.expect_punct(',')?;
            }
        }
        self.index += 1;
        Ok(Value::Object(fields))
    }

    fn array(&mut self) -> Parsed<Value> {
        self.expect_punct('[')?;
        let mut items = Vec::new();
        while !self.is_punct(']') {
            items.push(self.value()?);
            if !self.is_punct(']') {
                self.expect_punct(',')?;
            }
        }
        self.index += 1;
        Ok(Value::Array(items))
    }
}

fn regex(text: &str) -> Value {
    let end = text.rfind('/').filter(|end| *end > 0).unwrap_or(text.len());
    Value::Regex {
        pattern: text[1..end].to_owned(),
        flags: text.get(end + 1..).unwrap_or_default().to_owned(),
    }
}

/// Removes the quotes of a string and reads its escapes. Returns `None` if the
/// string has no closing quote.
fn unquote(text: &str) -> Option<String> {
    let quote = text.chars().next()?;
    let inner = text.strip_prefix(quote)?.strip_suffix(quote)?;
    let mut out = String::with_capacity(inner.len());
    let mut chars = inner.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next()? {
            'n' => out.push('\n'),
            't' => out.push('\t'),
            'r' => out.push('\r'),
            '0' => out.push('\0'),
            'u' => {
                let code: String = chars.by_ref().take(4).collect();
                out.push(char::from_u32(u32::from_str_radix(&code, 16).ok()?)?);
            }
            other => out.push(other),
        }
    }
    Some(out)
}

/// Reads one statement.
///
/// # Errors
///
/// Returns an error with a position if the statement is not in the accepted syntax.
pub fn parse_statement(statement: &str) -> Result<Statement, ParseError> {
    Parser::new(statement).statement()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn object(fields: &[(&str, Value)]) -> Value {
        Value::Object(
            fields
                .iter()
                .map(|(key, value)| ((*key).to_owned(), value.clone()))
                .collect(),
        )
    }

    fn number(text: &str) -> Value {
        Value::Number(text.to_owned())
    }

    #[test]
    fn reads_a_find_with_a_chain() {
        let statement = parse_statement(
            "db.users.find({ age: { $gt: 30 } }, {name: 1}).sort({ name: -1 }).limit(10);",
        )
        .unwrap();

        assert_eq!(
            statement,
            Statement::Collection {
                database: None,
                collection: "users".to_owned(),
                method: Call {
                    name: "find".to_owned(),
                    args: vec![
                        object(&[("age", object(&[("$gt", number("30"))]))]),
                        object(&[("name", number("1"))]),
                    ],
                },
                chain: vec![
                    Call {
                        name: "sort".to_owned(),
                        args: vec![object(&[("name", number("-1"))])],
                    },
                    Call {
                        name: "limit".to_owned(),
                        args: vec![number("10")],
                    },
                ],
            }
        );
    }

    #[test]
    fn reads_the_other_forms_of_a_collection_name() {
        let collection = |text: &str| match parse_statement(text).unwrap() {
            Statement::Collection {
                database,
                collection,
                ..
            } => (database, collection),
            other => panic!("{other:?}"),
        };

        assert_eq!(
            collection("db.getCollection('my-users').find()"),
            (None, "my-users".to_owned())
        );
        assert_eq!(collection("db['a b'].find()"), (None, "a b".to_owned()));
        assert_eq!(
            collection("db.system.views.find()"),
            (None, "system.views".to_owned())
        );
        assert_eq!(
            collection("db.getSiblingDB(\"sales\").orders.find()"),
            (Some("sales".to_owned()), "orders".to_owned())
        );
    }

    #[test]
    fn reads_database_methods_commands_and_shell_commands() {
        assert_eq!(
            parse_statement("db.dropDatabase()").unwrap(),
            Statement::Database {
                database: None,
                method: Call {
                    name: "dropDatabase".to_owned(),
                    args: vec![],
                },
            }
        );
        assert_eq!(
            parse_statement(r#"{ "count": "users" }"#).unwrap(),
            Statement::Command {
                database: None,
                document: object(&[("count", Value::String("users".to_owned()))]),
            }
        );
        assert_eq!(
            parse_statement("db.adminCommand({ ping: 1 })").unwrap(),
            Statement::Command {
                database: Some("admin".to_owned()),
                document: object(&[("ping", number("1"))]),
            }
        );
        assert_eq!(
            parse_statement("use sales").unwrap(),
            Statement::Use {
                database: "sales".to_owned()
            }
        );
        assert_eq!(
            parse_statement("show dbs").unwrap(),
            Statement::Show(ShowTarget::Databases)
        );
    }

    #[test]
    fn reads_constructors_regexes_and_escapes() {
        let Statement::Collection { method, .. } = parse_statement(
            r#"db.c.find({ _id: ObjectId("65a1"), at: new Date(), n: /^a/i, s: 'it\'sé', l: [1, -2.5,], x: null })"#,
        )
        .unwrap() else {
            panic!("not a collection statement");
        };

        assert_eq!(
            method.args[0],
            object(&[
                (
                    "_id",
                    Value::Constructor {
                        name: "ObjectId".to_owned(),
                        args: vec![Value::String("65a1".to_owned())],
                    }
                ),
                (
                    "at",
                    Value::Constructor {
                        name: "Date".to_owned(),
                        args: vec![],
                    }
                ),
                (
                    "n",
                    Value::Regex {
                        pattern: "^a".to_owned(),
                        flags: "i".to_owned(),
                    }
                ),
                ("s", Value::String("it'sé".to_owned())),
                ("l", Value::Array(vec![number("1"), number("-2.5")])),
                ("x", Value::Null),
            ])
        );
    }

    #[test]
    fn rejects_javascript_with_a_position() {
        let error = parse_statement("db.users.find({ a: b })").unwrap_err();
        assert_eq!(error.position, 20);
        assert!(
            error.message.contains("`b` is not a value"),
            "{}",
            error.message
        );

        let error = parse_statement("var x = 1").unwrap_err();
        assert_eq!(error.position, 1);

        let error = parse_statement("db.users.find() db.x.find()").unwrap_err();
        assert_eq!(error.position, 17);

        let error = parse_statement("db.runCommand('ping')").unwrap_err();
        assert!(error.message.contains("command document"));
    }

    #[test]
    fn the_position_counts_characters_and_not_bytes() {
        let error = parse_statement("db.c.find({ n: 'é', x: ? })").unwrap_err();

        assert_eq!(error.position, 24);
    }
}
