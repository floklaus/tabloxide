//! The AI assistant: it writes SQL for a database schema and analyzes execution plans.
//!
//! - [`collect_schema`] reads the structure of a database. [`SchemaContext::render`]
//!   makes the text that goes to the AI service. The text has no rows.
//! - [`chat_request`] makes a request from the conversation and the schema.
//! - [`ChatProvider`] is the interface to an AI service. [`AnthropicProvider`]
//!   calls the Claude API.
//! - [`ModelLister`] gets the list of models of an AI service. [`AnthropicProvider`]
//!   reads it from the Models API of Anthropic.
//! - [`explain_statement`] makes the statement that reads an execution plan.

mod action;
mod anthropic;
mod anthropic_models;
mod context;
mod error;
mod explain;
mod model_list;
mod models;
mod prompt;
mod provider;
mod sse;
#[cfg(test)]
mod test_server;

pub use action::{ActionContext, MAX_GIT_OUTPUT_CHARS, SchemaCount, sent_summary};
pub use anthropic::AnthropicProvider;
pub use context::{
    MAX_DETAILED_RELATIONS, RelationContext, SchemaContext, SchemaGroup, collect_schema,
};
pub use error::{AssistantError, AssistantErrorKind};
pub use explain::{
    ExplainRejection, explain_json_statement, explain_statement, plan_json, plan_text,
};
pub use model_list::{MODEL_LIST_MAX_AGE_SECS, ModelList, ModelsResult, ModelsUpdate, load_models};
pub use models::{ModelFeatures, ModelInfo, ModelLister};
pub use prompt::{Database, MAX_CONVERSATION_CHARS, chat_request};
pub use provider::{
    ChatMessage, ChatOutcome, ChatProvider, ChatRequest, Effort, Role, StopKind, SystemPart, Task,
    TextSink,
};
