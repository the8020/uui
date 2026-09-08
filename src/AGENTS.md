Parent DOX: [uui DOX](../AGENTS.md).

# Purpose

- Own semantic session and short-dump fields, dump shaping, and focused
  standard-program tests.

# Ownership

- Own `session_fields.ts`, `short_dump.ts`, `short_dump_test.ts`, and
  `home_test.ts`.

# Local Contracts

- `session_fields.ts` owns reusable UUI-session labels and help. `short_dump.ts`
  also owns the short-dump field schema; standard programs add only their
  presentation hints.

- Bound exception, stack, and source context before presenting recovery output.
- Home tests retain manifest-driven filtering and silent program returns.

# Work Guidance

# Verification

- From the repository root, run `deno task check` and `deno task test`.

# Child DOX Index

No child DOX documents. This document owns the entire local scope.
