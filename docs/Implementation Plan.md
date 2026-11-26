# Tabloxide — Implementation Plan

This plan accompanies `Cross-Platform SQL Client Feature Backlog.md`. It gives the full plan for Phase 1 (usable MVP). It gives the milestones of Phase 2 and an outline for Phase 3.

## 1. Product decisions

Section 7 of the backlog lists four open product decisions. The product owner accepted the answers in the table on 2026-11-14. A different answer changes only the parts in the last column.

| Decision | Answer | Effect of a different answer |
|---|---|---|
| First database engine | PostgreSQL | Replace the adapter in M2 and M4. The other parts do not change. |
| Git implementation | System `git` executable | Replace the internals of the `git` crate. The command API does not change. |
| Scope | Query workbench only. No data editing. No schema management. | Data editing adds a milestone after M4. It also adds transaction controls to the UI. |
| Primary user | One developer who keeps SQL in a Git repository | A team focus moves shared connection definitions and conventions from Phase 3 to an earlier phase. |

## 2. Technology stack

| Area | Selection | Reason |
|---|---|---|
| Shell | Tauri 2 | The backlog specifies it. |
| UI | React, TypeScript, Vite | This stack has the most components for the editor, the grid, and the panes. |
| Editor | CodeMirror 6 with `@codemirror/lang-sql` and `@codemirror/merge` | It is small and it supports SQL dialects. The merge view shows diffs in Phase 1 and merge conflicts in Phase 2. |
| Result grid | TanStack Virtual with a small grid component of the project | TanStack Virtual gives virtual rows. The grid component does the sort, the resize, and the column visibility. Each value is text, thus a table library is not necessary. |
| Panes | `react-resizable-panels` | It gives a resizable layout and it stores the pane sizes. |
| UI state | Zustand | It gives one simple store for each concern (tabs, connections, Git). |
| Typed IPC | `tauri-specta` | It generates TypeScript bindings from the Rust commands. The two sides cannot become different. |
| PostgreSQL driver | `tokio-postgres` with `rustls` | It gives direct access to row streams, cancel tokens, and error positions. `sqlx` is for queries that the developer knows at compile time. |
| Secrets | `keyring` crate | It uses Keychain on macOS, Credential Manager on Windows, and Secret Service on Linux. |
| Local state | SQLite through `rusqlite` in the app data directory | It holds the query history and the UI state of one machine. It is never in the repository. |
| Project configuration | TOML file in the workspace root | A person can read it, and Git shows clear diffs for it. |
| Tests | `cargo test`, `testcontainers` for PostgreSQL, Vitest, WebdriverIO with `tauri-driver` | Refer to section 7. |
| CI and release | GitHub Actions with `tauri-action`, `tauri-plugin-updater` | They build the app on the three platforms and they make signed update files. |

## 3. Architecture

### Repository layout

```
tabloxide/
  crates/
    core/               domain types, DbAdapter trait, SQL statement splitter, safety classifier
    adapter-postgres/   PostgreSQL implementation of DbAdapter
    adapter-duckdb/     DuckDB implementation of DbAdapter
    git/                wrapper for the system git executable
    workspace/          project configuration, local state, history, secret references
  src-tauri/            Tauri commands and app wiring only, no business logic
  ui/                   React app, one folder for each feature (connections, editor, results, schema, git)
  docs/
```

The Rust crates outside `src-tauri` do not depend on Tauri. Thus tests can run without a window, and a later CLI can use the same crates.

### Adapter boundary

The `DbAdapter` trait in `core` is the only database interface that the other parts of the app use. It has these operations:

* `connect(profile, secret) -> Session`
* `Session::execute(statement) -> ResultStream`. The stream gives the column metadata, then pages of rows, then the affected-row count and the timing.
* `Session::cancel()`
* `Session::introspect(...)` for schemas, tables, views, columns, indexes, and constraints.
* `capabilities()`. The UI hides the functions that an engine does not support (read-only mode, sockets, cancel).

Phase 2 adds a second engine to test this boundary. Until then, do not put PostgreSQL-specific types in `core`.

### Query execution

* **One session for each query tab.** Cancel, transactions, and session settings of one tab do not affect a different tab. The schema browser uses its own session.
* **Incremental fetch.** The backend holds the row stream. It sends a page of rows to the UI through a Tauri channel only when the grid requests more rows. Between pages, the backend does not read from the socket. Thus memory use stays bounded on the two sides. A configurable row limit stops the fetch.
* **Values as text.** The backend runs user SQL with the simple query protocol. This protocol returns each value in the PostgreSQL text form.
  * The app does not need a decoder for each data type.
  * The grid shows values the same as `psql` shows them.
  * The simple query protocol of the driver gives the column names only. Thus the backend prepares the statement first and reads the column types from the prepared statement. If the preparation fails, the grid shows the columns without types.
* **Paged statements.** The backend pages only a statement that reads data (`SELECT`, `TABLE`, `VALUES`, and `WITH` without a data change). To close a paged result early, the backend cancels the statement.
  * The backend reads all rows of each other statement immediately. A cancel of such a statement would undo its data change. The backend keeps a bounded number of these rows.
  * In a script, only the last statement can stay open. The backend reads each earlier statement to its end.
* **Statement splitter in Rust.** The command "Run current statement" needs a splitter that understands strings, dollar quotes, and comments. The splitter is in `core` and has a large table-driven test suite. The splitter offsets convert the error position from the server to an editor line and column.
* **Cancel.** The backend sends the cancel token of the driver on a separate connection. The tab shows one of these states: running, cancelling, cancelled, failed.

### Results of the M2 spike

The spike ran on 2026-11-14 against PostgreSQL 17 in a container, with a table of 5 million rows and 7 columns.

| Question | Result |
|---|---|
| Time to the first 500 rows | 2 ms |
| Memory of the process during a pause of 3 seconds | No change (9.7 MB). The server waited in the `ClientWrite` state, thus the driver did not read from the socket. |
| Memory of the process while it read 2 million rows in pages | 9.8 MB maximum |
| Cancel during the fetch | The stream stopped after 7 ms with SQLSTATE `57014`. The session was usable again. |
| Column types from the simple query protocol | Not available. The driver gives the names only. |
| Column types from a prepared statement | Available. The preparation took less than 1 ms. |
| A result that the code drops without a cancel | The next statement waited 6.4 seconds, because the server sent all remaining rows. Thus the backend must cancel a result that it closes early. |
| Error position | The server gives a character position in the statement text. |

Known limit: while a paged result is open, the statement stays active on the server and keeps its snapshot. The row limit and the close of the result set a bound on this time.

### Workspace files and secrets

* Git tracks `tabloxide.toml` in the workspace root. This file holds the connection definitions without secrets.
  * It holds the host, the port, the database, the user, the TLS mode, and the environment marker.
  * It holds a reference to a keychain entry name or to an environment variable.
* Passwords are only in the OS credential store. The key is the workspace and the connection ID.
* Machine-specific state is in the app data directory. The key is the workspace path. This state includes the open tabs, the pane sizes, the history, and the last connection.
* The starter `.gitignore` excludes exports and logs.
* A redaction type in Rust contains each secret. Thus the code cannot write a secret into a log or an error message.

### Git

* Each operation runs `git` with machine-readable output (`status --porcelain=v2 -z`, `diff`, `log --format=...`).
* Each operation sets `GIT_TERMINAL_PROMPT=0`. If a credential is missing, the operation fails with a clear message and does not stop responding.
* Phase 1 authentication uses the methods that operate in the terminal of the user: the SSH agent and the Git credential helpers. Phase 2 adds an in-app prompt through `GIT_ASKPASS`.
* At startup, the app finds `git` and reads its version. If `git` is missing, the app disables the Git panel and gives install instructions.
* Fetch, pull, and push send progress lines to the UI as a stream.
* A file watcher on the workspace updates the Git status. It also reloads editor tabs when their files change on disk.
* A tab with unsaved changes asks the user before it reloads. For the same reason, a branch switch keeps unsaved buffers in memory.

### Safety

* The tab and the run button always show the active connection name and the environment marker. Production has a different colour.
* A classifier in `core` flags destructive statements: `DROP`, `TRUNCATE`, `ALTER`, and `DELETE` or `UPDATE` without `WHERE`.
* The app asks for confirmation before it runs a flagged statement. It also asks before it runs a statement on a production connection. The user can configure the two rules.
* A read-only connection sets `default_transaction_read_only = on` for the session.
* The backend uses parameters in all introspection queries.
* To save a file, the app writes a temporary file and then renames it. Thus a crash cannot leave a script that is only partly written.

## 4. Phase 1 milestones

Status on 2026-11-14: the milestones M0 to M6 are complete in code. The sections below show the plan. The commit messages show what each milestone delivered and where it is different from the plan.

The estimates assume one full-time developer. They are approximate.

### M0 — Foundation (1 week)

* Scaffold the Tauri 2 app, the Cargo workspace, and the React UI. Connect `tauri-specta`.
* Add lint, format, and test commands for the two languages.
* Add a GitHub Actions matrix that builds the app and runs the unit tests on macOS, Windows, and Linux.
* Build the app shell with three resizable panes (sidebar, editor, results) and with light and dark themes.

Completion criterion: CI makes a build that starts on the three platforms.

### M1 — Connections and secrets (1.5 weeks)

* Read and write `tabloxide.toml`. Open a folder as a workspace. Show recent workspaces.
* Create, edit, duplicate, delete, and test connections.
* Support these fields: host, port, database, user, TLS mode, extra parameters, Unix socket path, environment marker, timeouts.
* Store passwords through `keyring`. Support references to environment variables.
* Show the connection status. Show error messages that tell the user what to correct (authentication, TLS, unreachable host, timeout).

Completion criterion: the user can create a connection, test it, and open it again after a restart. No file on disk contains a secret.

### M2 — Execute and results (2.5 weeks)

* Do a short spike first. Check the text protocol and the paged stream against a table that has millions of rows.
* Write the `DbAdapter` trait and the PostgreSQL adapter: connect, execute, cancel.
* Write the statement splitter and the error position conversion.
* Build the result grid: virtual rows, sort, column resize, column visibility, copy of cells and rows, a clear marker for NULL.
* Show the affected-row count, the elapsed time, and the execution state.
* Run the statements of a script in sequence. Stop at the first error.
* Export results to CSV as a stream from the backend to a file.

Completion criteria for a query on a table that has millions of rows:

* The first page shows quickly.
* Memory use stays constant while the user scrolls.
* Cancel operates during a fetch.

### M3 — Editor, tabs, and history (2 weeks)

* Build the CodeMirror SQL editor with highlighting, bracket matching, and indentation.
* Add editor preferences: font size, tab width, line numbers, word wrap.
* Add tabs for workspace files and for untitled buffers. Show a marker for unsaved changes. Warn before a tab with unsaved changes closes.
* Run the current statement, the selection, or the full script. Add keyboard shortcuts.
* Store the query history in SQLite with search and re-run. Make the retention configurable. Do not record data from connection strings.
* Restore the window state, the open tabs, and the pane sizes.
* Add a file tree for the workspace in the sidebar.

Completion criterion: a work session is the same after an app restart.

### M4 — Schema browser (1.5 weeks)

* Build a tree of databases, schemas, tables, views, columns, indexes, and constraints. Load each node only when the user opens it.
* Build a table detail view that shows the structure and a bounded row sample (`LIMIT`).
* Add a manual refresh.

Completion criterion: the tree stays responsive on a database that has several thousand tables.

### M5 — Git (2.5 weeks)

* Open an existing repository, initialise a repository, or clone a repository.
* Find the root, the branch, the upstream, and the ahead and behind counts.
* Show a status list for workspace files. Stage, unstage, and discard changes. Ask for confirmation before a discard.
* Show diffs with the CodeMirror merge view. Commit with a message. Explain a missing user identity.
* Create and switch branches without loss of unsaved buffers.
* Fetch, pull, and push with progress. Pull does a fast-forward or a merge.
* Report a merge conflict to the user. Until Phase 2, the user resolves the conflict in the terminal.
* Add a setting for each workspace that disables Git. Add the starter `.gitignore`.

Completion criterion: the user can edit, commit, and push a script from the app, then pull it on a second machine from the app.

### M6 — Hardening and first release (1.5 weeks)

* Add the confirmations for destructive statements and for production connections. Add read-only mode.
* Reconnect after a connection drops.
* Audit that no secret goes into logs, history, or error messages.
* Add the automated smoke test to CI (refer to section 7). Make installers for the three platforms. Publish checksums.
* Do the primary flows with the keyboard only.
* Write a README with install and build instructions.

Total: approximately 12 to 13 weeks.

### Sequence and parallel work

M0 and M1 are first. After M1, the database milestones (M2 to M4) and the Git milestone (M5) share only the shell and the workspace code. Thus two developers can do them at the same time. M6 is after M4 and M5.

## 5. Phase 2 milestones — public release

Phase 2 has six milestones. The sequence puts the work that needs no decision of the product owner first.

| Milestone | Content | Necessary from the product owner |
|---|---|---|
| M7 — Git history and conflicts | Commit history with a diff for each commit. Branch rename and delete. Conflict resolution with a side-by-side view. Abort of a merge. | Nothing |
| M8 — Git credentials and live status | In-app prompts for Git credentials and passphrases through `GIT_ASKPASS`. A stream of progress lines for fetch, pull, and push. A file watcher that updates the Git status and the open tabs. | Nothing |
| M9 — Second engine | SQLite as the second engine. Changes to `DbAdapter` that the second engine shows to be necessary. | Agreement with SQLite, or a different selection |
| M10 — Guardrails and large results | Guardrails that the user can configure for each environment. Column virtualization in the grid. Keyboard resize of columns. | Nothing |
| M11 — Packaging | Code signing and notarisation. Automatic updates that the user can defer. Release notes. | Certificates for macOS and Windows, and a remote repository |
| M12 — Accessibility and documentation | An accessibility audit with screen readers on each platform. User documentation: install, troubleshooting, contribution, security reports. | A person who does the audit with a screen reader |

Notes:

* SQLite is the recommended second engine.
  * It tests the adapter for a database that is a file without a server.
  * Its tests need no server. The project uses `rusqlite` already.
  * MySQL tests the adapter for a different SQL dialect. It can be the third engine.
* Expect changes to `DbAdapter` in M9.
* M11 cannot be complete without the certificates. Without them, the milestone delivers the updater and the workflow steps only.

Status on 2026-11-15: M7, M8, and M9 are complete in code. The second engine is DuckDB, not SQLite. The product owner made this selection after the spike below.

Status of M10 on 2026-11-15: M10 is complete in code.

* The preferences have a confirmation rule for each environment: never, before a risky statement, or before each run. The defaults are the behaviour of Phase 1.
* The rule "before a risky statement" covers the DuckDB statements that write files or load an extension. A DuckDB statement that reads a file of the disk has no confirmation.
* The result grid renders only the visible columns.
* Alt+Shift+Left and Alt+Shift+Right change the width of the column of the selected cell.

Status of M11 on 2026-11-22: M11 is complete in code, but not tested. A test needs a remote repository, the keys, and the certificates. `docs/release.md` tells the product owner how to add them.

* The release notes are in `CHANGELOG.md`. The release workflow copies the section of the version into the release.
* The application has an updater. It checks for a newer version at the start. The user can install the version, defer it until the next start, or disable the check in the preferences.
  * The application starts the updater only when the build has the updater settings. The repository has no updater settings. The release workflow adds them only when the repository has the signing key. Thus a development build has no updater, and it does not send a request.
  * The UI calls two commands of the application. It cannot call the commands of the updater plugin directly.
* The release workflow signs the update files and writes `latest.json` when the repository has the updater key.
* The release workflow signs and notarises the macOS application when the repository has the Apple certificate. It signs the Windows installers when the repository has a `.pfx` certificate.
* Not done:
  * A sign step for a certificate in a hardware module or a cloud service.
  * Updates for the `.deb` and `.rpm` packages, if the bundler makes no signature for them. Such an installation can then receive the AppImage as its update. This is not tested.

Status of M12 on 2026-11-15:

* The user documentation is complete: `docs/user/install.md`, `docs/user/troubleshooting.md`, `CONTRIBUTING.md`, and `SECURITY.md`.
* The automated part of the accessibility audit is complete.
  * Each UI test checks the rules of axe-core on the DOM that it leaves.
  * A test checks the colour contrast of the two themes.
  * The editor tabs, the file tree, and the dialogs have the keyboard behaviour of the ARIA patterns.
* The audit with a screen reader on each platform is open. It needs a person.
* The procedures for macOS and Windows in `install.md` come from the build configuration. No person did them on these systems.
* `SECURITY.md` refers to the private report function of the repository host. The owner must enable this function when the remote repository exists.

Changes to the adapter boundary in M9:

* A connection profile has an `engine` field. A profile without this field is a PostgreSQL profile, thus an old `tabloxide.toml` stays valid.
* For a file engine, `database` is the path of the file. A relative path starts at the workspace folder. Such a profile has no host, no user, and no password.
* `connect` and `test_connection` of `DbAdapter` have the workspace folder as a new parameter.
* The application state has one adapter for each engine. The DuckDB adapter holds the open database files.
* The traits `Session`, `ResultStream`, and `CancelHandle` did not change.
* The classifier in `core` accepts the read statements of DuckDB (`FROM`, `DESCRIBE`, `SUMMARIZE`, `PIVOT`, `UNPIVOT`). It has two new risks: a statement that writes files, and a statement that loads an extension.

Design of the credential prompts (M8):

* Git and SSH start a helper program when they need an answer from the user. The helper program is the executable of the application.
* When the environment has the variables of a prompt, the executable does not open a window. It sends the prompt to the application that runs, prints the answer, and stops.
* The application listens on the loopback address. Each Git operation has a random token, and the application answers only a request with a known token.
* The UI shows the prompt in a dialog. The answer goes to Git only. No part of the application stores it.
* If the user gives no answer in 5 minutes, Git stops the operation.

### Results of the DuckDB spike

The spike ran on 2026-11-14 on Linux with the crate `duckdb` 1.20000.2 and its `bundled` feature (DuckDB 2.0.0). The table had 5 million rows and 7 columns in a database file of 118 MB. The spike code is not in the repository.

| Question | Result |
|---|---|
| Clean build with the bundled DuckDB, 16 processor cores | Debug: 6 min 35 s. Release: 7 min 30 s. The two builds used 65 and 99 minutes of processor time. |
| Size of the release executable of the spike | 52 MB without symbols |
| Time to the first 2048 rows of a stream | 51 ms |
| Memory during a pause of 3 seconds in a stream | No increase |
| Memory while the stream read 2 million rows | 255 MB maximum. The process had 225 MB before the read. |
| A stream that the code drops early | The drop took less than 1 ms. The next statement ran immediately. A cancel is not necessary. |
| A statement with `ORDER BY` on all rows | First rows after 328 ms. The memory of the process increased by 500 MB. |
| Cancel of a long statement | The statement stopped 4 ms after the interrupt. The connection was usable again. |
| Cancel during a stream | The next read gave the interrupt error. The connection was usable again. |
| Values as text | `SELECT CAST(COLUMNS(*) AS VARCHAR) FROM (statement)` gives each value as the text of DuckDB, also for lists, structures, and maps. `NULL` and the empty string stay different. |
| Column names and types | `DESCRIBE statement` gives them in 2 ms and does not run the statement. The text wrapper changes a column name that occurs two times, thus the names must come from `DESCRIBE`. |
| Error position | With the setting `errors_as_json`, the error has a character position that starts at 0. |
| Number of changed rows | `execute` returns it. |
| More than one statement in one text | DuckDB runs all of them and returns the result of the last one. The statement splitter of `core` must split the text first. |
| Catalog queries with parameters | `information_schema` gives the schemas, the relations, and the columns. `duckdb_constraints()` and `duckdb_indexes()` give the constraints and the indexes. |
| Query of a CSV file | `select * from 'file.csv'` operates without an import. |
| Read-only mode | The database refuses a write, and a statement cannot change the mode. |

Design rules for the adapter that come from the spike:

* **One instance for each file.** The adapter opens a database file one time and makes each session with `try_clone`.
  * A second open of the same file in the same process made a second, independent instance. The two instances did not see the changes of each other.
  * When the code dropped the second instance, the process lost its file lock, and a different process could open the file for a write.
* **A worker thread for each session.** The API blocks, and a stream borrows its statement and its connection. Thus one thread must own the three.
* **A clone is independent for cancel.** An interrupt of one clone did not stop the stream of a different clone.
* **File lock between processes.** While the application has a file open for a write, no other process can open it, also not for a read. Many processes can open one file in read-only mode at the same time.
* **Access to the machine.** A DuckDB statement can read and write files on the disk and can install and load extensions. The setting `enable_external_access = false` stops this, but it also stops the query of CSV files. The guardrails of M10 must cover this.

Not measured: the build on macOS and on Windows, and the build time on the CI machines, which have fewer processor cores.

## 6. Phase 3 outline — differentiators

* Autocomplete from the schema cache.
* SQL formatting and snippets.
* Explain-plan view.
* Schema diff and migrations.
* Data editing with explicit transaction controls.
* More engines.
* Integrations with hosted Git providers.

Set the sequence of these items from user feedback after the public release.

Status on 2026-11-22: no user feedback exists yet. Thus the sequence below starts with the items that need no decision of the product owner. The item "More engines" is the connector design in `Connector Design.md`. It has its own stages and is not in this table.

| Milestone | Content | Necessary from the product owner |
|---|---|---|
| M13 — Completion | Completion of schemas, tables, views, and columns from a cache of the catalog | Nothing |
| M14 — Formatting and snippets | A command that formats SQL. Snippets that the workspace stores. | Nothing |
| M15 — Plan view | A tree view of the execution plan of PostgreSQL and DuckDB, with the costliest steps marked | Nothing |
| M16 — Schema diff and migrations | A comparison of the structure of two connections. A migration script from the differences. | The format of the migration files, or the migration tool of the team |
| M17 — Data editing | A change of cells in the result grid, with explicit transaction controls | The rules for a production connection, and if a table without a primary key can change |
| M18 — Git hosting | Pull requests and the review state of the hosted Git service | The providers (GitHub, GitLab, or a different one) |

Status of M13 on 2026-11-22: M13 is complete in code.

* Each connection has its own catalog session for the completion. Thus a read of the catalog never closes an open result of a query tab.
* The cache reads the schemas and the tables at the first completion. It reads the columns of a table only when the completion needs them.
* The cache reads the catalog again after a statement without rows, after a refresh of the schema browser, and after a change of the connection.
* After an alias and a dot, the list offers the columns of that table. Without a qualifier, the list starts with the columns of the tables of the statement.
* The statement reader of the completion is in the UI. It does not use the statement splitter of `core`, because the completion needs an answer without a call to the backend.

Status of M14 on 2026-11-22: M14 is complete in code.

* The formatter is the library `sql-formatter` 15.9.0. It knows the dialects of PostgreSQL and DuckDB. The keywords keep the case that the user typed.
* A snippet is a file in `.tabloxide/snippets/` of the workspace. The first line can be a comment with the description. `${name}` marks a field.
* Six built-in snippets are available. A snippet of the workspace replaces a built-in snippet with the same name.
* The completion list joins the snippets, the catalog, and the keywords.

Status of M15 on 2026-11-22: M15 is complete in code.

* The command `plan_read` reads the plan with `EXPLAIN (FORMAT JSON)` or `EXPLAIN (ANALYZE, FORMAT JSON)`. It uses the checks of the assistant: one statement, and `ANALYZE` only for a statement that reads data.
* The UI reads the JSON of each engine into one tree. The tests use real plans of PostgreSQL 17 and DuckDB 2.0.
* After `ANALYZE`, the share of a step is its time without its child steps. Without `ANALYZE`, the share of a PostgreSQL step is its cost without its child steps. DuckDB gives no cost, so its estimated plan has no shares.
* The view marks the three steps with the largest share, and each step whose actual rows are 10 times more or fewer than the estimate.
* Like the assistant, the plan read uses the session of the tab and closes its open result. The results pane tells the user why the result ended.

Status of the new navigation on 2026-11-22: the product owner asked for the UI of the design canvas in `.design/imported/`. The first part is complete in code.

* Done:
  * The menu bar, the command palette, the tool strips, and the status bar.
  * The title bar widgets for the project, the connection, and the branch.
  * The View menu with the panels, the results position, the zoom, and full screen.
  * The themes neon and high contrast.
* One command list feeds the menus, the palette, and the shortcuts. A menu item shows only a function that exists.
* Done later on 2026-11-22: the layout editor, the custom layouts, and the compact density.
* Not done in the layout editor: a drag of the dividers in the preview. The two size fields do the same work.
* Not done: the assistant in its own tab, and the screens for other kinds of databases.
* Not done because the function does not exist: Save as, Import, SSH tunnels, and certificates.
* Also not done for the same reason: stash, the Git history of one file, and remote branches in the branch menu.
* The design gives `Ctrl+K` to the command palette and to Commit. The palette has `Ctrl+K`. Commit has no shortcut.

Status on 2026-11-16: the product owner added an AI assistant to this phase, and it is complete in code. It writes SQL for the schema of the connected database, and it analyzes the plan of a statement that it reads with `EXPLAIN`. Thus the item "Explain-plan view" has a first part: the plan as text with an analysis. A graphic view of the plan is not started.

Decisions of the product owner for the assistant:

* The AI service is the Claude API of Anthropic, with the API key of the user. The code calls the service through the interface `ChatProvider` of `crates/assistant`, so that a second service needs only a second implementation.
* A request sends the structure of the database, the conversation, and the plan text. It sends no rows. On 2026-11-25, the product owner added one exception: "Ask about these rows" in M19.
* The plan comes from `EXPLAIN`. `EXPLAIN ANALYZE` is on request, and only for a statement that reads data.
* The assistant is a side panel. The application never runs the SQL of an answer.

Not done: a test against the real service. The tests use a local test server and a test provider.

### M19 and M20 — AI in each feature, and the Git console

Status on 2026-11-25: the product owner asked for AI actions in each main feature. The product owner also asked for an embedded Git console for experienced users. The design is on the design canvas, in the section "AI in each feature, and the Git console". The copy is in `.design/imported/`. No code exists yet.

The work has two milestones:

* **M19:** AI actions in the Git panel, the query errors, the editor, the schema browser, and the result grid.
* **M20:** the Git console.

M20 does not need M19, except for the button "Explain the last output". Thus the two milestones can go in parallel after stage 1 of M19.

#### Decisions of the product owner

The product owner made these decisions on 2026-11-25:

| Decision | Answer |
|---|---|
| Features with AI actions | Git, query errors, editor, and schema |
| Rows | A request sends no rows. Only the action "Ask about these rows" sends rows, after a confirmation. |
| Number of rows | A preference sets the number: 1 to 1000, default 100. |
| Production | A production connection never sends rows to the AI service. No setting changes this. |
| Git console | Git commands only. No shell. |
| Writing style | Each text of the AI is in Simplified Technical English, after the rules of ASD-STE100. Code and names do not change. |

The rules on the design canvas apply to each AI action:

1. A sparkle icon in the accent colour marks each AI action.
2. An answer goes to the assistant panel, as a step of the current session. There are two exceptions. The commit message goes into the message field. A change of the selection shows as a diff in the editor.
3. The application never runs SQL from an answer. It never runs a Git command from an answer. The user accepts each change.
4. Only "Ask about these rows" sends rows.
5. The Git console runs no shell.

These decisions replace one decision of 2026-11-16: "A request sends no rows." That rule stays true for all actions except "Ask about these rows".

#### Architecture

The backend builds the context of each request. The UI does not send free context text. The backend has three reasons for this:

* The backend can enforce the rows rule and the production rule. A check in the UI only is not sufficient.
* The backend limits the size of the context and removes credentials, in one place for all actions.
* The backend tells the UI exactly what it sent. The panel shows this text. An example is "Sent: the statement, the error message, and the structure of 12 tables".

Changes in `crates/assistant`:

* `Task` gets one value for each action:
  * `QueryError`, `ChangeSelection`, `ExplainSelection`.
  * `ExplainTable`, `StarterQuery`.
  * `CommitMessage`, `ExplainDiff`, `Conflict`, `GitOutput`.
  * `Rows`.
  * `Sql` and `Plan` stay.
* A new type `ActionContext` holds the data of one action. Examples are the statement, the error, the selection, the diff, the conflict block, the Git output, and the rows. `ActionContext::render` makes the text that goes to the AI service. `ActionContext::summary` makes the "Sent:" text.
* `chat_request` adds a third system part with the instructions of the task. The instructions and the schema stay the first two parts. Thus the service can keep them for the next request.
* Each task sets its effort. `Plan` and `Conflict` use `High`. The other tasks use `Medium`.
* The writing style is part of the first system part, so it applies to each task. Since 2026-11-25, the instructions tell the AI service to write in Simplified Technical English, after ASD-STE100.
  * The style applies to the explanations, the commit message, the explanation of a conflict, and the explanation of Git output.
  * The style does not apply to code, names, and quoted error messages.
  * A commit message keeps the subject limit of 72 characters. Its body follows the sentence limits of the style.
* Size limits: 60 000 characters for a diff, 20 000 characters for Git output, and 500 characters for each value of a row. A text that is longer than its limit gets a clear marker where the cut is. The summary tells the user about the cut.

Changes in `src-tauri`:

* `AskRequest` gets `context: Option<ActionContextRequest>`. The request has identifiers only where the backend has the data. Examples are the path of a staged file, or the path and the number of a conflict block.
* The backend reads the Git data itself, with the `git` crate. The UI sends text only for the data that the backend does not have. This data is the error of a query, the selection, and the rows.
* For `Rows`, the backend reads the environment of the connection from the workspace at the time of the request, through `connection_id` of the session. Thus a connection that changed to production after the connect also refuses rows. A request without a session refuses rows.
* `AssistantEvent` gets `Sent { summary }`. The backend sends it before the first answer text.

Changes in the UI:

* A component `AiAction` shows the sparkle button. If no API key exists, it opens the setup of the assistant, as the panel does now.
* The session view shows the "Sent:" line and the new step kinds.
* An answer that has one SQL block gets the buttons that its action needs: "Replace in the editor", "Open in a new tab", or "Accept".

#### M19 stages

**Stage 1: foundation (1 week).**

* `Task`, `ActionContext`, the instructions of each task, and the `Sent` event.
* The component `AiAction` and the new step kinds of the session view.
* The preference `assistant.rows_for_ai`, 1 to 1000, default 100. It goes on the tab "AI assistant" of the Preferences dialog. The tab also shows: "A production connection never sends rows, and no setting changes this."
* Unit tests for the context text, the limits, the summaries, and the third system part.

Status of stage 1 on 2026-11-25: stage 1 is complete in code.

* The context of an action goes with its message of the user, as `ChatMessage.context`. Thus a later request of the session sends the data of the earlier actions again. The backend puts the data into the text between tags, and the instructions tell the AI service that this text is data.
* Stage 1 has the data that the UI sends: `QueryError`, `Selection`, and `GitOutput`. The data that the backend reads (the diff, the conflict, the table, and the rows) comes with stages 4 to 6.
* A Git task sends no structure of the database, and it does not connect the tab.
* No feature shows an AI action yet. Stage 2 adds the first one.

**Stage 2: query errors (0.5 weeks).**

* The error of a query gets the button "Explain and fix".
* The request sends the statement, the error message, the position, the hint, the SQLSTATE code, and the schema.
* The answer goes to the panel. Its SQL block gets "Replace in the editor". This replaces the text of the statement that failed. The UI keeps the range of that statement with the error.
* If the editor text in that range changed after the error, "Replace in the editor" is not available. Then "Copy" stays available.

Status of stage 2 on 2026-11-25: stage 2 is complete in code.

* "Explain and fix" is on an error of the kind `database` or `other`. A cancel, a timeout, or a lost connection does not get it.
* The request also sends the detail of the error.
* "Replace in the editor" is available only while all text of the tab is the same as at the run. A check of the range of the statement only is not sufficient, because text after the statement does not change the range.

**Stage 3: editor (1.5 weeks).**

* `Ctrl+I` opens an instruction field at the selection. Without a selection, the statement at the cursor is the selection. The UI finds it with the statement reader of the completion.
* The request sends the selection, the instruction, and the schema.
* The answer must have exactly one SQL block. Another answer is an error that the field shows.
* The editor shows the change as an inline diff, with `@codemirror/merge`.
  * `Ctrl+Enter` or "Accept" applies the change.
  * `Esc` or "Reject" removes the diff.
  * "Change again" sends a new instruction in the same conversation.
* If the user changes the text of the selection while the request runs, the UI discards the answer and tells the user why.
* `Ctrl+Shift+I` explains the selection in the assistant panel.
* Add the two shortcuts to the command list and to the help screen. Before the work starts, check that no other command uses them.

Status of stage 3 on 2026-11-25: stage 3 is complete in code.

* The editor shows the proposal as decorations: the old text struck through, and the new text as a block below it. The text of the document changes only at "Accept". Thus a proposal is not in the undo history, and "Reject" changes nothing.
* The editor is read-only from `Ctrl+I` until the change closes. This replaces the plan to discard the answer after a change of the text, because the text cannot change.
* A tab that the user leaves gets its state without the proposal and without the lock. The change closes.
* The default keys of the editor give `Ctrl+I` to "select the parent syntax". The AI keys come first, with the highest precedence. `Ctrl+Enter` during a change accepts the proposal and does not run a statement.
* The instruction field is a box at the bottom of the editor, not at the selection.
* The conversation of a change is a session that is not in the list of the panel.

**Stage 4: schema browser (0.5 weeks).**

* The menu of a table or a view gets "Explain the table" and "Write a starter query".
* The request sends the detail of the relation: the columns, the keys, the indexes, the constraints, and the references in the two directions. It uses `schema_relation_detail`. It sends no rows.
* "Explain the table" goes to the panel.
* "Write a starter query" opens a new editor tab with the name "<table>: starter query". The tab has the SQL of the answer. The application does not run it.

Status of stage 4 on 2026-11-25: stage 4 is complete in code.

* The two actions are in the Table view of the results pane, not in a menu of the schema tree. Each row of the tree hides the content outside the row, thus a menu at a row would be cut.
* The UI sends the schema and the name of the table. The backend reads the structure with `relation_detail` and puts it into the request. The UI cannot set the structure, because the field is not in the input.
* "Write a starter query" opens a new tab only for an answer with exactly one code block. The tab gets the connection of the SQL tab.

**Stage 5: Git (1.5 weeks).**

* **Commit message.** The message field gets a sparkle button, and then "Write again".
  * The request sends the staged diff (`git diff --cached --no-color --no-ext-diff`) and the subjects of the last 10 commits, for the style.
  * It does not send binary files.
  * For a diff that is longer than the limit, the request sends `--stat` and the first part of each file.
  * The answer is a subject of 72 characters or fewer, an empty line, and a body. It goes into the message field.
  * If the field has text that the user typed, the UI asks before it replaces the text.
* **Explain the changes.** The diff view gets this button. The request sends the diff of the one file in the view.
* **Merge conflict.** The conflict view gets "Propose a resolution".
  * The request sends the base, the current, and the incoming version of the one block, with 20 lines of context. The data comes from `ConflictSides`.
  * The answer has one SQL block and an explanation.
  * "Accept" puts the block into the result. "Edit in the result" puts it there and moves the focus to it. "Reject" removes the proposal.
  * The user still marks the file as resolved.
* The `git` crate removes credentials from the remote addresses in each text, with `redact_credentials`.

Status of stage 5 on 2026-11-26: stage 5 is complete in code.

* The UI sends only the path of a file, or nothing for the commit message. The backend reads the Git data in `src-tauri/src/commands/assistant_git.rs`. The fields of the data are not in the input of the command.
* The staged diff uses `--no-ext-diff` and `--no-textconv`, because a diff program or a text conversion of the configuration can run other programs.
* "Explain the changes" gets a unified diff that the backend makes with the crate `similar` from the two sides of the diff view. Thus it is the same as the view, also for a new file.
* The conflict view has no blocks. It shows the whole file. Thus "Propose a resolution" sends the three versions of the whole file, with a limit of 60 000 characters, and the proposal is the whole result.
* The commit message request runs in a session that is not in the panel, because the answer goes into the field.

**Stage 6: ask about these rows (1 week).**

* The results toolbar gets "Ask about these rows". Its position is not on the design canvas yet. Add it to the canvas before this stage starts.
* For a production connection, the button is not available. Its tooltip gives the reason.
* The confirmation dialog shows the number of rows, the columns, and the connection with its environment. Its button tells the number, for example "Send 100 rows".
* The request sends the column names and types, and the first N rows of the result in the grid. N is the preference. A NULL value has a clear marker. Each value has a maximum of 500 characters.
* The backend refuses the request for a production connection, for a request without a session, and for more rows than the preference permits.

Status of stage 6 on 2026-11-26: stage 6 is complete in code. M19 is complete in code.

* "Ask about these rows" is in the bar below the rows of a result, next to "Export CSV". The design canvas does not have this position yet.
* The confirmation also has a field for the question. The design does not show it, but the request needs a question.
* The UI sends the rows, because only the UI has the loaded rows. The backend checks each request before the AI service gets it: a message with rows needs the session of a connection that is not production, and the number of rows must not be more than the preference. The backend reads the environment from the workspace at the time of the request.
* A later request of the session sends the earlier messages again, also their rows. Thus the same check applies to each later request.
* Only the data `Rows` has rows. The other data of the actions has no field for rows.

Completion criteria of M19:

* Each action of the design canvas works, and the panel shows what it sent.
* A test proves that each action except "Ask about these rows" sends no rows.
* A test proves that the backend refuses rows for a production connection, also when the UI sends them.
* `docs/user/assistant.md` tells, for each action, what the request sends.

#### M20: the Git console (2 weeks)

The console is a tab of the results pane, with the name "Git console". It is also in the View menu and in the command palette. It runs in the folder of the workspace.

Backend, in a new module `crates/git/src/console.rs`:

* **Words.** The console splits the line into words with the crate `shell-words`. The crate knows quotes, and it does not expand variables or file patterns.
* **Shell characters.** The console refuses a word outside quotes that has `|`, `>`, `<`, `;`, `&`, `$(`, or a backtick. The message says that the console has no shell.
* **The program.** The console always runs the `git` executable with the words as arguments. It adds `--no-pager` and `-c color.ui=never`. It sets `GIT_TERMINAL_PROMPT=0` and uses the askpass helper, as the Git panel does.
* **Options that run other programs.** The console refuses these options of the user:
  * `-c` and `--config-env`.
  * `--exec-path`, `--git-dir`, `--work-tree`, and `-C`.
  * `--upload-pack`, `--receive-pack`, and `-u` for `clone`, `fetch`, `pull`, and `push`.
* **Aliases.** The console refuses an alias that starts with `!`, because such an alias runs a shell. It reads the alias with `git config --get alias.<name>`.
* **Commands that need a terminal or a window.** The console refuses these commands, with the instruction to use the terminal of the system:
  * `rebase -i`, `add -p`, `add -i`, `commit -p`.
  * `difftool`, `mergetool`, `gui`, `citool`, `gitk`, `help`, and `instaweb`.
* **Editor.** As a second check, `GIT_EDITOR` and `GIT_SEQUENCE_EDITOR` point to the askpass helper in a new editor mode. That mode stops with an error. Thus a command that opens an editor fails at once and does not wait.
* **Destructive commands.** A command that can remove work gets a confirmation in the console before it runs. The confirmation tells the effect, from a check without changes:
  * `reset --hard`: the number of changed files from the status, and the number of commits that the branch moves back, from `rev-list --count`.
  * `clean -f`: the file list from `clean -n`.
  * `checkout -f`, `checkout -- <path>`, and `restore` of the working tree: the changed files that the command overwrites.
  * `push --force` and `push --force-with-lease`.
  * `branch -D`, `stash drop`, `stash clear`, `tag -d`, `update-ref -d`, `reflog expire`, and `gc --prune`.
* **Run.** A command can stop with "Cancel". The output has a maximum of 1 MB. After that, the console keeps the last part and shows a marker.
* **After a run.** The Git panel reads the status and the branches again.

UI:

* The line has the fixed prefix `git`.
* Up and Down select an earlier command. The application keeps the last 200 commands of each workspace in the application data directory.
* Tab completes subcommands, branch names, remote names, tag names, and file paths.
* "Explain the last output" sends the command and its output to the assistant panel. This uses the task `GitOutput` of M19.
* "Clear" removes the output from the view. It does not remove the history.

Completion criteria of M20:

* The tests of `console.rs` run against temporary repositories. They cover each refused option, the shell characters, a shell alias, the editor mode, each confirmation, and the output limit.
* A test proves that no command of the console runs a program other than `git` and the askpass helper.
* `docs/user/` gets a page about the console, with the commands that it refuses and the reason for each.

Status of M20 on 2026-11-26: M20 is complete in code. The user guide is `docs/user/git-console.md`.

* Correction of the plan: for `push`, `-u` is `--set-upstream`. The console accepts it. Only `clone -u` is `--upload-pack`, and the console refuses it.
* More refusals than the plan: `rebase --exec`, `submodule foreach`, `bisect run`, and `filter-branch` run shell commands. `clone --template` and `clone -c` can add hooks or programs. `config` refuses keys that name a program, because Git runs that program later.
* The editor check does not need the askpass helper. `GIT_EDITOR` and `GIT_SEQUENCE_EDITOR` name a program that does not exist, so Git fails at once. A test proves that `commit` without a message fails at once.
* The history is in the cache of the local state, with the key of the workspace.
* The shortcut is ``Ctrl+` ``.
* A test that proves that no program other than `git` runs is not possible with the tests of the crate. The tests prove the parts: the word split without a shell, the refusals, the editor, and the alias.

#### Sequence

| Week | Work |
|---|---|
| 1 | M19 stage 1 |
| 2 | M19 stages 2 and 4. M20 backend starts. |
| 3–4 | M19 stage 3. M20 backend and UI. |
| 5–6 | M19 stage 5. M20 history, completion, and tests. |
| 7 | M19 stage 6. "Explain the last output" in M20. |

#### Open items

* The position of "Ask about these rows" in the results toolbar. It is not on the design canvas.
* A shortcut for the Git console. The proposal is ``Ctrl+` ``, if the shortcut list does not use it.
* The design canvas also has AI connections for more than one service. M19 does not need them. The texts say "Anthropic" until the AI connections exist. After that, the texts use the name of the service of the selected connection.

### M21 — AI for each database engine

Status on 2026-11-25: the product owner asked that the AI actions also work for the engines of connectors. The first connector is MongoDB (`Connector Design.md`, section 10). This milestone is item F13 of `Database Kinds Backlog.md`. No code exists yet.

M19 assumes SQL in four places:

* The instructions of the assistant name SQL and tell the AI service to write SQL blocks.
* The schema text names tables and columns.
* The plan read uses `EXPLAIN` of PostgreSQL and DuckDB.
* The editor actions find the statement at the cursor with the SQL reader of the completion.

M21 removes these assumptions. The actions of M19 then work for each engine, in the language of the engine.

#### What does not change

* The schema text already comes from the catalog of the `Session` trait. A connector implements the same catalog with `ListSchemas`, `ListRelations`, and `DescribeRelation`. Thus the assistant gets the structure of a MongoDB database through the connector host with no new protocol operation.
* The rules of M19 stay. The backend builds each context. Only "Ask about these rows" sends rows. A production connection never sends rows. The application never runs a statement from an answer.
* The Git actions and the Git console do not depend on the engine.
* The assistant stays in the core. A connector cannot send text to the AI service, and it cannot read an answer.

#### Design

**1. The language of the request.**

* `chat_request` gets the engine and the query language from `EngineInfo`, not the name "PostgreSQL" or "DuckDB".
* The instructions have two parts. The first part is the same for each engine. It has the writing style of ASD-STE100. The second part is the guide of the language.
* The core has a guide for each language that it knows:
  * `sql`, with the dialect of the engine.
  * `mongodb-shell`, with the subset of section 10.2 of `Connector Design.md`. The guide tells the AI service that the application runs no JavaScript. Thus an answer must use only the forms of that subset.
* A language that the core does not know gets a short general guide. The panel tells the user that the answers for this language can be less exact.
* A connector does not send a guide. The text of a connector from a different source would go into each request without a check.

**2. The code blocks of an answer.**

* The guide tells the AI service the tag of its code blocks, for example `sql` or `mongodb`.
* The buttons "Insert", "Replace in the editor", and "Accept" use only a block with the tag of the language of the tab. A block with a different tag gets "Copy" only.
* Before "Accept" or "Replace in the editor", the UI shows the risk of the block. The risk comes from the classifier of the language. An example is "This statement drops the collection orders." A language without a classifier shows "The application cannot check this statement."

**3. The structure text for each engine.**

* The schema text uses the words of the engine. MongoDB has databases, collections, views, and fields. The relational engines keep schemas, tables, views, and columns.
* `DescribeRelation` gets a field `columns_from_sample`. It is `true` when the fields come from a sample of documents, as for a MongoDB collection. This is a minor change of protocol `v1`.
* The schema text then says that the field list can be incomplete.
* The structure text has names and types only. It has no values from the sample. A test of the connector conformance set (item F14) checks this for each connector.

**4. The plan read as an operation of the connector.**

* The protocol gets the operation `ReadPlan(session, statement, run)`. The answer has the plan text, the format (`json` or `text`), and the statement that the engine ran.
* The capability `explain_plan` gets a second field `plan_runs_statement`. It tells if the plan read with `run` runs the statement, as `EXPLAIN ANALYZE` does.
* The core keeps the check: `run` is permitted only for a statement that the classifier of the language marks as a read. For a language without a classifier, `run` is not available.
* MongoDB: the connector uses `explain("queryPlanner")` without `run`, and `explain("executionStats")` with `run`.
* The guide of each language tells the AI service how to read a plan of that engine.
* The plan tree view of M15 stays for PostgreSQL and DuckDB. Another engine shows its plan as text, with the analysis of the assistant.

**5. The statement at the cursor.**

* For a language other than SQL, the editor gets the statement at the cursor from the splitter of the language in the core (item F4). A new command `statement_at(language, text, offset)` returns its range.
* The completion keeps its SQL reader, because it needs an answer without a call to the backend.

**6. The values in "Ask about these rows".**

* A document or a list is a cell of the kind JSON (item F7). The request sends it as relaxed Extended JSON.
* The limit of 500 characters applies to each cell. A document that is longer gets a marker at the cut.

#### Each action and what it needs from the engine

| Action | Needs from the engine | Without it |
|---|---|---|
| Ask the assistant | A guide of the language in the core | The general guide, and a note in the panel |
| Explain and fix a query error | The error message and its position | Always available |
| Change or explain the selection | The splitter of the language, for the statement at the cursor | The user must select the text |
| Explain the table, write a starter query | The catalog | The menu items are not shown |
| Analyze the plan | `explain_plan` | The button is not shown |
| Ask about these rows | Nothing more | Always available, except for production |
| Commit message, diff, conflict, Git output | Nothing | Always available |

#### Stages

| Stage | Content | Size | Needs first |
|---|---|---|---|
| 1 | The two parts of the instructions. The guides for `sql` and `mongodb-shell`. The general guide. The tag of the code blocks and the buttons for each language. | 1 week | M19 stage 1 |
| 2 | The words of the engine in the structure text. `columns_from_sample`. The conformance test without values. | 0.5 weeks | Connector stage 4. Decision 7 of the backlog. |
| 3 | `ReadPlan`, `plan_runs_statement`, and the MongoDB plan read. The plan as text in the panel. | 1.5 weeks | Connector stage 4 |
| 4 | The risk of an answer before "Accept". `statement_at` for the editor actions. | 1 week | Item F4 for the language |
| 5 | The JSON values in "Ask about these rows". | 0.5 weeks | M19 stage 6. Item F7. |
| 6 | The documents. `docs/user/assistant.md` tells what each engine sends. The guide for connector authors tells how the assistant uses the catalog and the plan. | 0.5 weeks | Stages 1 to 5 |

Completion criteria:

* Each action of M19 works with PostgreSQL, DuckDB, and the MongoDB connector, or it is not shown, as the table above tells.
* Tests with the test provider record each request. They check the guide, the writing style, the words of the structure text, and the tag of the code blocks for each of the three engines.
* A test with a scripted connector proves that a structure text has no values, also when the connector sends fields from a sample.
* A test proves that a plan read with `run` is refused for a statement that the classifier does not mark as a read.

#### Decision for the product owner

Decision 7 of `Database Kinds Backlog.md` is still open: can the assistant send field names that come from a sample of documents? Stage 2 needs the answer.

The recommendation is yes, with these limits:

* The request sends the names and the types of the fields, and never a value.
* The schema text and the "Sent:" line tell the user that the fields come from a sample.
* The rule is the same for a production connection, because the names are structure, not data.

If the answer is no, the structure text of MongoDB has the collections, the indexes, and the validation rules only. Then the answers of the assistant for MongoDB are less exact.

## 7. Tests

| Level | Tool | Scope |
|---|---|---|
| Rust unit | `cargo test` | Statement splitter, safety classifier, Git output parsers, configuration read and write, redaction |
| Rust integration | `testcontainers` with PostgreSQL, temporary Git repositories | Adapter (execute, cancel, pages, introspection, error positions). Git operations against a local bare remote. |
| UI unit | Vitest and Testing Library | Stores, grid behaviour, forms |
| End to end | WebdriverIO with `tauri-driver` | Connect, run a query, see rows, commit a file |
| Platform | CI matrix | Credential store, path handling, packaging |

The tests have two limits:

* `tauri-driver` supports only Windows and Linux. macOS has no WebDriver for its webview. On macOS, the smoke test only starts the built app and checks that it runs. The Rust suite and the UI suite also run on macOS.
* The PostgreSQL tests that use Docker run only on the Linux CI runner. The Windows and macOS runners run the suites that do not need a container.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Large results use all the memory or freeze the UI. | Use a paged stream with backpressure and a row limit. The M2 spike must prove this design before the grid work starts. |
| The statement splitter reads PostgreSQL syntax incorrectly. | Use table-driven tests from real scripts. Include dollar quotes, nested comments, and `psql` edge cases. "Run selection" always stays available as an alternative. |
| The Linux credential store is missing (a minimal desktop has no Secret Service). | Find this at startup and tell the user. Offer references to environment variables. Never use plain-text storage without a message to the user. |
| Git authentication stops responding or fails without an explanation. | Set `GIT_TERMINAL_PROMPT=0` and timeouts. Convert common stderr messages to instructions. |
| System Git is absent or old, primarily on Windows. | Check the version at startup and give install instructions. Disable the Git panel. The database features continue to operate. |
| The webviews are different: WebKitGTK, WebView2, WKWebView. | Run the UI on the three webviews from M0. Do not use CSS and JavaScript features that are new. |
| Signing certificates and notarisation can need a long time. | Start the Apple and Windows certificate process during Phase 1. Phase 2 is the first phase that needs the certificates. |

## 9. First steps

1. Initialise the Git repository and scaffold M0.
2. Do the M2 spike early, in parallel with M1. The result stream design is the largest technical unknown.
