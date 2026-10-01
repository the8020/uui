Parent DOX: [uui/programs DOX](../AGENTS.md).

# Purpose

- Remove UUI-owned preferences after account deletion.

# Ownership

- Own the hidden event program and manifest.

# Local Contracts

- Validate the ordinary `users.deleted` envelope with a nonempty username.
- Delete only that username's preference row. Preserve the empty-username
  default and other users; repeated delivery is harmless.

# Work Guidance

# Verification

- Run UUI `deno task test`; `preferences_test.ts` covers deletion cleanup.

# Child DOX Index

No child DOX documents. This document owns the entire local scope.
