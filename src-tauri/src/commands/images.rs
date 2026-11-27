//! The export of an image of a result view to a file that the user selected.

use crate::error::{CommandError, CommandErrorKind};
use crate::state::blocking;
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use serde::Deserialize;
use specta::Type;
use std::path::{Path, PathBuf};

/// Largest image that the application writes.
const MAX_IMAGE_BYTES: usize = 64 * 1024 * 1024;

/// The first bytes of each PNG file.
const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];

/// An image of a view, as the UI made it.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Type)]
#[serde(tag = "format", rename_all = "lowercase")]
pub enum ViewImage {
    /// A PNG image as base64 text.
    Png { base64: String },
    /// An SVG image as its XML text.
    Svg { text: String },
}

impl ViewImage {
    /// The file extension of the format, in lower case.
    fn extension(&self) -> &'static str {
        match self {
            Self::Png { .. } => "png",
            Self::Svg { .. } => "svg",
        }
    }

    /// Returns the bytes of the file. The content must be an image of the format.
    fn into_bytes(self) -> Result<Vec<u8>, CommandError> {
        let bytes = match self {
            Self::Png { base64 } => {
                let bytes = STANDARD
                    .decode(base64.as_bytes())
                    .map_err(|_| invalid("The image data is not valid base64 text."))?;
                if !bytes.starts_with(&PNG_SIGNATURE) {
                    return Err(invalid("The image data is not a PNG image."));
                }
                bytes
            }
            Self::Svg { text } => {
                if !text.trim_start().starts_with("<svg") {
                    return Err(invalid("The image data is not an SVG image."));
                }
                text.into_bytes()
            }
        };
        if bytes.len() > MAX_IMAGE_BYTES {
            return Err(invalid("The image is too large."));
        }
        Ok(bytes)
    }
}

fn invalid(message: &str) -> CommandError {
    CommandError::internal(message)
}

fn file_error(path: &Path, error: &std::io::Error) -> CommandError {
    CommandError::new(
        CommandErrorKind::Workspace,
        format!("Cannot write the file {}: {error}", path.display()),
    )
}

fn part_path(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(".part");
    PathBuf::from(name)
}

/// Writes the image to `path`. The extension of the file must be the extension
/// of the image format, thus this function cannot write a file of a different type.
///
/// The function writes a temporary file, then moves it to `path`. Thus a failure
/// does not leave a file that is only partly written.
///
/// # Errors
///
/// Returns an error if the extension or the content is not that of the format,
/// or if the write fails.
pub fn write_image(path: &Path, image: ViewImage) -> Result<(), CommandError> {
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase);
    if extension.as_deref() != Some(image.extension()) {
        return Err(invalid(&format!(
            "The file name must end with .{}.",
            image.extension()
        )));
    }
    let bytes = image.into_bytes()?;
    let part = part_path(path);
    std::fs::write(&part, bytes).map_err(|error| file_error(&part, &error))?;
    std::fs::rename(&part, path).map_err(|error| {
        // The rename error is more important than a failure to remove the file.
        let _ = std::fs::remove_file(&part);
        file_error(path, &error)
    })
}

/// Writes an image of a view to the file `path`. The path comes from the save
/// dialog, thus it is absolute and can be outside the workspace.
#[tauri::command]
#[specta::specta]
pub async fn view_image_save(path: String, image: ViewImage) -> Result<(), CommandError> {
    blocking(move || write_image(Path::new(&path), image)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png() -> ViewImage {
        let mut bytes = PNG_SIGNATURE.to_vec();
        bytes.extend_from_slice(b"data");
        ViewImage::Png {
            base64: STANDARD.encode(bytes),
        }
    }

    fn svg() -> ViewImage {
        ViewImage::Svg {
            text: "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>".to_owned(),
        }
    }

    #[test]
    fn a_png_image_goes_to_the_file_as_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("chart.png");

        write_image(&path, png()).unwrap();

        let written = std::fs::read(&path).unwrap();
        assert!(written.starts_with(&PNG_SIGNATURE));
        assert!(written.ends_with(b"data"));
        assert!(!part_path(&path).exists());
    }

    #[test]
    fn an_svg_image_goes_to_the_file_as_text() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("chart.SVG");

        write_image(&path, svg()).unwrap();

        assert!(std::fs::read_to_string(&path).unwrap().starts_with("<svg"));
    }

    #[test]
    fn the_extension_must_be_that_of_the_format() {
        let dir = tempfile::tempdir().unwrap();

        for name in ["chart.svg", "chart", "chart.sh", ".bashrc"] {
            let path = dir.path().join(name);
            let error = write_image(&path, png()).unwrap_err();

            assert_eq!(error.message, "The file name must end with .png.");
            assert!(!path.exists(), "{name}");
        }
    }

    #[test]
    fn content_that_is_not_an_image_of_the_format_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let not_png = ViewImage::Png {
            base64: STANDARD.encode(b"#!/bin/sh"),
        };
        let not_base64 = ViewImage::Png {
            base64: "not base64!".to_owned(),
        };
        let not_svg = ViewImage::Svg {
            text: "#!/bin/sh".to_owned(),
        };

        let png_path = dir.path().join("a.png");
        let svg_path = dir.path().join("a.svg");
        assert_eq!(
            write_image(&png_path, not_png).unwrap_err().message,
            "The image data is not a PNG image."
        );
        assert_eq!(
            write_image(&png_path, not_base64).unwrap_err().message,
            "The image data is not valid base64 text."
        );
        assert_eq!(
            write_image(&svg_path, not_svg).unwrap_err().message,
            "The image data is not an SVG image."
        );
        assert!(!png_path.exists() && !svg_path.exists());
    }

    #[test]
    fn a_folder_that_does_not_exist_gives_a_file_error() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("missing").join("chart.png");

        let error = write_image(&path, png()).unwrap_err();

        assert_eq!(error.kind, CommandErrorKind::Workspace);
        assert!(error.message.starts_with("Cannot write the file"));
    }
}
