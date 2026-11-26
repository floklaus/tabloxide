//! Commands of the AI assistant.

use crate::commands::assistant_git::read_git_data;
use crate::commands::assistant_models::clear_model_cache;
use crate::commands::workspace::state_dir;
use crate::error::CommandError;
use crate::state::{AppState, SessionEntry, SessionId, blocking};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::sync::{Arc, Mutex, PoisonError};
use tabloxide_assistant::{
    AssistantError, AssistantErrorKind, ChatMessage, ChatOutcome, ChatProvider, Database,
    ExplainRejection, MAX_DETAILED_RELATIONS, SchemaContext, SchemaCount, Task, TextSink,
    chat_request, check_rows, collect_schema, explain_statement, plan_statement, plan_text,
    read_relations, sent_summary,
};
use tabloxide_core::{Environment, QueryError, QueryLanguage, QuerySession, Secret};
use tabloxide_workspace::AssistantPreferences;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tokio::sync::Notify;

/// The name of the API key in the credential store of the operating system.
pub(crate) const KEY_ENTRY: &str = "assistant:anthropic";

/// Largest number of rows that the application reads from a plan.
const MAX_PLAN_ROWS: usize = 5000;

/// Identifier that the UI gives to one request. `assistant_cancel` uses it.
pub type AskId = u32;

#[derive(Debug, Clone, Copy, Serialize, Type)]
pub struct AssistantStatus {
    /// `true` if the credential store has an API key.
    pub has_key: bool,
}

/// A request of the user to the assistant.
#[derive(Debug, Clone, Deserialize, Type)]
pub struct AskRequest {
    pub id: AskId,
    /// The session of the editor tab. The request gets the schema of its database.
    pub session_id: Option<SessionId>,
    pub task: Task,
    /// The conversation. The last message is the new request of the user.
    pub messages: Vec<ChatMessage>,
    /// `true` reads the schema again. `false` uses the schema of the last request.
    pub refresh_schema: bool,
}

/// A message from a request to the UI while the request is in progress.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum AssistantEvent {
    /// The application reads the schema from the database.
    ReadingSchema,
    /// The schema that goes to the AI service: the number of tables and views, and
    /// the number of those for which the request has the columns.
    Schema { relations: u32, detailed: u32 },
    /// What the request sends to the AI service, for example "Sent: your request and
    /// the structure of 12 tables and views." It comes before the answer text.
    Sent { summary: String },
    /// The next part of the answer text.
    Text { text: String },
}

/// Result of a request. A failure of the AI service is a normal result, not a command error.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum AskResult {
    /// `text` is the complete answer. The UI uses it in place of the parts that it
    /// collected, because the last parts can arrive after this result.
    Done {
        outcome: ChatOutcome,
        text: String,
    },
    Failed {
        error: AssistantError,
    },
    /// The user stopped the request. `text` is the part of the answer that came.
    Cancelled {
        text: String,
    },
}

/// Result of a plan read. A statement that fails is a normal result, not a command error.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum ExplainResult {
    Plan {
        /// The statement that the database ran.
        statement: String,
        plan: String,
        /// `true` if the plan has more rows than the application reads.
        is_truncated: bool,
    },
    Rejected {
        reason: ExplainRejection,
        message: String,
    },
    Failed {
        error: QueryError,
    },
}

/// Tells if the application has an API key for the AI service.
#[tauri::command]
#[specta::specta]
pub async fn assistant_status(state: State<'_, AppState>) -> Result<AssistantStatus, CommandError> {
    let secrets = state.secrets();
    let key = blocking(move || Ok(secrets.get_entry(KEY_ENTRY)?)).await?;
    Ok(AssistantStatus {
        has_key: key.is_some(),
    })
}

/// Stores the API key in the credential store of the operating system. It also
/// removes the stored model list, because a different key can have different models.
#[tauri::command]
#[specta::specta]
pub async fn assistant_key_set(
    app: AppHandle,
    state: State<'_, AppState>,
    key: String,
) -> Result<(), CommandError> {
    let key = Secret::new(key.trim());
    if key.expose().is_empty() {
        return Err(CommandError::internal("Enter an API key."));
    }
    let secrets = state.secrets();
    blocking(move || Ok(secrets.set_entry(KEY_ENTRY, &key)?)).await?;
    clear_model_cache(&app, &state).await
}

/// Removes the API key from the credential store, and the stored model list.
#[tauri::command]
#[specta::specta]
pub async fn assistant_key_delete(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    let secrets = state.secrets();
    blocking(move || Ok(secrets.delete_entry(KEY_ENTRY)?)).await?;
    clear_model_cache(&app, &state).await
}

fn count(value: usize) -> u32 {
    u32::try_from(value).unwrap_or(u32::MAX)
}

/// Returns the schema of the database of a session. The first request of a session
/// reads it from the database. The next requests use the same schema, until
/// `refresh` is `true`.
async fn schema_of(
    state: &AppState,
    session_id: SessionId,
    entry: &SessionEntry,
    refresh: bool,
    on_event: &Channel<AssistantEvent>,
) -> Result<Arc<SchemaContext>, AssistantError> {
    if !refresh && let Some(schema) = state.assistant_schema(session_id) {
        return Ok(schema);
    }
    let _ = on_event.send(AssistantEvent::ReadingSchema);
    let schema = collect_schema(&entry.session, MAX_DETAILED_RELATIONS)
        .await
        .map_err(|error| {
            AssistantError::new(
                AssistantErrorKind::Other,
                format!("The application cannot read the schema: {}", error.message),
            )
        })?;
    let schema = Arc::new(schema);
    state.set_assistant_schema(session_id, Arc::clone(&schema));
    Ok(schema)
}

/// Returns the environment of the connection of a session, from the workspace.
/// Returns `None` if the session or its connection is not known.
fn environment_of(state: &AppState, session_id: SessionId) -> Option<Environment> {
    let entry = state.session_entry(session_id).ok()?;
    let workspace = state.workspace().ok()?;
    workspace
        .connections()
        .iter()
        .find(|profile| profile.id == entry.connection_id)
        .map(|profile| profile.environment)
}

/// Makes the "Sent:" line of a request.
fn summary_of(request: &AskRequest, database: Option<&Database<'_>>) -> String {
    let schema = database.map(|database| SchemaCount {
        relations: database.schema.relation_count(),
        detailed: database.schema.detailed_count(),
        sampled: database.schema.sampled_count(),
    });
    let context = request
        .messages
        .last()
        .and_then(|message| message.context.as_ref());
    sent_summary(request.messages.len() > 1, context, schema)
}

/// The data of one request to the AI service.
struct Ask<'a> {
    provider: &'a dyn ChatProvider,
    model: &'a str,
    task: Task,
    database: Option<&'a Database<'a>>,
    messages: &'a [ChatMessage],
    api_key: &'a Secret,
}

impl Ask<'_> {
    /// Sends the conversation to the AI service.
    async fn send(&self, on_text: &mut TextSink<'_>) -> Result<ChatOutcome, AssistantError> {
        let request = chat_request(self.model, self.task, self.database, self.messages)?;
        self.provider.stream(&request, self.api_key, on_text).await
    }

    /// Sends the conversation and collects the answer text. A notification on `cancel`
    /// stops the request, and the result has the text that came before the stop.
    async fn send_with_cancel(
        &self,
        cancel: &Notify,
        on_part: &(dyn Fn(&str) + Send + Sync),
    ) -> AskResult {
        let collected = Mutex::new(String::new());
        let lock = || collected.lock().unwrap_or_else(PoisonError::into_inner);
        let mut on_text = |text: &str| {
            lock().push_str(text);
            on_part(text);
        };
        // A cancel that came before this point is not lost. `Notify` keeps it.
        let result = tokio::select! {
            result = self.send(&mut on_text) => Some(result),
            () = cancel.notified() => None,
        };
        let text = std::mem::take(&mut *lock());
        match result {
            Some(Ok(outcome)) => AskResult::Done { outcome, text },
            Some(Err(error)) => AskResult::Failed { error },
            None => AskResult::Cancelled { text },
        }
    }
}

/// Reads the schema, then sends the conversation. A notification on `cancel` stops
/// the request to the AI service.
///
/// The schema read is not in the cancel. A database request that stops in the middle
/// can leave the session in a state that the next statement does not expect.
async fn answer(
    state: &AppState,
    request: &AskRequest,
    preferences: &AssistantPreferences,
    api_key: &Secret,
    cancel: &Notify,
    on_event: &Channel<AssistantEvent>,
) -> Result<AskResult, CommandError> {
    let model = preferences.model.id();
    // A task without the structure of the database does not read it.
    let session_id = request.session_id.filter(|_| request.task.uses_schema());
    // Rows go only from a connection that is not production, and only up to the
    // number of the preferences. The check uses the workspace at this time, so that a
    // connection that changed to production after the connect also refuses rows.
    let environment = session_id.and_then(|id| environment_of(state, id));
    if let Err(error) = check_rows(&request.messages, environment, preferences.rows_for_ai) {
        return Ok(AskResult::Failed { error });
    }
    let session = match session_id {
        Some(id) => {
            let entry = state.session_entry(id)?;
            match schema_of(state, id, &entry, request.refresh_schema, on_event).await {
                Ok(schema) => Some((entry, schema)),
                Err(error) => return Ok(AskResult::Failed { error }),
            }
        }
        None => None,
    };
    let database = session.as_ref().map(|(entry, schema)| Database {
        engine: &entry.info.display_name,
        version: &entry.session.server_info().version,
        language: entry.info.language,
        schema,
    });
    if let Some(database) = &database {
        let _ = on_event.send(AssistantEvent::Schema {
            relations: count(database.schema.relation_count()),
            detailed: count(database.schema.detailed_count()),
        });
    }
    // A table of the schema browser gets its structure from the database here. The
    // UI cannot send it.
    let entry = session.as_ref().map(|(entry, _)| entry.session.as_ref());
    let messages = match read_relations(&request.messages, entry).await {
        Ok(messages) => messages,
        Err(error) => return Ok(AskResult::Failed { error }),
    };
    // The Git data comes from the repository of the workspace. The UI cannot send it.
    let messages = match read_git_data(state, messages).await? {
        Ok(messages) => messages,
        Err(error) => return Ok(AskResult::Failed { error }),
    };
    let _ = on_event.send(AssistantEvent::Sent {
        summary: summary_of(request, database.as_ref()),
    });
    let on_part = |text: &str| {
        // The UI is gone when the send fails. Then no one needs the text.
        let _ = on_event.send(AssistantEvent::Text {
            text: text.to_owned(),
        });
    };
    let provider = state.assistant();
    let ask = Ask {
        provider: provider.as_ref(),
        model,
        task: request.task,
        database: database.as_ref(),
        messages: &messages,
        api_key,
    };
    Ok(ask.send_with_cancel(cancel, &on_part).await)
}

/// Sends a conversation to the AI service. The answer text comes on `on_event`.
///
/// The request has the instructions of the application, the structure of the database
/// of the session, and the messages. It has no rows and no connection settings.
#[tauri::command]
#[specta::specta]
pub async fn assistant_ask(
    app: AppHandle,
    state: State<'_, AppState>,
    request: AskRequest,
    on_event: Channel<AssistantEvent>,
) -> Result<AskResult, CommandError> {
    // The request is in the list before the first wait. Thus an early stop finds it.
    let cancel = state.start_ask(request.id);
    let result = prepare_and_answer(&app, &state, &request, &cancel, &on_event).await;
    state.end_ask(request.id);
    result
}

async fn prepare_and_answer(
    app: &AppHandle,
    state: &AppState,
    request: &AskRequest,
    cancel: &Notify,
    on_event: &Channel<AssistantEvent>,
) -> Result<AskResult, CommandError> {
    let secrets = state.secrets();
    let Some(api_key) = blocking(move || Ok(secrets.get_entry(KEY_ENTRY)?)).await? else {
        return Ok(AskResult::Failed {
            error: AssistantError::missing_key(),
        });
    };
    let local = state.local(&state_dir(app)?)?;
    let preferences = blocking(move || Ok(local.load_preferences()?)).await?;
    answer(
        state,
        request,
        &preferences.assistant,
        &api_key,
        cancel,
        on_event,
    )
    .await
}

/// Stops a request that is in progress. The request then returns `cancelled`.
#[tauri::command]
#[specta::specta]
pub fn assistant_cancel(state: State<'_, AppState>, id: AskId) {
    state.cancel_ask(id);
}

/// Reads the plan of the one statement in `sql`.
/// Reads the plan of a connector engine with `read_plan`. The check of the statement
/// comes from its language.
async fn read_connector_plan(entry: &SessionEntry, text: &str, measure: bool) -> ExplainResult {
    if !entry.info.capabilities.explain_plan {
        let reason = ExplainRejection::NoPlan;
        return ExplainResult::Rejected {
            reason,
            message: reason.to_string(),
        };
    }
    let statement = match plan_statement(entry.info.language, text, measure) {
        Ok(statement) => statement,
        Err(reason) => {
            return ExplainResult::Rejected {
                reason,
                message: reason.to_string(),
            };
        }
    };
    match entry.session.read_plan(&statement, measure).await {
        Ok(plan) => ExplainResult::Plan {
            statement: plan.statement,
            plan: plan.text,
            is_truncated: false,
        },
        Err(error) => ExplainResult::Failed { error },
    }
}

async fn read_plan(session: &QuerySession, sql: &str, analyze: bool) -> ExplainResult {
    let statement = match explain_statement(sql, analyze) {
        Ok(statement) => statement,
        Err(reason) => {
            return ExplainResult::Rejected {
                reason,
                message: reason.to_string(),
            };
        }
    };
    match session.read_rows(&statement, MAX_PLAN_ROWS).await {
        Ok(rows) => ExplainResult::Plan {
            plan: plan_text(&rows),
            is_truncated: rows.len() >= MAX_PLAN_ROWS,
            statement,
        },
        Err(error) => ExplainResult::Failed { error },
    }
}

/// Reads the execution plan of the one statement in `sql`.
///
/// Without `analyze`, the database does not run the statement. With `analyze`, the
/// database runs it. Thus `analyze` is permitted only for a statement that reads data.
/// The query history does not record the plan read. This closes the open result.
#[tauri::command]
#[specta::specta]
pub async fn assistant_explain(
    state: State<'_, AppState>,
    session_id: SessionId,
    sql: String,
    analyze: bool,
) -> Result<ExplainResult, CommandError> {
    let entry = state.session_entry(session_id)?;
    // The SQL engines read the plan with EXPLAIN. A different engine gives its plan
    // through its connector.
    if entry.info.language == QueryLanguage::Sql {
        Ok(read_plan(&entry.session, &sql, analyze).await)
    } else {
        Ok(read_connector_plan(&entry, &sql, analyze).await)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use std::sync::Mutex;
    use tabloxide_assistant::{ChatRequest, Role, StopKind};
    use tabloxide_core::testing::{Scripted, ScriptedSession};

    /// A provider that records the request and answers with two text parts.
    #[derive(Default)]
    struct FakeProvider {
        requests: Mutex<Vec<ChatRequest>>,
        fails: bool,
    }

    #[async_trait]
    impl ChatProvider for FakeProvider {
        async fn stream(
            &self,
            request: &ChatRequest,
            _api_key: &Secret,
            on_text: &mut TextSink<'_>,
        ) -> Result<ChatOutcome, AssistantError> {
            self.requests.lock().unwrap().push(request.clone());
            on_text("SELECT ");
            if self.fails {
                return Err(AssistantError::new(AssistantErrorKind::Network, "closed"));
            }
            on_text("1");
            Ok(ChatOutcome {
                stop: StopKind::Complete,
                model: request.model.clone(),
                input_tokens: 5,
                output_tokens: 2,
            })
        }
    }

    fn user(text: &str) -> ChatMessage {
        ChatMessage::new(Role::User, text)
    }

    async fn ask_cancellable(
        provider: &dyn ChatProvider,
        messages: &[ChatMessage],
        cancel: &Notify,
    ) -> (AskResult, String) {
        let parts = Mutex::new(String::new());
        let on_part = |part: &str| parts.lock().unwrap().push_str(part);
        let schema = SchemaContext::default();
        let database = Database {
            engine: "PostgreSQL",
            version: "17",
            language: tabloxide_core::QueryLanguage::Sql,
            schema: &schema,
        };
        let ask = Ask {
            provider,
            model: "claude-opus-5-5",
            task: Task::Sql,
            database: Some(&database),
            messages,
            api_key: &Secret::new("key"),
        };
        let result = ask.send_with_cancel(cancel, &on_part).await;
        (result, parts.into_inner().unwrap())
    }

    async fn ask(provider: &FakeProvider, messages: &[ChatMessage]) -> (AskResult, String) {
        ask_cancellable(provider, messages, &Notify::new()).await
    }

    /// A provider that sends one text part and then waits for ever.
    struct SlowProvider;

    #[async_trait]
    impl ChatProvider for SlowProvider {
        async fn stream(
            &self,
            _request: &ChatRequest,
            _api_key: &Secret,
            on_text: &mut TextSink<'_>,
        ) -> Result<ChatOutcome, AssistantError> {
            on_text("SELECT");
            std::future::pending().await
        }
    }

    #[tokio::test]
    async fn a_cancel_stops_the_request_and_keeps_the_text_that_came() {
        let cancel = Arc::new(Notify::new());
        let later = Arc::clone(&cancel);
        tokio::spawn(async move {
            tokio::task::yield_now().await;
            later.notify_one();
        });

        let (result, _) = ask_cancellable(&SlowProvider, &[user("x")], &cancel).await;

        assert_eq!(
            result,
            AskResult::Cancelled {
                text: "SELECT".to_owned()
            }
        );
    }

    #[tokio::test]
    async fn a_cancel_before_the_request_starts_is_not_lost() {
        let cancel = Notify::new();
        cancel.notify_one();

        let (result, _) = ask_cancellable(&SlowProvider, &[user("x")], &cancel).await;

        assert!(matches!(result, AskResult::Cancelled { .. }));
    }

    #[test]
    fn the_summary_names_the_data_of_the_last_message_and_the_schema() {
        let error = ChatMessage {
            context: Some(tabloxide_assistant::ActionContext::QueryError {
                statement: "select".to_owned(),
                message: "syntax error".to_owned(),
                detail: None,
                position: None,
                hint: None,
                code: None,
            }),
            ..user("Explain and fix.")
        };
        let request = AskRequest {
            id: 1,
            session_id: None,
            task: Task::QueryError,
            messages: vec![error],
            refresh_schema: false,
        };
        let schema = SchemaContext::default();
        let database = Database {
            engine: "PostgreSQL",
            version: "17",
            language: tabloxide_core::QueryLanguage::Sql,
            schema: &schema,
        };

        assert_eq!(
            summary_of(&request, Some(&database)),
            "Sent: your request, the statement, the error message, and the structure \
             of 0 tables and views."
        );
        assert_eq!(
            summary_of(&request, None),
            "Sent: your request, the statement, and the error message."
        );
    }

    /// A state with a workspace that has one connection of `environment`, and a
    /// session of that connection.
    fn state_with_a_session(environment: &str) -> (tempfile::TempDir, AppState, SessionId) {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("tabloxide.toml"),
            format!(
                "[[connections]]\nid = \"c1\"\nname = \"Shop\"\nenvironment = \"{environment}\"\n\
                 database = \"shop\"\nuser = \"u\"\n"
            ),
        )
        .unwrap();
        let state = AppState::default();
        state.set_workspace(Some(
            tabloxide_workspace::Workspace::open(dir.path()).unwrap(),
        ));
        let (scripted, _) = ScriptedSession::new(vec![]);
        let id = state.add_session(SessionEntry {
            session: Arc::new(QuerySession::new(
                Box::new(scripted),
                tabloxide_core::QueryLanguage::Sql,
            )),
            connection_id: tabloxide_core::ConnectionId::from("c1"),
            connection_name: "Shop".to_owned(),
            engine: tabloxide_core::Engine::new("postgres"),
            info: tabloxide_core::EngineInfo {
                engine: tabloxide_core::Engine::new("postgres"),
                display_name: "PostgreSQL".to_owned(),
                language: tabloxide_core::QueryLanguage::Sql,
                default_port: Some(5432),
                capabilities: tabloxide_core::Capabilities {
                    cancel: true,
                    unix_socket: false,
                    file_database: false,
                    explain_plan: true,
                },
            },
        });
        (dir, state, id)
    }

    #[test]
    fn the_environment_comes_from_the_connection_of_the_session() {
        let (_production_dir, production, production_id) = state_with_a_session("production");
        let (_staging_dir, staging, staging_id) = state_with_a_session("staging");

        assert_eq!(
            environment_of(&production, production_id),
            Some(Environment::Production)
        );
        assert_eq!(
            environment_of(&staging, staging_id),
            Some(Environment::Staging)
        );
        assert_eq!(environment_of(&staging, staging_id + 1), None);
    }

    fn rows_request(session_id: SessionId, count: usize) -> AskRequest {
        AskRequest {
            id: 1,
            session_id: Some(session_id),
            task: Task::Rows,
            messages: vec![ChatMessage {
                context: Some(tabloxide_assistant::ActionContext::Rows {
                    columns: vec![tabloxide_assistant::RowColumn {
                        name: "id".to_owned(),
                        type_name: None,
                    }],
                    rows: (0..count).map(|i| vec![Some(i.to_string())]).collect(),
                    total_rows: None,
                }),
                ..user("Which ids?")
            }],
            refresh_schema: false,
        }
    }

    async fn failure_of(state: &AppState, request: &AskRequest) -> String {
        let channel = Channel::new(|_| Ok(()));
        let result = answer(
            state,
            request,
            &AssistantPreferences::default(),
            &Secret::new("key"),
            &Notify::new(),
            &channel,
        )
        .await
        .unwrap();
        match result {
            AskResult::Failed { error } => error.message,
            other => panic!("{other:?}"),
        }
    }

    #[tokio::test]
    async fn a_request_with_rows_of_a_production_connection_fails_before_the_ai_service() {
        let (_dir, state, id) = state_with_a_session("production");

        let message = failure_of(&state, &rows_request(id, 3)).await;

        assert!(
            message.contains("A production connection never sends rows"),
            "{message}"
        );
    }

    #[tokio::test]
    async fn a_request_with_more_rows_than_the_preferences_fails() {
        let (_dir, state, id) = state_with_a_session("development");

        let message = failure_of(&state, &rows_request(id, 101)).await;

        assert!(message.contains("Preferences permit 100 rows"), "{message}");
    }

    fn mongodb_entry(explain_plan: bool) -> SessionEntry {
        let (scripted, _) = ScriptedSession::new(vec![]);
        SessionEntry {
            session: Arc::new(QuerySession::new(
                Box::new(scripted),
                QueryLanguage::MongodbShell,
            )),
            connection_id: tabloxide_core::ConnectionId::from("m1"),
            connection_name: "Users".to_owned(),
            engine: tabloxide_core::Engine::new("mongodb"),
            info: tabloxide_core::EngineInfo {
                engine: tabloxide_core::Engine::new("mongodb"),
                display_name: "MongoDB".to_owned(),
                language: QueryLanguage::MongodbShell,
                default_port: Some(27017),
                capabilities: tabloxide_core::Capabilities {
                    cancel: true,
                    unix_socket: false,
                    file_database: false,
                    explain_plan,
                },
            },
        }
    }

    #[tokio::test]
    async fn a_connector_plan_needs_the_capability() {
        let result = read_connector_plan(&mongodb_entry(false), "db.users.find()", false).await;

        assert!(matches!(
            result,
            ExplainResult::Rejected {
                reason: ExplainRejection::NoPlan,
                ..
            }
        ));
    }

    #[tokio::test]
    async fn a_connector_plan_with_measured_times_is_only_for_a_read() {
        let result =
            read_connector_plan(&mongodb_entry(true), "db.users.deleteMany({ a: 1 })", true).await;

        assert!(matches!(
            result,
            ExplainResult::Rejected {
                reason: ExplainRejection::MeasureChangesData,
                ..
            }
        ));
    }

    #[tokio::test]
    async fn a_connector_plan_goes_to_the_session_of_the_engine() {
        // The scripted session has no plan. Its default answer proves the call.
        let result = read_connector_plan(&mongodb_entry(true), "db.users.find()", true).await;

        let ExplainResult::Failed { error } = result else {
            panic!("{result:?}");
        };
        assert!(error.message.contains("gives no execution plan"));
    }

    #[test]
    fn the_state_cancels_only_a_request_that_is_in_progress() {
        let state = AppState::default();
        let cancel = state.start_ask(4);

        state.cancel_ask(5);
        state.cancel_ask(4);
        state.end_ask(4);
        state.cancel_ask(4);

        // One permit is in the notification: the cancel of request 4 while it ran.
        assert!(tokio_test_ready(&cancel));
    }

    fn tokio_test_ready(cancel: &Notify) -> bool {
        use std::future::Future;
        use std::task::{Context, Poll, Waker};
        let mut notified = std::pin::pin!(cancel.notified());
        let mut context = Context::from_waker(Waker::noop());
        matches!(notified.as_mut().poll(&mut context), Poll::Ready(()))
    }

    #[tokio::test]
    async fn the_request_goes_to_the_provider_and_the_text_comes_back() {
        let provider = FakeProvider::default();

        let (result, text) = ask(&provider, &[user("Count the items.")]).await;

        assert_eq!(text, "SELECT 1");
        assert!(matches!(
            result,
            AskResult::Done { outcome, text } if outcome.output_tokens == 2 && text == "SELECT 1"
        ));
        let requests = provider.requests.lock().unwrap();
        assert_eq!(requests[0].model, "claude-opus-5-5");
        assert_eq!(requests[0].messages, vec![user("Count the items.")]);
        assert!(requests[0].system[1].text.contains("PostgreSQL 17"));
    }

    #[tokio::test]
    async fn an_empty_conversation_does_not_go_to_the_provider() {
        let provider = FakeProvider::default();

        let (result, _) = ask(&provider, &[]).await;

        assert!(matches!(
            result,
            AskResult::Failed { error } if error.kind == AssistantErrorKind::InvalidRequest
        ));
        assert!(provider.requests.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn a_failure_of_the_provider_is_a_failed_result() {
        let provider = FakeProvider {
            fails: true,
            ..FakeProvider::default()
        };

        let (result, text) = ask(&provider, &[user("x")]).await;

        assert_eq!(text, "SELECT ");
        assert!(matches!(
            result,
            AskResult::Failed { error } if error.kind == AssistantErrorKind::Network
        ));
    }

    fn session(answers: Vec<Scripted>) -> (QuerySession, Arc<tabloxide_core::testing::Probe>) {
        let (session, probe) = ScriptedSession::new(answers);
        (
            QuerySession::new(Box::new(session), tabloxide_core::QueryLanguage::Sql),
            probe,
        )
    }

    #[tokio::test]
    async fn the_plan_read_runs_explain_and_returns_the_text() {
        let (session, probe) = session(vec![Scripted::Rows(2)]);

        let result = read_plan(&session, "select * from item;", false).await;

        assert_eq!(
            result,
            ExplainResult::Plan {
                statement: "EXPLAIN select * from item".to_owned(),
                plan: "1\n2".to_owned(),
                is_truncated: false,
            }
        );
        assert_eq!(
            *probe.executed.lock().unwrap(),
            vec!["EXPLAIN select * from item"]
        );
    }

    #[tokio::test]
    async fn analyze_of_a_statement_that_changes_data_does_not_run() {
        let (session, probe) = session(vec![]);

        let result = read_plan(&session, "delete from item", true).await;

        assert!(matches!(
            result,
            ExplainResult::Rejected {
                reason: ExplainRejection::AnalyzeChangesData,
                ..
            }
        ));
        assert!(probe.executed.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn a_statement_error_is_a_failed_plan_read() {
        let (session, _) = session(vec![Scripted::Error {
            message: "relation \"item\" does not exist".to_owned(),
            position: None,
        }]);

        let result = read_plan(&session, "select * from item", false).await;

        assert!(matches!(
            result,
            ExplainResult::Failed { error } if error.message.contains("does not exist")
        ));
    }
}
