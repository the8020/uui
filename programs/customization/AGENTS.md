Parent DOX: [uui/programs DOX](../AGENTS.md).

# Purpose

- Customize the authenticated user's UUI preferences from the hamburger menu.

# Ownership

- Own the hidden UUI program, its manifest, Appearance and personal shortcuts.
- Root `preferences.ts` owns resolution and storage operations.

# Local Contracts

- Reuse `src/preference_fields.ts` with the native `color` control.
- Save applies the color to both themes; Back discards unsaved changes.
- Use system default updates the draft and removes the personal override on
  Save.
- Resolve the authenticated identity through the shared preferences API; accept
  no target-user input. Preserve the calling screen and its pending draft.
- The menu presents this program as a modal. Below System accent color, an
  initially empty ordinary list shows Shortcut and Program. Add and row
  selection open an isolated editor with shared field help and searchable value
  help from the program index; only UUI targets are offered. Delete removes
  selected draft rows. Save commits color and mappings together and closes the
  modal; Close discards unsaved changes. Save failures keep the modal open.
- Codes are case-insensitive, unique per user and limited to 100 mappings.
  Personal codes override matching manifest defaults. Use system default resets
  only color.

# Work Guidance

# Verification

- Run UUI `deno task check`, `deno task test`, and
  `deno task test:programs-browser --runtime`.

# Child DOX Index

No child DOX documents. This document owns the entire local scope.
