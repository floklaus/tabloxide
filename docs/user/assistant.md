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

Under each request, the panel shows a line that starts with **Sent:**. The line tells what the request sent, for example "Sent: your request and the structure of 12 tables and views."

A request does not send this data:

- Rows of a table or of a result. The only exception is **Ask about these rows** (section 10), after your confirmation. **Propose a chart** (section 11) sends the names and the types of the columns of a result, and no rows.
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

For a MongoDB connection, Tabloxide reads the plan with the MongoDB command `explain`. The plan is available for `find`, `aggregate`, `count`, `distinct`, `update`, `delete`, and `findAndModify`. Without **Measure the times**, the verbosity is `queryPlanner`, and MongoDB does not run the statement. With **Measure the times**, the verbosity is `executionStats`, and MongoDB runs the statement. Thus Tabloxide permits it only for `find`, and for `aggregate` without `$out` and `$merge`. The Plan tab of the results pane also shows the plan of MongoDB as steps, with explanations and hints. **Original** shows the answer of MongoDB.

### The AI and the engine of the connection

The assistant writes in the query language of the connection of the tab. The structure that it gets depends on the engine:

| Engine | Language of the answers | Structure that a request sends |
| --- | --- | --- |
| PostgreSQL, DuckDB | SQL in the dialect of the engine | Schemas, tables, views, columns with their types, indexes, and constraints |
| MongoDB | The MongoDB shell syntax of Tabloxide. Tabloxide runs no JavaScript. | Databases, collections, views, indexes, and validation rules. The fields of a collection come from a sample of 100 documents: their names and types, never a value. A collection can have more fields. The **Sent:** line tells you this. |
| A different engine of a connector | Tabloxide has no guide for the language. The panel tells you that the answers can be less exact. | The catalog of the connector |

**Insert** and **Replace in the editor** are only on a code block in the language of the tab. A block in a different language, for example SQL for a MongoDB tab, has only **Copy**. Before you insert or accept a statement, the block shows its risk, for example "Before you run it: The statement deletes all documents of the collection."

## 6. Explain and fix a query error

When a statement fails, the results pane shows the error. For an error of the database, the error has the button **Explain and fix**.

1. Select **Explain and fix**. The assistant panel opens.
2. Read the explanation and the corrected statement.
3. Select **Replace in the editor** to put the corrected statement in place of the statement that failed. Tabloxide does not run it.

The request sends the statement, the error message, the details of the error, and the structure of the database. It sends no rows.

**Replace in the editor** is available only while the tab of the statement is open and its text is the same as at the run. After a change of the text, use **Copy**.

## 7. Change or explain the selection

You can ask the AI to change text in the editor, or to explain it. Without a selection, the action uses the statement at the cursor.

To change the text:

1. Select the text, or put the cursor in a statement.
2. Press **Ctrl+I**. A field for the instruction opens below the editor. The editor is read-only until the change closes.
3. Type the instruction, for example "Only the orders of the last 30 days", and press **Enter**.
4. The editor shows the removed text struck through, and the proposed text below it. The text of the file does not change yet.
5. Select one of these:
   - **Accept** or **Ctrl+Enter** puts the proposed text into the editor. **Ctrl+Z** removes it again.
   - **Reject** or **Esc** removes the proposal. The text stays as it was.
   - **Change again** asks for a new instruction. The AI gets the earlier instructions and answers too.

To explain the text, press **Ctrl+Shift+I**. The explanation goes to the assistant panel.

The request sends the text, the instruction, and the structure of the database. It sends no rows. Tabloxide does not run the changed text.

## 8. Explain a table, or write a starter query

Each table and view in the schema browser has a menu (**…**) with two AI actions. When you select a table, its detail opens in a tab of the editor area, and that tab has the same actions. The menu does not read rows of the table.

- **Explain the table** explains in the assistant panel what one row is, the key, the references, and the indexes.
- **Write a starter query** writes a first query for the table. The query opens in a new tab with the name "*table*: starter query" and the connection of your tab. Tabloxide does not run it. The answer also stays in the panel.

Tabloxide reads the structure of the table from the database for the request: the columns, the indexes, and the constraints. The request sends no rows and no default values.

## 9. Use AI with Git

The Git view and its detail tabs have three AI actions. They send no rows and no structure of the database.

- **Write the message with AI**, below the commit message field at the bottom of the Git view. The AI writes the message from the staged changes, and the message goes into the field. Read it and change it before you commit. If the field has your own text, Tabloxide asks before it replaces it. **Write again** writes a new message.
- **Explain the changes**, in the diff tab of a changed file. The explanation goes to the assistant panel.
- **Propose a resolution**, in the conflict tab of a file with a merge conflict. The AI proposes a result that keeps the changes of the two branches. **Accept** puts it into the result side, and **Edit in the result** also moves the cursor there. **Reject** removes it. Then you mark the file as resolved.

What each request sends:

| Action | Data |
| --- | --- |
| Write the message with AI | The staged diff, and the subjects of the last 10 commits. A diff of more than 60 000 characters is cut, and the first part of each file stays. |
| Explain the changes | The diff of the one file. |
| Propose a resolution | The three versions of the file: the common base, your version, and the incoming version. The limit is 60 000 characters. |

Tabloxide never runs a Git command from an answer.

## 10. Ask about these rows

This is the only AI action that sends rows.

1. Run a statement that returns rows.
2. In the bar below the rows, select **Ask about these rows**.
3. The confirmation shows the number of rows, the columns, and the connection with its environment. Type your question.
4. Select **Send** to send the question and the rows. The answer goes to the assistant panel.

Tabloxide sends the first rows of the result that the grid has loaded. **Preferences › AI assistant › Rows for "Ask about these rows"** sets the number: 1 to 1000, and 100 if you do not change it. Each value has a maximum of 500 characters.

**A production connection never sends rows.** For a connection with the environment production, the button is not available, and no setting changes this. Tabloxide also checks this when it sends the request. If you change a connection to production, its earlier rows do not go again either.

## 11. Propose a chart

The chart view of a result has the button **Propose a chart**. The AI proposes the settings of a chart for the columns of the result.

1. Run a statement that returns rows, and select **Chart** in the view switch.
2. Select **Propose a chart**. Type what you want to see. The question is optional.
3. Select **Send**. The answer goes to the assistant panel.

The request sends your question, and the name, the type, and the type name of each column of the result. For a result with more than 200 columns, it sends the first 200 columns. It sends no rows and no structure of the database.

Tabloxide checks the chart settings of the answer against the columns of the result. The chart changes only if the settings pass each check. If a check fails, a notice gives the cause. Refer to [Charts](charts.md).

## 12. Use sessions

Each conversation is a session. Two or more sessions can run at the same time. The sessions stay until you close the workspace. Tabloxide does not store them on disk.

- To start a new session, select **+** (New conversation) in the panel. The earlier session continues.
- To see all sessions, select **Assistant sessions** in the left tool strip. The Sessions view shows the newest session first. A status mark before each title shows the state: Running, Waiting for you, Done, Stopped, Failed, or New. Waiting for you means that a plan read waits for your confirmation. The filter field shows only the sessions whose title contains the text.
- To open a session in an editor tab, click it in the list, or press **Space** or **Enter** on it. You can also select **Open the session in a tab** in the panel.
- To show a session in the assistant panel, press **Ctrl+Enter** on it in the list.
- To stop the request of a session, press **Shift+F10** on it in the list and select **Stop the request**.

The Sessions view uses the keys of all side views. Refer to [Side views](side-views.md).

The tab of a session shows these parts:

1. The steps of the last request, for example the plan read, the structure read, and the answer.
2. The conversation and the request field.
3. **Proposed changes**: the SQL blocks of the last answer. **Open in a new tab** puts the SQL into a new editor tab. **Insert into** puts the SQL at the cursor of the last SQL tab. Tabloxide does not run the SQL.
4. **Context**: the connection, the tab, and the schema of the last request.

A request of a session uses the last SQL tab, also when the tab of the session is active. The status bar shows the number of sessions that run.

## 13. Limits

- The model can make mistakes. Examine each statement before you run it, most of all a statement that changes or removes data.
- The model does not see rows, the number of rows, or the distribution of values, unless a plan shows them.
- A long answer can stop at the maximum length. The panel shows a note for such an answer.
- The assistant writes its text in Simplified Technical English, after the rules of ASD-STE100: short sentences, the active voice, and one word for one thing. Names, quoted error messages, and code stay as they are.
- **Stop** ends a request. The service can charge for the part that it made before the stop.
