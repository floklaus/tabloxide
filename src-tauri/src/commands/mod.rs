//! Tauri commands. Each command is a thin layer. Business logic is in the `crates/` libraries.

pub mod app;
pub mod assistant;
pub mod assistant_models;
pub mod connections;
pub mod files;
pub mod git;
pub mod local;
pub mod plan;
pub mod queries;
pub mod schema;
pub mod sessions;
pub mod updates;
pub mod workspace;
