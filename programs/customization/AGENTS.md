Parent DOX: [uui/programs DOX](../AGENTS.md).

# Purpose

- Customize the authenticated user's UUI preferences from the hamburger menu.

# Ownership

- Own the hidden UUI program, its manifest, and Appearance screen.
- Root `preferences.ts` owns resolution and storage operations.

# Local Contracts

- Reuse `src/preference_fields.ts` with the native `color` control.
- Save applies the color to both themes; Back discards unsaved changes.
- Use system default updates the draft and removes the personal override on
  Save.
- Resolve the authenticated identity through the shared preferences API; accept
  no target-user input. Preserve the calling screen and its pending draft.

# Work Guidance

# Verification

- Run UUI `deno task check`, `deno task test`, and
  `deno task test:programs-browser --runtime`.

# Child DOX Index

No child DOX documents. This document owns the entire local scope.
