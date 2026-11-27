# Backlog: support for more kinds of databases

This backlog lists the work to support five kinds of databases in Tabloxide: relational, graph, time-series, document, and vector. It accompanies `Cross-Platform SQL Client Feature Backlog.md` and `Implementation Plan.md`.

Status on 2026-11-16: this is a list of work, not a plan. No item is started. Section 9 lists the decisions that the product owner must make before a plan is possible.

Status on 2026-11-16, later: the product owner decided that an engine other than PostgreSQL is a connector, which is a separate program that Tabloxide downloads on demand. `Connector Design.md` gives the design and its stages. This answers decision 10 of section 9. Each adapter item of this backlog (for example R1, G3, D4, V5) is thus a connector, and the items F1 and F15 are part of the connector work.

## 1. How to read this backlog

Each item has an identifier, a priority, and a size.

| Field    | Values                                                                                              |
| -------- | --------------------------------------------------------------------------------------------------- |
| Priority | **Must**: the kind is not usable without it. **Should**: a public release needs it. **Could**: later. |
| Size     | **S**, **M**, **L**, **XL**. The size compares items with each other. It is not a time.               |

The identifiers have a letter for the group: `F` foundation, `R` relational, `G` graph, `T` time-series, `D` document, `V` vector.

## 2. Where Tabloxide is now

Tabloxide has two engines: PostgreSQL and DuckDB. The two are relational, and their query language is SQL. Thus many parts of the code assume a relational SQL database:

| Part                                             | Assumption                                                                                   |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `Session` trait in `crates/core/src/adapter.rs`  | The catalog has schemas, relations (tables and views), columns, indexes, and constraints.    |
| `Row` in `crates/core/src/query.rs`              | A result is rows of text cells. A cell has no structure.                                     |
| `crates/core/src/sql`                            | The splitter, the lexer, and the risk classifier know SQL only.                              |
| `ConnectionProfile` in `crates/core`             | A connection is a host, a port, a database, and a user, or a file path.                      |
| `ui/src/editor/CodeEditor.tsx`                   | The editor always uses the PostgreSQL dialect of SQL.                                        |
| `ui/src/query/QueryEditor.tsx`                   | The server label always starts with "PostgreSQL".                                            |
| `ui/src/results`                                 | The only result view is a grid.                                                              |
| `crates/assistant`                               | The schema text has tables and columns. The plan read uses `EXPLAIN`.                        |
| Query history and guardrails                     | The password check and the destructive-statement check read SQL.                             |

The adapter interface (`DbAdapter`) and one crate for each engine are a good base. The work is to remove the assumptions above, not to replace the structure.

## 3. Principles

1. **Capabilities, not kinds.** An engine tells the application what it can do: its query languages, its result shapes, its catalog objects, cancel, plan read, transactions. The UI shows a function only when the engine has the capability. A kind such as "graph" is a label for the user, not a branch in the code. Many engines are more than one kind, for example PostgreSQL with extensions.
2. **Extensions of an engine come first.** TimescaleDB, pgvector, Apache AGE, and JSONB are PostgreSQL. They give four kinds with one adapter and a small quantity of work.
3. **One crate for each engine.** A crate brings its driver. A Cargo feature can remove an engine from a build.
4. **The safety rules apply to each language.** A language without a destructive-statement check gets the rule "ask before each run" until it has one.
5. **The privacy rule of the assistant stays.** A request sends structure and no rows. A kind that has no fixed structure needs a decision (item D8).
6. **Each engine has integration tests against a real server** in a container, as PostgreSQL has now.

## 4. Foundation (F)

These items are not for one kind. Most items of the other groups need them.

| ID  | Item                                                                                                                                                                                                                         | Priority | Size |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---- |
| F1  | **Engine registry.** Replace the `match` on `Engine` with a list of engines. Each engine gives its name, its kinds, its default port, and its capabilities.                                                                   | Must     | M    |
| F2  | **Capabilities.** Extend `Capabilities`: query languages, result shapes, catalog object types, plan read, transactions, read-only mode, cancel.                                                                               | Must     | M    |
| F3  | **Connection profile for each engine.** Fields that an engine defines: URI, API key or token, cloud region, database or namespace, TLS options. The form in the UI comes from the field list. Tokens go to the credential store. | Must     | L    |
| F4  | **Query language interface.** One interface for the text functions. It splits a script into statements and finds the statement at the cursor. It classifies the risk, and it tells if a statement only reads data or can contain a password.            | Must     | L    |
| F5  | **Editor language for each engine.** The editor takes its language mode and its dialect from the engine of the tab. First step: the correct SQL dialect for each relational engine.                                           | Must     | M    |
| F6  | **File types.** The file tree and the tabs know the file extension of each language (for example `.sql`, `.cypher`). A tab selects its language from the file and the connection.                                             | Should   | S    |
| F7  | **Typed result values.** A cell can be text, a number, a document (JSON), a list, a vector, a graph node, a graph relationship, or a path. The grid shows a short form of each.                                               | Must     | XL   |
| F8  | **Result views.** A result has one or more views: grid (now), document tree, graph, chart. The engine and the result shape select the default view.                                                                           | Must     | L    |
| F9  | **Catalog tree.** Replace schemas, relations, and columns with a tree of objects. Each object has a type, a name, and details. The schema browser shows the tree of the engine.                                               | Must     | L    |
| F10 | **Engine label.** Show the real engine name and version in the editor bar. The label "PostgreSQL" is fixed in the code now.                                                                                                   | Must     | S    |
| F11 | **Guardrails for each language.** The confirmation rules use the classifier of the language (F4). The CSV export and the paging use "only reads data" of the language.                                                        | Must     | M    |
| F12 | **History for each language.** The history records the language. The password check uses the language (F4).                                                                                                                   | Should   | S    |
| F13 | **Assistant for each kind.** The schema text comes from the catalog tree (F9). The instructions name the query language. The plan read is a capability with the syntax of the engine.                                         | Should   | L    |
| F14 | **Adapter conformance tests.** One test set that each adapter must pass: connect, run, cancel, page, catalog, errors with positions.                                                                                          | Should   | M    |
| F15 | **Build and licences.** A Cargo feature for each engine. A check of the licence of each driver. A measurement of the installer size and the build time for each new driver.                                                   | Should   | M    |
| F16 | **Documents.** `docs/user/install.md`, `docs/user/troubleshooting.md`, and `README.md` for each new engine: the fields, the limits, the known problems.                                                                       | Should   | S    |

Status on 2026-11-25: item F13 has a plan. It is milestone M21 in `Implementation Plan.md`.

Status on 2026-11-26: the product owner answered decision 7 (section 9). The assistant can send the names and the types of fields from a sample of documents, and never a value.

Status on 2026-11-26, later: `Visualization Design.md` gives a proposal for the result views (F8, T2, G5, and D3). The product owner made no decision yet.

Status on 2026-11-27: the product owner selected Apache ECharts as the chart library. Stage 2 of `Visualization Design.md` is built: the view switch of a result (the first part of F8) and the chart view (T2). Section 15 of that document gives the state.

## 5. Relational (R)

Relational engines use the structure that exists. They need F1, F2, F3, F5, F10, and F15.

| ID  | Item                                                                                                                                                                              | Priority | Size |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---- |
| R1  | **MySQL and MariaDB adapter.** Connect with TLS, run, cancel, page, catalog (databases as schemas), error positions.                                                               | Must     | L    |
| R2  | **SQLite adapter.** A database file, as DuckDB. The workspace crate uses SQLite for the local state already, but the adapter needs its own open and lock rules.                    | Must     | M    |
| R3  | **Microsoft SQL Server adapter.** Connect with SQL login and TLS, run, cancel, catalog, `GO` as a batch separator in the splitter.                                                 | Should   | L    |
| R4  | **Servers that speak the PostgreSQL protocol.** Test the PostgreSQL adapter with CockroachDB and YugabyteDB. Handle the catalog queries that such a server does not support.       | Should   | M    |
| R5  | **Plan read for each engine.** The syntax of `EXPLAIN` is different for each engine. The assistant uses the capability of F13.                                                     | Should   | M    |
| R6  | **Quoting and dialect rules.** Identifier quotes (`"`, `` ` ``, `[ ]`), string escapes, and comments for each dialect in the lexer.                                                 | Must     | M    |
| R7  | **ClickHouse adapter.** A column store for analysis. It has its own protocol and its own SQL dialect.                                                                              | Could    | L    |
| R8  | **Oracle Database adapter.** The driver needs a client library of Oracle or a pure Rust driver. Examine the licence and the installer size first.                                  | Could    | XL   |
| R9  | **Windows authentication and cloud authentication** (Kerberos, IAM tokens of cloud providers).                                                                                     | Could    | L    |

## 6. Graph (G)

A graph database has nodes and relationships. Its result can be a table, but it can also be a set of nodes, relationships, and paths. The query languages are different from SQL.

| ID  | Item                                                                                                                                                                                         | Priority | Size |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---- |
| G1  | **Apache AGE through the PostgreSQL adapter.** AGE runs Cypher in a PostgreSQL function. Show the `agtype` values as nodes and relationships (F7). This is the smallest first step.            | Should   | M    |
| G2  | **Cypher language.** Splitter, statement at the cursor, editor mode, and risk classifier for Cypher (F4, F5). Risks: `DETACH DELETE`, `DELETE` of all nodes, `DROP`, `LOAD CSV`, procedures.   | Must     | L    |
| G3  | **Neo4j adapter (Bolt protocol).** Connect with TLS and a user or a token, run, cancel, read results in parts. Memgraph uses the same protocol and can use the same adapter.                   | Must     | L    |
| G4  | **Graph values in the grid.** A node shows its labels and its properties. A relationship shows its type and its ends. A path shows its length. A click opens the details.                      | Must     | M    |
| G5  | **Graph view.** A view that draws the nodes and the relationships of a result. It needs a limit for the number of nodes, a keyboard alternative, and the grid as the accessible form.          | Should   | XL   |
| G6  | **Graph catalog.** Labels, relationship types, property keys, indexes, and constraints in the catalog tree (F9).                                                                              | Must     | M    |
| G7  | **Plan read.** `EXPLAIN` and `PROFILE` of Cypher. `PROFILE` runs the statement, thus the rules of `EXPLAIN ANALYZE` apply.                                                                     | Could    | M    |
| G8  | **Gremlin (Apache TinkerPop).** JanusGraph and Amazon Neptune use it. It is a second graph language with its own protocol.                                                                     | Could    | XL   |
| G9  | **GQL.** The ISO standard for a graph query language. Examine it when the engines of this backlog support it.                                                                                  | Could    | S    |

## 7. Time-series (T) and document (D)

### Time-series

Most time-series engines have a table model and SQL, or a language of their own. The main new need is a chart of values against time.

| ID  | Item                                                                                                                                                                                    | Priority | Size |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---- |
| T1  | **TimescaleDB through the PostgreSQL adapter.** Show hypertables, continuous aggregates, and compression settings in the catalog. Hide the internal chunk tables.                         | Should   | M    |
| T2  | **Chart view.** A line chart for a result with a time column and number columns. The user selects the columns. The view reduces the points for a large result and says so.                | Must     | L    |
| T3  | **Time range control.** A control that sets a start and an end time as parameters of a statement. It needs statement parameters, which the application does not have now.                 | Could    | L    |
| T4  | **QuestDB through the PostgreSQL protocol.** Test the PostgreSQL adapter with QuestDB. Its catalog and its cancel are different.                                                          | Could    | M    |
| T5  | **InfluxDB adapter.** Version 3 has SQL. Version 2 has the language Flux, and version 1 has InfluxQL. Decide the versions first (section 9).                                              | Should   | XL   |
| T6  | **Guardrails for time-series.** Risks: drop of a measurement or a hypertable, delete of a time range, a change of a retention rule.                                                       | Must     | S    |
| T7  | **Prometheus (PromQL), read-only.** A metrics store with a query language of its own and an HTTP interface. It has no write statements.                                                   | Could    | L    |

### Document

A document database keeps documents with a structure that can be different for each document. The result is documents, not rows.

| ID  | Item                                                                                                                                                                                                             | Priority | Size |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---- |
| D1  | **JSON in the grid.** A cell with JSON or JSONB opens a tree view with search and copy. This helps PostgreSQL and DuckDB now, and it is the base for D3.                                                           | Should   | M    |
| D2  | **MongoDB query form.** Decide how the user writes a query (section 9): the shell language (JavaScript), or command documents in JSON. The shell language needs a JavaScript engine in the application.            | Must     | S    |
| D3  | **Document view.** A result view that shows each document as a tree, and a table form with one column for each top-level field.                                                                                    | Must     | L    |
| D4  | **MongoDB adapter.** Connect with a connection string, TLS, and the authentication methods of MongoDB. Run find, aggregate, and write commands. Cancel. Read with a cursor.                                        | Must     | XL   |
| D5  | **Document catalog.** Databases, collections, indexes, and validation rules. A collection has no fixed columns.                                                                                                    | Must     | M    |
| D6  | **Field list from a sample.** Read some documents of a collection and show the fields and their types. This reads data, not only structure.                                                                        | Should   | M    |
| D7  | **Guardrails for documents.** Risks: a delete or an update with an empty filter, a drop of a collection or a database, a rename of a collection.                                                                   | Must     | M    |
| D8  | **Assistant for documents.** The assistant needs the field names. They come from validation rules, or from the sample of D6. A sample of field names is not rows, but it comes from rows. This needs a decision.   | Should   | M    |
| D9  | **Couchbase (SQL++)** and **Amazon DocumentDB** (MongoDB protocol). Test or add them after D4.                                                                                                                      | Could    | L    |
| D10 | **Elasticsearch and OpenSearch.** Search engines with JSON documents and an HTTP interface. They are a kind of their own. Add them only if users ask.                                                               | Could    | XL   |

## 8. Vector (V)

A vector database finds the items that are nearest to a vector. A vector has hundreds or thousands of numbers, thus the grid cannot show it as text. Many users keep vectors in a relational engine with an extension.

| ID  | Item                                                                                                                                                                                                      | Priority | Size |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---- |
| V1  | **Vector values in the grid.** Show the dimension and the first numbers. A click opens all numbers with copy. Do not send a full vector to the UI until the user asks for it.                               | Must     | M    |
| V2  | **pgvector through the PostgreSQL adapter.** Show the vector columns with their dimension, and the HNSW and IVFFlat indexes with their settings, in the catalog. Add the distance operators to the editor. | Should   | M    |
| V3  | **DuckDB vector search.** DuckDB has fixed-size arrays and an extension for vector search. Show them as V2 does.                                                                                           | Could    | S    |
| V4  | **Search form.** A form for "find the nearest items": the collection, the vector (pasted, or the vector of an item), a filter, a limit. It makes the query, and the user sees the query.                    | Should   | L    |
| V5  | **Qdrant adapter.** Collections, points with payload, search, filter, scroll. The interface is HTTP or gRPC, not a query language.                                                                         | Should   | XL   |
| V6  | **Vector catalog.** Collections, the dimension, the distance measure, the index settings, and the payload fields.                                                                                          | Must     | M    |
| V7  | **Guardrails for vectors.** Risks: delete of a collection, delete of points by a filter, a change of index settings that makes the index again.                                                            | Must     | S    |
| V8  | **Text to vector.** A search with text needs an embedding model. That sends the text to a service, or it needs a model on the machine. This needs a decision.                                              | Could    | L    |
| V9  | **Milvus, Weaviate, Chroma, and LanceDB adapters.** Each has its own interface. Select from user feedback after V5.                                                                                        | Could    | XL   |

An engine without a query language (V5, V9) does not fit the editor. Such an engine needs a request editor, for example for JSON requests, or only forms. This is part of the decision in section 9.

## 9. Decisions for the product owner

| No. | Decision                                                                                                                                                                                                 | Items       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 1   | **The product name and its promise.** Tabloxide is a "SQL client with Git". With graph, document, and vector engines it is a database client. Decide if the promise changes, and when.                    | All         |
| 2   | **The first engine of each kind.** The suggestions of this backlog: MySQL and SQLite, Neo4j, TimescaleDB, MongoDB, pgvector.                                                                              | R, G, T, D, V |
| 3   | **Extensions first, or native engines first.** Extensions of PostgreSQL give four kinds with little work, but only to users of PostgreSQL.                                                               | G1, T1, D1, V2 |
| 4   | **The MongoDB query form:** the shell language with a JavaScript engine, or command documents in JSON.                                                                                                    | D2          |
| 5   | **Engines without a query language:** a request editor, forms only, or no support.                                                                                                                        | V5, V9      |
| 6   | **The InfluxDB versions.** Each version has a different language.                                                                                                                                         | T5          |
| 7   | **The assistant and data without a fixed structure.** Can the assistant send field names that come from a sample of documents?                                                                            | D6, D8      |
| 8   | **Text to vector:** a service, a model on the machine, or not at all.                                                                                                                                     | V8          |
| 9   | **The graph view:** a library for the drawing, and the limit of nodes.                                                                                                                                    | G5          |
| 10  | **Installer size.** Each driver makes the installer larger and the build longer. Decide if all engines are in one installer.                                                                              | F15         |

## 10. Suggested sequence

The sequence puts the work with the most use for the least risk first. It is a suggestion, and decision 3 can change it.

1. **Base.** F1, F2, F5, F10, and R6. The application then has no fixed "PostgreSQL" in the UI, and an engine tells what it can do.
2. **Kinds through PostgreSQL and DuckDB.** D1, V1, V2, T1, T2, and G1 with G4. The typed values of F7 start here, for JSON, vectors, and graph values. The chart view is the first part of F8. Each of the five kinds then has a first form.
3. **More relational engines.** F3, R1, R2, then R3 and R4. The connection form for each engine (F3) is ready for the engines of the next steps.
4. **The first engine with a different language.** F4, F9, F11, F12, then Cypher and Neo4j (G2, G3, G6), or MongoDB (D2 to D5, D7). This step is the largest change of the core, because the splitter, the classifier, and the catalog become engine-neutral.
5. **The second engine with a different language**, then the assistant for each kind (F13).
6. **Engines without a query language** (V4 to V7), if decision 5 permits them.

F14, F15, and F16 are part of each step that adds an engine.

## 11. Not in this backlog

- Key-value stores (for example Redis) and wide-column stores (for example Apache Cassandra). They are not in the five kinds.
- Data migration between engines.
- Administration functions: users, roles, backup, server settings.
- Import of data, other than the file read of DuckDB that exists.
- Edit of data in the grid. `Implementation Plan.md`, Phase 3, has this item for relational engines.
