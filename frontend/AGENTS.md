Parent DOX: [uui DOX](../AGENTS.md).

# Purpose

- Provide shared browser Markdown rendering outside service-owned source trees.

# Ownership

- Own `markdown.ts`, `markdown.css`, the `mod.ts` exports, and Markdown tests.

# Local Contracts

- Disable raw HTML and images, reject executable link schemes, and harden links
  opened in a new browsing context.
- Keep styles scoped to `.markdown`; the shell serves the shared stylesheet
  through its constrained asset handler.

# Work Guidance

- Keep rendering local, semantic, and accessible.

# Verification

- From the repository root, run `deno task check` and `deno task test`.

# Child DOX Index

No child DOX documents. This document owns the entire local scope.
