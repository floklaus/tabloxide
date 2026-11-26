#!/usr/bin/env bash
# Builds the connectors of this repository and puts them into target/connectors,
# in the layout that the connector host reads. Then start the app with:
#
#   TABLOXIDE_CONNECTOR_DIR="$PWD/target/connectors" pnpm dev
#
# Only a development build reads TABLOXIDE_CONNECTOR_DIR.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/target/connectors"

for folder in "$ROOT"/connectors/*/; do
  name="$(basename "$folder")"
  package="tabloxide-connector-$name"
  cargo build --manifest-path "$ROOT/Cargo.toml" -p "$package"
  mkdir -p "$OUT/$name"
  cp "$folder/connector.toml" "$OUT/$name/connector.toml"
  program="$ROOT/target/debug/$package"
  [ -f "$program.exe" ] && program="$program.exe"
  cp "$program" "$OUT/$name/"
  echo "$name: $OUT/$name"
done
