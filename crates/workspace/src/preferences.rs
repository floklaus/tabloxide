//! Preferences of the user on this machine.

use serde::{Deserialize, Serialize};

pub const DEFAULT_FONT_SIZE: u8 = 14;
pub const FONT_SIZE_RANGE: (u8, u8) = (10, 32);
pub const DEFAULT_TAB_WIDTH: u8 = 2;
pub const TAB_WIDTH_RANGE: (u8, u8) = (1, 8);
pub const DEFAULT_HISTORY_RETENTION_DAYS: u32 = 90;
pub const HISTORY_RETENTION_RANGE: (u32, u32) = (1, 3650);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(default)]
pub struct EditorPreferences {
    /// Font size in pixels.
    pub font_size: u8,
    /// Number of spaces for one indentation level.
    pub tab_width: u8,
    pub line_numbers: bool,
    pub word_wrap: bool,
}

impl Default for EditorPreferences {
    fn default() -> Self {
        Self {
            font_size: DEFAULT_FONT_SIZE,
            tab_width: DEFAULT_TAB_WIDTH,
            line_numbers: true,
            word_wrap: false,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(default)]
pub struct Preferences {
    pub editor: EditorPreferences,
    /// The application deletes history entries that are older than this number of days.
    pub history_retention_days: u32,
    /// Ask before a destructive statement runs.
    pub confirm_destructive: bool,
    /// Ask before a statement runs on a production connection.
    pub confirm_production: bool,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            editor: EditorPreferences::default(),
            history_retention_days: DEFAULT_HISTORY_RETENTION_DAYS,
            confirm_destructive: true,
            confirm_production: true,
        }
    }
}

impl Preferences {
    /// Returns the preferences with each value in its permitted range.
    #[must_use]
    pub fn normalized(self) -> Self {
        let editor = EditorPreferences {
            font_size: self
                .editor
                .font_size
                .clamp(FONT_SIZE_RANGE.0, FONT_SIZE_RANGE.1),
            tab_width: self
                .editor
                .tab_width
                .clamp(TAB_WIDTH_RANGE.0, TAB_WIDTH_RANGE.1),
            ..self.editor
        };
        Self {
            editor,
            history_retention_days: self
                .history_retention_days
                .clamp(HISTORY_RETENTION_RANGE.0, HISTORY_RETENTION_RANGE.1),
            ..self
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalized_puts_each_value_in_its_range() {
        let preferences = Preferences {
            editor: EditorPreferences {
                font_size: 200,
                tab_width: 0,
                line_numbers: false,
                word_wrap: true,
            },
            history_retention_days: 0,
            confirm_destructive: false,
            confirm_production: true,
        };

        let normalized = preferences.normalized();

        assert_eq!(normalized.editor.font_size, 32);
        assert_eq!(normalized.editor.tab_width, 1);
        assert!(!normalized.editor.line_numbers);
        assert!(normalized.editor.word_wrap);
        assert_eq!(normalized.history_retention_days, 1);
        assert!(!normalized.confirm_destructive);
        assert!(normalized.confirm_production);
    }

    #[test]
    fn missing_fields_get_the_default_values() {
        let preferences: Preferences =
            serde_json::from_str(r#"{"editor": {"font_size": 18}}"#).unwrap();

        assert_eq!(preferences.editor.font_size, 18);
        assert_eq!(preferences.editor.tab_width, DEFAULT_TAB_WIDTH);
        assert_eq!(
            preferences.history_retention_days,
            DEFAULT_HISTORY_RETENTION_DAYS
        );
        assert!(preferences.confirm_destructive);
        assert!(preferences.confirm_production);
    }
}
