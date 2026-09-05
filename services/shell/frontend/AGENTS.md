Parent DOX: [uui/services/shell DOX](../AGENTS.md).

# Purpose

- Implement browser presentation, forms, lists, messages, downloads, and custom
  elements.

# Ownership

- Own main/renderer/model/presentation modules, geometry helpers, styles,
  download worker, custom elements, and colocated tests.
- The assets child owns vendored icon files; shared Markdown lives at the
  repository's frontend root.

# Local Contracts

- Reconcile stable surfaces and retained DOM while preserving dirty values,
  focus, custom elements, and list state.
- Keep one shell-owned in-flight interaction gate, bounded message/history
  rendering, and consumption-based download flow control.
- Use the shared responsive geometry, accessible dialogs, local icon registry,
  and browser-only theme state.

# Work Guidance

- Keep browser modules free of server-only imports and executable layout
  content.
- Apply shared rendering fixes here so all consuming programs receive the same
  behavior.

# Verification

- Run UUI `deno task check` and `deno task test`, and rebuild with
  `services/shell/build.sh` for browser-source changes.
- Use `deno task test:presentation-browser`, `test:lists-browser`,
  `test:programs-browser`, or `test:download-browser` for the affected
  end-to-end path.

# Child DOX Index

- [assets/AGENTS.md](assets/AGENTS.md): Hold individually vendored Material SVG
  icons used by the shell registry.
