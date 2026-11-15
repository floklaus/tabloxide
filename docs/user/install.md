# Install Tabloxide

This document tells you how to install, start, update, and uninstall Tabloxide on Linux, macOS, and Windows.

If a step fails, refer to [Troubleshooting](troubleshooting.md).

## 1. Requirements

| | Linux | macOS | Windows |
|---|---|---|---|
| Processor | x86-64 | Apple silicon | x86-64 |
| Operating system | A distribution with glibc 2.35 or later, for example Ubuntu 22.04, Debian 12, or Fedora 36 | A macOS version that supports Apple silicon | Windows 10 or Windows 11 |
| Web view | WebKitGTK 4.1 | Part of macOS | Microsoft Edge WebView2 |
| Credential store | A Secret Service, for example GNOME Keyring or KWallet | Keychain | Credential Manager |

Notes:

* **Intel Mac:** a release has no installer for an Intel Mac. Build the application from the source code. Refer to the `README.md` file of the repository.
* **Web view on Linux:** the package manager installs WebKitGTK together with the `.deb` or the `.rpm` package. The AppImage contains its own copy.
* **Web view on Windows:** Windows 11 includes WebView2. If WebView2 is missing, the installer downloads it. This download needs an internet connection.
* **Credential store:** Tabloxide keeps each database password in the credential store. Without a credential store, a password can come from an environment variable.

### Git

The Git functions use the `git` executable of your system. Tabloxide does not include Git.

* Install Git and make sure that `git` is in the `PATH`.
* On Windows, install Git for Windows from <https://git-scm.com>.
* A passphrase prompt for an SSH key needs OpenSSH 8.4 or later.

Without Git, the Git panel shows an instruction to install Git. The database functions continue to operate.

## 2. Download the installer and check it

A release has these files. The version number and the architecture in each file name can be different.

| Operating system | File | Example |
|---|---|---|
| Linux (Debian, Ubuntu) | `.deb` | `Tabloxide_0.1.0_amd64.deb` |
| Linux (Fedora, openSUSE) | `.rpm` | `Tabloxide-0.1.0-1.x86_64.rpm` |
| Linux (other) | `.AppImage` | `Tabloxide_0.1.0_amd64.AppImage` |
| macOS | `.dmg` | `Tabloxide_0.1.0_aarch64.dmg` |
| Windows | `.msi` | `Tabloxide_0.1.0_x64_en-US.msi` |
| Windows | `-setup.exe` | `Tabloxide_0.1.0_x64-setup.exe` |
| All | `SHA256SUMS.txt` | The SHA-256 checksum of each installer |

The installers have no code signature. Thus the checksum is the only method to make sure that the download is correct.

1. Download the installer for your operating system.
2. Download `SHA256SUMS.txt` into the same folder.
3. Calculate the checksum of the installer with the command for your operating system.
4. Compare the result with the line for your installer in `SHA256SUMS.txt`.
5. If the two values are different, do not start the installer. Download it again.

Linux:

```sh
sha256sum --check --ignore-missing SHA256SUMS.txt
```

This command does the comparison for you. It prints `OK` for a correct file.

macOS:

```sh
shasum -a 256 Tabloxide_0.1.0_aarch64.dmg
```

Windows (PowerShell):

```powershell
Get-FileHash .\Tabloxide_0.1.0_x64-setup.exe -Algorithm SHA256
```

## 3. Linux

Use one of the three procedures.

### Debian and Ubuntu (`.deb`)

```sh
sudo apt install ./Tabloxide_0.1.0_amd64.deb
```

The `./` before the file name is necessary. Without it, `apt` searches its package sources for the name.

### Fedora and openSUSE (`.rpm`)

Fedora:

```sh
sudo dnf install ./Tabloxide-0.1.0-1.x86_64.rpm
```

openSUSE:

```sh
sudo zypper install ./Tabloxide-0.1.0-1.x86_64.rpm
```

`zypper` tells you that the package has no signature. Accept this only after the checksum was correct.

### Other distributions (`.AppImage`)

An AppImage is one executable file. It needs no installation.

1. Move the file to a folder of your selection, for example `~/Applications`.
2. Make the file executable:

   ```sh
   chmod +x Tabloxide_0.1.0_amd64.AppImage
   ```

3. Start the file:

   ```sh
   ./Tabloxide_0.1.0_amd64.AppImage
   ```

An AppImage needs FUSE 2. If the start fails with a message about FUSE, refer to [Troubleshooting](troubleshooting.md#the-appimage-does-not-start).

### Start

After the installation of a `.deb` or an `.rpm` package, Tabloxide is in the application menu of your desktop. You can also start it from a terminal:

```sh
tabloxide
```

## 4. macOS

1. Open the `.dmg` file.
2. Move `Tabloxide` to the `Applications` folder.
3. Eject the disk image.
4. Open `Tabloxide` from the `Applications` folder.

The application has no code signature and no notarisation. Thus macOS blocks the first start. Do this procedure one time:

1. Try to open the application. macOS shows a message that it cannot check the application. Close the message.
2. Open **System Settings**, then **Privacy & Security**.
3. Go to the **Security** section. Select **Open Anyway** for Tabloxide.
4. Enter your password or use Touch ID. Then select **Open**.

On macOS 14 and earlier, you can also hold `Control`, click the application, and select **Open**.

If macOS tells you that the application is damaged, refer to [Troubleshooting](troubleshooting.md#macos-tells-you-that-the-application-is-damaged).

When Tabloxide reads or writes a password for the first time, macOS can ask for permission to use the keychain. Select **Always Allow** to prevent the question for each connection.

## 5. Windows

A release has two installers. Use one of them. Do not install the two.

| Installer | Installs for | Administrator rights |
|---|---|---|
| `-setup.exe` | The current user | Not necessary |
| `.msi` | All users of the computer | Necessary |

1. Start the installer.
2. Windows SmartScreen can show the message "Windows protected your PC", because the installer has no code signature. Select **More info**, then **Run anyway**.
3. Obey the instructions of the installer.
4. Start Tabloxide from the Start menu.

## 6. First start

1. Tabloxide shows the welcome screen. Select **Open folder…** and select the folder that contains your SQL files. This folder is the workspace.
   * To get a workspace from a Git server, select **Clone a repository…**.
2. In the **Connections** list, select **New**.
3. Select the database engine and enter the connection data. Select **Test connection**, then **Save**.
   * A PostgreSQL connection needs a server.
   * A DuckDB connection needs only a database file. Tabloxide contains DuckDB, thus no other installation is necessary.
4. Write a statement in the editor. Press `Ctrl+Enter` to run it. On macOS, press `Cmd+Enter`.

Tabloxide writes the connection definitions into the file `tabloxide.toml` in the workspace folder. This file contains no password, thus you can commit it.

## 7. Update

Tabloxide does not update itself. To update, download the installer of the new release and install it with the procedure for your operating system.

* **Linux packages, macOS, Windows:** the new version replaces the old version.
* **AppImage:** delete the old file and use the new file.

An update keeps your workspaces, your history, your preferences, and your passwords.

## 8. Uninstall

| Installation | Procedure |
|---|---|
| `.deb` | `sudo apt remove tabloxide` |
| `.rpm` on Fedora | `sudo dnf remove tabloxide` |
| `.rpm` on openSUSE | `sudo zypper remove tabloxide` |
| AppImage | Delete the file. |
| macOS | Move `Tabloxide` from the `Applications` folder to the Trash. |
| Windows | Open **Settings**, then **Apps**, then **Installed apps**. Find Tabloxide and select **Uninstall**. |

This procedure does not delete your data. The next section tells you where the data is.

## 9. Where Tabloxide keeps data

| Data | Location |
|---|---|
| SQL files | The workspace folder |
| Connection definitions without passwords | `tabloxide.toml` in the workspace folder |
| Query history, preferences, open tabs, list of recent workspaces | The application data folder |
| Database passwords | The credential store of the operating system |

The application data folder has these paths:

| Operating system | Path |
|---|---|
| Linux | `~/.local/share/dev.tabloxide.desktop` |
| macOS | `~/Library/Application Support/dev.tabloxide.desktop` |
| Windows | `%APPDATA%\dev.tabloxide.desktop` |

On Linux, the path is different if the variable `XDG_DATA_HOME` is set.

The web view and the window position use more folders that have the name `dev.tabloxide.desktop`. These folders are in the configuration directory and the cache directory of your user. They contain no SQL text and no password.

To delete all data of Tabloxide from a computer:

1. Delete each connection in Tabloxide before you uninstall the application. This also deletes the password of the connection from the credential store.
2. Uninstall the application.
3. Delete the folders that have the name `dev.tabloxide.desktop`.

If you uninstalled the application first, delete the passwords in the credential store manually. The entries have the service name `dev.tabloxide.desktop`. Use Keychain Access on macOS, Credential Manager on Windows, or a tool such as Seahorse on Linux.

Tabloxide never deletes a workspace folder.
