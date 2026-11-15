# Security policy

## Report a vulnerability

Do not report a vulnerability in a public issue, a pull request, or a discussion. A public report puts the users at risk before a correction is available.

Send a private report with the function **Report a vulnerability** on the **Security** page of the repository.

Include this data:

- The version of Tabloxide and the operating system.
- A description of the vulnerability and of the damage that it can cause.
- The steps or the files that show the vulnerability.
- A possible correction, if you know one.

Remove real passwords, tokens, and host names from the report.

## What occurs after a report

1. A maintainer tells you that the report arrived.
2. The maintainer examines the report and tells you the result.
3. For a real vulnerability, the maintainer prepares a correction and a new release.
4. The release notes describe the vulnerability after the release is available. They give your name if you agree.

The project has a small number of maintainers and gives no fixed response time. Do not publish the vulnerability before the release with the correction is available.

## Supported versions

Only the latest release gets security corrections.

## Scope

These are examples of a vulnerability:

- A database password, or an answer to a credential prompt of Git, that goes into a file, the history, or an error message.
- A read or a write of a file outside the workspace folder through the file functions of the application.
- A workspace, a `tabloxide.toml` file, or a SQL file from a different person that runs a command or a statement without an action of the user.
- A second program on the same computer that gets a credential from the credential prompt of Tabloxide.
- Content from a database or from a Git repository that runs as script code in the window of the application.

These are not a vulnerability of Tabloxide:

- **A statement that you run changes or reads data.** Tabloxide sends your SQL to the database with the rights of the database user.
- **A read-only connection permits a write.** This setting is a protection against mistakes. A statement can set the session back to read-write. For a real restriction, use a database user that has only read permissions.
- **A person with access to your user account reads your passwords.** The credential store of the operating system protects the passwords with your account.
- **The TLS modes `prefer` and `require` do not check the server certificate.** These modes have the same meaning as in PostgreSQL. Use `verify-full` to check the certificate.
- **A Git hook or a Git configuration of a repository runs a program.** Tabloxide uses the `git` executable of the system, which runs the hooks of a repository. Open only a repository that you trust.
- **The installers have no code signature.** This is a known limit. Compare the checksum of the installer with `SHA256SUMS.txt`.

## Security properties of the application

The section **Security** in [README.md](README.md) lists the properties that the application keeps.
