Parent DOX: [uui DOX](../AGENTS.md).

# Purpose

- Declare and expose the login, shell, and persistent session services.

# Ownership

- Own service composition; each child owns its manifest, handler, and local
  materials.

# Local Contracts

- Login is public; shell and session use ordinary authenticated platform service
  handling.
- Keep service policy in manifests and application configuration in
  ui-config.json; the kernel owns transport and placement.

# Work Guidance

# Verification

- From the repository root, run `deno task check` and `deno task test`.

# Child DOX Index

- [login/AGENTS.md](login/AGENTS.md): Serve the public login page and invoke
  package-owned login/logout behavior.
- [session/AGENTS.md](session/AGENTS.md): Expose the ordinary persistent UUI
  service through its package framework.
- [shell/AGENTS.md](shell/AGENTS.md): Serve and build the authenticated UUI
  browser shell.
