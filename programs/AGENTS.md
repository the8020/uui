Parent DOX: [uui DOX](../AGENTS.md).

# Purpose

- Own standard Home, Program terminated, and session administration programs.

# Ownership

- Own program manifests and common verification; each child owns its screen
  implementation and layouts.

# Local Contracts

- Home and Program terminated are hidden UUI programs selected by package-owned
  ui-config.json.
- Session administration uses package metadata and exact Worker functions, while
  generic discovery lives in root framework modules.

# Work Guidance

# Verification

- From the repository root, run `deno task check` and `deno task test`.

# Child DOX Index

- [home/AGENTS.md](home/AGENTS.md): Launch discoverable UUI programs from the
  mounted package catalog.
- [program-terminated/AGENTS.md](program-terminated/AGENTS.md): Present standard
  uncaught-program recovery and bounded short dumps.
- [sessions/AGENTS.md](sessions/AGENTS.md): Administer package-owned UUI session
  metadata and exact live executions.
