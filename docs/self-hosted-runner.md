# Self-hosted runner

This document is for the maintainer of the project. It tells you how to run the Linux jobs of CI on your own server, for example the Coolify server, and what the risks are.

GitHub does not count the minutes of a self-hosted runner. The macOS and Windows jobs must stay on GitHub-hosted runners, because they need these operating systems.

## What runs where

| Workflow | Job | Runner |
| --- | --- | --- |
| CI, on a push or a pull request | Linux: format, lint, tests, Docker tests, build, smoke test | The self-hosted runner |
| CI, on a pull request from a fork | Linux | GitHub-hosted (`ubuntu-22.04`) |
| CI, started by hand with "All platforms" | macOS and Windows | GitHub-hosted |
| Release, Connectors | All builds | GitHub-hosted. They need free GitHub minutes. |
| Website sync | Copy | The self-hosted runner |

The release builds stay on GitHub-hosted runners. A Linux program needs the glibc version of the computer that built it, or an older version. The installers support Ubuntu 22.04 (glibc 2.35). A build on a server with a newer system would not start on Ubuntu 22.04.

The macOS minutes count 10 times and the Windows minutes count 2 times on a private repository. Thus CI runs these jobs only when you start them.

## Risks

- **The runner user can control the server.** The tests start database containers, so the runner user is in the group `docker`. A member of this group has the same rights as root. A workflow job can thus read the data of the other applications of the server, also the data of Coolify.
- **Only your own code must run on the runner.** CI sends a pull request from a fork to a GitHub-hosted runner. Also set this in the repository: in Settings › Actions › General, at the approval of fork pull request workflows, select the strictest option (approval for all external contributors).
- **A job uses the CPU and the memory of the server.** The service of the runner has limits: by default 6 CPU cores and 8 GB of memory, with a lower priority than the other processes. On a server with 8 cores, 2 cores stay free for the other applications.
- **The disk fills.** The runner keeps its work folder, the Rust toolchains, the Cargo cache, and the images of the test databases. Keep at least 30 GB free. The debug build and the release build of the workspace are large.

## Rust build cache

The runner keeps the Rust build between jobs in `~gha-runner/.cache/tabloxide-ci/target`. A job thus compiles only the crates that changed, not all the dependencies. The GitHub-hosted runners use the GitHub cache (`Swatinem/rust-cache`) instead.

The step "Choose the Cargo target folder" of `.github/actions/build-and-test` controls the folder:

- When the Rust version changes, the step deletes the folder. The old build files are of no use then.
- When the folder is larger than 40 GB, the step deletes it. The next job then compiles everything again. To change the limit, change `TARGET_LIMIT_GB` in the step.

To clear the cache by hand, run this on the server as root:

```sh
rm -rf /home/gha-runner/.cache/tabloxide-ci
```

If the repository becomes public, think again about the runner. Then the GitHub-hosted runners cost nothing, and the risks of the runner are not necessary.

## Install

The script `deploy/github-runner/setup.sh` installs the runner as a systemd service. It supports Debian and Ubuntu.

1. In the repository on GitHub, open Settings › Actions › Runners › New self-hosted runner. Copy the token from the command `./config.sh … --token <token>`. The token is valid for one hour.
2. Copy the script to the server:

   ```sh
   scp deploy/github-runner/setup.sh root@<server>:/root/
   ```

3. On the server, as root:

   ```sh
   RUNNER_TOKEN=<token> ./setup.sh install
   ```

   The script installs the build libraries, makes the user `gha-runner`, downloads the runner and checks its checksum, registers it with the label `tabloxide`, and starts the service `github-runner-tabloxide`.

4. In Settings › Actions › Runners, check that the runner is "Idle".

To change the limits, set them before the install, for example `RUNNER_MEMORY_MAX=12G RUNNER_CPU_QUOTA=400%`.

To change the CPU limit of a runner that is installed, run this as root. The change is immediate and stays after a restart:

```sh
systemctl set-property github-runner-tabloxide CPUQuota=600%
```

After each job, the runner removes the containers of the tests (the label `org.testcontainers=true`). It does not touch the containers of Coolify.

## Check and remove

```sh
./setup.sh status
RUNNER_TOKEN=<token> ./setup.sh remove
```

For `remove`, get a token in Settings › Actions › Runners › (the runner) › Remove. The script keeps the user and its home folder. `userdel -r gha-runner` removes them.

If the runner is offline, the Linux jobs of CI wait for it. To use GitHub-hosted runners again, change `runs-on` of the CI workflow back to `ubuntu-22.04`.
