Parent DOX: [programs](../AGENTS.md).

# Purpose

- Demonstrate ordinary selection fields and database queries with standard list
  variants.

# Ownership

- Own the selection-demo report and manifest; the UUI tables owner owns its
  sample records.

# Local Contracts

- Seed only the dedicated sample table, in an ordinary atomic transaction, when
  empty.
- Compose `whereSelection` calls with qualified author-selected columns and
  original semantic fields.
- Keep criteria in the normal bound Model; results use the shared list and
  layouts implementation.

# Verification

- UUI check/test, selection browser fixture, and installed combined-preview
  checks.

# Child DOX Index

No child documents.
