#!/usr/bin/env bash
# One command from wherever you want the project to live:
#   git clone https://github.com/itsZaid05/nyay-saathi && cd nyay-saathi && ./scripts/bootstrap.sh ../play
# Creates a Serverpod project in the folder you pass, overlays this repository
# onto it, and stops there — migrations and the key are yours to do, on purpose.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="${1:-$HOME/nyay-play}"
NAME=nyay
VERSION=4.0.3

for tool in flutter dart python3; do
  command -v "$tool" >/dev/null || { echo "missing: $tool (see README)"; exit 1; }
done
flutter --version | head -1

command -v serverpod >/dev/null || {
  echo "installing serverpod_cli $VERSION"
  dart pub global activate serverpod_cli "$VERSION"
  export PATH="$PATH:$HOME/.pub-cache/bin"
}
serverpod --version

mkdir -p "$WORK"
cd "$WORK"
if [ ! -d "$NAME" ]; then
  serverpod create "$NAME" --template fullstack --database --webapp --ide none
else
  echo "reusing $WORK/$NAME"
fi

cd "$NAME"
python3 "$REPO/scripts/apply_overlay.py" .
