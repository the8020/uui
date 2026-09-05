Parent DOX: [uui/services DOX](../AGENTS.md).

# Purpose

- Serve and build the authenticated UUI browser shell.

# Ownership

- Own the handler, manifest, `build.sh`, and service tests; the frontend child
  owns authored browser source.
- The `.generated/` bundle and source map are build outputs from
  frontend/main.ts.

# Local Contracts

- Use one constrained static handler with file-derived MIME/cache behavior.
- Build from this repository's deno.json and keep runtime browser imports on the
  browser-safe protocol surface.
- Theme preferences stay in browser storage and initialize before first paint.

# Work Guidance

- Edit authored frontend modules and rebuild through `services/shell/build.sh`
  when browser source changes.

# Verification

- Run `deno task check` and `deno task test` from the UUI root.
- Use the existing presentation, lists, programs, and download browser tasks for
  affected browser behavior.

# Child DOX Index

- [frontend/AGENTS.md](frontend/AGENTS.md): Implement browser presentation,
  forms, lists, messages, downloads, and custom elements.
