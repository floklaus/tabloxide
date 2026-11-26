# Connector design

A connector is a separate program that connects Tabloxide to one database engine. This document gives the design. It accompanies `Database Kinds Backlog.md`.

Status on 2026-11-16: the product owner made the decisions of section 2. Section 8 gives the stages and their status.

Status on 2026-11-25: the product owner decided that MongoDB is the first connector, and that the downloads come from tabloxide.org. Section 10 gives the design for MongoDB. It changes the sequence of the stages.

## 1. Why connectors

Each database engine needs a driver. A driver in the Tabloxide program makes the installer larger and the build longer for all users, also for the users who do not use that engine. DuckDB, for example, is a C++ library that the build compiles from source.

With connectors:

- The installer has the core and one engine. A user downloads only the connectors for the engines that the user has.
- A defect in a driver stops the connector, not Tabloxide.
- Other people can build a connector, in any programming language, without a change of Tabloxide.

## 2. Decisions

| Topic            | Decision                                                                                                                                                         |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Protocol         | gRPC on a local socket.                                                                                                                                          |
| Built-in engines | PostgreSQL only. DuckDB and all new engines are connectors. Changed on 2026-11-25: DuckDB stays built in until the measurement of stage 3. |
| Delivery         | Tabloxide downloads a connector when the user selects its engine. An install from a local file is also possible.                                                 |
| Download place   | The signed index is at `https://tabloxide.org/connectors/v1/index.json`. The packages are assets of GitHub releases. The index has the full address of each package. |
| First connector  | MongoDB. DuckDB stays built in until the measurement of stage 3.                                                                                                  |
| Trust            | A connector with the signature of the Tabloxide project runs without a question. A connector from a different source needs a confirmation that names the risk.   |

## 3. Parts

```text
Tabloxide (core)                                   Connector (one for each engine)
+---------------------------------------------+    +--------------------------------+
| UI                                          |    | gRPC server                    |
| Commands, guardrails, history, assistant    |    | Driver of the database engine  |
| Connector host:                             |    +---------------+----------------+
|   - finds, downloads, and checks connectors |                    |
|   - starts and stops connector processes    |  gRPC, loopback    |  protocol of the engine
|   - gRPC client that implements DbAdapter   +--------------------+----------> database
| Built-in adapter: PostgreSQL                |
+---------------------------------------------+
```

- The **connector host** is new code in the core. For the other parts of the core, a connector is a `DbAdapter` and a `Session`, the same as the PostgreSQL adapter.
- The **guardrails, the query history, the password check, and the assistant stay in the core.** A connector cannot go around them. A connector only gets statements that the core released.
- One connector process serves all sessions of its engine. Thus a file engine such as DuckDB can keep one instance of a database file, as the adapter does now.

## 4. Protocol

The file `crates/connector-protocol/proto/tabloxide/connector/v1/connector.proto` is the contract. A connector in any language generates its code from that file.

### Transport

- The connector listens on the loopback address `127.0.0.1` with a port that the operating system selects. Tabloxide passes no port.
- Tabloxide starts the connector with a random token in the environment variable `TABLOXIDE_CONNECTOR_TOKEN`. The connector writes one line with its port to standard output. Each request has the token in the header `authorization`. A connector refuses a request without the correct token.
- The loopback address is the same on Linux, macOS, and Windows. A Unix socket or a named pipe would need different code for each platform. The token prevents that a different program of the same machine uses the connector.
- The connector stops when its standard input closes. Thus a connector does not stay after Tabloxide stopped.

### Operations

The operations are the methods of the `DbAdapter` and `Session` traits of `crates/core/src/adapter.rs`.

| Operation                                | Function                                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `Describe`                               | The engine name, the protocol version, the capabilities, and the fields of a connection profile.  |
| `TestConnection`                         | Connects, reads the server version, and disconnects.                                              |
| `OpenSession`, `CloseSession`            | Opens and closes a session. A session runs one statement at a time.                               |
| `Execute`                                | Starts one statement. The answer is a stream: the columns, then pages of rows, then the end.      |
| `Cancel`                                 | Cancels the active statement of a session.                                                        |
| `ListSchemas`, `ListRelations`, `DescribeRelation` | The catalog. A later version replaces these with the catalog tree of backlog item F9.   |
| `SampleStatement`                        | The statement that reads the first rows of a table, with the quotes of the engine.                |

### Rules

- **Flow control.** Tabloxide reads a page only when the grid needs it. The stream of gRPC stops the connector until Tabloxide reads. A connector must not read all rows into memory.
- **Versions.** The package name has the major version (`v1`). A new field is a minor change. `Describe` tells the versions that a connector supports, and Tabloxide refuses a connector that it cannot talk to, with a message for the user.
- **Errors.** A failed statement is a normal answer with the kind, the message, and the position, as `QueryError` has now. A gRPC error status is for a defect of the connector or of the transport.
- **Secrets.** The password goes to the connector in the `OpenSession` request and in no other place. A connector must not write it to a log or to a file.

## 5. Delivery

- An **index file** lists the official connectors: the engine, the version, the protocol version, and, for each platform, the download address, the size, and the SHA-256 checksum. The index file has a signature.
- When the user selects an engine without a connector, Tabloxide shows the name, the size, and the source, and asks before the download. Tabloxide makes no network request for connectors without this question.
- Tabloxide checks the checksum and the signature before it keeps the file. The files are in the application data folder, in `connectors/<engine>/<version>/`.
- **Install from a file:** the user selects a connector package on the disk. The same checks apply.
- A connector update is a new version folder. A session that is open continues with its version.
- For development, the environment variable `TABLOXIDE_CONNECTOR_DIR` names a folder with connector programs. Then no download and no signature check occurs. A release build ignores the variable.

## 6. Trust

A connector is a program with the permissions of the user. It gets the address and the password of a database. Thus:

- A connector with the signature of the Tabloxide project runs without a question.
- A connector with a different signature, or with no signature, needs a confirmation. The dialog names the publisher if a signature gives one, and it says that the connector can read the passwords and the data of its connections. The confirmation is for one version of one connector.
- The preferences list the installed connectors, with the version, the source, and a button that removes one.
- The signature uses a key of the project that is different from the code signature of the installers. The project does not have this key yet (section 9).

Limits that the design does not remove:

- Tabloxide does not put a connector in a sandbox. The confirmation is the only protection against a bad connector from a different source.
- The token protects the connector port from other programs of a different user. A program of the same user can read the environment of a process on some operating systems.

## 7. Effects on the code

| Part                        | Change                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `crates/connector-protocol` | New. The `.proto` file and the generated Rust code.                                                                            |
| `crates/connector-host`     | New. Start and stop of connector processes, the gRPC client as `DbAdapter` and `Session`, the index, the download, the checks. |
| `crates/connector-sdk`      | New. A library that makes a connector from a `DbAdapter` of this repository. A connector in Rust needs only a `main` function. |
| `connectors/duckdb`         | New. The DuckDB connector: the adapter that exists, with the SDK.                                                              |
| `crates/adapter-duckdb`     | Stays as a library. The core does not depend on it after the change.                                                           |
| `crates/core`               | `Engine` becomes a name, not a fixed list (backlog item F1).                                                                   |
| `src-tauri`                 | The state gets adapters from the connector host. New commands for install, list, and remove.                                   |
| `ui`                        | The connection form asks for a connector that is not installed. The preferences list the connectors.                           |
| CI and release              | Build each connector for each platform. Publish the connectors and the signed index file.                                      |

## 8. Stages

| Stage | Content                                                                                                                                                      | Needs from the product owner                  | Status      |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- | ----------- |
| 1     | The protocol file, the generated code, and its tests.                                                                                                        | Nothing                                       | Complete    |
| 2     | The SDK and the connector host. A scripted connector process runs the adapter operations through the host. MongoDB, not DuckDB, is the first connector (section 10). | Nothing | Complete |
| 3     | A measurement: the installer size and the speed of a large result, with DuckDB built in and as a connector. The result decides if the design continues.      | Nothing                                       | Not started |
| 4     | The core without DuckDB. `Engine` as a name. The connection form and the preferences for connectors. | Nothing | `Engine` as a name is complete. The rest is in progress. |
| 5     | The index file, the download, the checksum, the signature, and the install from a file.                                                                      | A signature key and a place for the downloads | Not started |
| 6     | The confirmation for connectors from a different source. A guide for people who build a connector.                                                           | Nothing                                       | Not started |

## 9. Open points

- **The signature key.** The key pair exists. The public key is in `crates/connector-host/keys/`, and the product owner keeps the private key. A rule for a second person with access to the key is open.
- **The place for the downloads.** Closed on 2026-11-25: refer to section 2 and section 10.
- **The measurement of stage 3.** A local file engine through a loopback connection is slower than in the process. If the difference is not acceptable for DuckDB, DuckDB can stay built in, and the design applies to the new engines only.
- **The workspace folder.** A DuckDB connection uses a path relative to the workspace. The connector gets the workspace folder in `OpenSession`. A connector from a different source then knows a path of the user.

## 10. MongoDB, the first connector

The product owner made these decisions on 2026-11-25:

- MongoDB is the first connector. It proves the connector host and the SDK. DuckDB stays built in.
- The user writes a subset of the MongoDB shell syntax, or a JSON command document. Tabloxide runs no JavaScript.
- This round includes the download from tabloxide.org.
- The app repository owns the guide for connector authors. A CI job copies it to the website repository.

### 10.1 Engine and query language

- `Engine` becomes a name (backlog item F1). `postgres` and `duckdb` stay valid names, so the profiles in the workspaces do not change.
- `Describe` gets new fields: the query language, the default port, and the editor mode. This is a minor change of protocol `v1`.
- The core keeps the guardrails. Thus the core knows each query language: `sql` and `mongodb-shell`. A connector with a language that the core does not know gets the rule "ask before each run" (principle 4 of the backlog).
- The language gives the statement split, the statement at the cursor, the risk, the read check for pages, and the password check for the history.

### 10.2 MongoDB statements

| Form | Example |
| --- | --- |
| Collection method | `db.users.find({ age: { $gt: 30 } }).sort({ name: 1 }).limit(10)` |
| Other collection names | `db.getCollection("my-users").countDocuments({})`, `db.getSiblingDB("sales").orders.find()` |
| Database method | `db.createCollection("logs")`, `db.dropDatabase()` |
| Command document | `{ "count": "users" }`. The connector runs it with `runCommand`. |
| Shell commands | `use sales`, `show dbs`, `show collections` |

Values can be JSON, with keys without quotes and strings in single quotes. These constructors are available: `ObjectId`, `ISODate`, `new Date`, `NumberInt`, `NumberLong`, `NumberDecimal`, `UUID`, and `/regex/flags`.

A `;` or a line break ends a statement. A line that starts with `.` continues the statement of the line before it.

| Statement | Risk |
| --- | --- |
| `drop`, `dropDatabase`, `dropIndex`, `dropIndexes` | Drop |
| `deleteMany({})`, `remove({})` | Delete without a filter |
| `updateMany({}, …)`, `replaceOne({}, …)` | Update without a filter |
| `renameCollection`, `collMod` | Alter |
| `aggregate` with `$out` or `$merge` | Overwrite |
| A command document or a database method that the check does not know | Unchecked |

Only `find` and `aggregate` without `$out` and `$merge` give results that the grid can read in pages. `createUser`, `updateUser`, and `changeUserPassword` do not go into the history.

### 10.3 Results and catalog

- A document is a row. The columns are the top-level fields of the first page, with `_id` first. When the result has more pages, the last column is `(more fields)`. It holds the fields that the first page did not have, as JSON.
- A nested document or an array is a cell of the kind JSON, in relaxed Extended JSON.
- A schema is a database. A relation is a collection or a view. The columns of a collection come from a sample of 100 documents. The indexes come from `listIndexes`. A `$jsonSchema` validator is a check constraint.

### 10.4 Connector host and SDK

- `crates/connector-sdk` serves a `DbAdapter` as a connector. A connector in Rust needs only a `main` function.
- `crates/connector-host` finds the connectors, starts one process for each engine on the first use, and gives a `DbAdapter` for each engine. A process that stopped starts again on the next use.
- The connectors are in `connectors/<engine>/` of the repository. The MongoDB connector is `connectors/mongodb`.

### 10.5 Package and index

- A package is `tabloxide-connector-<engine>-<version>-<target>.tar.gz`. It holds the program and `connector.toml` (the engine, the version, the protocol, and the program name).
- The index has `issued` and `expires`. Tabloxide refuses an index that is older than the last index that it accepted, and an index after its expiry date.
- A tag `connector-<engine>-v<version>` starts the CI job. The job builds the packages, adds them to a GitHub release, and writes an index without a signature. The maintainer signs the index on their own machine and copies it to the website repository.
