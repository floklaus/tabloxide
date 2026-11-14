//! Application wiring for Tabloxide. This crate contains no business logic.

mod commands;

use tauri_specta::{Builder, collect_commands};

/// Builds the typed command set. The TypeScript bindings come from this builder.
fn specta_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new().commands(collect_commands![commands::app_info])
}

/// Starts the application.
///
/// # Panics
///
/// Panics if the Tauri runtime cannot start.
pub fn run() {
    let builder = specta_builder();

    tauri::Builder::default()
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
