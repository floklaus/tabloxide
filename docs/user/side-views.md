# Side views

The tool strip on the left selects the side view: Files, Connections, Schema, Git, History, or Sessions. All side views have the same parts, the same keys, and the same states. When you know one view, you know all views.

## 1. Parts of a view

Each view has these parts, from the top to the bottom:

1. **Header.** The title of the view, then the scope. The scope is the connection and the database, the workspace, or the branch. In some views, the scope is a menu that changes the scope. On the right, the header has one primary action as an icon button, and the overflow menu (**⋯**). The overflow menu has all actions of the view.
2. **Modes.** Only the Git view has modes: Changes, History, and Branches.
3. **Filter.** The filter field shows only the rows that contain the text. The History view searches the text of the statements.
4. **Body.** One tree or one list. Group headers divide a list, for example by day or by environment. Only the body scrolls.
5. **Status line.** The number of rows, the age of the data, or an operation in progress. The status line never shows an error. An error shows at the top of the body.

A status mark comes before the label of a row. Each state has a colour and a shape, so you can see the state without the colour:

| Shape | State | Examples |
|---|---|---|
| Filled circle | OK | Connected, the query ran, the session is done |
| Open arc | Busy | Testing, running |
| Ring | Neutral | Not tested, stopped, new |
| Triangle | Warning | Old data, the session waits for you |
| Diamond | Error | Failed, conflict |

## 2. Detail in a preview tab

The detail of a row opens in a tab of the editor area. Examples are the structure of a table, the settings of a connection, a commit, and a history entry.

- A click or **Space** shows the detail in the preview tab. The title of a preview tab is in italics. The focus stays in the view. The next selection replaces the preview tab.
- A double click or **Enter** keeps the tab open. An edit in the tab also keeps it.
- **Esc** in the rows closes the preview tab.

Files and sessions have no preview tab. A click, **Space**, and **Enter** open the file or the session in its own tab.

## 3. Keys

You can do each task of a view with the keyboard. The keys are the same in each view.

| Keys | Function |
|---|---|
| **F6**, **Shift+F6** | Move the focus to the next or the previous area of the window: side view, editor, lower panel, assistant. |
| **Up**, **Down** | Move the focus one row. The detail does not change. |
| **Home**, **End**, **Page Up**, **Page Down** | Move to the first row, the last row, or one page. |
| **Right**, **Left** | In a tree: open or close a node. **Right** on an open node moves to its first child. **Left** on a closed node moves to its parent. |
| **Space** | Show the detail in the preview tab. In the Git changes, Space stages or unstages the file. |
| **Enter** | Do the primary action of the row: open the table, the file, or the diff, connect, switch to the branch, or open the session. |
| **Ctrl+Enter** | Do the second action of the row: query the first 100 rows, test the connection, run the history entry again, or show the session in the assistant panel. |
| **F2** | Rename or edit the row. Views without rename ignore F2. |
| **Delete** | Delete or discard the row. A confirmation names the object first. Views without delete ignore the key. |
| **F5** | Read the data of the view again. |
| **Shift+F10** or the Menu key | Open the context menu of the row. It has the same actions as the overflow menu. |
| **Ctrl+F** or **/** | Move the focus to the filter field. |
| **Esc** | In the filter: clear the text. A second Esc moves the focus to the rows. In the rows: close the preview tab. |
| Letters and digits | Type-ahead: move to the next row that starts with the typed text. Type-ahead does not filter. |

On macOS, use **Cmd** in place of **Ctrl**. **Help › Keyboard shortcuts** (**F1**) shows all keys, with a search.

**Tab** moves between the parts of a view: the scope, the actions, the modes, the filter, and the rows. The rows are one Tab stop. The arrow keys move between the rows.

## 4. States

Each view shows one of these states in its body. The header and the filter stay in their place.

- **Empty.** The view has nothing to show yet. A sentence tells why, and a button fixes it. For example, the Schema view shows "Select a connection" when the tab has no connection.
- **No match.** The filter hides all rows. **Clear the filter** shows all rows again.
- **Loading.** After 300 ms, grey rows show in place of the data. The rows that are already there stay.
- **Error.** The error shows at the top of the body. It tells what failed. **Try again** reads the data again.

## 5. The views

| View | Rows | Space or click | Enter | Ctrl+Enter | F2 | Delete |
|---|---|---|---|---|---|---|
| Files | Folders and files of the workspace, as a tree | Opens a folder or a file | Opens a folder or a file | — | — | — |
| Connections | Connections in groups by environment | Shows the connection | Connects the tab | Tests the connection | Edits the connection | Deletes the connection |
| Schema | Schemas, tables, and columns, as a tree | Shows the table | Opens the table in a tab that stays | Queries the first 100 rows | — | — |
| Git | Changes, commits, or branches | Stages or unstages a change, shows a commit, or selects a branch | Opens the diff or the commit, or switches to the branch | Commits the staged changes | Renames a branch | Discards a change, or deletes a branch |
| History | Statements that ran, in groups by day | Shows the entry | Opens the statement in a new tab | Runs the statement again | — | — |
| Sessions | Assistant sessions, the newest first | Opens the session in its tab | Opens the session in its tab | Shows the session in the assistant panel | — | — |

The Files view filters only the folders that loaded. Open a folder to include its files in the filter. The Files view has no F2 and no Delete: Tabloxide does not rename or delete files.
