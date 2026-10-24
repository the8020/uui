Parent DOX: [shell frontend](../../AGENTS.md).

# Purpose

- Provide a bounded file picker for ordinary UUI programs.

# Ownership

- `mod.ts` owns the transient byte receiver; `input.ts` owns the native browser
  picker. The existing Channel transport owns flow control and cancellation.

# Local Contracts

- Create `fileUpload({ maximumBytes, accept })` for each pending screen call.
  Bind its `custom` descriptor to a filename string with `fieldHelp: false`;
  file selection cannot be edited through the text-value help modal.
- Call `take()` after the screen action to consume a completed file once. Keep
  bytes outside Models, snapshots, diagnostic messages, and history. Consumers
  validate the actual file format and permissions.
- Bound total received bytes, accept one stream at a time, and discard partial
  or replaced uploads. Screen and connection cancellation terminate reads.
- Load the standalone browser entry only when the field is shown. No upload
  service, temporary file, dependency, or application-specific parser is needed.
- Program browser modules may compose `mount(context, prepare)` with an async
  File-to-Blob converter. The picker retains its busy, cancellation, and
  ordinary byte-upload behavior; consumers own conversion and conversion-error
  messages.

# Work Guidance

# Verification

- Run the UUI checks and `deno task test:file-upload-browser` after rebuilding
  the shell.

# Child DOX Index

No child DOX documents. This document owns the entire local scope.
