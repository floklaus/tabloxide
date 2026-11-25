//! Wrapper for the system `git` executable.
//!
//! Each operation runs `git` with machine-readable output. No operation can ask the
//! user a question in a terminal: a missing credential is an error, not a wait.

mod askpass;
mod error;
mod history;
mod merge;
mod operations;
mod runner;
mod status;

pub use askpass::{
    AskpassServer, AskpassSession, Prompt, PromptHandler, run_helper as run_askpass_helper,
};
pub use error::GitError;
pub use history::{CommitFile, CommitInfo};
pub use merge::ConflictSides;
pub use operations::{BranchDeletion, BranchInfo, FileDiff, RemoteBranchInfo, STARTER_GITIGNORE};
pub use runner::Git;
pub use status::{ChangeKind, FileStatus, StatusReport};
