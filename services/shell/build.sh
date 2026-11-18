#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
DENO_COMMAND="${DENO_COMMAND:-deno}"
mkdir -p "$SCRIPT_DIR/.generated"
"$DENO_COMMAND" bundle --config "$PACKAGE_ROOT/deno.json" --platform browser --minify --sourcemap=external --output "$SCRIPT_DIR/.generated/main.js" "$SCRIPT_DIR/frontend/main.ts"
"$DENO_COMMAND" bundle --config "$PACKAGE_ROOT/deno.json" --platform browser --minify --sourcemap=external --external './vendor/library.js' --output "$SCRIPT_DIR/.generated/components/code-editor/editor.js" "$SCRIPT_DIR/frontend/components/code-editor/editor.ts"
"$DENO_COMMAND" bundle --config "$PACKAGE_ROOT/deno.json" --platform browser --minify --sourcemap=external --output "$SCRIPT_DIR/.generated/components/file-upload/input.js" "$SCRIPT_DIR/frontend/components/file-upload/input.ts"
"$DENO_COMMAND" bundle --config "$PACKAGE_ROOT/deno.json" --platform browser --minify --sourcemap=external --output "$SCRIPT_DIR/.generated/system-customization.js" "$PACKAGE_ROOT/programs/system-customization/frontend.ts"
"$DENO_COMMAND" bundle --config "$PACKAGE_ROOT/deno.json" --platform browser --minify --output "$PACKAGE_ROOT/public/status-brand.js" "$PACKAGE_ROOT/programs/status/frontend.ts"
cp "$PACKAGE_ROOT/programs/status/frontend.css" "$PACKAGE_ROOT/public/status-brand.css"
