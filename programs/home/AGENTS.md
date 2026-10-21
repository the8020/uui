Parent DOX: [uui programs DOX](../AGENTS.md).

# Purpose

- Launch discoverable UUI programs from the mounted package catalog.

# Ownership

- Own the Home entrypoint, manifest, layout, program tree, and its browser
  navigator component.
- `catalog.ts` resolves package widgets into tiles, their launch actions, and
  data sources; `tree.ts` builds category folders. `frontend.ts` and
  `frontend.css` are the navigator sources; `deno task build:home` publishes
  them as `public/home-navigator.js` and `public/home-navigator.css`, served
  through `packageAssetURL`. Rebuild after changing either source.

# Local Contracts

- Refresh and Logout stay in the page header.
- Tiles come from installed `widgets/*.toml` declarations (format owned by
  `the8020/packages/widgets.ts`). A widget appears only when `open.program` is
  an installed UUI program, including non-discoverable ones. Every discoverable
  UUI program that no widget opens gets a default tile, titled from its name, in
  a folder named after its package placed after declared categories. Invalid
  widgets are skipped and logged with `console.error`.
- Visibility: a widget with `[visible] permission` appears only to users whom
  `permitsAny` (no audit) grants that action for some value, evaluated on each
  render; selecting such a tile checks again and shows a message instead of
  launching. The permission must be declared by an installed package, or the
  widget is skipped. Platform (`the8020/*`) widgets without `[visible]` are
  skipped (`public = true` makes one public on purpose), and platform programs
  never get a default tile. A skipped widget's program, and every program of a
  package with an unreadable widget file, gets no default tile either, so no
  tile becomes public by mistake. Folders appear only with visible tiles. Hiding
  is not enforcement: programs still check their own permissions.
- Texts are English only until platform localization is designed.
- Widgets with `[data]` show live status. The data program must be an installed
  non-interactive (`uui = false`) program; otherwise its data is ignored and
  logged. Home creates one Channel per screen. The browser asks with `load`
  `{ tiles }` (at most 100) for visible live tiles that are missing, stale after
  a redraw, or due by `refresh`; nothing is sent before it asks. `tile_data.ts`
  runs each program with a 10-second timeout, at most six at once per session
  through `limiter.ts` (queued tiles of an ended screen are skipped), and sends
  one `data` message per tile as soon as it answers:
  `{ tile, value?, detail?,
  status? }` (value ≤24, detail ≤120 characters,
  status `ok`, `info`, `warning` or `danger`), or `{ tile, error: true }` after
  a logged failure. Tiles render first, show `…` while loading and `—` when
  unavailable; unanswered requests may repeat after 20 seconds.
- The page body is one preserved custom element. The left tree shows category
  folders with their tiles; a root with one folder collapses into it. Folders
  precede tiles, both by order then title. The right pane shows tiles for the
  selected folder's children with a clickable path. Folder tiles and tree
  folders select that folder; tiles and tree leaves send the ordinary `select`
  action with the tile ID, and Home launches its `open` program with its
  arguments.
- The tree is keyboard-accessible (arrows, Home/End, Enter/Space). Selected and
  expanded folders live in the element's screen state, so they survive redraws
  and program returns.
- The divider between tree and tiles resizes the tree by pointer drag or
  Left/Right arrows; double-click or Home restores the 280px default. The width
  is a browser-only `localStorage` preference, clamped to 180px and 60% of the
  navigator. Narrow viewports stack the tree above the tiles without a divider.
- Reuse package-owned program identifiers and descriptions. Build the catalog
  (widgets and manifests, read in parallel) on the first render and keep it for
  the session; only explicit Refresh rebuilds it. Default tiles require both uui
  and discoverable flags.
- Invoke ordinary programs and return silently without a generic completion
  notification.

# Work Guidance

# Verification

- Run `deno task test` from the UUI root; `src/home_test.ts` covers catalog
  filtering and silent returns, `catalog_test.ts` covers widget resolution, data
  sources and default tiles, `tile_data_test.ts` covers data validation,
  failures and timeouts, `limiter_test.ts` covers bounded concurrency, and
  `tree_test.ts` covers folder ordering.
- Run `deno task test:programs-browser` for the shared interactive launch path.
- The native `browser_e2e.ts` harness opens programs from Home through its
  shared `clickRow` helper: when no list row matches, it expands the tree one
  folder at a time and clicks the tile's tree leaf.

# Child DOX Index

No child DOX documents. This document owns the entire local scope.
