//! SQL text functions that do not need a database: the lexer, the statement splitter,
//! the statement classifier, and the position conversions.

mod classify;
mod lexer;
mod splitter;
mod text;

pub use classify::{can_contain_password, is_pageable};
pub use splitter::{Span, split_statements, statement_at};
pub use text::{Location, byte_to_utf16, char_to_byte, locate, utf16_to_byte};
