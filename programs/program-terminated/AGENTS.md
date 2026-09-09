Parent DOX: [uui/programs DOX](../AGENTS.md).

# Purpose

- Present standard uncaught-program recovery and bounded short dumps.

# Ownership

- Own the termination program, manifest, and layouts; `../../src/short_dump.ts`
  owns shared dump shaping.

# Local Contracts

- Reuse the short-dump fields from `src/short_dump.ts`, including package-owned
  program and entrypoint references.

- Keep the UUI session alive, expose bounded exception/stack/source context,
  support copying, and allow direct Home recovery.
- Use package configuration for Home and termination identities.
- Use the prebuilt read-only code field for stack, raw source, and complete
  dump. Source excerpts retain original line numbers and mark the exception
  line; disable structural checking because excerpts can begin inside a
  construct. Copy short dump retains the complete formatted report.

# Work Guidance

# Verification

- From the repository root, run `deno task check` and `deno task test`.

# Child DOX Index

No child DOX documents. This document owns the entire local scope.
