#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
DENO_COMMAND="${DENO_COMMAND:-deno}"
IMPORT_MAP=()
if [[ -n "${DENO_IMPORT_MAP:-}" ]]; then
  IMPORT_MAP=(--import-map "$DENO_IMPORT_MAP")
fi
mkdir -p "$SCRIPT_DIR/.generated"
"$DENO_COMMAND" bundle --config "$PACKAGE_ROOT/deno.json" "${IMPORT_MAP[@]}" --platform browser --minify --sourcemap=external --output "$SCRIPT_DIR/.generated/main.js" "$SCRIPT_DIR/frontend/main.ts"
"$DENO_COMMAND" bundle --config "$PACKAGE_ROOT/deno.json" "${IMPORT_MAP[@]}" --platform browser --minify --sourcemap=external --external './vendor/library.js' --output "$SCRIPT_DIR/.generated/components/code-editor/editor.js" "$SCRIPT_DIR/frontend/components/code-editor/editor.ts"
