# AI assistant

The AI assistant is a side panel of Tabloxide. It has two functions:

- It writes SQL for the schema of your database: queries, statements that change data, and statements that change the structure.
- It reads the execution plan of a statement and suggests improvements.

The assistant sends each request to the Claude API of Anthropic. It needs an API key of Anthropic. The account of the API key pays for the requests.

Tabloxide never runs the SQL of an answer. You read the SQL, insert it into the editor, and run it.

## 1. What a request sends

Each request sends this data to Anthropic:

- The instructions of Tabloxide for the model.
- The name and the version of the database engine.
- The structure of the user schemas of the connected database:
  - The names of schemas, tables, and views.
  - The names and the types of columns, and which columns have a default value.
  - The definitions of indexes and of constraints.
- The conversation in the panel: your requests and the answers.
- For a plan analysis: the text of the statement and the text of the plan. The panel shows this text as your message.

A request does not send this data:

- Rows of a table or of a result.
- Passwords.
- The host, the port, the database name, or the user of a connection.
- The files of the workspace, unless you copy their text into a request.

The definition of an index or of a constraint can contain a value, for example in a `CHECK` rule. Such a value is part of the structure and goes to the service. The default expression of a column does not go to the service.

Tabloxide does not store the conversation. It is gone when you close the workspace or start a new conversation. Anthropic keeps and uses the data as the terms of your API account specify.

## 2. Set the API key

1. Make an API key in the console of Anthropic.
2. In Tabloxide, select **Assistant** in the title bar. The panel opens.
3. Enter the key in the field **API key of Anthropic**.
4. Select **Save the key**.

Tabloxide keeps the key in the credential store of the operating system. The key is not in a file of the workspace and not in the preferences.

To replace or remove the key, open **Preferences**. The group **AI assistant** has the same field and the button **Remove the key**.

## 3. Select the model

Open **Preferences**. In the group **AI assistant**, select the model. The default is Claude Opus 5.5. A model with a lower cost answers faster, but its answers can be less accurate.

If the service declines a request of a model, the service can run the request again on a different model of Anthropic. Claude Haiku 5.5 does not have this function.

## 4. Write SQL

1. Open an editor tab and select the connection of the database.
2. Open the panel with **Assistant** in the title bar.
3. Enter the request, for example "Add a table for invoices with a foreign key to the customer table". Press `Enter` to send it. `Shift+Enter` adds a line.
4. Read the answer. Each SQL block has the buttons **Insert** and **Copy**.
5. Select **Insert**. The SQL goes to the cursor position of the editor.
6. Examine the SQL, then run it as usual. The confirmation rules of the environment apply.

If the tab has a connection but no session, the first request connects. The first request on a session reads the schema from the database. This closes an open result of the tab. The next requests use the same schema. After you changed the structure of the database, select **Read the schema again**.

The request has the columns of a maximum of 200 tables and views. For the others, it has only the name. The panel tells you when this limit applies.

A tab without a connection gets an answer without a schema. Then the model must guess the names.

## 5. Analyze a plan

1. Put the cursor in one statement, or select one statement.
2. Select **Analyze plan**.

Tabloxide runs `EXPLAIN` with the statement. `EXPLAIN` does not run the statement. The plan has estimates only.

Tabloxide reads a plan only for a statement that starts with `SELECT`, `WITH`, `VALUES`, `TABLE`, `FROM`, `INSERT`, `UPDATE`, `DELETE`, or `MERGE`. It refuses all other statements, also a statement that starts with `EXPLAIN` or `ANALYZE`.

For measured times, set **Measure the times** first. Then Tabloxide runs `EXPLAIN ANALYZE`, and the database runs the statement. These rules apply:

- `EXPLAIN ANALYZE` is available only for a statement that reads data. Tabloxide refuses it for other statements, and for `SELECT ... INTO`.
- If the rule of the environment is "Before each run", Tabloxide asks first.
- The query history does not record the plan read.
- **Stop** cancels the statement.

The check for a statement that reads data looks at the keywords of the statement. It has these limits:

- It cannot see the effect of a function that the statement calls. A function can change data, for example `nextval`.
- `SELECT ... FOR UPDATE` locks rows while the statement runs.
- On a PostgreSQL server with the setting `standard_conforming_strings = off`, a string with a backslash can hide a second statement from the check.

Do not use **Measure the times** in these conditions. For a full protection, use a read-only connection or a database user that has only read permissions.

A plan read closes an open result of the tab. The results pane then tells you that the assistant closed the result.

## 6. Use sessions

Each conversation is a session. Two or more sessions can run at the same time. The sessions stay until you close the workspace. Tabloxide does not store them on disk.

- To start a new session, select **+** (New conversation) in the panel. The earlier session continues.
- To see all sessions, select **Assistant sessions** in the left tool strip. Each session shows its state: Running, Waiting for you, or Done. Waiting for you means that a plan read waits for your confirmation.
- To open a session in an editor tab, select it in the list, or select **Open the session in a tab** in the panel.

The tab of a session shows these parts:

1. The steps of the last request, for example the plan read, the structure read, and the answer.
2. The conversation and the request field.
3. **Proposed changes**: the SQL blocks of the last answer. **Open in a new tab** puts the SQL into a new editor tab. **Insert into** puts the SQL at the cursor of the last SQL tab. Tabloxide does not run the SQL.
4. **Context**: the connection, the tab, and the schema of the last request.

A request of a session uses the last SQL tab, also when the tab of the session is active. The status bar shows the number of sessions that run.

## 7. Limits

- The model can make mistakes. Examine each statement before you run it, most of all a statement that changes or removes data.
- The model does not see rows, the number of rows, or the distribution of values, unless a plan shows them.
- A long answer can stop at the maximum length. The panel shows a note for such an answer.
- **Stop** ends a request. The service can charge for the part that it made before the stop.
