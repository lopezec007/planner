#!/usr/bin/env bash
# Install or upgrade planner as a systemd service on Debian 13.
#
# Usage (as root):
#   deploy/install.sh                 # build with the local Go toolchain
#   deploy/install.sh dist/planner    # install a prebuilt binary (e.g. from `make dist`)
#
# Idempotent: re-running upgrades the binary and unit, restarts the service,
# and leaves /etc/planner/planner.env and /var/lib/planner untouched.
set -euo pipefail

SVC_USER=planner
BIN_DST=/usr/local/bin/planner
UNIT_DST=/etc/systemd/system/planner.service
ENV_DIR=/etc/planner
ENV_DST=$ENV_DIR/planner.env
STATE_DIR=/var/lib/planner

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_DIR="$REPO_DIR/deploy"

die() { echo "install.sh: $*" >&2; exit 1; }
log() { echo "==> $*"; }

[[ $EUID -eq 0 ]] || die "must be run as root (try: sudo $0 $*)"
command -v systemctl >/dev/null || die "systemctl not found; this script targets systemd (Debian 13)"
[[ -f /etc/debian_version ]] || echo "install.sh: warning: not a Debian system; continuing anyway" >&2
[[ -f "$DEPLOY_DIR/planner.service" && -f "$DEPLOY_DIR/planner.env.example" ]] \
    || die "deploy files not found in $DEPLOY_DIR"

# --- 1. Obtain the binary -------------------------------------------------
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

if [[ $# -ge 1 ]]; then
    BIN_SRC=$1
    [[ -f "$BIN_SRC" ]] || die "prebuilt binary not found: $BIN_SRC"
    [[ -x "$BIN_SRC" ]] || die "prebuilt binary is not executable: $BIN_SRC"
    log "using prebuilt binary $BIN_SRC"
else
    # sudo usually resets PATH, so also look where the Go tarball installs to.
    GO=$(command -v go || true)
    if [[ -z "$GO" && -x /usr/local/go/bin/go ]]; then GO=/usr/local/go/bin/go; fi
    [[ -n "$GO" ]] || die "go not found; either install Go or pass a prebuilt binary: $0 dist/planner (build it with 'make dist')"
    VERSION=$(cd "$REPO_DIR" && git describe --tags --always --dirty 2>/dev/null || echo dev)
    log "building planner $VERSION with $("$GO" version)"
    BIN_SRC="$TMP/planner"
    (cd "$REPO_DIR" && CGO_ENABLED=0 "$GO" build -trimpath -ldflags "-s -w -X main.build=$VERSION" -o "$BIN_SRC" .)
fi

"$BIN_SRC" -version >/dev/null || die "$BIN_SRC does not run on this machine"

# --- 2. System user ---------------------------------------------------------
if getent passwd "$SVC_USER" >/dev/null; then
    log "system user $SVC_USER already exists"
else
    log "creating system user $SVC_USER"
    useradd --system --user-group --home-dir "$STATE_DIR" --no-create-home \
        --shell /usr/sbin/nologin --comment "planner service" "$SVC_USER"
fi

# --- 3. Binary ---------------------------------------------------------------
# Copy then rename so a running service is never left with a half-written
# or "text file busy" binary.
log "installing binary to $BIN_DST ($("$BIN_SRC" -version))"
install -m 0755 "$BIN_SRC" "$BIN_DST.tmp"
mv -f "$BIN_DST.tmp" "$BIN_DST"

# --- 4. Unit and environment file -------------------------------------------
log "installing unit to $UNIT_DST"
install -m 0644 "$DEPLOY_DIR/planner.service" "$UNIT_DST"

install -d -m 0755 "$ENV_DIR"
install -m 0644 "$DEPLOY_DIR/planner.env.example" "$ENV_DIR/planner.env.example"
if [[ -f "$ENV_DST" ]]; then
    log "keeping existing $ENV_DST"
else
    log "creating $ENV_DST from example"
    install -m 0644 "$DEPLOY_DIR/planner.env.example" "$ENV_DST"
fi

# --- 5. Service --------------------------------------------------------------
log "reloading systemd and (re)starting planner"
systemctl daemon-reload
systemctl enable planner.service >/dev/null
# restart also starts a stopped service, and picks up a replaced binary.
systemctl restart planner.service

# Give it a moment to fail if it is going to (bad address, unreadable db...).
sleep 1
if ! systemctl is-active --quiet planner.service; then
    echo "install.sh: planner.service is not running; recent log:" >&2
    journalctl -u planner.service -n 20 --no-pager >&2 || true
    exit 1
fi

# --- 6. Report ---------------------------------------------------------------
addr=$(grep -E '^[[:space:]]*PLANNER_ADDR=' "$ENV_DST" 2>/dev/null | tail -n1 | cut -d= -f2- | tr -d '"'"'" || true)
addr=${addr:-0.0.0.0:8080}
host=${addr%:*}
port=${addr##*:}
if [[ -z "$host" || "$host" == "0.0.0.0" || "$host" == "[::]" || "$host" == "::" ]]; then
    host=$(hostname -I 2>/dev/null | awk '{print $1}')
    host=${host:-$(hostname)}
fi

echo
echo "$("$BIN_DST" -version) is running."
echo "  URL:       http://$host:$port/"
echo "  Config:    $ENV_DST   (edit, then: systemctl restart planner)"
echo "  Database:  $STATE_DIR/planner.db"
echo "  Logs:      journalctl -u planner -f"
