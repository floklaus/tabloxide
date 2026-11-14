# Cross-Platform SQL Client — Feature Backlog

## Product assumptions

* Desktop application for macOS, Windows, and Linux.
* Initial implementation uses Tauri, a TypeScript UI, and a Rust backend; the feature list is stack-independent.
* Built-in Git manages local SQL project files and scripts, with optional remote push/pull. It is not intended to replace GitHub, GitLab, or other hosting services.
* Initial database support should be deliberately narrow. PostgreSQL is a reasonable first target; add other engines through independent adapters.

## 1. Core desktop experience

### Application shell

* Installable builds for macOS, Windows, and Linux.
* Workspaces that group database connections, query files, and project settings.
* Resizable panes and a layout that accommodates editor, results, and schema navigation.
* Remembered window state, open tabs, and recent workspaces.
* Light and dark themes, keyboard shortcuts, and accessible controls.

### Connections

* Create, edit, duplicate, test, and remove database connections.
* Support common connection fields: host, port, database, username, SSL/TLS options, and connection parameters.
* Support local socket or file connections where relevant to the chosen engine.
* Securely store secrets using the operating system credential store; never write passwords or tokens into project files or Git.
* Connection profiles, labels, and environment markers (such as development, staging, and production).
* Clear connection status, reconnect behavior, and actionable error messages.
* Configurable connection and query timeouts.

### SQL editor and execution

* Syntax highlighting, indentation, bracket matching, and SQL-aware language support.
* Multiple query tabs with unsaved-change indicators.
* Execute the current statement, selection, or full script.
* Cancel a running query; show elapsed time and execution state.
* Display errors with line/column locations where the database provides them.
* Configurable query history with search and re-run.
* Basic editor preferences: font size, tab width, line numbers, and word wrap.

### Results and schema browsing

* Tabular result grid with sorting, resizing, and column visibility controls.
* Handle large result sets through pagination or incremental fetching rather than loading everything into memory.
* Copy selected cells/rows and export results to CSV; consider JSON as an additional format.
* Show affected-row counts and query timing.
* Browse databases, schemas, tables, views, columns, indexes, and constraints supported by the selected engine.
* Inspect table structure and view a bounded sample of rows.
* Refresh schema metadata and preserve the distinction between metadata and data-changing actions.

## 2. Built-in Git integration

### Repository and project workflow

* Open an existing local Git repository as a SQL workspace, or initialize a repository in a chosen folder.
* Clone a remote repository into a selected location.
* Detect repository root, current branch, dirty files, and upstream status.
* Show Git status for SQL files and related project files in the workspace.
* Stage, unstage, discard changes, and commit from the app.
* Review diffs before committing, including syntax-aware or line-based diffs for SQL files.
* Create, switch, rename, and delete branches; create and switch branches without losing unsaved editor changes.
* Fetch, pull, and push with progress and clear error reporting.
* Show commit history and inspect a commit’s changed files and diff.
* Resolve merge conflicts with a side-by-side view and explicit accept/edit actions; do not silently overwrite files.
* Respect `.gitignore`, Git configuration, and user identity; explain missing identity or authentication configuration.
* Support standard SSH and HTTPS Git remotes through installed Git or a well-scoped Git library. Avoid inventing a proprietary remote protocol.
* Allow Git integration to be disabled per workspace.

### SQL-project conventions

* Treat SQL scripts, migration files, project configuration, and documentation as versioned files.
* Provide an optional starter `.gitignore` that excludes local state, logs, exports, and secrets while preserving useful shared project files.
* Keep connection credentials and machine-specific settings out of committed files by default.
* Allow shared connection definitions to refer to environment variables or named secret-store entries rather than embedding secrets.
* Make it easy to open and execute a script from the repository while showing which connection/environment it targets.
* Clearly distinguish Git actions (editing/versioning files) from database actions (executing SQL).

## 3. Safety, reliability, and privacy

* Make the active connection and environment unmistakable before executing SQL.
* Provide a configurable confirmation for destructive statements or execution against production-marked connections.
* Support read-only connection mode where the database supports it.
* Warn before closing tabs with unsaved changes or discarding Git changes.
* Use parameterized queries for internal metadata operations; do not interpolate user-provided values into backend SQL.
* Keep credentials out of logs, crash reports, query history, and Git diffs.
* Show what data is sent in any optional diagnostics or update checks; make telemetry opt-in or clearly configurable.
* Handle app crashes or database disconnects without corrupting local SQL files.

## 4. Cross-platform engineering and release features

* Automated build and smoke-test pipeline for all three operating systems.
* Signed/notarized installers where required by the distribution channel; document unsigned or community build options.
* Versioned application updates and release notes, with an option to defer updates.
* Reproducible release process, checksums, and published source code.
* Platform-specific tests for credential storage, file paths, SSH behavior, and packaging.
* Keyboard navigation and accessibility checks across supported platforms.

## 5. Suggested delivery phases

### Phase 1 — Usable MVP

* One database engine.
* Connection setup and secure secret storage.
* SQL editor, execute/cancel, results grid, and CSV export.
* Basic schema browser and query history.
* Open/init a local Git repository; status, diff, stage, commit, branch switch, pull, and push.
* macOS, Windows, and Linux builds with a basic automated smoke test.

### Phase 2 — Solid public release

* Improve error handling, performance for large result sets, accessibility, and platform packaging.
* Add merge conflict resolution, commit history, and polished authentication flows.
* Add a second database engine and validate the adapter boundary.
* Add safer environment/production indicators and configurable execution guardrails.
* Publish installation, troubleshooting, contribution, and security-reporting documentation.

### Phase 3 — Differentiators

* More database engines and database-specific features.
* SQL formatting, autocomplete, explain-plan visualization, and snippets.
* Schema diff and migration workflow.
* Multiple result sets, saved filters, richer exports, and data editing with explicit transaction controls.
* Team-oriented project conventions and optional integrations with hosted Git providers.

## 6. Explicitly defer unless they are core to the product

* Built-in Git hosting, code review, or issue tracking.
* Cloud synchronization of credentials or connection profiles.
* Arbitrary plugin execution in the main process.
* Universal support for every SQL dialect in the first release.
* Automatic execution of migrations or destructive scripts without explicit user action.
* Collaborative real-time editing.

## 7. Product decisions to settle before implementation

* Which database engine is the first-class launch target?
* Should Git operations use the system Git executable, or should the app embed a Git implementation? System Git is a straightforward initial choice if dependency availability and UX are acceptable.
* Is the app strictly a query workbench, or should it also edit table data and manage schema changes?
* Is the primary user an individual developer, a data analyst, or an engineering team? This changes the priority of saved projects, data editing, and shared conventions.

