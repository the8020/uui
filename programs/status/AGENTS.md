Parent DOX: [UUI programs](../AGENTS.md).

# Purpose

- Present diagnostic identity for the screen captured when Status opens.

# Ownership

- Own the hidden program, ordinary modal layout and small lazy-loaded brand
  component; shared semantic fields live in `src/status_fields.ts`.

# Local Contracts

- Resolve only the authenticated user's profile. Read system identity and
  runtime placement through their owners; project only the kernel build ID from
  native status. Package versions show current checkout commits and local
  modifications through `packages/version.ts`, without remote fetches. They do
  not identify a frozen version of a running Worker's imports.
- Capture values once per opening. Unavailable metadata leaves the remaining
  diagnostics usable. Technical details expand within the same modal; Copy
  diagnostics includes them even when collapsed.
- Hide the visible Status heading while retaining its accessible dialog name.
  Center the existing 80|20 wordmark above one inline subtitle/GitHub line
  linking to `https://github.com/the8020`. Keep the logo's pipe proportional to
  its text. Build `frontend.ts` and copy its scoped CSS to
  `public/status-brand.{js,css}` through the shell build; load them via ordinary
  package asset routes.
- Pair System name with System ID, then Environment with System address on the
  next desktop row. Label program identifiers Program name and Program ID.

# Work Guidance

- Reuse ordinary fields, presentation, clipboard and custom-element mechanisms.

# Verification

- From UUI, run `deno task check`, `deno task test`, and
  `deno task test:status-browser` after the shell build.

# Child DOX Index

No child documents.
