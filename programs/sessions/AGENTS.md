Parent DOX: [uui/programs DOX](../AGENTS.md).

# Purpose

- Administer package-owned UUI session metadata and exact live executions.

# Ownership

- Own the session list/detail program, manifest, and layouts.

# Local Contracts

- Page database metadata in batches of 200 with one-row lookahead, then inspect
  the selected node/sandbox/Worker and persistent execution identity. Refresh a
  selected row by its exact session ID, independently of list scope or paging.
- Main detail shows user, status, the live screen title, connection, and
  activity. Advanced owns execution IDs and the bounded message log; opening
  main detail never reads that log. End session confirms the selected user
  before stopping interactive work. Runtime/service/user fields open their
  owning programs.
- Use registered package functions for bounded logs and termination; stale
  metadata cleanup does not scan kernel Workers.
- Stale-row deletion validates the canonical `uis-` ID through the shared kernel
  SDK identity helper. It accepts the ten-character body created by the session
  owner and never maintains a separate identifier pattern.
- User columns and fields reuse `the8020/users/types/user.ts` for their name and
  description.
- The default program accepts an optional username for account clickthrough.
  Apply this filter in `readSessionMetadata` before the 200-row limit.

# Work Guidance

- Runtime placement uses one sandbox identity alongside node and Worker IDs. Do
  not store or display a second identity for the same sandbox.

# Verification

- From the repository root, run `deno task check` and `deno task test`.
- The two-node browser E2E creates real sessions, restarts their owning kernel,
  and deletes the stale metadata through this program.

# Child DOX Index

No child DOX documents. This document owns the entire local scope.
