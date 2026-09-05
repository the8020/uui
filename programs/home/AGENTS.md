Parent DOX: [uui/programs DOX](../AGENTS.md).

# Purpose

- Launch discoverable UUI programs from the mounted package catalog.

# Ownership

- Own the Home entrypoint, manifest, and layout.

# Local Contracts

- Rescan program manifests before rendering and on explicit Refresh; require
  both uui and discoverable flags.
- Invoke ordinary programs and return silently without a generic completion
  notification.

# Work Guidance

# Verification

- Run `deno task test` from the UUI root; `src/home_test.ts` covers catalog
  filtering and silent returns.
- Run `deno task test:programs-browser` for the shared interactive launch path.

# Child DOX Index

No child DOX documents. This document owns the entire local scope.
