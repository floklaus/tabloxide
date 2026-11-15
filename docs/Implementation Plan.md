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

Status on 2026-11-14: M7 is complete in code.

## 6. Phase 3 outline — differentiators

* Autocomplete from the schema cache.
* SQL formatting and snippets.
* Explain-plan view.
* Schema diff and migrations.
* Data editing with explicit transaction controls.
* More engines.
* Integrations with hosted Git providers.

Set the sequence of these items from user feedback after the public release.

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
