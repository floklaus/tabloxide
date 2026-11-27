# Release notes

This file lists the changes of each release that a user can see. The newest release is first.

The section `Unreleased` collects the changes after the last release. Before you push a release tag, change its title to the version and the date, for example `## 0.1.0 (2026-12-01)`. The release workflow copies the section of the tag into the release.

## Unreleased

### Charts

- A result with rows has a view switch with **Grid** and **Chart**. The chart shows the loaded rows as a line chart, an area chart, a bar chart, a scatter plot, a histogram, or a single value.
- Tabloxide proposes a chart from the types of the columns, for example a line chart for a date column with number columns. You can change the chart type, the columns of the axes, a series column, an aggregate, the stack, and the scale.
- Notes above the chart tell you when the chart does not show the complete result. Examples are the first 100,000 of 5,000,000 rows, and cells that are not numbers. **Load all rows** loads an open result to the row limit.
- A chart groups for you. If the values of the horizontal axis repeat, it shows the sum for each value and tells you so. **Group by** combines the dates of an hour, a day, a week, a month, or a year. **Number of rows** counts rows without a column.
- **Sort** puts the categories in the sequence of their names or their values.
- One sentence above the chart says what the chart shows. Each list of columns shows the type of a column. A warning about the cells of a column is below the setting of that column.
- A result with only text columns gets a bar chart of the number of rows.
- **Save as new view** writes the chart settings to a file next to the query file, for example `revenue.view.json` for `revenue.sql`. You can commit the file to Git. Tabloxide writes the file only when you save or remove a view.
- **Save image…** saves the chart as a PNG image or an SVG image.
- A chart follows the four themes. In the High contrast theme, each series also has a pattern and its own line style. A screen reader gets a text about the chart, and the grid always has the values.
- `docs/user/charts.md` describes the charts.

### Run time and cancel

- The status line of each result starts with the run time of the statement. A statement that failed or that you cancelled also shows its time.
- During a run, the results show the time since the start, and a **Cancel** button. **Ctrl+.** also cancels the statement. On macOS, press **Cmd+.**.
- The time of a result with more rows than the first page now includes each later fetch. While rows are not loaded, the status says `so far`.
- On Linux, a click on the close button of the last editor tab now closes the tab.

### Messages of the database

- The result of a statement shows the messages that the database sent with it. For PostgreSQL, these are the notices and the warnings, for example the text of `RAISE NOTICE`, or the warning of a `COMMIT` without a transaction.
- For a MongoDB update, the result shows how many documents the filter matched, how many the update changed, and how many it inserted. This needs a MongoDB connector that is newer than 0.1.0.
- The result keeps a maximum of 200 messages for one statement.

### Execution plans of a connector

- Explain is now available for the engine of a connector, for example MongoDB, after the first connect. Before, the application said that the engine gives no execution plan.

## 0.1.0 (2026-11-26)

This is the first release.

### Workspace and connections

- A workspace is a folder with your SQL files. The file `tabloxide.toml` in that folder holds the connection definitions without passwords.
- You can add, edit, duplicate, delete, and test connections.
- PostgreSQL and DuckDB are built in. A DuckDB connection opens a database file, or a database in memory.
- Other engines come as connectors. MongoDB is the first connector. See **Connectors and MongoDB**.
- A password is in the credential store of the operating system, or it comes from an environment variable.
- A connection has an environment: development, staging, or production. The run controls show the environment.
- A connection can be read-only.

### Editor and results

- SQL editor with tabs for files and for text without a file. Each tab has its own database session.
- The editor completes keywords, and the schemas, tables, views, and columns of the connected database. `Ctrl+Space` opens the list.
- **Explain** and **Explain analyze** show the plan of a statement as a tree in the results pane. The view marks the costliest steps and the large differences between the expected and the actual rows. This works for PostgreSQL and DuckDB.
- The plan view explains each step in plain words, and shows all fields of the step in groups, each with its explanation. Hints tell about probable causes of a slow statement, for example a missing index, a sort on disk, or old statistics. For PostgreSQL, the plan also has the output columns and, with Explain analyze, the block reads of the cache and the disk.
- **Format** (`Shift+Alt+F`) formats the selection or all text in the SQL dialect of the connection. One undo step restores the text.
- Snippets: the editor offers built-in snippets and the snippets of the workspace. **Save as snippet** saves SQL in `.tabloxide/snippets/`, thus Git can track the snippets of a team.
- You can run the statement at the cursor, the selection, or all statements of a tab. You can cancel a run.
- The result grid reads the rows in pages. It renders only the visible rows and the visible columns.
- The grid has sort, column resize, column visibility, and copy of a cell or a row.
- You can export a result to a CSV file.
- An error shows its position in the editor.
- The application restores the window, the open tabs, and the pane sizes after a restart.
- A file tree shows the files of the workspace.
- The start screen can remove an entry from the list of recent workspaces. The folder does not change.

### History and schema

- The query history is a side view. It groups the runs by day, and has a search and a filter for the connection. You can set how many days the history stays.
- The history does not record the text of a statement that can contain a password.
- The schema view shows schemas, tables, views, and columns with their types. A nullable column shows as `text?`. The primary keys and the foreign keys have a mark.
- The detail of a table opens as a tab in the editor area. It shows the columns, the indexes, and the constraints, and the first 100 rows. **Query the rows** opens a query for the table in a new tab.

### Git

- Open, initialise, or clone a repository.
- The Git view has three modes: Changes, History, and Branches.
- Status, stage, unstage, discard, diff, and commit. Space stages or unstages the selected file. The commit box is at the bottom of the view.
- Create, switch, rename, and delete branches.
- Fetch, pull, and push with the progress of Git.
- The commit history of the current branch, grouped by day. A commit opens as a tab with its files and the diff of each file. A commit that is not pushed has a mark.
- A diff, a conflict, and a commit open as tabs in the editor area.
- A side-by-side view for merge conflicts. You can abort a merge.
- A dialog asks for a user name, a password, or a passphrase when Git or SSH needs one.
- The application updates the file tree, the open tabs, and the Git status after a different program changed files.

### AI assistant

- A side panel writes SQL for the schema of the connected database. Each SQL block of an answer has a button that inserts it into the editor. The application does not run it.
- The panel reads the execution plan of the statement at the cursor with `EXPLAIN`, and asks for an analysis with suggestions. On request, it uses `EXPLAIN ANALYZE` for a statement that reads data.
- The assistant uses the Claude API of Anthropic with your API key. The key is in the credential store of the operating system. The preferences select the model.
- A request sends the structure of the database, the conversation, and the plan text. It sends no rows, no passwords, and no connection settings.
- Each conversation is a session. Two or more sessions can run at the same time. The side view **Sessions** lists them with their state: running, waiting for you, done, stopped, or failed.
- A session can open in its own editor tab. The tab shows the steps of the last request, the conversation, the SQL of the last answer, and the context of the request. The SQL goes into a new tab, or into the last SQL tab. The application does not run it.
- The status bar shows the number of sessions that run.

### AI actions

- Each feature has AI actions. A sparkle icon marks them. The answer goes to the assistant panel.
- A query error: **Explain and fix**.
- The selection in the editor: **Change the selection with AI** (`Ctrl+I`) and **Explain the selection with AI** (`Ctrl+Shift+I`). A change shows as a diff in the editor. You accept or reject it.
- A table in the schema view: **Explain the table** and **Write a starter query**. The starter query opens in a new tab.
- Git: **Write the message with AI** puts a commit message into the commit box. **Explain the changes** explains a diff. **Propose a resolution** proposes a resolution for a file with a merge conflict.
- **Ask about these rows** sends rows of a result after a confirmation. The AI assistant tab of Preferences sets the number of rows (1 to 1000, default 100). A production connection never sends rows.
- Each request shows what it sent.
- The AI writes its text in Simplified Technical English (ASD-STE100): short sentences, the active voice, and one word for one thing.
- The AI gets a guide for the query language of the connection: SQL for PostgreSQL and DuckDB, the MongoDB shell for MongoDB. It shows the risk of each statement that it proposes.
- The application never runs SQL or a Git command from an answer.

### Git console

- The results pane has a **Git console** tab (`` Ctrl+` ``). It runs `git` commands that you type, in the root folder of the repository. It runs no shell.
- The console keeps the last 200 commands of each workspace. `Tab` completes commands, branches, remotes, tags, and files.
- The console asks before a command that removes work.
- **Explain the last output** sends the output to the AI.

### Connectors and MongoDB

- A connector is a separate program that adds a database engine. The connection form lists the official connectors.
- The application downloads a connector only after you select **Download**. It checks the size, the SHA-256 checksum, and the signature of the list of connectors. If a check fails, it keeps nothing.
- You can install a connector from a file. A file without the project signature shows a warning.
- The **Connectors** tab of Preferences shows each engine and its source, and can remove a connector.
- The MongoDB connector runs a subset of the MongoDB shell and JSON commands. The editor has the syntax of the MongoDB shell. The schema view shows the fields from a sample of 100 documents.
- `docs/connectors/build-a-connector.md` tells how to build a connector.

### Side views

- All side views (Files, Connections, Schema, Git, History, and Sessions) have the same parts: a header with one primary action and a menu, a filter, a list or a tree, and a status line.
- All side views have the same keys: the arrow keys, `Space` shows the detail, `Enter` opens, `Ctrl+Enter` does the second action, `F2` renames, `Delete` deletes after a confirmation, `F5` reads the data again, `Shift+F10` opens the context menu, and `Ctrl+F` or `/` goes to the filter. You can type the first letters of a name to go to it.
- A single click or `Space` opens the detail in a preview tab with an italic title. The next detail replaces it. A double click or `Enter` keeps the tab.
- `F6` moves the focus between the side view, the editor, the results, and the assistant.
- The Connections view groups the connections by environment, production first. Each connection shows the state of its last test.
- The status of an item has a shape and a colour: OK, busy, neutral, warning, and error.
- `docs/user/side-views.md` describes the views.

### Safety

- The application can ask before a run. The preferences have one rule for each environment: never, before a destructive statement, or before each run.
- A destructive statement is `DROP`, `TRUNCATE`, `ALTER`, and `DELETE` or `UPDATE` without `WHERE`. For DuckDB, it is also a statement that writes files or loads an extension.
- The application connects again after the server closed a connection.

### Navigation

- A menu bar with the menus File, Connections, Git, View, and Help.
- The title bar shows the project, the connection of the active tab, and the Git branch. Each of them opens a menu to switch the project, the connection, or the branch.
- The connection menu groups the connections by environment, with a coloured mark for each environment and the engine of each connection. The branch menu shows the time of the last commit of each branch, and the remote branches. A remote branch switches to a new local branch that tracks it.
- The command palette (`Ctrl+K`, or Help › Search or run a command) finds commands, files, schema objects, and settings.
- `F1` and Help › Keyboard shortcuts show all keyboard shortcuts, with a search. The start screen has the same list.
- Tool strips on the two sides open the sidebar views and the assistant.
- The View menu shows or hides the sidebar, the assistant, the results, and the status bar. It puts the results below or beside the editor, and it has the layouts Standard and Simple.
- The status bar shows the connection, the server version, and the cursor position.
- Two new themes: neon and high contrast.
- A compact density makes the controls and the rows of the result grid smaller.
- The preferences have tabs. They show the themes as cards with a preview, and have the density and the layout.
- The layout editor makes, changes, renames, and deletes custom layouts. The results can be below the editor, beside it, or a tab in the editor. The assistant can be below the editor. The sidebar can be on the right.

### Keyboard and accessibility

- All primary functions operate with the keyboard. `README.md` lists the keys.
- The editor tabs, the file tree, the result grid, and the dialogs use the keyboard patterns of ARIA.
- The text colours of all themes have a contrast of 4.5:1 or more.
- The menus use the ARIA menu pattern, and the command palette uses the combobox pattern.

### Updates

- A release build can update itself. At the start, it asks the release page for a newer version. You can install the new version or select **Later**.
- The preferences can disable the check. **Check now** in the preferences checks immediately.
- The application installs an update only if the signature of the update file is correct.

### Known limits

- The installers have no code signature until the project has its certificates. macOS and Windows show a warning. `docs/user/install.md` gives the procedure.
- The application can update itself only when the release has update files. A release without the updater key has no update files.
- The macOS installer is for Apple silicon only.
- A person did not test the application with a screen reader.
- The download of connectors needs the signed list of connectors on tabloxide.org. Until the project publishes it, you can install a connector only from a file.
- The AI cannot read the plan of a MongoDB statement yet. This needs a new release of the MongoDB connector.
- The commit tab has no AI action and no line counts.
