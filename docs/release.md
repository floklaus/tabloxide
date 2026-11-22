# Release procedure

This document is for the maintainer of the project. It tells you how to prepare the repository for signed releases with updates, and how to make a release.

The release workflow is `.github/workflows/release.yml`. It operates without the keys and the certificates of this document. Without them, the installers have no signature and the application does not update itself.

## Parts of a release

| Part | Necessary data | Without the data |
|---|---|---|
| Installers for Linux, macOS, and Windows | Nothing | Not applicable |
| Update files and the update manifest `latest.json` | The updater key pair | The application does not update itself. |
| macOS signature and notarisation | An Apple Developer ID certificate and an Apple account | macOS blocks the first start. |
| Windows signature | A code signing certificate | Windows SmartScreen shows a warning. |

## Updater key pair

The updater accepts only an update file with a correct signature. The private key signs the update files. The public key is in each build of the application.

1. Make the key pair on your computer:

   ```sh
   pnpm tauri signer generate -w ~/.tauri/tabloxide.key
   ```

   The command asks for a password. Use a strong password.

2. In the settings of the repository, add these secrets:
   - `TAURI_SIGNING_PRIVATE_KEY`: the content of `~/.tauri/tabloxide.key`.
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: the password of the key.
3. Add the repository variable `TAURI_UPDATER_PUBKEY` with the content of `~/.tauri/tabloxide.key.pub`. A variable is correct here, because the public key is not a secret.
4. Keep a copy of the private key and its password in a safe place.

> **Warning:** If you lose the private key, the installed applications cannot get updates. The users must then install the next version manually. Do not put the private key into the repository.

The workflow adds the update address `https://github.com/<owner>/<repository>/releases/latest/download/latest.json` to the build. The address works only after you publish the release. A draft release is not visible to the updater.

## macOS signature and notarisation

You need a membership of the Apple Developer Program.

1. Make a "Developer ID Application" certificate in your Apple Developer account.
2. Export the certificate and its private key from Keychain Access as a `.p12` file with a password.
3. Encode the file as Base64:

   ```sh
   base64 -i certificate.p12 | pbcopy
   ```

4. Make an app-specific password for your Apple account at https://account.apple.com.
5. Add these secrets to the repository:

   | Secret | Value |
   |---|---|
   | `APPLE_CERTIFICATE` | The Base64 text of the `.p12` file |
   | `APPLE_CERTIFICATE_PASSWORD` | The password of the `.p12` file |
   | `APPLE_SIGNING_IDENTITY` | The name of the certificate, for example `Developer ID Application: Name (TEAMID)` |
   | `APPLE_ID` | The e-mail address of your Apple account |
   | `APPLE_PASSWORD` | The app-specific password |
   | `APPLE_TEAM_ID` | The team identifier of your Apple Developer account |

If `APPLE_CERTIFICATE` has a value, the workflow needs all six secrets. It stops with an error if one of them is missing.

## Windows signature

You need a code signing certificate as a `.pfx` file with a password.

1. Encode the file as Base64:

   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("certificate.pfx")) | Set-Clipboard
   ```

2. Add these secrets to the repository:
   - `WINDOWS_CERTIFICATE`: the Base64 text.
   - `WINDOWS_CERTIFICATE_PASSWORD`: the password of the file.

The workflow uses the time stamp server of DigiCert. A time stamp keeps the signature valid after the certificate expires.

Some certificate providers do not give a `.pfx` file. They keep the key in a hardware module or in a cloud service. The workflow does not support this. It then needs a different sign step.

## Make a release

1. In `CHANGELOG.md`, change the title `## Unreleased` to the version and the date, for example `## 0.1.0 (2026-12-01)`. Add a new, empty section `## Unreleased` above it.
2. Set the same version in `Cargo.toml` (`workspace.package.version`), `package.json`, and `ui/package.json`. The updater compares the version of the build with the version of the release.
3. Commit the changes.
4. Push a tag for that version, for example `v0.1.0`.
5. The workflow builds the installers on the three platforms. It makes a draft release with these files:
   - The installers.
   - The update files and their signatures, if the repository has the updater key.
   - `latest.json`, if the repository has the updater key.
   - `SHA256SUMS.txt`.
   - The release notes from the section of the version in `CHANGELOG.md`.
6. Examine the draft. Install one installer and start the application.
7. Publish the draft. The installed applications then find the new version at their next start.

## Test the updater

The updater operates only between two signed releases. Do this test after the first two releases with the updater key:

1. Install the older release.
2. Publish the newer release.
3. Start the older application. It shows a notice for the newer version.
4. Select **Install and restart**. The application starts again with the newer version.
5. In **Preferences**, select **Check now**. The application shows that you use the newest version.
