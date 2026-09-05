Parent DOX: [uui/services DOX](../AGENTS.md).

# Purpose

- Serve the public login page and invoke package-owned login/logout behavior.

# Ownership

- Own the handler, manifest, login frontend, and service tests.

# Local Contracts

- Call the users package explicitly; passwords and authentication cookies never
  enter UUI boot data or messages.
- Read the HTML template per response and serve supported frontend assets
  through one constrained handler.
- The login page uses the fixed dark palette and does not read
  authenticated-shell theme state.

# Work Guidance

# Verification

- From the repository root, run `deno task check` and `deno task test`.

# Child DOX Index

No child DOX documents. This document owns the entire local scope.
