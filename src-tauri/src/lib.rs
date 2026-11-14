//! Application wiring for Tabloxide. This crate contains no business logic.

mod commands;
mod error;
mod state;

use commands::{app, connections, workspace};
use tauri_specta::{Builder, ErrorHandlingMode, collect_commands};

/// Builds the typed command set. The TypeScript bindings come from this builder.
fn specta_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new()
        .error_handling(ErrorHandlingMode::Result)
        .commands(collect_commands![
            app::app_info,
            workspace::workspace_open,
            workspace::workspace_current,
            workspace::workspace_close,
            workspace::workspace_recent,
            connections::connection_template,
            connections::connection_save,
            connections::connection_delete,
            connections::connection_duplicate,
            connections::connection_test,
        ])
}

/// Starts the application.
///
/// # Panics
///
/// Panics if the Tauri runtime cannot start.
pub fn run() {
    let builder = specta_builder();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(state::AppState::default())
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("the Tauri runtime must start");
}

#[cfg(test)]
mod tests {
    use super::*;
    use specta_typescript::Typescript;
    use std::path::Path;

    /// Writes `ui/src/bindings.ts`. Run it with `pnpm bindings`.
    /// CI fails if the committed file is different from the generated file.
    #[test]
    fn export_bindings() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../ui/src/bindings.ts");

        specta_builder()
            .export(Typescript::default(), path)
            .expect("the TypeScript bindings must export");
    }
}
