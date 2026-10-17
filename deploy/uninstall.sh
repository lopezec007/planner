#!/usr/bin/env bash
# Remove the planner service, unit and binary. Data and configuration are
# left in place. Usage (as root): deploy/uninstall.sh
set -euo pipefail

BIN_DST=/usr/local/bin/planner
UNIT_DST=/etc/systemd/system/planner.service
ENV_DIR=/etc/planner
STATE_DIR=/var/lib/planner
SVC_USER=planner

[[ $EUID -eq 0 ]] || { echo "uninstall.sh: must be run as root" >&2; exit 1; }

if [[ -f "$UNIT_DST" ]]; then
    echo "==> stopping and disabling planner.service"
    systemctl disable --now planner.service 2>/dev/null || true
    rm -f "$UNIT_DST"
    systemctl daemon-reload
    systemctl reset-failed planner.service 2>/dev/null || true
else
    echo "==> planner.service not installed"
fi

if [[ -e "$BIN_DST" ]]; then
    echo "==> removing $BIN_DST"
    rm -f "$BIN_DST"
fi

cat <<MSG

planner has been uninstalled. Left in place on purpose:
  $STATE_DIR/      the SQLite database (back it up or delete it yourself)
  $ENV_DIR/        configuration
  user '$SVC_USER' (remove with: userdel $SVC_USER)
MSG
