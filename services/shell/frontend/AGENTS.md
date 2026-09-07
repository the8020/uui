Parent DOX: [uui/services/shell DOX](../AGENTS.md).

# Purpose

- Implement browser presentation, forms, lists, messages, downloads, and custom
  elements.

# Ownership

- Own main/renderer/model/presentation modules, geometry helpers, styles,
  download worker, custom elements, and colocated tests.
- The assets child owns vendored icon files; shared Markdown lives at the
  repository's frontend root.

# Local Contracts

- Reconcile stable surfaces and retained DOM while preserving dirty values,
  focus, custom elements, and list state. Identical snapshots that retain DOM
  must also retain its bound model object so later edits reach submitted data.
- Keep one shell-owned in-flight interaction gate, bounded message/history
  rendering, and consumption-based download flow control.
- Native browser Back traverses the marked base entry, restores the existing
  guard with `history.forward()`, then dispatches UUI Back. Never push a new
  guard after traversal; Chromium may skip it on later native Back presses.
  Reload adopts the current guard.
- Use the shared responsive geometry, accessible dialogs, complete local
  Material Symbols catalogue, and browser-only theme state.
- Startup and failed WebSocket admission share HTTP route establishment. A
  redirected response ends reconnecting, clears the route, and navigates to its
  final URL before checking status or route headers. Preserve retry behavior for
  transport failures and route replacement only for a direct `409`.
- Scalar fields expose a focusable pencil or read-only Chevron Right button;
  button clicks and focused-field F4 send the shared `field-help` event with
  dirty bindings. `fieldHelp: false` suppresses it. Keep read-only text
  selectable and use the wrapper for disabled choices' F4 focus. Full
  descriptions use shared safe Markdown; the reserved hint line shows plain
  text.
- Every field group uses exact row metrics, including when all fields default to
  one row. Clamp controls to their declared `rowSpan`; one-row textareas match
  ordinary inputs, and multiline textareas end at the corresponding ordinary
  row's underline. Native inline baselines must not add control-shell height.
  Radio options scroll inside the declared height when needed.
- Decimal fields use text inputs with decimal input mode and retain exact
  strings. Decimal list comparisons share the exact server comparator and
  numeric filter guidance.
- `overflow.ts` owns reusable `createOverflowText`, batched responsive
  measurement, and disposal for list values, field hints, and column
  descriptions. Keep text selectable and its normal click behavior; only a
  separate font-sized ellipsis opens full Markdown. The button is transparent
  and borderless with the pencil's subtle hover fill and visible keyboard focus.
  Fitting text has no button or reserved button space.
- `popover.ts` owns `AnchoredPopover`: native nested light dismissal, Escape
  focus return, resize/scroll positioning, and a ten-pixel viewport gutter.
  Overflow aligns below the row and left from the button's right edge, flipping
  above only when necessary. Popovers scroll within 24rem and the available
  viewport; use the existing safe Markdown renderer for full content.
- Column descriptions inherit shared Zod metadata. Put their plain-text preview
  between the heading and query controls, capped at 100 characters and three
  lines, with the same ellipsis for the complete Markdown description.
- List row hover and focus change only the text color to primary. Keep the row
  background transparent.
- Lists use precise fractional viewport widths and contain invisible
  full-heading measurements within their columns. Reserve fixed-height body rows
  from `min(totalSourceItems, pageSize)`, with one empty-state row at minimum,
  so filtering and shorter pages retain the card and footer geometry after
  reload. Reserved blank body space never enters capacity overhead; viewport,
  toolbar, and visibility changes may still remeasure capacity.
- Page sources use the same search toolbar and pagination as local arrays. Show
  their current range without inventing a total; `more` makes the next page
  available and reserves footer space independently of the loaded row count.
  Search-only sources retain heading help but omit column sort/filter controls.
- Hide the entire pagination footer for zero or one result page. Sources that
  fit on one page reserve no footer space; filtering larger sources retains the
  original card height while hiding pagination. Determine capacity from source
  totals and measured footer chrome, independent of current footer visibility,
  so a footer cannot create a second page merely by occupying space.
- Column popovers place ascending and descending `Sort` buttons in one row,
  followed by the direction icon. Use the Material `sort` bars, flipped
  vertically for ascending, in both buttons and headers. Only the selected
  option has a trailing `X` to clear sort. Filters have an accessible name and
  typed `Filter` placeholder, with a trailing in-field `X` only for nonempty
  values. Sort selection/clearing, filter clearing, and filter Enter confirm
  immediately and close the popover; debounced typing retains focus/caret.
  Search Enter also confirms immediately. Blur keeps the debounce pending so
  clear buttons can commit one complete query without an intervening request.
- The expanded list toolbar matches the column-header height, with zero search
  input block padding. Its left side shows icon-only, tooltip-labeled clear-all
  actions only for applied sorts or filters. `filter_list_off` clears sort;
  `filter_alt_off` clears column filters and quick search together. Clearing one
  query category preserves the other and affects only that list.
- The List tools `+`/`−` toggle overlays only the header at the viewport's exact
  right edge, including during horizontal scroll. Keep its width at 24px with
  zero padding; reserve clearance only in the last column heading. Data columns
  use the full table width, with no tools column or empty body cells, so row
  content and highlights continue to the right edge.

# Work Guidance

- Keep shell modules free of server-only imports and program-specific code.
  Custom elements load program-owned same-origin modules and styles only when
  rendered. Modules own their contents, scoped CSS, and dependencies; the
  wrapper owns preservation, update/activity/disposal, an abort signal, and
  screen actions through the existing surface interaction gate.
- Apply shared rendering fixes here so all consuming programs receive the same
  behavior.

# Verification

- Run UUI `deno task check` and `deno task test`, and rebuild with
  `services/shell/build.sh` for browser-source changes.
- Use `deno task test:connection-browser`, `test:presentation-browser`,
  `test:lists-browser`, `test:programs-browser`, or `test:download-browser` for
  the affected end-to-end path. `test:native-back-browser` uses Xvfb and xdotool
  to test actual browser Back with CDP userGesture disabled for assertions.

# Child DOX Index

- [assets/AGENTS.md](assets/AGENTS.md): Hold the complete local Material Symbols
  font and its generated icon catalogue.
