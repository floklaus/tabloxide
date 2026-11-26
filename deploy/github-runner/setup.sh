#!/usr/bin/env bash
#
# setup.sh — install, update, or remove a self-hosted GitHub Actions runner for the
# Tabloxide repository on a Linux server, for example the Coolify server.
# docs/self-hosted-runner.md tells why and what the risks are.
#
# Run it as root on the server:
#
#   sudo RUNNER_TOKEN=<token> ./setup.sh install
#   sudo RUNNER_TOKEN=<token> ./setup.sh remove
#   sudo ./setup.sh status
#
# Get the token in the repository on GitHub: Settings › Actions › Runners ›
# New self-hosted runner. A token is valid for one hour. The script does not
# write the token to a file or to the log.
#
# Settings (environment variables, all optional):
#   RUNNER_REPOSITORY   default: https://github.com/floklaus/tabloxide
#   RUNNER_NAME         default: <host name>-tabloxide
#   RUNNER_USER         default: gha-runner
#   RUNNER_MEMORY_MAX   default: 8G    hard memory limit of all jobs
#   RUNNER_CPU_QUOTA    default: 600%  six CPU cores at most
#   RUNNER_VERSION      default: the pinned version below
#   RUNNER_SHA256       default: the checksum of the pinned version
set -euo pipefail

# The runner updates itself later. This is only the first version.
PINNED_VERSION="2.338.2"
PINNED_SHA256="baebf204307bac6193480852732f0aba2ae97b6c5597c244f4d5558390147c40"

REPOSITORY="${RUNNER_REPOSITORY:-https://github.com/floklaus/tabloxide}"
RUNNER_USER="${RUNNER_USER:-gha-runner}"
NAME="${RUNNER_NAME:-$(hostname -s)-tabloxide}"
MEMORY_MAX="${RUNNER_MEMORY_MAX:-8G}"
CPU_QUOTA="${RUNNER_CPU_QUOTA:-600%}"
VERSION="${RUNNER_VERSION:-$PINNED_VERSION}"
SHA256="${RUNNER_SHA256:-$PINNED_SHA256}"
LABELS="tabloxide"

HOME_DIR="/home/$RUNNER_USER"
RUNNER_DIR="$HOME_DIR/actions-runner"
SERVICE="github-runner-tabloxide"
UNIT_FILE="/etc/systemd/system/$SERVICE.service"

die() { echo "error: $*" >&2; exit 1; }
info() { echo ">> $*" >&2; }

need_root() { [ "$(id -u)" -eq 0 ] || die "run this script as root (sudo)"; }
# Runs `./config.sh <args>` as the runner user with the token. The runner reads
# its inputs from ACTIONS_RUNNER_INPUT_* variables. The token goes through a file
# that only the runner user can read, so that it is never on a command line, where
# `ps` would show it.
config_as_runner() {
  local secret
  # The file is in the runner folder, not in /tmp. In /tmp, the kernel setting
  # fs.protected_regular stops root from writing to a file of a different user.
  # Root writes the token first, and gives the file to the runner user after that.
  secret="$(mktemp "$RUNNER_DIR/.token.XXXXXX")"
  chmod 600 "$secret"
  printf '%s' "$RUNNER_TOKEN" > "$secret"
  chown "$RUNNER_USER" "$secret"
  local status=0
  # The inner shell expands the variables, so the single quotes are correct.
  # shellcheck disable=SC2016
  runuser -u "$RUNNER_USER" -- bash -c \
    'cd "$1" && shift && secret="$1" && shift && ACTIONS_RUNNER_INPUT_TOKEN="$(cat "$secret")" HOME="$(getent passwd "$(id -un)" | cut -d: -f6)" exec ./config.sh "$@"' \
    config "$RUNNER_DIR" "$secret" "$@" || status=$?
  rm -f "$secret"
  return "$status"
}

need_token() { [ -n "${RUNNER_TOKEN:-}" ] || die "set RUNNER_TOKEN (Settings › Actions › Runners › New self-hosted runner)"; }

# The libraries of the Tauri build and the tools of the CI steps. GitHub-hosted
# runners have them. On this server, the workflow does not install them, because
# the runner user has no sudo.
install_packages() {
  command -v apt-get >/dev/null || die "this script supports Debian and Ubuntu only"
  info "installing the system packages"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -q
  # Ubuntu 24.04 and later have libfuse2 with the name libfuse2t64. The AppImage
  # build needs it.
  local fuse=libfuse2
  if apt-cache show libfuse2t64 >/dev/null 2>&1; then
    fuse=libfuse2t64
  fi
  apt-get install -y -q --no-install-recommends \
    build-essential curl file git jq unzip xz-utils zstd ca-certificates pkg-config \
    libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev \
    libssl-dev libxdo-dev xvfb xauth "$fuse" rpm
  command -v docker >/dev/null || die "Docker is missing. The Coolify server has it, so check the PATH."
}

create_user() {
  if ! id "$RUNNER_USER" >/dev/null 2>&1; then
    info "creating the user $RUNNER_USER"
    useradd --create-home --shell /bin/bash "$RUNNER_USER"
  fi
  # The tests of the database engines start containers. Membership of the docker
  # group gives the same rights as root on this server. docs/self-hosted-runner.md
  # explains the risk.
  usermod -aG docker "$RUNNER_USER"
}

download_runner() {
  local archive="actions-runner-linux-x64-$VERSION.tar.gz"
  local url="https://github.com/actions/runner/releases/download/v$VERSION/$archive"
  local tmp
  tmp="$(mktemp -d)"
  info "downloading the runner $VERSION"
  curl -fsSL "$url" -o "$tmp/$archive"
  echo "$SHA256  $tmp/$archive" | sha256sum -c --quiet - || die "the checksum of the runner download does not agree"
  install -d -o "$RUNNER_USER" -g "$RUNNER_USER" "$RUNNER_DIR"
  tar -xzf "$tmp/$archive" -C "$RUNNER_DIR"
  chown -R "$RUNNER_USER:$RUNNER_USER" "$RUNNER_DIR"
  rm -rf "$tmp"
}

# After each job, remove the containers that the tests left. Only containers of
# testcontainers: the containers of Coolify stay.
write_cleanup_hook() {
  cat > "$RUNNER_DIR/job-completed.sh" <<'HOOK'
#!/usr/bin/env bash
docker ps -aq --filter label=org.testcontainers=true | xargs -r docker rm -f >/dev/null 2>&1 || true
HOOK
  chmod 755 "$RUNNER_DIR/job-completed.sh"
  chown "$RUNNER_USER:$RUNNER_USER" "$RUNNER_DIR/job-completed.sh"
  printf 'ACTIONS_RUNNER_HOOK_JOB_COMPLETED=%s\n' "$RUNNER_DIR/job-completed.sh" > "$RUNNER_DIR/.env"
  chown "$RUNNER_USER:$RUNNER_USER" "$RUNNER_DIR/.env"
}

configure_runner() {
  info "registering the runner $NAME at $REPOSITORY"
  # The runner reads its inputs from ACTIONS_RUNNER_INPUT_* variables. Thus the
  # token is not on a command line, and `ps` does not show it.
  config_as_runner --unattended \
    --url "$REPOSITORY" --name "$NAME" --labels "$LABELS" --work _work --replace
}

# A systemd service with limits, so that a build does not stop the applications
# of Coolify on the same server.
write_service() {
  info "writing $UNIT_FILE (memory max $MEMORY_MAX, CPU quota $CPU_QUOTA)"
  cat > "$UNIT_FILE" <<UNIT
[Unit]
Description=GitHub Actions runner for Tabloxide
After=network-online.target docker.service
Wants=network-online.target

[Service]
User=$RUNNER_USER
WorkingDirectory=$RUNNER_DIR
ExecStart=$RUNNER_DIR/run.sh
Restart=always
RestartSec=10
KillMode=process
KillSignal=SIGTERM
TimeoutStopSec=5min
Nice=10
CPUWeight=50
IOWeight=50
CPUQuota=$CPU_QUOTA
MemoryHigh=$(( ${MEMORY_MAX%G} * 3 / 4 ))G
MemoryMax=$MEMORY_MAX
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl enable --now "$SERVICE"
}

cmd_install() {
  need_root; need_token
  [[ "$MEMORY_MAX" =~ ^[0-9]+G$ ]] || die "RUNNER_MEMORY_MAX must be a number of gigabytes, for example 8G"
  install_packages
  create_user
  if [ -f "$RUNNER_DIR/.runner" ]; then
    info "the runner is registered already: stopping it to register it again"
    systemctl stop "$SERVICE" 2>/dev/null || true
  else
    download_runner
  fi
  write_cleanup_hook
  configure_runner
  write_service
  info "done. The runner shows as Idle in Settings › Actions › Runners."
}

cmd_remove() {
  need_root; need_token
  systemctl disable --now "$SERVICE" 2>/dev/null || true
  rm -f "$UNIT_FILE"
  systemctl daemon-reload
  if [ -f "$RUNNER_DIR/config.sh" ]; then
    info "removing the registration at GitHub"
    config_as_runner remove --unattended
  fi
  info "the user $RUNNER_USER and $HOME_DIR stay. Remove them with: userdel -r $RUNNER_USER"
}

cmd_status() {
  systemctl --no-pager status "$SERVICE" || true
}

case "${1:-}" in
  install) cmd_install ;;
  remove) cmd_remove ;;
  status) cmd_status ;;
  *) echo "usage: $0 install|remove|status" >&2; exit 2 ;;
esac
