Parent DOX: [uui/services/shell/frontend DOX](../AGENTS.md).

# Purpose

- Hold the complete local Google Material Symbols font and its icon catalogue.

# Ownership

- Own the hashed `material-symbols-*.woff2` font and `material_symbols.json`,
  generated from the same complete upstream font. The parent icon-text renderer
  owns name lookup, codepoint rendering, and color validation.

# Local Contracts

- Every name in the vendored collection is available through `[[icon=name]]`,
  including names beginning with digits. No hand-maintained subset is allowed.
- Keep the font source, hash, and Apache-2.0 notice in
  `../../../../THIRD_PARTY_NOTICES.md` current.
- Unknown icon names and invalid colors remain literal text through the shared
  renderer.

# Work Guidance

- Run `python3 vendor_material_symbols.py` from the UUI root with `fonttools`
  installed to regenerate the pinned font, catalogue, and CSS URL. This is an
  asset maintenance dependency only; rebuild the shell afterward.

# Verification

- The parent `icon_text_test.ts` and UUI `deno task test` verify full catalogue
  parsing; the presentation browser harness checks that every catalogue entry
  renders a glyph from the local font. The shell service test verifies MIME,
  immutable caching, and the font hash.

# Child DOX Index

No child DOX documents. This document owns the entire local scope.
