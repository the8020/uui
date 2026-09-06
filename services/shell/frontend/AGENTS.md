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
  focus, custom elements, and list state.
- Keep one shell-owned in-flight interaction gate, bounded message/history
  rendering, and consumption-based download flow control.
- Use the shared responsive geometry, accessible dialogs, local icon registry,
  and browser-only theme state.
- Every field group uses exact row metrics, including when all fields default to
  one row. Clamp controls to their declared `rowSpan`; one-row textareas match
  ordinary inputs, and multiline textareas end at the corresponding ordinary
  row's underline. Native inline baselines must not add control-shell height.
  Radio options scroll inside the declared height when needed.
- Lists use precise fractional viewport widths and contain invisible
  full-heading measurements within their columns. Reserve fixed-height body rows
  from `min(totalSourceItems, pageSize)`, with one empty-state row at minimum,
  so filtering and shorter pages retain the card and footer geometry after
  reload. Reserved blank body space never enters capacity overhead; viewport,
  toolbar, and visibility changes may still remeasure capacity.
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

- Keep browser modules free of server-only imports and executable layout
  content.
- Apply shared rendering fixes here so all consuming programs receive the same
  behavior.

# Verification

- Run UUI `deno task check` and `deno task test`, and rebuild with
  `services/shell/build.sh` for browser-source changes.
- Use `deno task test:presentation-browser`, `test:lists-browser`,
  `test:programs-browser`, or `test:download-browser` for the affected
  end-to-end path.

# Child DOX Index

- [assets/AGENTS.md](assets/AGENTS.md): Hold individually vendored Material SVG
  icons used by the shell registry.
