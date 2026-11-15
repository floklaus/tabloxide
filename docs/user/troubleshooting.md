# Troubleshooting

This document lists known problems of Tabloxide and their solutions. Each section starts with the symptom.

For the installation procedures, refer to [Install Tabloxide](install.md).

## 1. Installation and start

### macOS blocks the application

**Symptom:** macOS tells you that it cannot check the application for malicious software.

**Cause:** the application has no code signature and no notarisation.

**Solution:** do the procedure in [Install Tabloxide, section 4](install.md#4-macos).

### macOS tells you that the application is damaged

**Symptom:** macOS shows the message "Tabloxide is damaged and can't be opened".

**Cause:** the browser set a quarantine attribute on the download. For an application without a signature, macOS can show this message.

**Solution:**

1. Make sure that the checksum of the `.dmg` file was correct.
2. Remove the quarantine attribute:

   ```sh
   xattr -dr com.apple.quarantine /Applications/Tabloxide.app
   ```

3. Open the application again.

### Windows shows "Windows protected your PC"

**Cause:** the installer has no code signature.

**Solution:** make sure that the checksum of the installer was correct. Then select **More info** and **Run anyway**.

### The Windows installer cannot download WebView2

**Symptom:** the installer stops, or the application shows no window on a computer without internet access.

**Cause:** Tabloxide needs Microsoft Edge WebView2. The installer downloads it if it is missing.

**Solution:** download the "Evergreen Standalone Installer" of WebView2 from Microsoft on a different computer. Install it, then start the installer of Tabloxide again.

### The AppImage does not start

**Symptom:** the terminal shows a message about `libfuse.so.2` or about FUSE.

**Cause:** an AppImage needs FUSE 2. Some distributions do not install it.

**Solution:** install FUSE 2. On Ubuntu 22.04, the package is `libfuse2`. On Ubuntu 24.04, the package is `libfuse2t64`.

As an alternative, start the AppImage without FUSE:

```sh
./Tabloxide_0.1.0_amd64.AppImage --appimage-extract-and-run
```

### The window is empty on Linux

**Symptom:** the application starts, but the window stays white or transparent.

**Cause:** WebKitGTK can fail with some graphics drivers, most frequently with the NVIDIA driver.

**Solution:** start the application with this variable:

```sh
WEBKIT_DISABLE_DMABUF_RENDERER=1 tabloxide
```

### `symbol lookup error` on Linux

**Symptom:** the application stops at the start with a `symbol lookup error`. You started it from the terminal of VS Code.

**Cause:** if VS Code is a snap package, its terminal sets GTK variables that point into the snap.

**Solution:** start the application from a terminal outside VS Code, or unset the variables first:

```sh
unset GTK_PATH GTK_EXE_PREFIX GIO_MODULE_DIR GSETTINGS_SCHEMA_DIR \
  GDK_PIXBUF_MODULE_FILE GDK_PIXBUF_MODULEDIR LOCPATH
```

## 2. Workspace

### `tabloxide.toml` is not valid

**Symptom:** the welcome screen shows the message "`<path>` is not valid", followed by the problem.

**Cause:** the file `tabloxide.toml` has a syntax error. A manual edit or a merge conflict is the usual source.

**Solution:** open the file in a text editor and correct the line that the message gives. If the file is in a Git repository, you can also restore the last committed version with `git checkout -- tabloxide.toml`. This command discards your changes to the file.

### `tabloxide.toml` has a later version

**Symptom:** the message says that the file has version N and that the application supports an earlier version.

**Cause:** a later version of Tabloxide wrote the file.

**Solution:** install the latest release of Tabloxide.

### A file does not open

| Message | Cause | Solution |
|---|---|---|
| "is too large to open. The limit is 5 MB." | The editor opens text files of 5 MB or less. | Divide the file, or use a different editor. |
| "is not a UTF-8 text file." | The file is binary, or it has a different text encoding. | Convert the file to UTF-8. |
| "The path is not in the workspace folder" | Tabloxide reads and writes only files in the workspace folder. A symbolic link that points out of the folder also causes this message. | Move the file into the workspace folder. |

## 3. Passwords and the credential store

### The credential store is not available

**Symptom:** the message starts with "The credential store of the operating system is not available".

**Cause on Linux:** no Secret Service runs, or the keyring is locked. A minimal desktop, a window manager without a desktop environment, and a remote session frequently have no Secret Service.

**Solution on Linux:**

1. Install a Secret Service, for example `gnome-keyring` or KWallet.
2. Log out and log in again, so that the service starts and unlocks the keyring.
3. Save the connection again.

**Solution without a credential store:** use an environment variable. Edit the connection, set the password source to an environment variable, and enter the name of the variable. Refer to the next section.

**Cause on macOS:** you selected **Deny** when macOS asked for permission to use the keychain. Save the connection again and select **Allow** or **Always Allow**.

### The environment variable is not set

**Symptom:** the message is "The environment variable `<name>` is not set", but you set the variable in your shell profile.

**Cause:** an application that you start from the desktop does not read your shell profile. It has only the variables of the desktop session.

**Solution:** use one of these methods.

* **All systems:** open a terminal, set the variable, and start Tabloxide from that terminal.
* **Windows:** set the variable in **System Properties**, **Environment Variables**. Then start Tabloxide again.
* **macOS:** run `launchctl setenv NAME value` in a terminal. Then start Tabloxide again. The value stays until the next restart of the computer.
* **Linux:** set the variable in a file that your desktop session reads, for example `~/.config/environment.d/tabloxide.conf` on a system with systemd. Then log in again.

A variable in a file is plain text on the disk. Use the credential store when it is available.

### The credential store has no password for this connection

**Symptom:** this message shows when you connect.

**Cause:** the workspace came from a different computer, for example through a Git clone. The file `tabloxide.toml` contains the connection, but a password is never in that file.

**Solution:** edit the connection, enter the password, and save.

## 4. PostgreSQL connections

The connection test shows a short instruction and, below it, the message of the server or the driver.

| Instruction | What to examine |
|---|---|
| "Check the user and the password." | The user name and the password. Also the `pg_hba.conf` file of the server, which can refuse a user from your address. |
| "Enter a password, or set the environment variable." | The server asked for a password, and the connection has no password source. |
| "Check the database name." | The database does not exist on that server. The name is case-sensitive. |
| "Check the TLS mode and the server certificate." | Refer to the section about TLS below. |
| "Check the host, the port, and that the server is running." | The host name, the port (the default is 5432), a firewall, a VPN, or an SSH tunnel that is not open. |
| "Check the network, or increase the connection timeout." | The server did not answer in the timeout of the connection. The default is 10 seconds. |
| "Correct the connection settings." | A field in the form is not valid. The form shows the problem next to the field. |
| "Read the server message for details." | The server gave an error that Tabloxide does not classify. |

### TLS

The TLS modes have the same names and the same meanings as the `sslmode` values of PostgreSQL.

| Mode | Behaviour |
|---|---|
| `disable` | No TLS. |
| `prefer` | TLS if the server supports it. No check of the certificate. |
| `require` | TLS always. No check of the certificate. |
| `verify-full` | TLS always. The certificate chain and the host name must be correct. |

* If the server does not support TLS, `require` and `verify-full` fail. Use `prefer` or `disable`, or enable TLS on the server.
* If `verify-full` fails, the certificate does not match the host name in the connection, or its issuer is not trusted.

### The PostgreSQL connection closes during work

**Symptom:** a statement fails with the message "The connection to the server closed."

**Cause:** the server or the network closed the session, for example after a server restart, an idle timeout, or a suspend of the computer.

**Solution:** run the statement again. Tabloxide connects again before the run. Settings of the old session, for example temporary tables and an open transaction, do not exist in the new session.

### A statement on a read-only connection fails

**Symptom:** the server refuses a statement with "cannot execute ... in a read-only transaction".

**Cause:** the connection has the read-only setting.

**Solution:** this behaviour is correct. To change data, use a connection without the read-only setting.

## 5. DuckDB connections

### A different program has the database file open

**Symptom:** the connection fails with the message "A different program has the database file open."

**Cause:** DuckDB locks a database file. While one program has the file open for a write, no other program can open it, also not for a read. Many programs can open one file at the same time if each of them opens it read-only.

**Solution:** use one of these methods.

* Close the other program, for example the DuckDB command line or a notebook.
* Set the read-only setting on this connection, and open the file read-only in the other program.

### A statement cannot find a file

**Symptom:** a statement such as `SELECT * FROM 'data.csv'` fails, and the message says that the file does not exist.

**Cause:** a relative file name starts at the workspace folder, not at the folder of the SQL file.

**Solution:** write the path from the workspace folder, for example `'exports/data.csv'`, or use an absolute path.

### Tabloxide asks before a statement runs

**Symptom:** a dialog asks for confirmation before `COPY ... TO`, `EXPORT DATABASE`, `INSTALL`, or `LOAD`.

**Cause:** these statements write files on your disk, or they load program code into the application.

**Solution:** read the statement. Continue only if you know what the statement does.

### An extension does not load

**Symptom:** a statement fails with a message that an extension is not installed.

**Cause:** Tabloxide does not let DuckDB install an extension from the network automatically.

**Solution:** run `INSTALL <name>` one time, then `LOAD <name>`. The installation needs an internet connection.

### A statement on a read-only DuckDB connection fails

**Cause:** the connection has the read-only setting. For DuckDB, a statement cannot change this mode.

**Solution:** this behaviour is correct. To change data, use a connection without the read-only setting.

## 6. Query history

### The history shows "Not recorded"

**Symptom:** an entry in the history has the text "-- Not recorded: the statement can contain a password."

**Cause:** the statement can contain a password, for example `CREATE ROLE ... PASSWORD` or `ALTER ROLE ... PASSWORD`. Tabloxide does not record the text of such a statement.

**Solution:** none is necessary. Keep such statements in a file outside the repository if you need them again.

## 7. Git

### Git is not installed

**Symptom:** the Git panel shows "Git is not installed, or it is not in the PATH."

**Solution:**

1. Install Git. On Windows, use Git for Windows from <https://git-scm.com> and keep the installer option that adds Git to the `PATH`.
2. Close Tabloxide and start it again.

On macOS and Linux, an application that you start from the desktop can have a shorter `PATH` than your terminal. If Git is in an unusual folder, start Tabloxide from a terminal.

### Git does not know your name and e-mail address

**Symptom:** a commit fails with this message.

**Solution:** run these commands in a terminal, then commit again:

```sh
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

### No dialog for the passphrase of an SSH key

**Symptom:** fetch, pull, or push with an SSH remote fails, and Tabloxide shows no dialog for the passphrase.

**Cause:** OpenSSH earlier than version 8.4 does not ask through the application.

**Solution:** update OpenSSH, or add the key to an SSH agent before you start Tabloxide:

```sh
ssh-add ~/.ssh/id_ed25519
```

### Tabloxide asks for the credential each time

**Cause:** Tabloxide sends your answer to Git only. It does not store the answer.

**Solution:** configure a credential helper for Git, or use an SSH agent. Git for Windows and Git on macOS usually install a credential helper.

### A Git operation stops after a credential dialog

**Cause:** if you give no answer in 5 minutes, Git stops the operation.

**Solution:** start the operation again.

### Pull reports a merge conflict

**Solution:** the Git panel lists the files that have a conflict. Open each file in the conflict view, edit the result, and mark it as resolved. Then commit. To go back to the state before the pull, abort the merge.

### The Git panel is not necessary for a workspace

**Solution:** disable Git for that workspace in the Git panel. The setting applies to one workspace on one computer.

## 8. Reset the local state

If the application shows the message "The local state database failed", or if it stops at each start, the local state can be defective.

1. Close Tabloxide.
2. Find the application data folder. [Install Tabloxide, section 9](install.md#9-where-tabloxide-keeps-data) gives the path.
3. Change the name of the file `state.sqlite3`, for example to `state.sqlite3.old`.
4. Start Tabloxide.

This procedure removes the query history, the preferences, and the open tabs. It does not change your workspaces, your connections, or your passwords.

## 9. Report a problem

Tabloxide does not write a log file. Thus a report must contain the data that follows:

* The version of Tabloxide. The status bar shows it.
* The operating system and its version.
* The type of installer (for example `.deb`, AppImage, `.msi`).
* The exact text of the error message.
* The steps that cause the problem.
* For a database problem: the database engine. For PostgreSQL, also the version of the server.
* For a Git problem: the output of `git --version`.

Before you send a report, remove passwords, tokens, host names, and private data from the text.

Do not report a security problem in public. Refer to the `SECURITY.md` file of the repository.
