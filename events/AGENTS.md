Parent DOX: [uui DOX](../AGENTS.md).

# Purpose

- Declare UUI subscriptions to account lifecycle events.

# Ownership

- Own `user-deleted.toml`; the referenced UUI program owns cleanup.

# Local Contracts

- Subscribe to `users.deleted` with `the8020/uui/user-deleted`. Cleanup runs
  after the users transaction, through the ordinary asynchronous event
  dispatcher.

# Work Guidance

# Verification

- Run UUI `deno task test`; `preferences_test.ts` and `list_layouts_test.ts`
  cover the event program.

# Child DOX Index

No child DOX documents. This document owns the entire local scope.
