---
title: Build a connector
description: Connect Tabloxide to a new database engine with a separate program.
protocol: v1
---

A connector is a separate program that connects Tabloxide to one database engine. Tabloxide starts the program, talks to it with gRPC on the loopback address, and stops it. You can write a connector in any programming language. Tabloxide does not need a change for a new connector.

This guide is for people who build a connector. It has these parts:

1. What a connector does
2. The contract
3. The start and stop rules
4. A connector in Rust
5. A connector in a different language
6. Test the connector on your computer
7. Make a package
8. Publish and trust

## 1. What a connector does

A connector does the work of one database driver. It opens connections, runs statements, sends the rows in pages, and reads the catalog: the schemas, the tables, the columns, and the indexes.

Tabloxide keeps these functions. A connector cannot go around them:

- The confirmation before a destructive statement.
- The query history, and the rule that a statement with a password does not go into the history.
- The password store.
- The AI assistant.

A connector gets only the statements that Tabloxide released.

## 2. The contract

The file [`connector.proto`](https://tabloxide.org/connectors/v1/connector.proto) is the contract. It is version 1 of the protocol, with the package name `tabloxide.connector.v1`. Generate the code of your language from this file.

| Operation | What the connector does |
| --- | --- |
| `Describe` | Tells the engine name, the display name, its own version, the query language, the default port, and the capabilities. It needs no database. |
| `TestConnection` | Connects, reads the server version, and disconnects. |
| `OpenSession`, `CloseSession` | Opens and closes a session. A session runs one statement at a time. |
| `Execute` | Runs one statement. The answer is a stream: first the columns, then pages of rows. The last page has `end`. |
| `Cancel` | Stops the active statement of a session. |
| `ListSchemas`, `ListRelations`, `DescribeRelation` | The catalog. |
| `SampleStatement` | The statement that reads the first rows of a table, with the quotes of the engine. |

Obey these rules:

- **Read rows only on request.** The stream of `Execute` stops while Tabloxide does not read. Do not read all rows into memory.
- **A failed statement is a normal answer.** Send an `ExecuteEvent` with `error`: the kind, the message, and the position. Use a gRPC error status only for a defect of the connector.
- **Keep the password secret.** The password comes in `TestConnection` and `OpenSession`. Do not write it to a log, to a file, or into an error message.
- **Read-only connections.** When `read_only` is true, refuse each statement that changes data or the structure.

### Query languages

`Describe` tells the query language of the engine. Tabloxide reads the statements of two languages for its checks: `sql` and `mongodb-shell`. For a different language, Tabloxide asks the user before each run, and it does not write the statements into the history.

## 3. The start and stop rules

1. Tabloxide starts the program with a random token in the environment variable `TABLOXIDE_CONNECTOR_TOKEN`.
2. The connector listens on `127.0.0.1`, on a port that the operating system selects.
3. The connector writes one line to standard output: `TABLOXIDE_CONNECTOR_PORT=<port>`.
4. Each request has the header `authorization: Bearer <token>`. Refuse each request without the correct token.
5. The connector stops when its standard input closes. Thus it does not stay after Tabloxide stops.

Write logs to standard error, not to standard output.

## 4. A connector in Rust

The crate `tabloxide-connector-sdk` does steps 2 to 5 for you. Implement the traits `DbAdapter` and `Session` of the crate `tabloxide-core`, then serve your adapter:

```rust
use std::sync::Arc;

#[tokio::main]
async fn main() -> Result<(), tabloxide_connector_sdk::ServeError> {
    let adapter = Arc::new(MyAdapter::default());
    tabloxide_connector_sdk::serve(adapter, env!("CARGO_PKG_VERSION")).await
}
```

The MongoDB connector in `connectors/mongodb` of the Tabloxide repository is a complete example.

## 5. A connector in a different language

Generate the server code from `connector.proto` with the gRPC tools of your language. For example, in Go:

```sh
protoc --go_out=. --go-grpc_out=. tabloxide/connector/v1/connector.proto
```

Then do the steps of section 3 yourself. Compare the token in a time that does not depend on the first difference.

## 6. Test the connector on your computer

A development build of Tabloxide reads connectors from the folder in `TABLOXIDE_CONNECTOR_DIR`. Each connector is in a sub-folder with its `connector.toml` and its program:

```sh
TABLOXIDE_CONNECTOR_DIR="$PWD/my-connectors" pnpm dev
```

In the Tabloxide repository, `pnpm connectors:dev` builds the connectors of the repository into `target/connectors`. A release build ignores the variable.

## 7. Make a package

A package is a `.tar.gz` file with two files at its top level: `connector.toml` and the program.

```toml
engine = "redis"            # lower case letters, digits, and "-"
display_name = "Redis"
version = "0.1.0"           # semantic version
protocol = 1                # major version of the protocol
program = "tabloxide-connector-redis"   # ".exe" is added on Windows
language = "redis"          # the query language
default_port = 6379         # leave it out for a file database
publisher = "Example Labs"
```

```sh
tar -czf tabloxide-connector-redis-0.1.0-x86_64-unknown-linux-gnu.tar.gz \
  -C package connector.toml tabloxide-connector-redis
```

Make one package for each target. Tabloxide refuses a package with folders, with links, or with a program that is not in it.

## 8. Publish and trust

- **Official connectors** are in the signed list at `https://tabloxide.org/connectors/v1/index.json`. Tabloxide checks the signature of the list and the SHA-256 checksum of each file. An official connector installs without a question.
- **Other connectors** install from a file, in Preferences, Connectors, "Install from a file…".

> **Trust rule.** A connector without the signature of the Tabloxide project needs a confirmation. The dialog names the publisher, if the package gives one. It tells the user that the connector can read the passwords and the data of its connections. The confirmation is for one version of one connector.

A connector runs with the permissions of the user, without a sandbox. Thus give your users the source code and a checksum of each package.

To propose an official connector, open an issue in the Tabloxide repository.
