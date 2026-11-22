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
- The editor completes keywords, and the schemas, tables, views, and columns of the connected database. `Ctrl+Space` opens the list.
- **Explain** and **Explain analyze** show the plan of a statement as a tree in the results pane. The view marks the costliest steps and the large differences between the expected and the actual rows. This works for PostgreSQL and DuckDB.
- **Format** (`Shift+Alt+F`) formats the selection or all text in the SQL dialect of the connection. One undo step restores the text.
- Snippets: the editor offers built-in snippets and the snippets of the workspace. **Save as snippet** saves SQL in `.tabloxide/snippets/`, thus Git can track the snippets of a team.
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

### Navigation

- A menu bar with the menus File, Connections, Git, and View.
- The title bar shows the project, the connection of the active tab, and the Git branch. Each of them opens a menu to switch the project, the connection, or the branch.
- The command palette (`Ctrl+K`) finds commands, files, schema objects, and settings.
- `F1` and Help › Keyboard shortcuts show all keyboard shortcuts, with a search. The start screen has the same list.
- Tool strips on the two sides open the sidebar views and the assistant.
- The View menu shows or hides the sidebar, the assistant, the results, and the status bar. It puts the results below or beside the editor, and it has the layouts Standard and Simple.
- The status bar shows the connection, the server version, and the cursor position.
- Two new themes: neon and high contrast.
- A compact density makes the controls and the rows of the result grid smaller.
- The preferences show the themes as cards with a preview, and have the density and the layout.

### Keyboard and accessibility

- All primary functions operate with the keyboard. `README.md` lists the keys.
- The editor tabs, the file tree, the result grid, and the dialogs use the keyboard patterns of ARIA.
- The text colours of all themes have a contrast of 4.5:1 or more.
- The menus use the ARIA menu pattern, and the command palette uses the combobox pattern.

### Updates

- A release build can update itself. At the start, it asks the release page for a newer version. You can install the new version or select **Later**.
- The preferences can disable the check. **Check now** in the preferences checks immediately.
- The application installs an update only if the signature of the update file is correct.

### Known limits

- The installers have no code signature until the project has its certificates. macOS and Windows show a warning. `docs/user/install.md` gives the procedure.
- The application can update itself only when the release has update files. A release without the updater key has no update files.
- The macOS installer is for Apple silicon only.
- A person did not test the application with a screen reader.
