Parent DOX: [uui DOX](../AGENTS.md).

# Purpose

- Describe bounded persistent metadata for UUI application sessions.

# Ownership

- Own `sessions.ts` and their descriptor tests; physical schema deployment
  remains kernel-owned.

# Local Contracts

- Default-export authored table descriptors through `/p/the8020/db/mod.ts`;
  table identity follows the package and file path.
- Record exact execution placement, authenticated user, lifecycle, observed
  client address, and bounded current-screen metadata.
- Never persist credentials, routing tokens, replay buffers, or unbounded
  messages; authentication sessions belong to the users package.

# Work Guidance

# Verification

- From the repository root, run `deno task check` and `deno task test`.

# Child DOX Index

No child DOX documents. This document owns the entire local scope.
