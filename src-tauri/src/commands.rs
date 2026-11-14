//! Tauri commands. Each command is a thin layer. Business logic is in the `crates/` libraries.

use serde::Serialize;
use specta::Type;

/// Name and version of the application.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub version: String,
}

/// Returns the name and the version of the application.
#[tauri::command]
#[specta::specta]
pub fn app_info() -> AppInfo {
    AppInfo {
        name: "Tabloxide".to_owned(),
        version: env!("CARGO_PKG_VERSION").to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_info_returns_the_package_version() {
        let info = app_info();

        assert_eq!(info.name, "Tabloxide");
        assert_eq!(info.version, env!("CARGO_PKG_VERSION"));
    }
}
