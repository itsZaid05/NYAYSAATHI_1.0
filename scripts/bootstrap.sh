#!/usr/bin/env bash
# Optional convenience wrapper. For one-command-at-a-time setup, use RUNBOOK.md.
# Usage: ./scripts/bootstrap.sh ~/nyay-build
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="${1:-$HOME/nyay-build}"
VERSION=4.0.3

for tool in flutter dart python3 serverpod; do
  if ! command -v "$tool" >/dev/null; then
    echo "Missing $tool. See $REPO/docs/RUNBOOK.md; no toolchain was installed or changed." >&2
    exit 1
  fi
done

CLI_VERSION="$(serverpod --version)"
if [[ ! "$CLI_VERSION" =~ (^|[^0-9])4\.0\.3([^0-9.]|$) ]]; then
  echo "Expected Serverpod $VERSION; got: $CLI_VERSION" >&2
  exit 1
fi
if [[ -e "$WORK/nyay" ]]; then
  echo "Refusing to overwrite $WORK/nyay. Apply the overlay explicitly after saving local fixes." >&2
  exit 1
fi

mkdir -p "$WORK"
cd "$WORK"
serverpod create nyay --template fullstack --database --webapp --ide none
python3 "$REPO/scripts/apply_overlay.py" "$PWD/nyay"
