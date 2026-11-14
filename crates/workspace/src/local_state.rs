//! Machine-specific state in an SQLite database in the application data directory.
//!
//! The database holds the query history, the open tabs of each workspace, and the
//! preferences. It is never in the repository. Each query uses parameters.

use crate::error::WorkspaceError;
use crate::history::{HistoryEntry, HistoryStatus, NewHistoryEntry};
use crate::preferences::Preferences;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::{Mutex, MutexGuard, PoisonError};
use tabloxide_core::ConnectionId;

const DATABASE_FILE_NAME: &str = "state.sqlite3";
const PREFERENCES_KEY: &str = "preferences";
const GIT_DISABLED_PREFIX: &str = "git-disabled:";
const SECONDS_PER_DAY: i64 = 24 * 60 * 60;

/// Largest number of entries that one history search returns.
pub const MAX_HISTORY_RESULTS: u32 = 500;

const SCHEMA: &str = "
    CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY,
        workspace TEXT NOT NULL,
        connection_id TEXT NOT NULL,
        connection_name TEXT NOT NULL,
        sql TEXT NOT NULL,
        executed_at_secs INTEGER NOT NULL,
        elapsed_ms INTEGER NOT NULL,
        status TEXT NOT NULL,
        rows INTEGER,
        error TEXT
    );
    CREATE INDEX IF NOT EXISTS history_workspace_time
        ON history (workspace, executed_at_secs DESC);
    CREATE TABLE IF NOT EXISTS ui_state (
        workspace TEXT PRIMARY KEY,
        json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        json TEXT NOT NULL
    );
";

/// One open editor tab.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct TabState {
    pub id: String,
    pub title: String,
    /// Path of the file in the workspace. `None` for a buffer without a file.
    pub path: Option<String>,
    /// Text that is not saved. `None` for a file tab without changes.
    pub content: Option<String>,
    pub connection_id: Option<ConnectionId>,
}

/// The open tabs of one workspace.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct UiState {
    pub tabs: Vec<TabState>,
    pub active_tab: Option<String>,
}

pub struct LocalState {
    connection: Mutex<Connection>,
}

fn db_error(error: impl std::fmt::Display) -> WorkspaceError {
    WorkspaceError::Database(error.to_string())
}

/// Escapes the wildcard characters of `LIKE`, so that the search finds them as text.
fn like_pattern(query: &str) -> String {
    let escaped = query
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    format!("%{escaped}%")
}

fn to_i64(value: u64) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
}

fn to_u64(value: i64) -> u64 {
    u64::try_from(value).unwrap_or(0)
}

impl LocalState {
    fn from_connection(connection: Connection) -> Result<Self, WorkspaceError> {
        connection.execute_batch(SCHEMA).map_err(db_error)?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    /// Opens the database in `state_dir`. Creates the directory and the tables if necessary.
    ///
    /// # Errors
    ///
    /// Returns an error if the directory or the database is not writable.
    pub fn open(state_dir: &Path) -> Result<Self, WorkspaceError> {
        std::fs::create_dir_all(state_dir).map_err(|source| WorkspaceError::Io {
            path: state_dir.to_owned(),
            source,
        })?;
        let connection = Connection::open(state_dir.join(DATABASE_FILE_NAME)).map_err(db_error)?;
        Self::from_connection(connection)
    }

    /// Opens a database in memory. The data is lost when the value drops.
    ///
    /// # Errors
    ///
    /// Returns an error if SQLite cannot make the tables.
    pub fn in_memory() -> Result<Self, WorkspaceError> {
        Self::from_connection(Connection::open_in_memory().map_err(db_error)?)
    }

    fn lock(&self) -> MutexGuard<'_, Connection> {
        self.connection
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }

    /// Adds entries to the history of `workspace`.
    ///
    /// # Errors
    ///
    /// Returns an error if the database write fails.
    pub fn add_history(
        &self,
        workspace: &str,
        entries: &[NewHistoryEntry],
        now_secs: i64,
    ) -> Result<(), WorkspaceError> {
        let mut connection = self.lock();
        let transaction = connection.transaction().map_err(db_error)?;
        for entry in entries {
            transaction
                .execute(
                    "INSERT INTO history (workspace, connection_id, connection_name, sql,
                        executed_at_secs, elapsed_ms, status, rows, error)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                    params![
                        workspace,
                        entry.connection_id.to_string(),
                        entry.connection_name,
                        entry.sql,
                        now_secs,
                        to_i64(entry.elapsed_ms),
                        entry.status.as_str(),
                        entry.rows.map(to_i64),
                        entry.error,
                    ],
                )
                .map_err(db_error)?;
        }
        transaction.commit().map_err(db_error)
    }

    /// Returns the history entries of `workspace` that contain `query` in the statement
    /// text or in the connection name. The newest entry is first. An empty query finds all.
    ///
    /// # Errors
    ///
    /// Returns an error if the database read fails.
    pub fn search_history(
        &self,
        workspace: &str,
        query: &str,
        limit: u32,
    ) -> Result<Vec<HistoryEntry>, WorkspaceError> {
        let connection = self.lock();
        let mut statement = connection
            .prepare(
                "SELECT id, connection_id, connection_name, sql, executed_at_secs,
                        elapsed_ms, status, rows, error
                 FROM history
                 WHERE workspace = ?1
                   AND (sql LIKE ?2 ESCAPE '\\' OR connection_name LIKE ?2 ESCAPE '\\')
                 ORDER BY executed_at_secs DESC, id DESC
                 LIMIT ?3",
            )
            .map_err(db_error)?;
        let rows = statement
            .query_map(
                params![
                    workspace,
                    like_pattern(query),
                    limit.min(MAX_HISTORY_RESULTS)
                ],
                |row| {
                    Ok(HistoryEntry {
                        id: row.get(0)?,
                        connection_id: ConnectionId::from(row.get::<_, String>(1)?.as_str()),
                        connection_name: row.get(2)?,
                        sql: row.get(3)?,
                        executed_at_secs: row.get(4)?,
                        elapsed_ms: to_u64(row.get(5)?),
                        status: HistoryStatus::parse(&row.get::<_, String>(6)?),
                        rows: row.get::<_, Option<i64>>(7)?.map(to_u64),
                        error: row.get(8)?,
                    })
                },
            )
            .map_err(db_error)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(db_error)
    }

    /// Deletes the history of `workspace`.
    ///
    /// # Errors
    ///
    /// Returns an error if the database write fails.
    pub fn clear_history(&self, workspace: &str) -> Result<(), WorkspaceError> {
        self.lock()
            .execute(
                "DELETE FROM history WHERE workspace = ?1",
                params![workspace],
            )
            .map(|_| ())
            .map_err(db_error)
    }

    /// Deletes the history entries that are older than `retention_days`.
    /// Returns the number of deleted entries.
    ///
    /// # Errors
    ///
    /// Returns an error if the database write fails.
    pub fn prune_history(
        &self,
        retention_days: u32,
        now_secs: i64,
    ) -> Result<usize, WorkspaceError> {
        let oldest = now_secs - i64::from(retention_days) * SECONDS_PER_DAY;
        self.lock()
            .execute(
                "DELETE FROM history WHERE executed_at_secs < ?1",
                params![oldest],
            )
            .map_err(db_error)
    }

    fn read_json(&self, sql: &str, key: &str) -> Result<Option<String>, WorkspaceError> {
        self.lock()
            .query_row(sql, params![key], |row| row.get(0))
            .optional()
            .map_err(db_error)
    }

    fn write_json(&self, sql: &str, key: &str, json: &str) -> Result<(), WorkspaceError> {
        self.lock()
            .execute(sql, params![key, json])
            .map(|_| ())
            .map_err(db_error)
    }

    /// Returns the open tabs of `workspace`. Data that is missing or not valid gives no tabs.
    ///
    /// # Errors
    ///
    /// Returns an error if the database read fails.
    pub fn load_ui_state(&self, workspace: &str) -> Result<UiState, WorkspaceError> {
        let json = self.read_json("SELECT json FROM ui_state WHERE workspace = ?1", workspace)?;
        Ok(json
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default())
    }

    /// Stores the open tabs of `workspace`.
    ///
    /// # Errors
    ///
    /// Returns an error if the database write fails.
    pub fn save_ui_state(&self, workspace: &str, state: &UiState) -> Result<(), WorkspaceError> {
        let json = serde_json::to_string(state).map_err(db_error)?;
        self.write_json(
            "INSERT INTO ui_state (workspace, json) VALUES (?1, ?2)
             ON CONFLICT (workspace) DO UPDATE SET json = excluded.json",
            workspace,
            &json,
        )
    }

    /// Returns `false` if the user disabled Git for `workspace`.
    ///
    /// # Errors
    ///
    /// Returns an error if the database read fails.
    pub fn is_git_enabled(&self, workspace: &str) -> Result<bool, WorkspaceError> {
        let key = format!("{GIT_DISABLED_PREFIX}{workspace}");
        let stored = self.read_json("SELECT json FROM settings WHERE key = ?1", &key)?;
        Ok(stored.is_none())
    }

    /// Enables or disables Git for `workspace`.
    ///
    /// # Errors
    ///
    /// Returns an error if the database write fails.
    pub fn set_git_enabled(&self, workspace: &str, is_enabled: bool) -> Result<(), WorkspaceError> {
        let key = format!("{GIT_DISABLED_PREFIX}{workspace}");
        if is_enabled {
            self.write_json("DELETE FROM settings WHERE key = ?1 AND ?2 = ?2", &key, "")
        } else {
            self.write_json(
                "INSERT INTO settings (key, json) VALUES (?1, ?2)
                 ON CONFLICT (key) DO UPDATE SET json = excluded.json",
                &key,
                "true",
            )
        }
    }

    /// Returns the preferences. Data that is missing or not valid gives the defaults.
    ///
    /// # Errors
    ///
    /// Returns an error if the database read fails.
    pub fn load_preferences(&self) -> Result<Preferences, WorkspaceError> {
        let json = self.read_json("SELECT json FROM settings WHERE key = ?1", PREFERENCES_KEY)?;
        Ok(json
            .and_then(|text| serde_json::from_str::<Preferences>(&text).ok())
            .unwrap_or_default()
            .normalized())
    }

    /// Stores the preferences. Returns the stored values, each in its permitted range.
    ///
    /// # Errors
    ///
    /// Returns an error if the database write fails.
    pub fn save_preferences(
        &self,
        preferences: Preferences,
    ) -> Result<Preferences, WorkspaceError> {
        let normalized = preferences.normalized();
        let json = serde_json::to_string(&normalized).map_err(db_error)?;
        self.write_json(
            "INSERT INTO settings (key, json) VALUES (?1, ?2)
             ON CONFLICT (key) DO UPDATE SET json = excluded.json",
            PREFERENCES_KEY,
            &json,
        )?;
        Ok(normalized)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_800_000_000;

    fn entry(sql: &str, connection_name: &str) -> NewHistoryEntry {
        NewHistoryEntry {
            connection_id: ConnectionId::from("c1"),
            connection_name: connection_name.to_owned(),
            sql: sql.to_owned(),
            elapsed_ms: 12,
            status: HistoryStatus::Ok,
            rows: Some(3),
            error: None,
        }
    }

    fn state_with(entries: &[(&str, i64)]) -> LocalState {
        let state = LocalState::in_memory().unwrap();
        for (sql, time) in entries {
            state
                .add_history("/w", &[entry(sql, "Local")], *time)
                .unwrap();
        }
        state
    }

    fn found(state: &LocalState, query: &str) -> Vec<String> {
        state
            .search_history("/w", query, 100)
            .unwrap()
            .into_iter()
            .map(|e| e.sql)
            .collect()
    }

    #[test]
    fn returns_the_history_with_the_newest_entry_first() {
        let state = state_with(&[("select 1", NOW), ("select 2", NOW + 5)]);

        let entries = state.search_history("/w", "", 100).unwrap();

        assert_eq!(entries[0].sql, "select 2");
        assert_eq!(entries[1].sql, "select 1");
        assert_eq!(entries[1].executed_at_secs, NOW);
        assert_eq!(entries[1].rows, Some(3));
        assert_eq!(entries[1].status, HistoryStatus::Ok);
        assert_eq!(entries[1].connection_name, "Local");
    }

    #[test]
    fn searches_the_statement_text_without_case() {
        let state = state_with(&[("SELECT * FROM orders", NOW), ("select 1", NOW)]);

        assert_eq!(found(&state, "ORDERS"), vec!["SELECT * FROM orders"]);
    }

    #[test]
    fn searches_wildcard_characters_as_text() {
        let state = state_with(&[
            ("select 100%", NOW),
            ("select a_b", NOW),
            ("select axb", NOW),
        ]);

        assert_eq!(found(&state, "0%"), vec!["select 100%"]);
        assert_eq!(found(&state, "a_b"), vec!["select a_b"]);
    }

    #[test]
    fn a_quote_in_the_search_text_is_only_text() {
        let state = state_with(&[("select 'x'", NOW)]);

        assert_eq!(found(&state, "'x'"), vec!["select 'x'"]);
        assert_eq!(
            found(&state, "'; DROP TABLE history; --"),
            Vec::<String>::new()
        );
        assert_eq!(found(&state, "").len(), 1);
    }

    #[test]
    fn the_history_of_one_workspace_is_not_in_a_different_workspace() {
        let state = state_with(&[("select 1", NOW)]);

        assert!(state.search_history("/other", "", 100).unwrap().is_empty());

        state.clear_history("/other").unwrap();
        assert_eq!(found(&state, "").len(), 1);
        state.clear_history("/w").unwrap();
        assert!(found(&state, "").is_empty());
    }

    #[test]
    fn prune_deletes_only_the_old_entries() {
        let day = SECONDS_PER_DAY;
        let state = state_with(&[("old", NOW - 31 * day), ("new", NOW - 29 * day)]);

        let deleted = state.prune_history(30, NOW).unwrap();

        assert_eq!(deleted, 1);
        assert_eq!(found(&state, ""), vec!["new"]);
    }

    #[test]
    fn stores_the_tabs_of_each_workspace() {
        let state = LocalState::in_memory().unwrap();
        let ui = UiState {
            tabs: vec![TabState {
                id: "t1".to_owned(),
                title: "Query 1".to_owned(),
                path: None,
                content: Some("select 1".to_owned()),
                connection_id: Some(ConnectionId::from("c1")),
            }],
            active_tab: Some("t1".to_owned()),
        };

        state.save_ui_state("/w", &ui).unwrap();
        state.save_ui_state("/w", &ui).unwrap();

        assert_eq!(state.load_ui_state("/w").unwrap(), ui);
        assert_eq!(state.load_ui_state("/other").unwrap(), UiState::default());
    }

    #[test]
    fn stores_the_preferences_in_their_ranges() {
        let state = LocalState::in_memory().unwrap();
        assert_eq!(state.load_preferences().unwrap(), Preferences::default());
        let mut preferences = Preferences::default();
        preferences.editor.font_size = 99;
        preferences.editor.word_wrap = true;

        let stored = state.save_preferences(preferences).unwrap();

        assert_eq!(stored.editor.font_size, 32);
        assert_eq!(state.load_preferences().unwrap(), stored);
    }

    #[test]
    fn git_is_enabled_until_the_user_disables_it_for_a_workspace() {
        let state = LocalState::in_memory().unwrap();
        assert!(state.is_git_enabled("/w").unwrap());

        state.set_git_enabled("/w", false).unwrap();
        assert!(!state.is_git_enabled("/w").unwrap());
        assert!(state.is_git_enabled("/other").unwrap());

        state.set_git_enabled("/w", true).unwrap();
        assert!(state.is_git_enabled("/w").unwrap());
    }

    #[test]
    fn the_database_file_keeps_the_data() {
        let dir = tempfile::tempdir().unwrap();
        {
            let state = LocalState::open(dir.path()).unwrap();
            state
                .add_history("/w", &[entry("select 1", "Local")], NOW)
                .unwrap();
        }

        let state = LocalState::open(dir.path()).unwrap();

        assert_eq!(found(&state, ""), vec!["select 1"]);
    }
}
