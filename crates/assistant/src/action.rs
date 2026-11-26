//! The data of an AI action, for example the error of a query or the output of a Git
//! command. The data goes into the message of the user, between tags of the
//! application. The "Sent:" line of the panel comes from the same data.

use serde::{Deserialize, Serialize};

/// Largest number of characters of the output of a Git command in a request.
pub const MAX_GIT_OUTPUT_CHARS: usize = 20_000;

/// The text at the place where the application cut a long text.
const CUT_MARKER: &str = "[The application removed the rest of this text here.]";

/// The data of an AI action. The UI sends it with the message of the user.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum ActionContext {
    /// A statement that failed, and the error of the database.
    QueryError {
        statement: String,
        message: String,
        /// More text of the database about the error.
        detail: Option<String>,
        /// The position of the error in the statement: the number of the character,
        /// from 1.
        position: Option<u32>,
        /// The hint of the database.
        hint: Option<String>,
        /// The error code of the database, for example the SQLSTATE code.
        code: Option<String>,
    },
    /// The text that the user selected in the editor.
    Selection { text: String },
    /// A command of the Git console and its output.
    GitOutput { command: String, output: String },
}

/// Returns `text` with a maximum of `max` characters, and `true` if the text was longer.
fn clip(text: &str, max: usize) -> (String, bool) {
    match text.char_indices().nth(max) {
        Some((end, _)) => (format!("{}\n{CUT_MARKER}", &text[..end]), true),
        None => (text.to_owned(), false),
    }
}

impl ActionContext {
    /// Makes the text that goes to the AI service.
    #[must_use]
    pub fn render(&self) -> String {
        match self {
            Self::QueryError {
                statement,
                message,
                detail,
                position,
                hint,
                code,
            } => {
                let mut lines = vec![
                    "<query_error>".to_owned(),
                    "Statement:".to_owned(),
                    statement.clone(),
                    format!("Error message: {message}"),
                ];
                if let Some(detail) = detail {
                    lines.push(format!("Detail: {detail}"));
                }
                if let Some(position) = position {
                    lines.push(format!("Position: character {position} of the statement"));
                }
                if let Some(hint) = hint {
                    lines.push(format!("Hint of the database: {hint}"));
                }
                if let Some(code) = code {
                    lines.push(format!("Error code: {code}"));
                }
                lines.push("</query_error>".to_owned());
                lines.join("\n")
            }
            Self::Selection { text } => format!("<selection>\n{text}\n</selection>"),
            Self::GitOutput { command, output } => {
                let (output, _) = clip(output, MAX_GIT_OUTPUT_CHARS);
                format!("<git_output>\nCommand: git {command}\nOutput:\n{output}\n</git_output>")
            }
        }
    }

    /// The parts of the data for the "Sent:" line, for example "the error message".
    #[must_use]
    pub fn summary_parts(&self) -> Vec<String> {
        match self {
            Self::QueryError { .. } => {
                vec!["the statement".to_owned(), "the error message".to_owned()]
            }
            Self::Selection { .. } => vec!["the selected text".to_owned()],
            Self::GitOutput { output, .. } => {
                let (_, is_cut) = clip(output, MAX_GIT_OUTPUT_CHARS);
                let output = if is_cut {
                    format!(
                        "the first {} characters of its output",
                        thousands(MAX_GIT_OUTPUT_CHARS)
                    )
                } else {
                    "its output".to_owned()
                };
                vec!["the Git command".to_owned(), output]
            }
        }
    }
}

/// Writes `value` with a space between each group of three digits, for example `20 000`.
fn thousands(value: usize) -> String {
    let digits = value.to_string();
    let mut text = String::new();
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index).is_multiple_of(3) {
            text.push(' ');
        }
        text.push(digit);
    }
    text
}

/// The structure of the database that a request sends.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SchemaCount {
    /// The number of tables and views.
    pub relations: usize,
    /// The number of tables and views with their columns.
    pub detailed: usize,
}

/// Joins the parts as a list in a sentence: "a", "a and b", or "a, b, and c".
fn join_parts(parts: &[String]) -> String {
    match parts {
        [] => String::new(),
        [one] => one.clone(),
        [first, second] => format!("{first} and {second}"),
        [rest @ .., last] => format!("{}, and {last}", rest.join(", ")),
    }
}

/// Makes the "Sent:" line of a request, for example "Sent: your request, the
/// statement, the error message, and the structure of 12 tables and views."
///
/// `has_earlier_messages` is `true` if the conversation has messages before the request.
#[must_use]
pub fn sent_summary(
    has_earlier_messages: bool,
    context: Option<&ActionContext>,
    schema: Option<SchemaCount>,
) -> String {
    let mut parts = vec!["your request".to_owned()];
    if has_earlier_messages {
        parts.push("the earlier messages of the session".to_owned());
    }
    if let Some(context) = context {
        parts.extend(context.summary_parts());
    }
    if let Some(schema) = schema {
        parts.push(if schema.detailed < schema.relations {
            format!(
                "the names of {} tables and views, with the columns of {}",
                schema.relations, schema.detailed
            )
        } else {
            format!("the structure of {} tables and views", schema.relations)
        });
    }
    format!("Sent: {}.", join_parts(&parts))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn query_error() -> ActionContext {
        ActionContext::QueryError {
            statement: "select o.totl from orders o".to_owned(),
            message: "column o.totl does not exist".to_owned(),
            detail: Some("The table orders has no such column.".to_owned()),
            position: Some(8),
            hint: Some("Perhaps you meant to reference the column \"o.total\".".to_owned()),
            code: Some("42703".to_owned()),
        }
    }

    #[test]
    fn a_query_error_has_the_statement_the_message_and_each_detail_in_its_tags() {
        let text = query_error().render();

        assert_eq!(
            text,
            "<query_error>\nStatement:\nselect o.totl from orders o\n\
             Error message: column o.totl does not exist\n\
             Detail: The table orders has no such column.\n\
             Position: character 8 of the statement\n\
             Hint of the database: Perhaps you meant to reference the column \"o.total\".\n\
             Error code: 42703\n</query_error>"
        );
    }

    #[test]
    fn a_query_error_without_details_has_no_empty_lines() {
        let context = ActionContext::QueryError {
            statement: "x".to_owned(),
            message: "syntax error".to_owned(),
            detail: None,
            position: None,
            hint: None,
            code: None,
        };

        assert_eq!(
            context.render(),
            "<query_error>\nStatement:\nx\nError message: syntax error\n</query_error>"
        );
    }

    #[test]
    fn a_selection_is_in_its_tags() {
        let context = ActionContext::Selection {
            text: "select 1".to_owned(),
        };

        assert_eq!(context.render(), "<selection>\nselect 1\n</selection>");
        assert_eq!(context.summary_parts(), ["the selected text"]);
    }

    #[test]
    fn a_long_git_output_gets_a_cut_and_the_summary_tells_it() {
        let short = ActionContext::GitOutput {
            command: "status".to_owned(),
            output: "nothing to commit".to_owned(),
        };
        let long = ActionContext::GitOutput {
            command: "log".to_owned(),
            output: "é".repeat(MAX_GIT_OUTPUT_CHARS + 5),
        };

        assert!(
            short
                .render()
                .contains("Command: git status\nOutput:\nnothing to commit\n")
        );
        assert_eq!(short.summary_parts(), ["the Git command", "its output"]);
        let text = long.render();
        assert_eq!(text.matches('é').count(), MAX_GIT_OUTPUT_CHARS);
        assert!(text.contains(CUT_MARKER));
        assert_eq!(
            long.summary_parts(),
            [
                "the Git command",
                "the first 20 000 characters of its output"
            ]
        );
    }

    #[test]
    fn the_summary_names_each_part_of_the_request() {
        assert_eq!(sent_summary(false, None, None), "Sent: your request.");
        assert_eq!(
            sent_summary(
                false,
                Some(&query_error()),
                Some(SchemaCount {
                    relations: 12,
                    detailed: 12
                })
            ),
            "Sent: your request, the statement, the error message, and the structure \
             of 12 tables and views."
        );
        assert_eq!(
            sent_summary(
                true,
                None,
                Some(SchemaCount {
                    relations: 250,
                    detailed: 200
                })
            ),
            "Sent: your request, the earlier messages of the session, and the names of \
             250 tables and views, with the columns of 200."
        );
    }

    #[test]
    fn the_text_form_has_the_type_of_the_context() {
        let json = serde_json::to_string(&ActionContext::Selection {
            text: "a".to_owned(),
        })
        .unwrap();

        assert_eq!(json, r#"{"type":"selection","text":"a"}"#);
    }

    #[test]
    fn thousands_puts_a_space_between_the_groups() {
        assert_eq!(thousands(7), "7");
        assert_eq!(thousands(20_000), "20 000");
        assert_eq!(thousands(1_234_567), "1 234 567");
    }
}
