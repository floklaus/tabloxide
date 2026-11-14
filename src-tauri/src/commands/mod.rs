//! Tauri commands. Each command is a thin layer. Business logic is in the `crates/` libraries.

pub mod app;
pub mod connections;
pub mod files;
pub mod local;
pub mod queries;
pub mod sessions;
pub mod workspace;
