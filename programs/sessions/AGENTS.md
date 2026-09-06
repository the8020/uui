Parent DOX: [uui/programs DOX](../AGENTS.md).

# Purpose

- Administer package-owned UUI session metadata and exact live executions.

# Ownership

- Own the session list/detail program, manifest, and layouts.

# Local Contracts

- List bounded database metadata, then inspect the exact node/sandbox/Worker and
  persistent execution identity.
- Use registered package functions for bounded logs and termination; stale
  metadata cleanup does not scan kernel Workers.
- Stale-row deletion validates the canonical `uis-` ID through the shared kernel
  SDK identity helper. It accepts the ten-character body created by the session
  owner and never maintains a separate identifier pattern.

# Work Guidance

- Runtime placement uses one sandbox identity alongside node and Worker IDs. Do
  not store or display a second identity for the same sandbox.

# Verification

- From the repository root, run `deno task check` and `deno task test`.
- The two-node browser E2E creates real sessions, restarts their owning kernel,
  and deletes the stale metadata through this program.

# Child DOX Index

No child DOX documents. This document owns the entire local scope.
