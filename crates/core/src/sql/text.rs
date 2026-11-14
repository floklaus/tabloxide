//! Conversions between the position units of the editor, the server, and Rust.
//!
//! The editor uses UTF-16 code units. The server uses characters. Rust uses bytes.

use serde::Serialize;

/// A position in a script. `offset` is in UTF-16 code units and starts at 0.
/// `line` and `column` start at 1. `column` is in characters.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct Location {
    pub offset: u32,
    pub line: u32,
    pub column: u32,
}

fn to_u32(value: usize) -> u32 {
    u32::try_from(value).unwrap_or(u32::MAX)
}

/// Converts an offset in UTF-16 code units to a byte offset.
/// An offset after the end gives the length of the text.
#[must_use]
pub fn utf16_to_byte(text: &str, utf16_offset: u32) -> usize {
    let mut units = 0_u32;
    for (byte_offset, character) in text.char_indices() {
        if units >= utf16_offset {
            return byte_offset;
        }
        units += to_u32(character.len_utf16());
    }
    text.len()
}

/// Converts a byte offset to an offset in UTF-16 code units.
#[must_use]
pub fn byte_to_utf16(text: &str, byte_offset: usize) -> u32 {
    let units = text
        .char_indices()
        .take_while(|(offset, _)| *offset < byte_offset)
        .map(|(_, character)| character.len_utf16())
        .sum();
    to_u32(units)
}

/// Converts a character count to a byte offset.
#[must_use]
pub fn char_to_byte(text: &str, chars: usize) -> usize {
    text.char_indices()
        .nth(chars)
        .map_or(text.len(), |(offset, _)| offset)
}

/// Returns the location of the byte offset `byte_offset` in `text`.
#[must_use]
pub fn locate(text: &str, byte_offset: usize) -> Location {
    let before = text
        .char_indices()
        .take_while(|(offset, _)| *offset < byte_offset)
        .map(|(_, character)| character);
    let (line, column) = before.fold((1_u32, 1_u32), |(line, column), character| {
        if character == '\n' {
            (line + 1, 1)
        } else {
            (line, column + 1)
        }
    });
    Location {
        offset: byte_to_utf16(text, byte_offset),
        line,
        column,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // "ü" is 2 bytes and 1 UTF-16 unit. "😀" is 4 bytes and 2 UTF-16 units.
    const TEXT: &str = "aü😀b\ncd";

    #[test]
    fn converts_utf16_offsets_to_bytes() {
        assert_eq!(utf16_to_byte(TEXT, 0), 0);
        assert_eq!(utf16_to_byte(TEXT, 1), 1);
        assert_eq!(utf16_to_byte(TEXT, 2), 3);
        assert_eq!(utf16_to_byte(TEXT, 4), 7);
        assert_eq!(utf16_to_byte(TEXT, 99), TEXT.len());
    }

    #[test]
    fn converts_bytes_to_utf16_offsets() {
        assert_eq!(byte_to_utf16(TEXT, 0), 0);
        assert_eq!(byte_to_utf16(TEXT, 3), 2);
        assert_eq!(byte_to_utf16(TEXT, 7), 4);
        assert_eq!(byte_to_utf16(TEXT, TEXT.len()), 8);
    }

    #[test]
    fn converts_characters_to_bytes() {
        assert_eq!(char_to_byte(TEXT, 2), 3);
        assert_eq!(char_to_byte(TEXT, 3), 7);
        assert_eq!(char_to_byte(TEXT, 99), TEXT.len());
    }

    #[test]
    fn finds_the_line_and_the_column() {
        assert_eq!(
            locate(TEXT, 0),
            Location {
                offset: 0,
                line: 1,
                column: 1
            }
        );
        assert_eq!(
            locate(TEXT, 7),
            Location {
                offset: 4,
                line: 1,
                column: 4
            }
        );
        assert_eq!(
            locate(TEXT, 10),
            Location {
                offset: 7,
                line: 2,
                column: 2
            }
        );
    }
}
