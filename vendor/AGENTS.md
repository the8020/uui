Parent DOX: [UUI](../AGENTS.md).

# Purpose

- Ship the backend image codec without runtime package downloads.

# Ownership

- `imagescript/` contains the original JavaScript, declarations, licenses, and
  third-party notices from `imagescript` 3.20.4. Use its MIT license option.

# Local Contracts

- Import lazily from branding conversion, never from browser code. Decoding uses
  one thread and the branding upload/pixel limits.
- Refresh from
  `https://registry.npmjs.org/imagescript/-/imagescript-3.20.4.tgz`, preserving
  original modules, declarations, licenses and notices. Update this pin and the
  root notices when upgrading.
- Declaration import specifiers use `.d.ts` instead of `.js` for Deno type
  resolution; runtime modules remain unchanged.

# Work Guidance

- Keep vendored sources outside formatting and linting.

# Verification

- UUI `deno task test` exercises the actual codec through branding conversion.

# Child DOX Index

No child DOX documents.
