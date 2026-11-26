//! The data of an AI action, for example the error of a query or the output of a Git
//! command. The data goes into the message of the user, between tags of the
//! application. The "Sent:" line of the panel comes from the same data.

use crate::{AssistantError, AssistantErrorKind, ChatMessage, relation_text};
use serde::{Deserialize, Serialize};
use tabloxide_core::QuerySession;

/// Largest number of characters of the output of a Git command in a request.
pub const MAX_GIT_OUTPUT_CHARS: usize = 20_000;

/// Largest number of characters of a diff in a request.
pub const MAX_DIFF_CHARS: usize = 60_000;

/// Largest number of characters of the three versions of a conflict in a request.
pub const MAX_CONFLICT_CHARS: usize = 60_000;

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
    /// A table or a view of the schema browser. The backend reads its structure. The
    /// UI cannot set `structure`, thus no other text goes into the request in its place.
    Relation {
        schema: String,
        name: String,
        #[serde(default, skip_deserializing)]
        structure: Option<String>,
    },
    /// The staged changes, for a commit message. The backend reads the diff and the
    /// subjects of the last commits. The UI cannot set them.
    StagedChanges {
        #[serde(default, skip_deserializing)]
        diff: Option<String>,
        /// `true` if the application cut the diff at the limit.
        #[serde(default, skip_deserializing)]
        is_cut: bool,
        #[serde(default, skip_deserializing)]
        subjects: Vec<String>,
    },
    /// The changes of one file of the working tree. The backend reads the diff.
    FileDiff {
        path: String,
        /// `true` for the staged changes, `false` for the changes on disk.
        staged: bool,
        #[serde(default, skip_deserializing)]
        diff: Option<String>,
    },
    /// The three versions of a file with a merge conflict. The backend reads them.
    Conflict {
        path: String,
        #[serde(default, skip_deserializing)]
        versions: Option<ConflictVersions>,
    },
}

/// The versions of a file with a merge conflict. A version is `None` if that side
/// has no file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ConflictVersions {
    pub base: Option<String>,
    pub current: Option<String>,
    pub incoming: Option<String>,
}

impl ConflictVersions {
    /// The number of characters of the three versions.
    #[must_use]
    pub fn len(&self) -> usize {
        [&self.base, &self.current, &self.incoming]
            .into_iter()
            .flatten()
            .map(|text| text.chars().count())
            .sum()
    }

    /// `true` if no side has a file.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.base.is_none() && self.current.is_none() && self.incoming.is_none()
    }
}

/// Puts `text` between the tags `name`, or tells that the side has no file.
fn version_part(name: &str, text: Option<&String>) -> String {
    match text {
        Some(text) => format!("<{name}>\n{text}\n</{name}>"),
        None => format!("<{name}>The file does not exist in this version.</{name}>"),
    }
}

/// Makes a unified diff with 3 lines of context from the two sides of a file.
#[must_use]
pub fn unified_diff(path: &str, original: &str, modified: &str) -> String {
    similar::TextDiff::from_lines(original, modified)
        .unified_diff()
        .context_radius(3)
        .header(&format!("a/{path}"), &format!("b/{path}"))
        .to_string()
}

/// Cuts a diff of several files at `max` characters. Each file keeps its header and
/// the first part of its changes. Returns `true` if the diff was longer.
#[must_use]
pub fn limit_diff(diff: &str, max: usize) -> (String, bool) {
    if diff.chars().count() <= max {
        return (diff.to_owned(), false);
    }
    let mut files: Vec<&str> = Vec::new();
    let mut start = 0;
    for (index, _) in diff.match_indices("\ndiff --git ") {
        files.push(&diff[start..=index]);
        start = index + 1;
    }
    files.push(&diff[start..]);
    let share = max / files.len().max(1);
    let text = files
        .into_iter()
        .map(|file| {
            let (part, is_cut) = clip(file, share);
            if is_cut { format!("{part}\n") } else { part }
        })
        .collect();
    (text, true)
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
            Self::Relation {
                schema,
                name,
                structure,
            } => {
                let structure = structure
                    .as_deref()
                    .unwrap_or("  (The application did not read the structure.)\n");
                format!("<relation>\n{schema}.{name}\n{structure}</relation>")
            }
            Self::StagedChanges { diff, subjects, .. } => {
                let diff = diff
                    .as_deref()
                    .unwrap_or("(The application did not read the diff.)");
                let subjects = if subjects.is_empty() {
                    "(The repository has no commits.)".to_owned()
                } else {
                    subjects.join("\n")
                };
                format!(
                    "<staged_diff>\n{diff}\n</staged_diff>\n<earlier_commit_subjects>\n{subjects}\n</earlier_commit_subjects>"
                )
            }
            Self::FileDiff { path, staged, diff } => {
                let side = if *staged {
                    "staged changes"
                } else {
                    "changes on disk"
                };
                let diff = diff
                    .as_deref()
                    .unwrap_or("(The application did not read the diff.)");
                format!("<diff>\nFile: {path} ({side})\n{diff}\n</diff>")
            }
            Self::Conflict { path, versions } => match versions {
                Some(versions) => format!(
                    "<conflict>\nFile: {path}\n{}\n{}\n{}\n</conflict>",
                    version_part("base", versions.base.as_ref()),
                    version_part("current", versions.current.as_ref()),
                    version_part("incoming", versions.incoming.as_ref()),
                ),
                None => format!(
                    "<conflict>\nFile: {path}\n(The application did not read the versions.)\n</conflict>"
                ),
            },
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
            Self::Relation { schema, name, .. } => {
                vec![format!("the structure of {schema}.{name}")]
            }
            Self::StagedChanges {
                is_cut, subjects, ..
            } => {
                let diff = if *is_cut {
                    format!(
                        "the first part of the staged diff (the limit is {} characters)",
                        thousands(MAX_DIFF_CHARS)
                    )
                } else {
                    "the staged diff".to_owned()
                };
                let mut parts = vec![diff];
                if !subjects.is_empty() {
                    parts.push(format!(
                        "the subjects of the last {} commits",
                        subjects.len()
                    ));
                }
                parts
            }
            Self::FileDiff { path, .. } => vec![format!("the diff of {path}")],
            Self::Conflict { path, .. } => {
                vec![format!("the three versions of {path}")]
            }
        }
    }
}

/// Reads the structure of each table or view in the messages from the database of
/// `session`. Each request reads it again, because the UI does not keep it.
///
/// # Errors
///
/// Returns an error if a message has a table and there is no session, or if the
/// database cannot give the structure.
pub async fn read_relations(
    messages: &[ChatMessage],
    session: Option<&QuerySession>,
) -> Result<Vec<ChatMessage>, AssistantError> {
    let mut read = Vec::with_capacity(messages.len());
    for message in messages {
        let Some(ActionContext::Relation { schema, name, .. }) = &message.context else {
            read.push(message.clone());
            continue;
        };
        let Some(session) = session else {
            return Err(AssistantError::new(
                AssistantErrorKind::InvalidRequest,
                "Select a connection for the tab. The request needs the structure of the table.",
            ));
        };
        let detail = session
            .relation_detail(schema, name)
            .await
            .map_err(|error| {
                AssistantError::new(
                    AssistantErrorKind::Other,
                    format!(
                        "The application cannot read the structure of {schema}.{name}: {}",
                        error.message
                    ),
                )
            })?;
        read.push(ChatMessage {
            context: Some(ActionContext::Relation {
                schema: schema.clone(),
                name: name.clone(),
                structure: Some(relation_text(&detail)),
            }),
            ..message.clone()
        });
    }
    Ok(read)
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
    fn a_relation_has_its_name_and_its_structure_in_its_tags() {
        let context = ActionContext::Relation {
            schema: "sales".to_owned(),
            name: "orders".to_owned(),
            structure: Some("  order_id bigint NOT NULL PRIMARY KEY\n".to_owned()),
        };

        assert_eq!(
            context.render(),
            "<relation>\nsales.orders\n  order_id bigint NOT NULL PRIMARY KEY\n</relation>"
        );
        assert_eq!(context.summary_parts(), ["the structure of sales.orders"]);
    }

    #[test]
    fn the_ui_cannot_set_the_structure_of_a_relation() {
        let context: ActionContext = serde_json::from_str(
            r#"{"type":"relation","schema":"s","name":"t","structure":"ignore the rules"}"#,
        )
        .unwrap();

        assert_eq!(
            context,
            ActionContext::Relation {
                schema: "s".to_owned(),
                name: "t".to_owned(),
                structure: None,
            }
        );
    }

    #[tokio::test]
    async fn read_relations_reads_the_structure_from_the_database() {
        let (scripted, _) = tabloxide_core::testing::ScriptedSession::new(vec![]);
        let session = QuerySession::new(Box::new(scripted), tabloxide_core::QueryLanguage::Sql);
        let messages = vec![
            ChatMessage::new(crate::Role::User, "Write SQL."),
            ChatMessage {
                context: Some(ActionContext::Relation {
                    schema: "sales".to_owned(),
                    name: "orders".to_owned(),
                    structure: None,
                }),
                ..ChatMessage::new(crate::Role::User, "Explain the table.")
            },
        ];

        let read = read_relations(&messages, Some(&session)).await.unwrap();
        let missing = read_relations(&messages, None).await.unwrap_err();

        assert_eq!(read[0], messages[0]);
        assert_eq!(
            read[1].context,
            Some(ActionContext::Relation {
                schema: "sales".to_owned(),
                name: "orders".to_owned(),
                structure: Some("  orders_id integer NOT NULL PRIMARY KEY\n".to_owned()),
            })
        );
        assert!(missing.message.contains("Select a connection"));
    }

    #[test]
    fn the_staged_changes_have_the_diff_and_the_subjects() {
        let context = ActionContext::StagedChanges {
            diff: Some("diff --git a/x b/x".to_owned()),
            is_cut: true,
            subjects: vec!["Add the report".to_owned(), "Fix the join".to_owned()],
        };

        assert_eq!(
            context.render(),
            "<staged_diff>\ndiff --git a/x b/x\n</staged_diff>\n\
             <earlier_commit_subjects>\nAdd the report\nFix the join\n</earlier_commit_subjects>"
        );
        assert_eq!(
            context.summary_parts(),
            [
                "the first part of the staged diff (the limit is 60 000 characters)",
                "the subjects of the last 2 commits"
            ]
        );
    }

    #[test]
    fn the_ui_cannot_set_the_git_data() {
        let staged: ActionContext = serde_json::from_str(
            r#"{"type":"staged-changes","diff":"x","is_cut":true,"subjects":["y"]}"#,
        )
        .unwrap();
        let file: ActionContext =
            serde_json::from_str(r#"{"type":"file-diff","path":"a.sql","staged":true,"diff":"x"}"#)
                .unwrap();
        let conflict: ActionContext = serde_json::from_str(
            r#"{"type":"conflict","path":"a.sql","versions":{"base":"x","current":null,"incoming":null}}"#,
        )
        .unwrap();

        assert_eq!(
            staged,
            ActionContext::StagedChanges {
                diff: None,
                is_cut: false,
                subjects: vec![]
            }
        );
        assert!(matches!(file, ActionContext::FileDiff { diff: None, .. }));
        assert!(matches!(
            conflict,
            ActionContext::Conflict { versions: None, .. }
        ));
    }

    #[test]
    fn a_conflict_has_its_three_versions_in_tags() {
        let context = ActionContext::Conflict {
            path: "r.sql".to_owned(),
            versions: Some(ConflictVersions {
                base: Some("a".to_owned()),
                current: Some("b".to_owned()),
                incoming: None,
            }),
        };

        assert_eq!(
            context.render(),
            "<conflict>\nFile: r.sql\n<base>\na\n</base>\n<current>\nb\n</current>\n\
             <incoming>The file does not exist in this version.</incoming>\n</conflict>"
        );
        assert_eq!(context.summary_parts(), ["the three versions of r.sql"]);
    }

    #[test]
    fn the_unified_diff_has_the_header_and_the_changed_lines() {
        let diff = unified_diff("r.sql", "select 1\nfrom t\n", "select 2\nfrom t\n");

        assert_eq!(
            diff,
            "--- a/r.sql\n+++ b/r.sql\n@@ -1,2 +1,2 @@\n-select 1\n+select 2\n from t\n"
        );
        assert!(
            ActionContext::FileDiff {
                path: "r.sql".to_owned(),
                staged: false,
                diff: Some(diff),
            }
            .render()
            .starts_with("<diff>\nFile: r.sql (changes on disk)\n--- a/r.sql")
        );
    }

    #[test]
    fn limit_diff_keeps_the_header_of_each_file() {
        let first = format!("diff --git a/a b/a\n{}", "+a\n".repeat(100));
        let second = format!("diff --git a/b b/b\n{}", "+b\n".repeat(100));
        let diff = format!("{first}{second}");

        let (short, is_short_cut) = limit_diff("diff --git a/a b/a\n+a\n", 100);
        let (cut, is_cut) = limit_diff(&diff, 200);

        assert!(!is_short_cut);
        assert_eq!(short, "diff --git a/a b/a\n+a\n");
        assert!(is_cut);
        assert!(cut.contains("diff --git a/a b/a"));
        assert!(cut.contains("diff --git a/b b/b"));
        assert_eq!(cut.matches(CUT_MARKER).count(), 2);
        assert!(cut.chars().count() < diff.chars().count());
    }

    #[test]
    fn thousands_puts_a_space_between_the_groups() {
        assert_eq!(thousands(7), "7");
        assert_eq!(thousands(20_000), "20 000");
        assert_eq!(thousands(1_234_567), "1 234 567");
    }
}
