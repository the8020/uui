Parent DOX: [shell frontend](../../AGENTS.md).

# Purpose

- Own the complete browser list component and its read-only data tools.

# Ownership

- `lists.ts` owns UUI rendering, query drafts, popovers, paging, and state.
- `list_geometry.ts` owns measured UUI capacity and column widths.
- `tools.ts` owns the expanded toolbar, native dialogs, spreadsheet lifecycle,
  export options, and clipboard writes. `data.ts` owns read correlation and
  shared displayed-column serializers. `list.css` owns component styles.
- `vendor/` contains unmodified Tabulator 6.3.1 (MIT) and SheetJS CE 0.20.3
  (Apache-2.0) assets and licenses. Load their modules only when the
  corresponding viewer or workbook export is requested; serve them through
  ordinary shell assets. Root `THIRD_PARTY_NOTICES.md` records upstream sources
  and notices.

# Local Contracts

- Keep list functionality encapsulated here and reuse the ordinary WebSocket.
  `screen.list` with an exclusive `read` returns `screen.list.data`, at most
  1,000 rows per request. Reads never commit dirty values, change the UUI page,
  or resolve the pending screen. Correlate one request at a time; disconnect,
  timeout, screen replacement, and disposal reject unfinished reads.
- Table processor opens a large native dialog with a read-only virtualized
  Tabulator grid, rectangular/column selection, and spreadsheet clipboard copy.
  Start at page 1 with a free positive integer rows-per-page input, default
  1000, followed by `(N total)` when known. No preset choices or 1000-row viewer
  maximum; fill larger pages with bounded reads. Include previous/next buttons
  and an editable page number. Keep its page independent of the UUI page and use
  the list's current filters, sort, and displayed columns.
- Export opens a compact dialog for CSV, JSON, XML, YAML, XLSX, or ODS and a
  one-based inclusive row range defaulting to first through last. ODS is the
  OpenDocument spreadsheet format. Unknown totals leave Last row blank for all
  remaining rows and show an unknown page count until the last page is reached.
- Copy page uses the UUI page; Copy all reads all matching pages in order. Both
  include full column headings and write quoted tab-separated text plus an HTML
  table to the clipboard. The grid's selection copy uses the same serializers
  without headings. Escape text, protect formula-like strings in delimited
  output, and preserve exact decimal strings in workbook exports.
- JSON/XML/YAML use displayed column keys; CSV/workbooks/clipboard use headings.
  Never export omitted navigation columns. Browser memory holds the requested
  export/copy result; each server read stays bounded.
- Page sources use optional server-side `callScreen({ listReaders })` callbacks,
  keyed by list ID. Readers receive the retained query, offset, and a maximum
  500-row limit and return rows, `more`, and an optional matching total; the
  shared owner fills larger reads. Without a reader, only Copy page is
  available. Field help supplies ordinary provider-defined typed columns and a
  full-query reader; the first column is its selection key.
- Show copy feedback beside the tools without changing list/page geometry. Tool
  results must not cause capacity updates that flush unrelated dirty fields.
- Close/Escape/browser Back dismiss local dialogs and restore focus. Dispose the
  grid and stop follow-up reads when the dialog or owning surface closes.
- List row hover and focus change only the text color to primary. Keep the row
  background transparent.
- Lists use precise fractional viewport widths and contain invisible
  full-heading measurements within their columns. Reserve fixed-height body rows
  from `min(totalSourceItems, pageSize)`, with one empty-state row at minimum,
  so filtering and shorter pages retain the card and footer geometry after
  reload. Reserved blank body space never enters capacity overhead; viewport,
  toolbar, and visibility changes may still remeasure capacity.
- Page sources use the same search toolbar and pagination as local arrays. Show
  their current range and optional known total; `more` makes the next page
  available. The server retains source size independently of filtered page
  length so card, modal, and footer geometry survive filtering and reload.
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
  input block padding. Its left side starts with icon-only, tooltip-labeled
  Table processor, Export, Copy page, and Copy all actions, followed by
  clear-all actions only for applied sorts or filters. `filter_list_off` clears
  sort; `filter_alt_off` clears column filters and quick search together.
  Clearing one query category preserves the other and affects only that list.
- The List tools `+`/`−` toggle overlays only the header at the viewport's exact
  right edge, including during horizontal scroll. Keep its width at 24px with
  zero padding; reserve clearance only in the last column heading. Data columns
  use the full table width, with no tools column or empty body cells, so row
  content and highlights continue to the right edge.

# Work Guidance

- Keep controls simple and icon-only in the expanded header, with tooltips and
  accessible labels. Reuse native dialogs, fields, existing icons, and shared
  serializers. No kernel, program-specific browser code, or editing workflow.
- Update optional libraries from their pinned official distributions; preserve
  licenses and notices and keep vendored bytes outside formatting/linting.

# Verification

- Run UUI `deno task check`, `deno task test`, and `services/shell/build.sh`.
- `data_test.ts` checks column projection, formats/quoting, and read
  correlation; `list_geometry_test.ts` checks layout. Root list/session tests
  cover bounded, stale, filtered/sorted reads and preservation of source and
  screen state, and actual session-service reload after reads.
- `deno task test:lists-browser` checks toolbar actions, real clipboard block
  and column selection, UUI versus spreadsheet pagination, dirty edits, all six
  downloaded formats/ranges, desktop/mobile geometry, and the existing list
  interactions. `test:presentation-browser --field-help` covers page-source
  readers through real field help.

# Child DOX Index
