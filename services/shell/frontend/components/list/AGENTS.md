Parent DOX: [shell frontend](../../AGENTS.md).

# Purpose

- Own the complete browser list component and its read-only data tools.

# Ownership

- `lists.ts` owns UUI rendering, query drafts, popovers, paging, and state,
  including key selections of paged sources (`multiple` checkboxes toggled by
  row clicks, header checked by `allSelected`; `single` highlighted rows with a
  250 ms click delay so double-click sends `activate`) and `focusSearch` (marks
  its search `data-autofocus` for the modal's first focus).
- `list_geometry.ts` owns measured UUI capacity and column widths.
- `page_size.ts` owns the browser-only rows-per-page choice.
- `tools.ts` owns the expanded toolbar, native dialogs, spreadsheet lifecycle,
  export options, and clipboard writes. `data.ts` owns list result validation
  and displayed-column serializers; token/result/cancel correlation belongs to
  the list owner; delivery and stream identity belong to the shared channel
  core. `list.css` owns component styles.
- `vendor/` contains unmodified Tabulator 6.3.1 (MIT) and SheetJS CE 0.20.3
  (Apache-2.0) assets and licenses. Load their modules only when the
  corresponding viewer or workbook export is requested; serve them through
  ordinary shell assets. Root `THIRD_PARTY_NOTICES.md` records upstream sources
  and notices.

# Local Contracts

- Every list reserves `--uui-bar-height` for its custom toolbar, including empty
  toolbars. Reuse `ResponsiveProgramHeader` for ordered three-dot overflow and
  native controls; dispose its observers/listeners on redraw and removal.
  Overflow menus do not change list capacity or table alignment.

- Lists send row indices and operations through their owning namespace without
  list revisions or identity comparisons. The pending call retains source
  mappings; validate row bounds, editability, queries and read ranges.
- Optional custom toolbars render ordinary UUI element arrays above the list and
  stay visible independently of List tools. Include their actual height in
  capacity measurement; reuse the shared element renderer and surface callbacks.
- A selection binding adds a fixed-width first checkbox column outside data
  columns, queries, copy, and exports. The header checkbox exposes all/none and
  an indeterminate state across the complete source. Selection-cell click or
  Space toggles its row; Shift ranges follow displayed order across pages.
  Pointer drag previews a range and commits once on release; cancellation
  restores the published state. Row-value clicks retain navigation.
- Selection footers remain visible on single/empty pages, display
  selected/source counts, and reserve their chrome during capacity measurement.
  Lists without selection keep the existing hidden-footer behavior.
- Keep list functionality encapsulated here and reuse the ordinary WebSocket.
  The list-owned `read` message uses the common namespace/core, at most 1,000
  rows and 900,000 JSON bytes. Reads never commit dirty values, change the UUI
  page, or resolve the pending screen. The shell gate admits one initiated
  request; the list matches its token/result while the core checks
  attachment/connection. Tools retain the list-owned 30-second deadline per read
  through AbortSignal; the common core has no default timeout. Disconnect, owner
  cancellation, screen-generation replacement and disposal cancel unfinished
  work.
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
- Retained sources register with `setListSource(model, id, source)`. ScreenLists
  owns visible paging/refresh and bounded independent reads with fixed typed
  columns. Every ordinary query/page/capacity/checkbox update uses the common
  namespace `update` message, including atomic multi-list capacity batches.
  Accepted presentations retain query drafts, geometry and focus; matching
  replies acknowledge only the dirty bindings captured by that request. Late
  old-generation results cannot release a fresh browser interaction gate. Field
  help uses the full query and first-column key under one pending screen.
- Show copy feedback beside the tools without changing list/page geometry. Tool
  results must not cause capacity updates that flush unrelated dirty fields.
- Close/Escape/browser Back dismiss local dialogs and restore focus. Dispose the
  grid and stop follow-up reads when the dialog or owning surface closes.
- List row hover and focus change only the text color to primary. Keep the row
  background transparent.
- Selected page buttons reuse the shell's contrasting primary foreground token
  so custom accents remain readable in both themes.
- Lists use precise fractional viewport widths and contain invisible
  full-heading measurements within their columns. Reserve fixed-height body rows
  from `min(totalSourceItems, pageSize)`, with one empty-state row at minimum,
  so filtering and shorter pages retain the card and footer geometry after
  reload. Reserved blank body space never enters capacity overhead; viewport,
  toolbar, and visibility changes may still remeasure capacity.
- The expanded toolbar's `Rows per page` select offers Auto, 25, 50, 100, and
  200. Auto keeps measured capacity; a fixed choice replaces it in the ordinary
  capacity update, so the list grows and the page scrolls. `localStorage`
  remembers the choice per screen ID and list ID; unavailable storage falls back
  to Auto. It never enters UUI messages beyond capacity.
- Size pages from the full page or modal content viewport, excluding fixed
  headers, modal height limits/padding, and list chrome. Content above a list
  scrolls away and never reduces its capacity. One scroll must expose the whole
  list and pager; pagination then retains that position. Small sources still
  reserve only their own rows, and scrolling never changes capacity.
- Page sources use the same search toolbar and pagination as local arrays. Show
  their current range and optional known total; `more` makes the next page
  available. The server retains source size independently of filtered page
  length so card, modal, and footer geometry survive filtering and reload.
  Search-only sources retain heading help but omit column sort/filter controls.
- Without selection, hide the entire pagination footer for zero or one result
  page. Sources that fit on one page reserve no footer space; filtering larger
  sources retains the original card height while hiding pagination. Retain that
  footer's layout before the first measurement so reload restores scroll against
  full geometry. Determine capacity from source totals and measured footer
  chrome, independent of current footer visibility, so a footer cannot create a
  second page merely by occupying space.
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
- `deno task test:list-selection-browser` covers native/Shift/drag/keyboard
  selection, all pages and filters, reload, selected totals, toolbar controls,
  actual demo bulk actions, equal navbar/list toolbar heights, paired lists with
  empty toolbars, and native/custom fields inside narrow overflow menus. Pass
  `--screenshots` to capture the paired desktop and mobile overflow layouts.
- `data_test.ts` checks column projection, formats/quoting and list result
  validation; channel_test.ts owns generic delivery/lifetimes;
  `list_geometry_test.ts` checks layout. Root list/session tests cover bounded,
  cancelled, filtered/sorted reads and preservation of source and screen state,
  and actual session-service reload after reads.
- `deno task test:lists-browser` checks toolbar actions, real clipboard block
  and column selection, UUI versus spreadsheet pagination, dirty edits, all six
  downloaded formats/ranges, desktop/mobile geometry, and the existing list
  interactions. `test:presentation-browser --field-help` covers
  retained-provider browsing through real field help.
- Field-help browser checks verify viewport-filling choice lists with collapsed
  and expanded tools, stable scrolling across pages, and desktop, tall-window,
  and mobile modal bounds.

# Child DOX Index
