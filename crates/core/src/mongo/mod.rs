//! The MongoDB shell syntax that Tabloxide accepts: the lexer, the parser, the
//! statement splitter, and the risk check. Tabloxide runs no JavaScript.
//!
//! The guardrails and the MongoDB connector use the same parser. Thus the check reads
//! the same statement that the connector runs.

mod classify;
mod lexer;
mod parse;
mod split;

pub use classify::{can_contain_password, classify_risk, is_pageable};
pub use lexer::{Token, TokenKind, tokenize};
pub use parse::{Call, ParseError, ShowTarget, Statement, Value, parse_statement};
pub use split::split_statements;
