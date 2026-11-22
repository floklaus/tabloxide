# Release notes

This file lists the changes of each release that a user can see. The newest release is first.

The section `Unreleased` collects the changes after the last release. Before you push a release tag, change its title to the version and the date, for example `## 0.1.0 (2026-12-01)`. The release workflow copies the section of the tag into the release.

## Unreleased

This will be the first release.

### Workspace and connections

- A workspace is a folder with your SQL files. The file `tabloxide.toml` in that folder holds the connection definitions without passwords.
- You can add, edit, duplicate, delete, and test connections.
- The database engines are PostgreSQL and DuckDB. A DuckDB connection opens a database file, or a database in memory.
- A password is in the credential store of the operating system, or it comes from an environment variable.
- A connection has an environment: development, staging, or production. The run controls show the environment.
- A connection can be read-only.

### Editor and results

- SQL editor with tabs for files and for text without a file. Each tab has its own database session.
- You can run the statement at the cursor, the selection, or all statements of a tab. You can cancel a run.
- The result grid reads the rows in pages. It renders only the visible rows and the visible columns.
- The grid has sort, column resize, column visibility, and copy of a cell or a row.
- You can export a result to a CSV file.
- An error shows its position in the editor.
- The application restores the window, the open tabs, and the pane sizes after a restart.
- A file tree shows the files of the workspace.

### History and schema

- The query history has a search. You can set how many days the history stays.
- The history does not record the text of a statement that can contain a password.
- The schema browser shows schemas, tables, views, columns, indexes, and constraints. A table detail view shows the structure and a row sample.

### Git

- Open, initialise, or clone a repository.
- Status, stage, unstage, discard, diff, and commit.
- Create, switch, rename, and delete branches.
- Fetch, pull, and push with the progress of Git.
- The commit history of the current branch, with the files and the diff of each commit.
- A side-by-side view for merge conflicts. You can abort a merge.
- A dialog asks for a user name, a password, or a passphrase when Git or SSH needs one.
- The application updates the file tree, the open tabs, and the Git status after a different program changed files.

### AI assistant

- A side panel writes SQL for the schema of the connected database. Each SQL block of an answer has a button that inserts it into the editor. The application does not run it.
- The panel reads the execution plan of the statement at the cursor with `EXPLAIN`, and asks for an analysis with suggestions. On request, it uses `EXPLAIN ANALYZE` for a statement that reads data.
- The assistant uses the Claude API of Anthropic with your API key. The key is in the credential store of the operating system. The preferences select the model.
- A request sends the structure of the database, the conversation, and the plan text. It sends no rows, no passwords, and no connection settings.

### Safety

- The application can ask before a run. The preferences have one rule for each environment: never, before a destructive statement, or before each run.
- A destructive statement is `DROP`, `TRUNCATE`, `ALTER`, and `DELETE` or `UPDATE` without `WHERE`. For DuckDB, it is also a statement that writes files or loads an extension.
- The application connects again after the server closed a connection.

### Keyboard and accessibility

- All primary functions operate with the keyboard. `README.md` lists the keys.
- The editor tabs, the file tree, the result grid, and the dialogs use the keyboard patterns of ARIA.
- The text colours of the light and the dark theme have a contrast of 4.5:1 or more.

### Updates

- A release build can update itself. At the start, it asks the release page for a newer version. You can install the new version or select **Later**.
- The preferences can disable the check. **Check now** in the preferences checks immediately.
- The application installs an update only if the signature of the update file is correct.

### Known limits

- The installers have no code signature until the project has its certificates. macOS and Windows show a warning. `docs/user/install.md` gives the procedure.
- The application can update itself only when the release has update files. A release without the updater key has no update files.
- The macOS installer is for Apple silicon only.
- A person did not test the application with a screen reader.
