#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
VENDOR_TEMP=$(mktemp -d)
trap 'rm -rf -- "$VENDOR_TEMP"' EXIT
"${DENO_COMMAND:-deno}" bundle --platform browser --minify --code-splitting \
  --outdir "$VENDOR_TEMP" library.ts
"${DENO_COMMAND:-deno}" info --json library.ts > "$VENDOR_TEMP/dependencies.json"
python3 - "$VENDOR_TEMP" <<'PY'
import json
import sys
from pathlib import Path

target = Path(sys.argv[1])
graph = json.loads((target / "dependencies.json").read_text())
packages = graph["npmPackages"]
pending = [dependency["npmPackage"] for module in graph["modules"]
           if module["specifier"] in graph["roots"] for dependency in module["dependencies"]
           if "npmPackage" in dependency]
included = set()
while pending:
    identifier = pending.pop()
    if identifier not in included:
        included.add(identifier)
        pending.extend(packages[identifier]["dependencies"])
notices = []
for identifier in sorted(included):
    package = packages[identifier]
    root = Path(package["localPath"])
    license_path = next(path for path in root.iterdir()
                        if path.name.lower().startswith("license"))
    notices.append(identifier + "\n" + "=" * len(identifier) + "\n" + license_path.read_text())
(target / "LICENSES.txt").write_text("\n\n".join(notices))
PY
mkdir -p vendor
find vendor -maxdepth 1 -name '*.js' -delete
cp -- "$VENDOR_TEMP"/*.js "$VENDOR_TEMP/LICENSES.txt" vendor/
