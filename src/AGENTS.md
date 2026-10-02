Parent DOX: [uui DOX](../AGENTS.md).

# Purpose

- Own semantic preference, session, and short-dump fields, dump shaping, and
  focused standard-program tests.

# Ownership

- Own `preference_fields.ts`, `session_fields.ts`, `short_dump.ts`,
  `short_dump_test.ts`, and `home_test.ts`.

# Local Contracts

- `preference_fields.ts` owns the shared six-digit hex accent-color field,
  effective preference schema, nullable override schema, and built-in purple.
  Tables and Customization reuse these definitions; screens own the color
  control.

- `session_fields.ts` owns reusable UUI-session labels and help. `short_dump.ts`
  also owns the short-dump field schema; standard programs add only their
  presentation hints.
- Session lifecycle and client network-scope fields offer known choices while
  retaining open diagnostic strings.

- Bound exception, stack, and source context before presenting recovery output.
- Short dumps retain formatted copy text and expose a bounded raw source
  document with its path, first line, and exception line/column for source
  viewers. This is the source read while displaying recovery, not a pinned crash
  revision.
- Stack location and canonical source-path formatting also supply `screenCall`
  provenance for the shared screen engine.
- Home tests retain manifest-driven filtering and silent program returns.

# Work Guidance

# Verification

- From the repository root, run `deno task check` and `deno task test`.

# Child DOX Index

No child DOX documents. This document owns the entire local scope.
