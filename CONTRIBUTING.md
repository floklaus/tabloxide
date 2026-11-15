# Contribute to Tabloxide

This document tells you how to change Tabloxide and how to send your change.

Do not report a security problem in an issue or in a pull request. Refer to [SECURITY.md](SECURITY.md).

## 1. Before you start

- For a problem, write an issue first. [Troubleshooting, section 8](docs/user/troubleshooting.md#8-report-a-problem) lists the data that an issue must contain.
- For a new function, write an issue first and wait for an answer. `docs/Implementation Plan.md` sets the scope and the sequence of the work. A change outside that scope can get a refusal.
- For a small correction, for example a spelling error, a pull request without an issue is sufficient.

## 2. Set up

[README.md](README.md) lists the requirements and the commands.

1. Install the requirements.
2. Clone the repository.
3. Run `pnpm install` in the repository root.
4. Run `pnpm dev` to start the application in development mode.

Use pnpm for all Node.js operations. Do not use npm or yarn, because the repository has only a pnpm lock file.

## 3. Architecture rules

`docs/Implementation Plan.md`, section 3, gives the architecture. These rules are the most important ones:

- **No business logic in `src-tauri`.** This crate contains the Tauri commands and the application wiring only. Put logic into a crate in `crates/`.
- **No Tauri in `crates/`.** These crates must build and run their tests without a window.
- **No engine-specific type in `crates/core`.** The `DbAdapter` trait is the only database interface for the other parts. Put PostgreSQL code into `crates/adapter-postgres`.
- **One folder for each feature in `ui/src`.** For example, `connections`, `results`, `git`.
- **Generated bindings.** Do not edit `ui/src/bindings.ts`. After you change a command or a command type, run `pnpm bindings` and commit the result.

## 4. Security rules

A change must keep these properties. A reviewer examines them first.

- A secret is always in the `Secret` type of `crates/core`. Do not copy its value into a `String` that lives longer than one call.
- No secret goes into a file, a log, the history, or an error message.
- An error message for the user does not contain a credential. Git output goes through the redaction function before the UI shows it.
- File access stays in the workspace folder. Use the path functions of `crates/workspace`.
- An introspection query uses parameters. Do not build SQL text from user input.
- The Rust code has no `unsafe` block. The workspace lints forbid it.

## 5. Code style

Rust:

- `cargo fmt` formats the code. `cargo clippy` must give no warning.
- Return an error for a failure that can occur. Do not call `unwrap` or `expect` for such a failure outside tests.
- Write a message for the user as an instruction: tell the user what to correct.

TypeScript:

- Prettier formats the code. oxlint and the type check must give no error.
- Do not use a CSS function or a JavaScript function that is new. The application runs on three different web views (WebKitGTK, WebView2, WKWebView).
- Each control must operate with the keyboard and must have an accessible name.

Text:

- Write the text of the UI, the error messages, and the documents in simple English. Use short sentences and the active voice. Use one word for one thing.

## 6. Tests

- Write the test before the code that it tests, when that is possible.
- Use the structure Arrange, Act, Assert. Give each test a name that describes the behaviour.
- A correction of a defect has a test that fails without the correction.
- Each UI test also checks the accessibility rules of axe-core on the DOM that it leaves. `ui/src/test/setup.ts` contains this check. A test fails if its last state breaks a rule.

| Command                                                 | Scope                                                                                                          |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `pnpm test`                                             | The UI tests (Vitest) and the Rust tests that need no database server. The Git tests need `git` in the `PATH`. |
| `cargo test -p tabloxide-adapter-postgres -- --ignored` | The PostgreSQL tests. They start a server in Docker.                                                           |

## 7. Checks before a pull request

Run these commands in the repository root. CI runs the same checks on Linux, macOS, and Windows.

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm bindings
git diff --exit-code -- ui/src/bindings.ts
```

The last command fails if the bindings are not current.

## 8. Commits

Use this format for a commit message:

```
<type>(<scope>): <description>

<body>
```

- The types are `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, and `ci`.
- The scope is optional. Use the name of the crate or the area, for example `core`, `git`, `ui`, `app`.
- Write the description in the imperative mood, without a full stop.
- The body tells what the change does and why. Each commit is one complete change that passes the checks.

Example:

```
fix(git): show the instruction when Git has no user identity

A commit without user.name failed with the raw output of Git. The
operation now finds this case and returns the two commands that set
the identity.
```

## 9. Pull requests

1. Make a branch from `main`.
2. Make the change and its tests.
3. Do the checks of section 7.
4. Open a pull request. Describe what the change does, why it is necessary, and how you tested it.
5. If the change is visible in the UI, add a screen capture.
6. If the change affects the user, update `README.md` and the documents in `docs/user`.

A maintainer reviews the pull request. All CI jobs must pass before the merge.
