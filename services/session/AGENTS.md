Parent DOX: [uui/services DOX](../AGENTS.md).

# Purpose

- Expose the ordinary persistent UUI service through its package framework.

# Ownership

- Own `service.toml` and the thin `service.ts` entrypoint; root session modules
  own execution, protocol, metadata, and registered functions.

# Local Contracts

- Keep the entrypoint delegated to defineSessionService and export the shared
  workerFunctions.
- The service uses session lifecycle and strict concurrency one; supervisor and
  kernel behavior remain generic.

# Work Guidance

# Verification

- From the repository root, run `deno task check` and `deno task test`.

# Child DOX Index

No child DOX documents. This document owns the entire local scope.
