#!/bin/bash
# Installs the relay as a systemd user unit, beside darkoak's. Run once; afterwards:
#   systemctl --user restart cs16-relay     journalctl --user -u cs16-relay -f
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p ~/.config/systemd/user
cp cs16-relay.service ~/.config/systemd/user/cs16-relay.service
systemctl --user daemon-reload
systemctl --user enable --now cs16-relay
systemctl --user status cs16-relay --no-pager | head -5
