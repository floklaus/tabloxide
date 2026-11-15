//! Preferences of the user on this machine.

use serde::{Deserialize, Serialize};
use tabloxide_core::Environment;

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

/// When the application asks the user before it runs statements on a connection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "kebab-case")]
pub enum ConfirmRule {
    /// Never ask.
    Never,
    /// Ask before a statement that the risk classifier flags: a destructive statement,
    /// or a statement with an effect outside the database.
    Risky,
    /// Ask before each run.
    Always,
}

/// The confirmation rule for the connections of each environment.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(default)]
pub struct Guardrails {
    pub development: ConfirmRule,
    pub staging: ConfirmRule,
    pub production: ConfirmRule,
}

impl Default for Guardrails {
    fn default() -> Self {
        Self {
            development: ConfirmRule::Risky,
            staging: ConfirmRule::Risky,
            production: ConfirmRule::Always,
        }
    }
}

impl Guardrails {
    /// Returns the rule for the connections of `environment`.
    #[must_use]
    pub fn rule(&self, environment: Environment) -> ConfirmRule {
        match environment {
            Environment::Development => self.development,
            Environment::Staging => self.staging,
            Environment::Production => self.production,
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
    /// When the application asks before a run. Each environment has its own rule.
    pub guardrails: Guardrails,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            editor: EditorPreferences::default(),
            history_retention_days: DEFAULT_HISTORY_RETENTION_DAYS,
            guardrails: Guardrails::default(),
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
            guardrails: Guardrails {
                development: ConfirmRule::Never,
                staging: ConfirmRule::Always,
                production: ConfirmRule::Risky,
            },
        };

        let normalized = preferences.normalized();

        assert_eq!(normalized.editor.font_size, 32);
        assert_eq!(normalized.editor.tab_width, 1);
        assert!(!normalized.editor.line_numbers);
        assert!(normalized.editor.word_wrap);
        assert_eq!(normalized.history_retention_days, 1);
        assert_eq!(normalized.guardrails, preferences.guardrails);
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
        assert_eq!(preferences.guardrails, Guardrails::default());
    }

    #[test]
    fn the_default_rules_ask_for_risky_statements_and_for_each_production_run() {
        let guardrails = Guardrails::default();

        assert_eq!(
            guardrails.rule(Environment::Development),
            ConfirmRule::Risky
        );
        assert_eq!(guardrails.rule(Environment::Staging), ConfirmRule::Risky);
        assert_eq!(
            guardrails.rule(Environment::Production),
            ConfirmRule::Always
        );
    }

    #[test]
    fn a_missing_environment_gets_its_default_rule() {
        let preferences: Preferences =
            serde_json::from_str(r#"{"guardrails": {"production": "never"}}"#).unwrap();

        assert_eq!(preferences.guardrails.production, ConfirmRule::Never);
        assert_eq!(preferences.guardrails.development, ConfirmRule::Risky);
    }

    #[test]
    fn preferences_of_an_earlier_version_get_the_default_rules() {
        let stored = r#"{"confirm_destructive": false, "confirm_production": false}"#;

        let preferences: Preferences = serde_json::from_str(stored).unwrap();

        assert_eq!(preferences.guardrails, Guardrails::default());
    }
}
