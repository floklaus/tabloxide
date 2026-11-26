//! The connector host: it finds, checks, installs, and starts the database connectors.
//!
//! `docs/Connector Design.md` gives the design. For the other parts of the core, a
//! connector is a `DbAdapter`, the same as a built-in adapter.

mod manifest;
mod process;
mod registry;
mod remote;
mod signature;

pub use manifest::{MANIFEST_FILE, Manifest, ManifestError};
pub use process::{Client, ConnectorProcess, StartError, connect_client, describe};
pub use registry::{
    EngineEntry, EngineRegistry, EngineSource, HostError, INSTALL_RECORD_FILE, InstallRecord,
};
pub use remote::RemoteAdapter;
pub use signature::{SignatureError, trusted_keys, verify};
