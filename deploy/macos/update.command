#!/bin/bash
set -euo pipefail
curl -fsSL "https://raw.githubusercontent.com/${DOSLINEAS_REPO_SLUG:-podcast-lab/doslineas}/${DOSLINEAS_REF:-main}/deploy/macos/install.command" -o /tmp/doslineas-install.command
exec bash /tmp/doslineas-install.command "$@"
