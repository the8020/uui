Parent DOX: [uui DOX](../AGENTS.md).

# Purpose

- Own Home, Program terminated, Customization, user cleanup, and session
  administration.

# Ownership

- Own program manifests and common verification; each child owns its screen
  implementation and layouts.
- Own the thin `sessions-cleanup` entrypoint; root `session_cleanup.ts` owns
  obsolete-session inspection and conditional metadata deletion.

# Local Contracts

- Home and Program terminated are hidden UUI programs selected by package-owned
  ui-config.json.
- Session administration uses package metadata and exact Worker functions, while
  generic discovery lives in root framework modules.

# Work Guidance

# Verification

- From the repository root, run `deno task check` and `deno task test`.

# Child DOX Index

- [system-customization/AGENTS.md](system-customization/AGENTS.md): Edit the
  system server title, favicon, and social preview through Administration.

- [customization/AGENTS.md](customization/AGENTS.md): Edit authenticated UUI
  preferences with save, default inheritance, and cancel behavior.
- [user-deleted/AGENTS.md](user-deleted/AGENTS.md): Remove UUI-owned preference
  overrides after account deletion.

- [home/AGENTS.md](home/AGENTS.md): Launch discoverable UUI programs from the
  mounted package catalog.
- [program-terminated/AGENTS.md](program-terminated/AGENTS.md): Present standard
  uncaught-program recovery and bounded short dumps.
- [sessions/AGENTS.md](sessions/AGENTS.md): Administer package-owned UUI session
  metadata and exact live executions.
