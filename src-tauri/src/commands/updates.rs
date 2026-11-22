//! Updates of the application.
//!
//! The updater needs a public key and an address of the update files. Only a release
//! build has them. The release workflow adds them when the repository has the
//! signing key. A development build and a build without the key have no updater.

use crate::error::CommandError;
use serde::Serialize;
use specta::Type;
use tauri::{AppHandle, Config};
use tauri_plugin_updater::{Update, UpdaterExt};

/// The name of the updater plugin in the `plugins` section of the configuration.
const UPDATER_PLUGIN: &str = "updater";

/// The result of a check for updates.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum UpdateCheck {
    /// This build cannot update itself. It has no updater configuration.
    NotConfigured,
    /// No newer version is available.
    UpToDate,
    /// A newer version is available.
    Available {
        version: String,
        current_version: String,
        /// The release notes of the new version.
        notes: Option<String>,
    },
}

/// Returns `true` if the configuration of this build has the updater settings.
pub fn is_configured(config: &Config) -> bool {
    config.plugins.0.contains_key(UPDATER_PLUGIN)
}

fn update_error(error: &tauri_plugin_updater::Error) -> CommandError {
    CommandError::internal(format!("The update failed: {error}"))
}

async fn find_update(app: &AppHandle) -> Result<Option<Update>, CommandError> {
    let updater = app.updater().map_err(|error| update_error(&error))?;
    updater.check().await.map_err(|error| update_error(&error))
}

/// Asks the update server if a newer version is available.
/// The request contains no data of the user. It contains only the address of the update file.
#[tauri::command]
#[specta::specta]
pub async fn update_check(app: AppHandle) -> Result<UpdateCheck, CommandError> {
    if !is_configured(app.config()) {
        return Ok(UpdateCheck::NotConfigured);
    }
    Ok(match find_update(&app).await? {
        None => UpdateCheck::UpToDate,
        Some(update) => UpdateCheck::Available {
            version: update.version,
            current_version: update.current_version,
            notes: update.body,
        },
    })
}

/// Downloads the newest version, checks its signature, installs it, and starts the
/// application again. The UI asks the user first, because unsaved text is lost.
#[tauri::command]
#[specta::specta]
pub async fn update_install(app: AppHandle) -> Result<(), CommandError> {
    if !is_configured(app.config()) {
        return Err(CommandError::internal(
            "This build of the application cannot update itself.",
        ));
    }
    let Some(update) = find_update(&app).await? else {
        return Err(CommandError::internal("No newer version is available."));
    };
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|error| update_error(&error))?;
    app.restart()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_configuration_without_the_updater_section_has_no_updater() {
        let mut config = Config::default();
        assert!(!is_configured(&config));

        config.plugins.0.insert(
            UPDATER_PLUGIN.to_owned(),
            serde_json::json!({ "pubkey": "key", "endpoints": [] }),
        );

        assert!(is_configured(&config));
    }

    #[test]
    fn the_configuration_of_the_repository_has_no_updater() {
        let config: Config = serde_json::from_str(include_str!("../../tauri.conf.json"))
            .expect("valid configuration");

        assert!(!is_configured(&config));
    }
}
