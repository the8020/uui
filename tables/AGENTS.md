Parent DOX: [uui DOX](../AGENTS.md).

# Purpose

- Own user preference overrides and bounded metadata for UUI application
  sessions.

# Ownership

- Own `sessions.ts`, `user_preferences.ts`, and descriptor tests; schema
  synchronization belongs to the db package and native database authority to the
  kernel.

# Local Contracts

- `user_preferences.ts` has username as its primary key and nullable preferences
  from `src/preference_fields.ts`. Empty username holds system defaults;
  personal rows contain only overrides. Avoid an account foreign key so defaults
  are valid. UUI's `users.deleted` subscriber removes personal rows after
  account deletion.

- Session identifiers, client address, screen ID, and execution references reuse
  `src/session_fields.ts`. Persisted lifecycle enums and logical datetime
  columns keep their existing representation.

- Default-export authored table descriptors through `/p/the8020/db/mod.ts`;
  table identity follows the package and file path.
- Record exact execution placement, authenticated user, lifecycle, observed
  client address, and bounded current-screen metadata.
- The session ID primary key rejects colliding initial inserts. Creation and
  updates are separate store operations; creation never upserts another owner.
- Never persist credentials, routing tokens, replay buffers, or unbounded
  messages; authentication sessions belong to the users package.
- User, service, sandbox, and Worker references reuse their owning semantic
  fields through `t.from()` without changing physical text columns.

# Work Guidance

- Runtime placement uses one sandbox identity alongside node and Worker IDs. Do
  not store or display a second identity for the same sandbox.

# Verification

- From the repository root, run `deno task check` and `deno task test`.

# Child DOX Index

No child DOX documents. This document owns the entire local scope.
