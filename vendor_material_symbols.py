"""Vendor the complete Google Material Symbols font and its own name/codepoint map.

Run with Python 3 and fonttools installed. No Python dependency is used at runtime.
Update SOURCE when upgrading, then rebuild the shell and run its browser checks.
"""

import hashlib
import io
import json
import re
from pathlib import Path
from urllib.request import urlopen

from fontTools.ttLib import TTFont

# Google Fonts: Material Symbols Outlined, opsz=24, wght=400, FILL=1, GRAD=0.
# Both URLs are the same complete v369 font, served in different formats.
SOURCE = "https://fonts.gstatic.com/s/materialsymbolsoutlined/v369/kJF1BvYX7BgnkSrUwT8OhrdQw4oELdPIeeII9v6oDMzByHX9rA6RzazHD_dY43zj-jCxv3fzvRNU22ZXGJpEpjC_1v-p_4MrImHCIJIZrDCvHOe"
assets = Path(__file__).parent / "services/shell/frontend/assets"
font = TTFont(io.BytesIO(urlopen(SOURCE + "m.ttf").read()))
reverse = {glyph: code for code, glyph in font.getBestCmap().items()}
icons = {}
for lookup in font["GSUB"].table.LookupList.Lookup:
    for table in lookup.SubTable:
        table = getattr(table, "ExtSubTable", table)
        for first, ligatures in getattr(table, "ligatures", {}).items():
            for ligature in ligatures:
                name = "".join(chr(reverse[g]) for g in [first] + ligature.Component)
                icons[name] = reverse[ligature.LigGlyph]
assert len(icons) > 4000
body = urlopen(SOURCE + "j.woff2").read()
assert body[:4] == b"wOF2"
digest = hashlib.sha256(body).hexdigest()
filename = f"material-symbols-{digest[:8]}.woff2"
(assets / filename).write_bytes(body)
(assets / "material_symbols.json").write_text(json.dumps({
    "font": filename,
    "source": SOURCE + "j.woff2",
    "sha256": digest,
    "icons": dict(sorted(icons.items())),
}, indent=2) + "\n")
print(f"Vendored {len(icons)} icon names; {filename}: {len(body)} bytes")
css = assets.parent / "styles.css"
css.write_text(re.sub(r"material-symbols-[a-f0-9]{8}\.woff2", filename, css.read_text()))
