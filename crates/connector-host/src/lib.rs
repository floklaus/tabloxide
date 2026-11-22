//! The connector host: it finds, checks, and starts the database connectors.
//!
//! `docs/Connector Design.md` gives the design. This crate has only the signature check
//! now. The start of connector processes comes with stage 2 of the design.

mod signature;

pub use signature::{SignatureError, trusted_keys, verify};
