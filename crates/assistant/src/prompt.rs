//! The request text for the AI service.

use tabloxide_core::QueryLanguage;

use crate::{
    AssistantError, AssistantErrorKind, ChatMessage, ChatRequest, Effort, Role, SchemaContext,
    SystemPart, Task,
};

/// Largest number of characters in the messages of one conversation.
/// A longer conversation gets an error. The application does not cut text silently.
pub const MAX_CONVERSATION_CHARS: usize = 400_000;

/// The database that the user works with.
#[derive(Debug, Clone, Copy)]
pub struct Database<'a> {
    /// Name of the database engine, for example `PostgreSQL`.
    pub engine: &'a str,
    /// Version text of the server.
    pub version: &'a str,
    pub language: QueryLanguage,
    pub schema: &'a SchemaContext,
}

/// The rules for the MongoDB syntax of Tabloxide. The application runs no JavaScript,
/// so the assistant must not write it.
const MONGODB_SHELL_NOTE: &str = "\n\nQuery language: the MongoDB shell syntax of \
Tabloxide, not SQL. Write one statement per line: `db.<collection>.<method>(…)` with \
chained calls such as `.sort()` and `.limit()`, `db.getCollection(\"name\")`, \
`use <database>`, `show collections`, or a command document `{ \"count\": \"users\" }`. \
Values are JSON with ObjectId(), ISODate(), NumberLong(), NumberDecimal(), and UUID(). \
The application runs no JavaScript: do not use variables, functions, loops, or `let`. \
In the schema, a schema is a database and a table is a collection. Use a code block \
with the language `javascript`.";

const INSTRUCTIONS: &str = "\
You are the SQL assistant of Tabloxide, a desktop SQL client. The user is a developer \
who writes SQL for the database that this prompt describes.

How the application uses your answer:
- The user reads the answer in a narrow side panel. Give the result first. Keep the \
explanation short.
- Put each SQL statement that the user can run in a fenced code block with the \
language `sql`. The panel gives each block an Insert button, which copies the block \
into the SQL editor. The application never runs your SQL. The user reads it and runs it.
- Outside of code blocks, write plain text. The panel does not render Markdown \
headings, tables, or bold text.
- Write SQL in the dialect of the database engine of the user.
- Use only the tables and the columns of the schema below. If the request needs an \
object that the schema does not have, say that, and do not invent a name.
- For a statement that changes or removes data or structure, say in one sentence what \
it changes. Mention a table lock or a table rewrite when that is important for a \
large table.

Execution plans:
- When the user sends an execution plan, name the steps that cost the most, give the \
cause, and suggest specific improvements: an index as a complete CREATE INDEX \
statement, a changed query, or new statistics. Put the improvement with the largest \
expected effect first.
- A plan from EXPLAIN without ANALYZE has estimates only. Say so when a conclusion \
needs measured times.
- You get the structure of the database only. You do not get its rows, the number of \
rows, or the distribution of values, unless the plan shows them.";

const NO_DATABASE: &str = "\
The user has no open database connection. Thus you have no schema. Write standard SQL, \
and tell the user which table and column names you assumed.";

fn database_part(database: &Database<'_>) -> String {
    let total = database.schema.relation_count();
    let detailed = database.schema.detailed_count();
    let limit_note = if detailed < total {
        format!(
            "\nThe schema is large. This prompt has the columns of {detailed} of {total} \
             tables and views. For the others it has the name only. Ask the user for the \
             columns of such a table when you need them."
        )
    } else {
        String::new()
    };
    let language_note = match database.language {
        QueryLanguage::MongodbShell => MONGODB_SHELL_NOTE,
        QueryLanguage::Sql | QueryLanguage::Unknown => "",
    };
    format!(
        "Database engine: {} {}{limit_note}{language_note}\n\n<schema>\n{}</schema>",
        database.engine,
        database.version,
        database.schema.render()
    )
}

fn invalid(message: &str) -> AssistantError {
    AssistantError::new(AssistantErrorKind::InvalidRequest, message)
}

fn check_messages(messages: &[ChatMessage]) -> Result<(), AssistantError> {
    let (Some(first), Some(last)) = (messages.first(), messages.last()) else {
        return Err(invalid("Enter a request."));
    };
    if first.role != Role::User || last.role != Role::User {
        return Err(invalid(
            "The conversation must start and end with a message of the user.",
        ));
    }
    if messages
        .iter()
        .any(|message| message.text.trim().is_empty())
    {
        return Err(invalid("Enter a request."));
    }
    let length: usize = messages.iter().map(|m| m.text.chars().count()).sum();
    if length > MAX_CONVERSATION_CHARS {
        return Err(invalid(
            "The conversation is too long for one request. Start a new conversation.",
        ));
    }
    Ok(())
}

/// Makes the request for the AI service from the conversation and the database.
///
/// The request has the instructions, the structure of the database, and the messages.
/// It has nothing else.
///
/// # Errors
///
/// Returns an error if the conversation is empty, if it does not end with a message
/// of the user, or if it is too long.
pub fn chat_request(
    model: &str,
    task: Task,
    database: Option<&Database<'_>>,
    messages: &[ChatMessage],
) -> Result<ChatRequest, AssistantError> {
    check_messages(messages)?;
    let context = database.map_or_else(|| NO_DATABASE.to_owned(), database_part);
    Ok(ChatRequest {
        model: model.to_owned(),
        effort: match task {
            Task::Sql => Effort::Medium,
            Task::Plan => Effort::High,
        },
        // The instructions are the same for each request, and the schema is the same
        // for each request on one database. Thus the service can keep the two parts.
        system: vec![
            SystemPart {
                text: INSTRUCTIONS.to_owned(),
                is_cache_end: false,
            },
            SystemPart {
                text: context,
                is_cache_end: true,
            },
        ],
        messages: messages.to_vec(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{RelationContext, SchemaGroup};
    use tabloxide_core::RelationKind;

    fn user(text: &str) -> ChatMessage {
        ChatMessage {
            role: Role::User,
            text: text.to_owned(),
        }
    }

    fn assistant(text: &str) -> ChatMessage {
        ChatMessage {
            role: Role::Assistant,
            text: text.to_owned(),
        }
    }

    fn schema(detailed: bool) -> SchemaContext {
        SchemaContext {
            schemas: vec![SchemaGroup {
                name: "public".to_owned(),
                relations: vec![RelationContext {
                    name: "item".to_owned(),
                    kind: RelationKind::Table,
                    detail: detailed.then(Default::default),
                }],
            }],
        }
    }

    #[test]
    fn the_request_has_the_engine_and_the_schema_in_the_last_system_part() {
        let schema = schema(true);
        let database = Database {
            engine: "PostgreSQL",
            version: "17.2",
            language: QueryLanguage::Sql,
            schema: &schema,
        };

        let request = chat_request(
            "claude-opus-5-5",
            Task::Sql,
            Some(&database),
            &[user("List the items.")],
        )
        .unwrap();

        assert_eq!(request.model, "claude-opus-5-5");
        assert_eq!(request.effort, Effort::Medium);
        assert_eq!(request.system.len(), 2);
        assert!(!request.system[0].is_cache_end);
        assert!(request.system[1].is_cache_end);
        assert!(
            request.system[1]
                .text
                .starts_with("Database engine: PostgreSQL 17.2\n\n<schema>\ntable public.item\n")
        );
        assert!(!request.system[1].text.contains("The schema is large"));
        assert_eq!(request.messages, vec![user("List the items.")]);
    }

    #[test]
    fn the_request_says_when_the_schema_is_not_complete() {
        let schema = schema(false);
        let database = Database {
            engine: "DuckDB",
            version: "1.3",
            language: QueryLanguage::Sql,
            schema: &schema,
        };

        let request = chat_request("m", Task::Sql, Some(&database), &[user("x")]).unwrap();

        assert!(
            request.system[1]
                .text
                .contains("has the columns of 0 of 1 tables and views")
        );
    }

    #[test]
    fn a_request_without_a_database_says_that_there_is_no_schema() {
        let request = chat_request("m", Task::Sql, None, &[user("x")]).unwrap();

        assert!(
            request.system[1]
                .text
                .contains("no open database connection")
        );
    }

    #[test]
    fn a_plan_analysis_uses_more_effort() {
        let request = chat_request("m", Task::Plan, None, &[user("plan")]).unwrap();

        assert_eq!(request.effort, Effort::High);
    }

    #[test]
    fn rejects_a_conversation_that_is_empty_or_does_not_end_with_the_user() {
        for messages in [
            vec![],
            vec![user("  ")],
            vec![user("a"), assistant("b")],
            vec![assistant("a"), user("b")],
        ] {
            let error = chat_request("m", Task::Sql, None, &messages).unwrap_err();

            assert_eq!(error.kind, AssistantErrorKind::InvalidRequest);
        }
    }

    #[test]
    fn rejects_a_conversation_that_is_too_long() {
        let long = "x".repeat(MAX_CONVERSATION_CHARS + 1);

        let error = chat_request("m", Task::Sql, None, &[user(&long)]).unwrap_err();

        assert!(error.message.contains("too long"));
    }
}
