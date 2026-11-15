# Tabloxide

Tabloxide is a cross-platform SQL client with built-in Git. It uses Tauri 2, a React and TypeScript UI, and a Rust backend.

Phase 1 of `docs/Implementation Plan.md` (milestones M0 to M6) is complete in code. Phase 2 is in work, and its milestones M7, M8, and M9 are complete in code. The database engines are PostgreSQL and DuckDB.

## Functions

- **Database engines:** PostgreSQL servers and DuckDB database files. A connection selects its engine.
- **DuckDB:** A DuckDB connection opens a database file, or a database in memory with the file name `:memory:`. A statement can read the CSV, Parquet, and JSON files of the workspace folder directly, for example `SELECT * FROM 'data.csv'`.

- **Workspace:** A workspace is a folder with your SQL files. The file `tabloxide.toml` in that folder holds the connection definitions without secrets.
- **Connections:** Add, edit, duplicate, delete, and test connections. A password is in the credential store of the operating system, or it comes from an environment variable.
- **Editor:** SQL editor with tabs for files and for buffers without a file. Each tab has its own database session.
- **Results:** Result grid with virtual rows, sort, column resize, column visibility, and copy. Export of a result to a CSV file.
- **History:** Query history with a search. The history is in the application data directory, not in the workspace.
- **Schema:** Schema browser with tables, views, columns, indexes, and constraints.
- **Git:** Status, stage, unstage, discard, diff, commit, fetch, pull, and push. The application uses the `git` executable of the system.
- **Git credentials:** When Git or SSH needs a user name, a password, or a passphrase, the application asks you in a dialog. Fetch, pull, push, and clone show the progress of Git.
- **External changes:** The application watches the workspace folder. It updates the file tree, the open tabs, and the Git status after a different program changed files.
- **Branches:** Create, switch, rename, and delete.
- **Commit history:** The commits of the current branch, with the files and the diff of each commit.
- **Merge conflicts:** A side-by-side view for each file with a conflict. You edit the result, or you copy blocks from the incoming version. You can abort the merge.
- **Safety:** Confirmation before a destructive statement and before a run on a production connection. Read-only connections.

## Install

A release has installers for Linux (`.deb`, `.rpm`, `.AppImage`), macOS (`.dmg`), and Windows (`.msi`, `-setup.exe`). The file `SHA256SUMS.txt` in the release has the checksum of each installer.

The installers have no code signature. macOS and Windows show a warning for an application without a signature.

To use the Git functions, install Git and make sure that `git` is in the `PATH`. A passphrase prompt for an SSH key needs OpenSSH 8.4 or later. On Linux, the credential store needs a Secret Service, for example GNOME Keyring or KWallet.

## Documentation

- [Install Tabloxide](docs/user/install.md): the procedures for Linux, macOS, and Windows, the update, the removal, and the data locations.
- [Troubleshooting](docs/user/troubleshooting.md): known problems and their solutions.
- [Contribute to Tabloxide](CONTRIBUTING.md): the rules and the checks for a change.
- [Security policy](SECURITY.md): how to report a vulnerability.

## Keyboard shortcuts

| Keys                                              | Function                                                              |
| ------------------------------------------------- | --------------------------------------------------------------------- |
| `Ctrl+Enter`                                      | Runs the selection, or the statement at the cursor.                   |
| `Ctrl+Shift+Enter`                                | Runs all statements of the tab.                                       |
| `Ctrl+S`                                          | Saves the file of the tab.                                            |
| `Ctrl+F`                                          | Opens the search in the editor.                                       |
| Arrow keys, `Home`, `End`, `Page Up`, `Page Down` | Move the selected cell in the result grid.                            |
| `Ctrl+C` in the result grid                       | Copies the selected cell.                                             |
| `Left`, `Right`, `Home`, `End` on an editor tab   | Move to a different editor tab.                                       |
| `Delete` on an editor tab                         | Closes the editor tab.                                                |
| Arrow keys, `Home`, `End` in the file tree        | Move between the files. `Right` opens a folder, and `Left` closes it. |
| `Escape`, then `Tab` in the editor                | Moves the focus out of the editor.                                    |
| `Escape`                                          | Closes a dialog.                                                      |

On macOS, use `Cmd` in place of `Ctrl`.

## Security

- A password is never in a file of the workspace, in the history, or in an error message.
- The history does not record the text of a statement that can contain a password.
- A Git message that the application shows has no user and no password in its URLs.
- The application sends your answer to a credential prompt of Git only to Git. It does not store the answer and does not write it to a log. To store a credential, configure a credential helper or an SSH agent for Git.
- The file tree and the editor read and write files only in the workspace folder.
- A DuckDB statement can read and write files on your disk, and it can install and load extensions. Do not run a script that you do not know against a DuckDB connection.
  - The application asks before `COPY ... TO`, `EXPORT DATABASE`, `INSTALL`, and `LOAD`.
  - DuckDB does not install an extension from the network automatically. You must use `INSTALL`.
- A read-only DuckDB connection is a real restriction. A statement cannot change the mode.
- A read-only PostgreSQL connection is a protection against mistakes. It is not a security control, because a statement can set the session back to read-write. For a real restriction, use a database user that has only read permissions.

## Requirements

- Rust (stable). `rust-toolchain.toml` selects the toolchain.
- A C++ compiler. The build compiles DuckDB from source. The first build takes approximately 7 minutes longer on a machine with 16 processor cores.
- Node.js 20.19 or later, or 22.12 or later. `.nvmrc` selects Node.js 26.13.1.
- pnpm 9.
- Docker, only for the database tests.
- The Tauri 2 system libraries for your operating system.

On Ubuntu or Debian, install the system libraries with this command:

```sh
sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev \
  librsvg2-dev libssl-dev libxdo-dev build-essential curl file
```

For other operating systems, refer to <https://tauri.app/start/prerequisites/>.

## Commands

Run these commands from the repository root.

| Command          | Function                                               |
| ---------------- | ------------------------------------------------------ |
| `pnpm install`   | Installs the Node.js dependencies.                     |
| `pnpm dev`       | Starts the application in development mode.            |
| `pnpm build`     | Builds the application and the installers.             |
| `pnpm test`      | Runs the UI tests and the Rust tests.                  |
| `pnpm lint`      | Runs oxlint and clippy.                                |
| `pnpm typecheck` | Checks the TypeScript types.                           |
| `pnpm format`    | Formats the TypeScript code and the Rust code.         |
| `pnpm bindings`  | Generates `ui/src/bindings.ts` from the Rust commands. |

### Database tests

The integration tests of the PostgreSQL adapter start a PostgreSQL server in Docker. They do not run with `pnpm test`. Run them with this command:

```sh
cargo test -p tabloxide-adapter-postgres -- --ignored
```

## Repository layout

| Path                      | Contents                                                           |
| ------------------------- | ------------------------------------------------------------------ |
| `crates/core`             | Domain types, adapter interface, statement splitter, script runner |
| `crates/adapter-postgres` | PostgreSQL adapter                                                 |
| `crates/adapter-duckdb`   | DuckDB adapter                                                     |
| `crates/git`              | Wrapper for the system `git` executable                            |
| `crates/workspace`        | Project configuration, local state, history, secret references     |
| `src-tauri`               | Tauri commands and application wiring                              |
| `ui`                      | React application                                                  |
| `docs`                    | Feature backlog, implementation plan, and user documentation       |

## Release

Push a tag such as `v0.1.0`. The workflow `.github/workflows/release.yml` builds the installers on the three platforms and makes a draft release with the installers and `SHA256SUMS.txt`. Examine the draft, then publish it.

## TypeScript bindings

`tauri-specta` generates `ui/src/bindings.ts` from the Rust commands. Do not edit this file. After you change a command or a command type, run `pnpm bindings` and commit the result. CI fails if the file is not current.

## Troubleshooting

### `symbol lookup error` in the VS Code terminal on Linux

If VS Code is a snap package, its terminal sets GTK variables that point into the snap. The application then stops at startup with a `symbol lookup error`. Start the application from a terminal outside VS Code, or unset the variables first:

```sh
unset GTK_PATH GTK_EXE_PREFIX GIO_MODULE_DIR GSETTINGS_SCHEMA_DIR \
  GDK_PIXBUF_MODULE_FILE GDK_PIXBUF_MODULEDIR LOCPATH
```
