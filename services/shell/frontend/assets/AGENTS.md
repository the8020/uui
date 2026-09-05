Parent DOX: [uui/services/shell/frontend DOX](../AGENTS.md).

# Purpose

- Hold individually vendored Material SVG icons used by the shell registry.

# Ownership

- Own the hashed `material-*.svg` assets; the parent icon-text renderer owns
  registry lookup and validation.

# Local Contracts

- Ship only registered individual assets and keep source/license notices in the
  repository's THIRD_PARTY_NOTICES.md current.
- Unknown icon names and invalid colors remain literal text through the shared
  renderer.

# Work Guidance

- Extend the existing SVG/registry system when adding icons.

# Verification

- The parent `icon_text_test.ts` and UUI `deno task test` verify
  registry/rendering behavior.

# Child DOX Index

No child DOX documents. This document owns the entire local scope.
