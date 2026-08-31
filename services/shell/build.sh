#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
DENO_COMMAND="${DENO_COMMAND:-deno}"
mkdir -p "$SCRIPT_DIR/.generated"
"$DENO_COMMAND" bundle --config "$PACKAGE_ROOT/deno.json" --platform browser --sourcemap=external --output "$SCRIPT_DIR/.generated/main.js" "$SCRIPT_DIR/frontend/main.ts"
