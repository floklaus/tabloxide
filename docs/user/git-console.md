# Git console

The Git console runs Git commands that you type. It is for users who know Git and want a command that the Git panel does not have.

The console runs the `git` program of your system, in the root folder of the repository of the workspace. It runs no shell.

## 1. Open the console

Do one of these:

- Select the tab **Git console** in the results pane.
- Select **View › Show the Git console**.
- Press **Ctrl+`**.

## 2. Run a command

1. Type the command after the fixed word `git`, for example `log --oneline -5`. You can also type the word `git`.
2. Press **Enter**.

The output shows below the command. Errors of Git show in red.

| Key | Function |
| --- | --- |
| Enter | Runs the command. |
| Up, Down | Select an earlier command. The console keeps the last 200 commands of each workspace. |
| Tab | Completes the command name, a branch, a remote, a tag, or a file name. If more names fit, the console completes the common part and shows the names. |

**Stop** ends a command that runs. **Clear** removes the output from the view. It does not remove the history.

After each command, the Git panel reads the state of the repository again.

**Explain the last output** sends the last command and its output to the AI assistant. The request sends no rows and no structure of the database.

## 3. No shell

The console gives the words of the line to Git. A shell does not read the line first. Thus:

- Pipes (`|`), redirects (`>`, `<`), command lists (`;`, `&`), variables (`$HOME`), and command substitution (`` ` `` or `$( )`) do not operate. The console does not run a line with one of these characters outside quotes.
- Quotes operate as in a shell: `commit -m "Fix the report"` gives Git the message as one word.
- File patterns such as `*.sql` go to Git as they are. Git reads them as a pathspec.

## 4. Commands that need a confirmation

A command that can remove work runs only after you select **Run**. The confirmation tells the effect, for example: "This command removes the changes in 2 files and moves main back by 1 commit."

| Command | Effect that the console tells |
| --- | --- |
| `reset --hard` | The number of changed files, and the number of commits that the branch moves back |
| `clean -f` | The files that Git does not track and that the command deletes. Without such files, no confirmation is necessary. |
| `checkout -f`, `checkout -- <path>`, `checkout .`, `restore` | The command overwrites changes of files on disk |
| `rm` without `--cached` | The command deletes files on disk |
| `push --force`, `--force-with-lease`, `--delete`, `--mirror`, `--prune`, a refspec with `+` or `:` | The command can remove commits or branches of the remote repository |
| `branch -D`, `branch -d --force`, `branch -M` | The command deletes or replaces a branch |
| `stash drop`, `stash clear` | The command deletes stashed changes |
| `tag -d`, `update-ref -d`, `reflog expire`, `reflog delete`, `gc --prune`, `prune` | The command deletes references or commits |

Tabloxide cannot undo these commands.

## 5. Commands that the console does not run

The console does not run these commands. It tells the reason instead.

| Command or option | Reason |
| --- | --- |
| `rebase -i`, `config --edit`, and other commands that open an editor | The console cannot show an editor. Use the terminal of your system. |
| `add -p`, `add -i`, `commit --patch`, `checkout -p`, `reset -p`, `restore -p`, `stash -p` | The command asks questions in a terminal. |
| `help`, `--help`, `difftool`, `mergetool`, `gui`, `citool`, `gitk`, `instaweb`, `daemon`, `credential`, `send-email` | The command opens a different program or waits for input. For a short help text, use `-h`, for example `log -h`. |
| `rebase --exec`, `submodule foreach`, `bisect run`, `filter-branch` | The command runs shell commands. |
| `clone -u`, `clone --upload-pack`, `clone --template`, `clone -c`, `fetch --upload-pack`, `pull --upload-pack`, `ls-remote --upload-pack`, `push --receive-pack`, `push --exec`, `archive --exec`, `diff --ext-diff`, `diff --textconv` | The option makes Git run a different program. |
| An option before the command, for example `-c`, `-C`, `--exec-path`, `--git-dir`, `--work-tree` | The option can change the program or the folder of Git. The console accepts only `--no-pager`, `--no-replace-objects`, `--no-optional-locks`, and the pathspec options. |
| An alias that starts with `!` | The alias runs a shell command. |
| `config` with a key that names a program, for example `core.pager`, `core.sshCommand`, `core.editor`, `credential.helper`, a key that ends with `.textconv`, `.command`, or `.driver`, `include.path`, or an alias that starts with `!` | Git runs the program of this value later. |

A command that opens an editor in a different way fails at once. The console then tells you to give the text in the command, for example `commit -m "Fix the report"`.

## 6. Limits

- The console shows the last 1 MB of the output of a command.
- The console removes passwords from remote addresses in the output.
- A remote command that needs a password or a passphrase asks for it in a dialog, as the Git panel does.
- The console is not a protection against your own Git configuration. Hooks and the settings of your repository apply, as in a terminal.
