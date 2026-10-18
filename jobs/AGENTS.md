Parent DOX: [uui DOX](../AGENTS.md).

# Purpose

- Declare UUI's static maintenance schedules.

# Ownership

- Own `cleanup-sessions.toml`; the jobs package owns indexing and execution.

# Local Contracts

- Run `the8020/uui/sessions-cleanup` at every UTC hour using the default Any
  node target and system identity. Do not replace this with a timer or minute
  event subscription.
- Definitions are read-only in Jobs; source activation changes the schedule.

# Work Guidance

# Verification

- `deno task test` covers cleanup through `session_cleanup_test.ts`.
- The jobs package's indexing tests cover calendar parsing and shared execution.

# Child DOX Index

No child DOX documents. This document owns the entire local scope.
