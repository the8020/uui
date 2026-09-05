Parent DOX: [8020 workspace](../AGENTS.md).

Framework source:
[agent0ai/dox/AGENTS.md](https://github.com/agent0ai/dox/blob/765ae4ac02cc884eefcd41a3d0f71941721adb89/AGENTS.md).

# DOX framework

- DOX is highly performant AGENTS.md hierarchy installed here
- Agent must follow DOX instructions across any edits

## Core Contract

- AGENTS.md files are binding work contracts for their subtrees
- Work products, source materials, instructions, records, assets, and durable
  docs must stay understandable from the nearest applicable AGENTS.md plus every
  parent AGENTS.md above it

## Read Before Editing

1. Read the root AGENTS.md
2. Identify every file or folder you expect to touch
3. Walk from the repository root to each target path
4. Read every AGENTS.md found along each route
5. If a parent AGENTS.md lists a child AGENTS.md whose scope contains the path,
   read that child and continue from there
6. Use the nearest AGENTS.md as the local contract and parent docs for repo-wide
   rules
7. If docs conflict, the closer doc controls local work details, but no child
   doc may weaken DOX

Do not rely on memory. Re-read the applicable DOX chain in the current session
before editing.

## Update After Editing

Every meaningful change requires a DOX pass before the task is done.

Update the closest owning AGENTS.md when a change affects:

- purpose, scope, ownership, or responsibilities
- durable structure, contracts, workflows, or operating rules
- required inputs, outputs, permissions, constraints, side effects, or artifacts
- user preferences about behavior, communication, process, organization, or
  quality
- AGENTS.md creation, deletion, move, rename, or index contents

Update parent docs when parent-level structure, ownership, workflow, or child
index changes. Update child docs when parent changes alter local rules. Remove
stale or contradictory text immediately. Small edits that do not change behavior
or contracts may leave docs unchanged, but the DOX pass still must happen.

## Hierarchy

- Root AGENTS.md is the DOX rail: project-wide instructions, global preferences,
  durable workflow rules, and the top-level Child DOX Index
- Child AGENTS.md files own domain-specific instructions and their own Child DOX
  Index
- Each parent explains what its direct children cover and what stays owned by
  the parent
- The closer a doc is to the work, the more specific and practical it must be

## Child Doc Shape

- Create a child AGENTS.md when a folder becomes a durable boundary with its own
  purpose, rules, responsibilities, workflow, materials, or quality standards
- Work Guidance must reflect the current standards of the project or user
  instructions; if there are no specific standards or instructions yet, leave it
  empty
- Verification must reflect an existing check; if no verification framework
  exists yet, leave it empty and update it when one exists

Default section order:

- Purpose
- Ownership
- Local Contracts
- Work Guidance
- Verification
- Child DOX Index

## Style

- Keep docs concise, current, and operational
- Document stable contracts, not diary entries
- Put broad rules in parent docs and concrete details in child docs
- Prefer direct bullets with explicit names
- Do not duplicate rules across many files unless each scope needs a local
  version
- Delete stale notes instead of explaining history
- Trim obvious statements, repeated rules, misplaced detail, and warnings for
  risks that no longer exist

## Closeout

1. Re-check changed paths against the DOX chain
2. Update nearest owning docs and any affected parents or children
3. Refresh every affected Child DOX Index
4. Remove stale or contradictory text
5. Run existing verification when relevant
6. Report any docs intentionally left unchanged and why

## User Preferences

When the user requests a durable behavior change, record it here or in the
relevant child AGENTS.md

## Child DOX Index

This root retains repository-wide contracts and files outside the child scopes
below.

- [frontend/AGENTS.md](frontend/AGENTS.md): Provide shared browser Markdown
  rendering outside service-owned source trees.
- [programs/AGENTS.md](programs/AGENTS.md): Own standard Home, Program
  terminated, and session administration programs.
- [services/AGENTS.md](services/AGENTS.md): Declare and expose the login, shell,
  and persistent session services.
- [src/AGENTS.md](src/AGENTS.md): Own shared short-dump shaping and focused
  standard-program tests.
- [tables/AGENTS.md](tables/AGENTS.md): Describe bounded persistent metadata for
  UUI application sessions.

# Purpose

- Provide the first-party 80|20 Unified User Interface services and standard
  session programs.
- This file is the root contract of the independent `the8020/uui` Git
  repository.

# Ownership

- Own the public login service, authenticated browser shell, authenticated
  persistent UUI service, Home and Program terminated programs, browser
  protocol/configuration, session metadata and administration, source/build,
  package-local layouts, trusted custom-element initializer registry, xterm
  terminal rendering, shared Markdown rendering, and the shell message center.
- Do not own authentication storage/validation, cookie construction, sandbox
  placement, physical WebSockets, or kernel routing.

# Local Contracts

- Deployed service identity and canonical paths derive from
  `packages/the8020/uui`; login, shell, and session are ordinary default-enabled
  services.
- `the8020/uui/home` and `the8020/uui/program-terminated` are hidden ordinary
  programs selected by package-local `ui-config.json`. Home rescans the mounted
  package tree before each render and on Refresh; Program terminated defensively
  presents bounded exception, stack, source context, and copyable dump data.
- `program.toml` declares `uui` as an optional boolean defaulting to false. Home
  includes only programs with `uui = true` and `discoverable = true`, and
  returns silently after invocation. Hidden helpers retain their UUI flag. The
  program loader parses real TOML, rejects invalid flags and duplicate keys, and
  invokes default exports with a positional argument array.
  `the8020/admin-core/programs` owns the complete catalog and delegates custom
  execution inputs to `the8020/jobs/run-program`.
- `ui-config.json` is the sole current UUI configuration source. It owns login,
  post-login, and session routes; protocol version; disconnect grace;
  heartbeat/reconnect timing; replay/message limits; and Home/Program terminated
  IDs. These values are static package constants with no kernel settings,
  environment overrides, persisted overrides, or request-metadata transport.
  Browser requests never choose redirects.
- Login/logout explicitly call `/p/the8020/users/mod.ts`; passwords and
  authentication cookies never enter UUI messages or browser boot data.
- The shell reads the canonical effective user from generic request metadata.
  Generic `@the8020/context` identifies the outer UUI service; UUI session IDs
  and session metadata remain package-owned.
- The public login page is fixed to the shell's dark palette and uses the same
  elevated field-group card, title tab, underline fields, and primary action
  treatment. Its unboxed `80|20` wordmark sits opposite `Sign in` on the card's
  top edge with a subtle `6px` background radius; login does not read or persist
  authenticated-shell theme state. The Worker reads its
  `services/login/frontend/index.html` template for every page response and
  serves supported frontend assets through one constrained `/*` handler;
  unhashed assets use `no-cache`, so frontend edits need only a browser reload
  during development.
- Login errors and authenticated-shell notifications use their semantic soft
  background and text colors without a left accent border.
- One session service Worker delegates startup and uncaught-program recovery to
  its package-local UUI framework, which validates and reads `ui-config.json`.
- The session service is an ordinary session service with concurrency one; its
  handler owns UUI establishment, messages, replay, heartbeat, reconnect,
  program lifecycle, metadata, and registered Worker administration functions.
  The supervisor provides only generic persistent execution binding/completion,
  exact registered-function invocation, and physical WebSocket relay.
- The handler atomically maintains one row per live session in
  `the8020__uui__sessions`, containing exact execution placement, authenticated
  user identity, lifecycle timestamps/state, latest kernel-observed client IP
  address and network scope, and bounded current-screen metadata. Reconnection
  replaces the address fields with the latest observation. It never stores
  passwords, cookies, route tokens, replay buffers, or unbounded messages. Clean
  termination removes the record after signaling generic persistent completion;
  abnormal loss may leave recoverable stale metadata.
- `the8020/uui/sessions` lists bounded database metadata rows, validates a
  selected record against its exact Worker with `kernel.worker.invoke()`, passes
  the selected persistent-execution identity, and calls package-owned inspect,
  bounded message-log, or terminate functions. Missing targets are stale and may
  be cleaned by the program; no kernel Worker scan or UUI administration command
  exists.
- Login, shell, and session declare zero minimum sandboxes and Workers. Login
  and shell share sandbox group `uui`, permit 128 Workers at 64 per sandbox, use
  concurrency 16, target 70% utilization, and retain idle Workers for two
  minutes. The session service also uses group `uui`, has an unbounded zero
  maximum, keeps 64 Workers per sandbox, uses canonical `session` lifecycle with
  concurrency one and 100% target utilization, and retains an inactive session
  environment for ten minutes. These are worker/sandbox policies, not legacy
  instance reservations.
- Initial program output may precede the physical WebSocket. The service replays
  that retained output in server-sequence order before `session.ready`, so the
  shell always receives the first presentation instead of remaining on its
  opening placeholder.
- Programs import `sendMessage(body, kind?)` from the public
  `/p/the8020/uui/mod.ts` surface and may call it while a screen roundtrip is
  active or from a background asynchronous task for the same bound session.
  Message kinds are `info`, `success`, `warning`, and `error`; bodies are
  non-empty Markdown bounded to 20,000 characters. Notification frames use the
  ordinary sequenced/replayable session transport and never require a client
  event to be emitted. There is no compatibility alias.
- Programs import `download({ filename, contentType?, body })` from the public
  UUI surface. A byte stream or lazy async iterable starts a session-owned
  background transfer and returns optional `done`/`cancel` controls. Background
  producers retain the initiating async context, outlive individual screens, and
  report failures through the message center. Connection loss/session end
  cancels them. Download control messages and binary frames share the existing
  authenticated WebSocket, never enter replay, and use consumption-based credit
  bounded across concurrent transfers. The shell's local service worker exposes
  each transferred stream as a one-use native download; it intercepts only its
  reserved path and does not cache application assets or fetch backend file
  bytes. The native frame stays alive until the service worker reports response
  consumption; transferable-stream prefetch alone cannot end its lifetime. A
  bounded tail of completed frames remains until connection/page cleanup because
  native attachment registration has no DOM completion event. See `README.md`
  for the API, limits, and browser requirements.
- Browser startup performs normal `POST /connect`, reads `the8020-route`, and
  stores it only in `sessionStorage` under the WebSocket URL. It
  opens/reconnects the standard `the8020.uui.v1` WebSocket with the same opaque
  token as the `route` query parameter; invalid/lost routes are cleared and
  re-established. A kernel restart may preserve the browser token after its
  exact Worker is gone; the kernel returns `409`, and the shell replaces that
  stale route automatically without a page reload. Transient establishment
  failures stay inside the bounded reconnect loop rather than escaping as
  unhandled browser errors.
- Programs obtain the current authenticated identity on demand through
  `currentUser()` from `/p/the8020/users/mod.ts` instead of receiving identity
  or infrastructure dependencies through their function parameters.
- Programs are plain default-exported functions with ordinary TypeScript call
  stacks, classes, and closures; there is no program wrapper or decorator.
  `callScreen()` remains presentation-neutral and defaults to the root page.
  `presentModal(() => program())` and `presentPage(() => program())` alone push
  presentation surfaces, and an async-safe ambient context makes direct calls
  and awaited descendants inherit their caller's surface.
- A session owns one logical LIFO surface stack whose root is a page. Each
  surface owns at most one snapshot and one unresolved `callScreen()`. The
  visible presentation is the suffix beginning with the most recent page: that
  page is the base and later modal surfaces are ordered above it. A later page
  suspends the earlier page-plus-modal composition without destroying its Worker
  continuations. Returning or throwing from a presentation callback removes its
  surface in `finally` and restores the prior composition. A second concurrent
  `callScreen()` in one surface is an error; calls in covered surfaces may
  remain pending.
- One central dispatcher owns the session input queue and routes screen events
  only to the logical top surface after validating stable surface identity,
  screen ID, and revision. Back and Escape are ordinary `BACK_EVENT` inputs to
  the top screen; programs decide when returning should pop a wrapper. Closed
  async contexts cannot target another surface, and surface closure is strict
  LIFO rather than FIFO scheduling or last-writer replacement.
- `ScreenChannel` is an argument-free, reusable controller optionally attached
  to one unresolved `callScreen()`. It coalesces `redraw()` calls against that
  call's existing model/contract, resolves `exit(action?)` with an honest
  framework-originated exit lacking a fabricated client sequence, and rejects
  through `fail(error)`. Covered redraws update the cached snapshot and publish
  only when uncovered. Every settlement and session end detaches the channel;
  detached commands are discarded rather than buffered.
- Runtime-loaded package modules address shared package APIs through the generic
  `/p/` mount alias. The package does not depend on a UUI-specific runtime
  import-map entry that the generic image would have to know.
- `deno.json` contains the canonical deployed `/opt/runtime` and
  `/workspace/packages` mappings. Package-local checks and tests override only
  those mappings with `deno.local.json` so they resolve sibling source trees
  while retaining the production compiler options.
- Layouts and future overrides are serializable data without executable code;
  user-specific layout variants are not persisted in this phase.
- Layout regions may place their ordered `actions` alongside their controls,
  including buttons inside field groups. Those buttons are omitted from the
  fallback screen action bar; an explicit `actions` region still owns screen
  action placement as before.
- The versioned protocol publishes one atomic `presentation.show` snapshot with
  stable surface IDs, the visible base page, ordered modal snapshots, its
  one-based logical page depth, and the active surface ID. Page depth lets a
  freshly reloaded shell distinguish restoration of an older page from a new
  page push even though hidden Worker snapshots are not sent. The session
  service retains this complete visible presentation for replay/resync and
  reports the top interactive screen in metadata. The live Worker alone retains
  hidden snapshots, promises, closures, and continuations; durable navigation
  recovery after Worker loss is out of scope.
- Browser source uses the shared UUI protocol types and reconciles independent
  per-surface DOM, model, dirty-binding, custom-element, field-message, focus,
  and disposal state. Modal pushes preserve the existing layer prefix. Page
  pushes cache and hide the prior visible composition, and normal pops restore
  its exact DOM. Reload rebuilds every layer in the retained visible
  presentation; brief reconnects preserve existing DOM and dirty edits.
- Browser runtime values come directly from the browser-safe `protocol.ts`
  contract, not the program-facing `mod.ts` barrel; the latter exports the
  server session engine and must never pull Node built-ins into the shell
  bundle.
- The shell window title is `80|20 <top visible heading>`, using normalized
  heading text from the active page or modal; before a presentation exists or
  after it closes, the title is the generic `80|20`.
- Sending any `screen.event` or `screen.list` enters one shell-owned in-flight
  interaction state for the top surface. It immediately makes presentation and
  applicable header controls inert, disables Back, rejects additional event
  sends in JavaScript, and activates a transparent page- or modal-local pointer
  shield. If still pending after `500ms`, the same state reveals a blurred
  overlay and loading indicator. An early `server.ack` does not unlock stale
  content; an atomic presentation with an active surface, a session
  error/resync, or session end releases it.
- `Model(data)` retains the business-data reference and owns typed screen state.
  `callScreen()` validates and edits `model.data`; reusing the wrapper preserves
  a logical screen identity, query/page state, scroll, and toolbar expansion.
  Programs or navigation frames retain wrappers across refreshes and returns.
  `resetScreen()` explicitly increments a reset version and clears presentation
  state. Never attach one Model to multiple pending calls.
- Normalize element identities before constructing a screen: reserve every
  explicit ID across controls, actions, custom descriptors, and layout regions;
  reject duplicates; hash stable declaration metadata for omitted IDs. Collision
  ordinals belong only to the collision group, never a global sibling position.
  Identical duplicates cannot retain individual identity when those duplicates
  themselves move or disappear; explicit IDs resolve that ambiguity. Binding
  references resolve to control IDs centrally, and each descriptor has one
  placement. Column IDs are list-local; framework DOM IDs also include surface
  and Model identity. Initializer internals keep their own ownership.
- Protocol version 4 puts Model state and independent list snapshots in each
  screen. Wire business list bindings contain empty arrays; displayed values
  live exclusively in `screen.lists`. `ScreenLists` owns search/filter, stable
  typed sort, pagination, and displayed-to-source mappings for explicit and
  inferred lists. Views never reorder or truncate the source array. Mapping
  validation checks the exact source identity, row order/content, and view
  revision before applying a selection or edit. Stale views reject and publish a
  fresh snapshot; invalid dirty edits change neither business nor screen state.
- `screen.list` carries bounded page, query, or browser-measured capacity
  requests on the existing WebSocket. Queries reset only their list to page 1.
  Default queries remain inside the pending call; `triggerFilterEvents: true`
  resolves a typed `list-query` event after valid edits/metadata and the query
  are merged. Repeated queries, pages, capacity, and redraws emit no query
  event. Processing and counts cover only the supplied array. Database search,
  providers, and a `table()` search helper remain deferred.
- Capture scroll and toolbar metadata with existing interactions, including
  Back, paging, queries, and capacity. Never send standalone or periodic scroll
  updates. Browser-local positions survive redraw and surface/instance returns;
  reload needs only the last synchronized position. Persistence ends with the
  live Worker. A new Model starts at the top even on an existing surface.
- Browser lists measure a bounded row capacity from page/modal and card
  geometry, including toolbar, headers, footer, and horizontal scrollbar. The
  first snapshot has one measurement row; there is no fixed 25-row default.
  Resizing and visibility/toolbar changes may remeasure; scrolling may not.
  Capacity changes keep the former first row within the new page when possible.
  Tab selection is element state, so measuring a revealed list retains its tab.
  Rows have a fixed height, nowrap ellipsis, and keyboard-accessible full
  values.
- List headers use full/short headings and semantic widths from schema and
  declarative `columnOptions`. Readable widths overflow horizontally. Header
  popovers expose full headings, typed filters, sort, and clear actions; icons
  use the vendored `[[icon=...]]` registry. The rightmost List tools disclosure
  opens the search toolbar. Drafts, focus/caret, expansion, and horizontal
  scroll survive updates. A complete summary and clearing controls remain
  present for single-page and empty results. No export action is implemented by
  this task.
- Root-page overscroll containment must not be inherited by nested horizontal
  overflow regions. Paginated lists retain horizontal overflow for narrow
  viewports while vertical wheel and touch movement chains to the page scroller.
- The authenticated navbar uses an unboxed `80|20` wordmark with a `30px`
  semibold line box: light-mode `80` uses `#cd9d00`, dark mode uses its brighter
  gold token, `20` uses the primary text color, and a `24px` by `3px` rule
  centered within the line box renders the pipe independently of font glyph
  metrics.
- The shell owns one always-visible icon-only Material `arrow_back` button
  immediately after the brand, retains the accessible `Back` label, and emits
  the reserved `BACK_EVENT` as both action and event type to the topmost visible
  surface. The browser Back action traverses one marked same-URL guard entry,
  immediately restores that guard without growing history, and invokes this same
  Back path; reload adopts the existing guard instead of adding another. Program
  header controls and actions render from the screen snapshot between Back and
  the always-visible session disclosure. That disclosure combines one `8px`
  status circle, the authenticated username, and a Material `menu` icon in one
  button. Connected is green; connecting and reconnecting are red, while a
  visually hidden live label preserves the complete textual state. The username
  remains one line and ellipsizes at constrained widths. Its locally anchored,
  light-dismiss menu currently owns labeled light/dark theme switching and clean
  logout. Logout ends the persistent UUI session through the typed client
  protocol before redirecting through the configured logout route, with direct
  navigation as a disconnected-client fallback. The left brand/Back cluster and
  right session cluster use explicit grid positions, so hiding or emptying the
  dynamic middle never moves the right cluster away from the navbar's right
  edge. Page header controls remain in this global area; modal header controls
  render inside their own semantic native dialog. Program presentation dialogs
  and shell-owned dialogs such as Messages share the same `uui-dialog` frame,
  toolbar, body, close affordance, backdrop, responsive bounds, and scrolling
  design; their distinct ownership changes behavior, not appearance. Dialog
  focus is contained and restored, covered layers are inert, close and Escape
  route through `BACK_EVENT`, and responsive modal bodies scroll within bounded
  viewport dimensions. The navbar remains one row at every width. As the dynamic
  area shrinks, a measured stable prefix remains visible while items move from
  right to left into an accessible More disclosure without recreating their DOM
  controls. More sits immediately after the last visible dynamic control, or at
  the dynamic area's start when none remain; opening it stacks every hidden
  control vertically in original order and clamps the popover to a `10px`
  viewport edge gutter.
- The session disclosure menu owns a Messages action whose badge counts all
  messages received since the current screen interaction began. A new
  `screen.event`, `screen.list`, or route begins a fresh collection. At most the
  last 100 messages are retained in the browser and at most the last 10 are
  drawn as toasts. Toasts are anchored below the session disclosure at equal
  width, overlap downward by `0.5rem`, and keep the oldest card on top. Lower
  cards retain the fixed three-row base height and align to the active card's
  lower edge; only the active card expands, up to `25em`, with internal
  scrolling for longer Markdown. Its bottom progress drains from right to left
  for the adaptive timeout described below. Clicking a toast opens the native
  Messages dialog at that exact expanded entry and dismisses the complete toast
  stack through the same history-preserving path as close-all. Toast text is not
  selectable; complete selectable content remains in Messages. Every toast has a
  borderless exact-right-edge Material close control, and each dismissal takes
  the exiting card out of live stack geometry immediately while its
  pointer-transparent animation completes, allowing repeated clicks and
  immediate reflow of every newly exposed card. Only the active card
  materializes its Markdown body. A compact borderless Material `tab_close`
  control below the stack appears after the stack has contained multiple cards,
  remains available if expiration reduces that stack to one, and dismisses every
  visible toast without removing history. The complete stack hover region,
  including either close control, resets the active timeout and pauses it until
  the pointer leaves. The timeout interpolates from one second for messages of
  at most 20 characters through three seconds at 60 characters to at most five
  seconds at 100 or more characters. Expiration and explicit dismissal animate
  cards to the session disclosure, pulse the badge, and start the next card. The
  Messages dialog grows with its contents up to 90% of the dynamic viewport and
  gives the remaining height to its scrolling list; it expands and scrolls to
  the most recently archived or otherwise focused message while allowing any
  retained item to be expanded. Expanded history bodies use the dialog surface
  without a semantic background fill. History summaries render all retained
  items, while rich Markdown bodies are materialized only for entries the user
  expands.
- The shell's one constrained `/*` static handler serves supported browser
  assets from the generated and frontend roots, deriving MIME and cache policy
  from file type and hashed names; never register one service route or table
  entry per asset.
- The browser's shared icon-text renderer expands `[[icon=<name>]]` placeholders
  in UUI button and text content into accessible Material icon spans. An
  optional `color` accepts `text`, `muted`, `primary`, `success`, `warning`,
  `danger`, its `error` alias, `info`, `brand`, or a 3/4/6/8-digit hex value.
  Icon names resolve only through the fixed registry of individually vendored
  hashed SVGs. Inline text icons are `1.2em` and vertically centered; button
  icons are `1.5em`, flex-based buttons keep `0.45em` between every rendered
  child, and explicitly sized shell icons remain `20px`. Unregistered names and
  invalid colors remain literal text. Shell-owned Back, overflow, session menu,
  theme, edit, and select affordances use the same registry and ship no icon
  font or unused collection.
- The authenticated shell uses the static demo's light/dark visual tokens and
  component language with an explicit two-level hierarchy. Screen and section
  canvases remain unboxed and section titles render as H1 headings; semantic
  `field-group`, `detail`, and `list` regions alone use bright-light/dark-theme
  elevated cards. Page H1s or their descriptions keep `32px` before the root
  layout; section H1 margin plus layout gap totals `32px` before its content.
  Every titled card uses the same left-edge-aligned top-border tab with an open
  bottom; its left border continues through the tab to replace the covered card
  border, while its right border stops at the card top. Its label is `1rem` at
  weight `600`, with `10px 20px 0 0` radii and `0.28rem 1.5rem 0.28rem 0.78rem`
  padding; the card content reuses the tab's `0.78rem` start and `1.5rem` end
  inline padding tokens. Sibling cards stretch to equal height within each grid
  row. Section H1s, direct card stacks, and wrapped card rows use one `24px`
  vertical-gap token, so the H1-to-first-card distance exactly matches the
  distance between subsequent cards; horizontal card gutters remain `16px`. Only
  section H1s may separate card regions. Group-local responsive grid planning
  honors `short`, `medium`, and `long` field lengths via container breakpoints,
  preserves source order, distributes unused row width in canonical grid units,
  and restricts long and medium field starts to half-row and quarter-row
  boundaries respectively. Bounded field row spans reserve their complete grid
  rectangle at every breakpoint; later fields use only legal space at or after
  their source-order position, leaving holes instead of backfilling. Spanning
  controls stretch to one exact row metric shared by sibling groups: an `N`-row
  field consumes `N` standard label, control, and supporting-message row heights
  plus `N - 1` 20px row gaps, aligning its underline and reserved message slot
  with the `N`th ordinary field. Every field reserves the same
  supporting-message slot even when empty. Hints occupy exactly one ellipsized
  line in that slot; truncated hints open the complete text in a
  keyboard-accessible, light-dismiss popover. The renderer and semantic
  message-kind styling form the shared field message concept so later validation
  errors can use the same slot without changing geometry. Textarea resizing is
  disabled so it cannot escape the planned grid. Field items have zero outer
  padding and field-group grids use a 20px row and column gap. Direct field
  labels and legends reuse list-column-header typography: muted, uppercase,
  `0.7em`, weight `800`, and `0.06em` tracking. They always occupy exactly one
  fixed-height line and ellipsize overflow, including in groups without row
  spans; radio option labels retain ordinary body typography. Numeric range
  controls render a native slider with its synchronized bounded value suffix on
  the left and, when editable, the same exact-right-edge pencil used by other
  editable fields. The painted track is centered over the thumb's actual
  center-travel width, so its fill endpoint and thumb center coincide at
  minimum, midpoint, and maximum. Pencil clearance belongs to the surrounding
  field shell and never pads or shortens the native range input's travel area;
  values use the ordinary numeric binding path. Every field control, including
  checkboxes, switches, radios, and ranges, uses the shared flat underline
  treatment. Read-only and editable controls retain identical color, opacity,
  and value styling; the pencil is the steady-state visual indicator of
  editability. Editable controls alone receive the muted vendored Material
  `edit` SVG aligned visually and geometrically to the exact field end; textarea
  and radio pencils keep the same underline-relative bottom offset, while select
  chevrons and native input affordances remain immediately before the pencil.
  Password controls retain this shared layout while masking their current
  browser value; programs must start sensitive edit models empty and never
  redisplay stored values. Interactive hover feedback changes paint-only
  properties such as color, border, background, and shadow; it never transforms
  or repositions a pointer hitbox. Neutral elevation shadows are dark-tinted in
  light mode and black in dark mode; dark-mode surfaces never use text-derived
  light shadows. Theme state is browser-only: `sessionStorage` keeps the current
  UUI session override through redraw/reconnect/reload, while `localStorage`
  supplies the default for future tabs. Shell markup defaults to dark, and a
  CSP-nonced initializer in the head resolves the browser-only stored or
  operating-system preference before CSS and first paint; theme state never
  enters UUI messages, service requests, kernel APIs, or backend storage.
- Untruncated field messages remain ordinary selectable text. Only genuine
  overflow adds the underline, help cursor, button semantics, and locally
  anchored full-message popover; responsive width changes update that state.
- Browser source executes bounded framework clipboard-write commands using the
  standard Clipboard API with a compatibility fallback.
- Shared browser Markdown lives under `frontend/`, outside any service-owned
  source tree. It uses `markdown-it` with raw HTML and images disabled, rejects
  executable link schemes, hardens rendered links for a new browsing context,
  and exposes both HTML and DOM rendering helpers through `frontend/mod.ts`.
  `frontend/markdown.css` is a dedicated, `.markdown`-scoped stylesheet for
  headings, tables, lists, quotes, code, and other rendered content; the shell's
  constrained static handler serves only that CSS from the shared frontend root,
  never the TypeScript source.
- Browser custom elements are selected only by framework-validated initializer
  names and plain JSON configuration. `sandbox-console.v1` owns one persistent
  xterm instance, same-origin `the8020.console.v1` connection, binary PTY
  input/output, Canvas2D rendering with DOM fallback, visible active/inactive
  mouse selection, exact content-box fitting, resize controls, bounded
  reconnect, and teardown; it never accepts executable source or
  backend-provided CSS.
- `THIRD_PARTY_NOTICES.md` records the MIT/BSD notices for the bundled xterm and
  Markdown renderer dependencies, copied essential xterm styles, plus the
  Apache-2.0 license for the individually vendored Google Material `arrow_back`,
  `arrow_drop_down`, `dark_mode`, `edit`, `error`, `light_mode`, `menu`,
  `more_vert`, `refresh`, `save`, `close`, `logout`, and `tab_close` SVGs.
  Session menu rows place a fixed-width leading icon or message-count badge
  before a left-aligned label. The theme menu action shows the icon and visible
  label for the theme it will switch to and retains its accessible label.
- Reload resume synchronizes the Worker-acknowledged client sequence before a
  new event is emitted, preventing post-reload actions from being mistaken for
  duplicates.
- `.generated/main.js` and its source map are build products from
  `services/shell/frontend/main.ts` and are never source-of-truth files. The
  package-local build script uses this repository's `deno.json`; it does not
  locate or invoke a kernel checkout.

# Work Guidance

- Keep all assets local, semantic, keyboard-accessible, responsive, and free of
  backend-provided CSS or executable layout content.
- User-visible descriptions, hints, placeholders, notices, and empty-state copy
  must help the user act or understand a user-visible outcome. Never add copy
  solely to explain internal architecture, storage, persistence, sessions,
  transport, or implementation details; omit it entirely and keep those details
  in DOX or developer documentation. For example, never show
  `Value is stored per-session in the user storage.` or
  `The value is sent directly to kernel secret storage and is not shown again.`
  in the UI.

# Verification

- `deno task test:programs-browser` drives the actual Programs catalog and
  shared execution form through Chromium against deterministic kernel/job
  fixtures. It checks all-program visibility, metadata, preselection, input
  validation, retained inputs, captured job output, current-session UUI
  execution, Back, and mobile sizing. Package tests cover Home filtering and
  silent returns.
- Deno checks cover all services/programs, including login template/error
  injection and constrained static asset routing. UUI and frontend tests cover
  discovery and containment failures, dynamic/default-export loading, static and
  natural class/closure program calls, nested page/modal stack restoration,
  async-context event ownership, atomic reload/resync presentations,
  `ScreenChannel` redraw/exit/failure lifecycle, dirty redraw merging,
  package-owned heartbeat timeout, metadata/replay/termination, Program
  terminated rendering/copy/Home recovery, model binding, resume decisions,
  exception escape, renderer-supporting pure helpers, the bounded message
  collection, safe Markdown output, asynchronous session message streaming, and
  standard UUI discovery; `services/shell/build.sh` rebuilds the browser bundle.
- `browser_e2e.ts` drives real Chromium through two isolated kernel nodes and
  receives explicit kernel-source and sibling package-workspace roots, then
  assigns distinct ephemeral main-HTTP and SSH ports to every node. The nodes
  stage the complete bootstrap package set so a fresh database can
  batch-evaluate and synchronize all tables before services start. The nodes use
  only canonical current command IDs: base `kernel.status` establishes the
  command socket, then package command polling establishes the service plane;
  the suite must never depend on removed legacy command aliases. The nodes share
  the signing key and users-package authentication database; CDP commands are
  bounded and the test injects a UUI-subprotocol-only socket handle to force a
  deterministic brief reconnect without altering package timing constants.
  Targeted service edits converge between nodes; invalid index publication
  preserves healthy fragments, and ordinary local package commands repair a boot
  with broken service defaults. Signed routes cover cross-node HTTP and browser
  WebSocket forwarding, case-insensitive platform headers, stripped forged
  internal metadata, unavailable-node failure without replay, and stale
  execution rejection. Forwarding checks release the original WebSocket before
  another request, respecting UUI's strict single-request concurrency, then
  resume the same browser execution. Kernel-restart recovery distinguishes the
  replacement live session from recoverable stale metadata and cleans the stale
  record through the package-owned sessions program. The suite then covers
  login/cookie sharing, persistent Canvas-rendered xterm Bash consoles in both a
  real development sandbox and an ordinary runtime sandbox,
  `xterm-256color`/`clear`, exact bottom-row fitting, visibly rendered mouse
  selection, confirmed source and factory reset controls, development activation
  preview statistics, required-message validation, independent package commits,
  and clean overlay reset, per-session theme persistence and future-tab theme
  inheritance, dark and light reload initialization before first paint,
  responsive two/four-group layouts, semantic field lengths, reserved
  hinted/unhinted supporting-message alignment, accessible full-hint popovers,
  and source-ordered multi-row field placement including its message slot at
  desktop/tablet/mobile widths, persistent standard Back navigation, header
  action/control rendering, one-row right-to-left responsive hiding,
  synchronized browser titles, vertical overflow disclosure, and mobile
  viewport-edge clamping; an open disclosure remains open across responsive
  refits while overflow is still required. It also covers modal
  stacking/focus/inertness, modal-local headers, Escape and browser-Back
  routing, page-over-modal suspension, later-page reload and exact continuation
  restoration, dirty background redraws, immediate rapid-event suppression and
  delayed loading feedback, direct home-list invocation, the summary-only
  core-admin package list and selected package manifest/Git/content detail with
  vertically spaced content cards and service clickthrough, live database
  catalog list/detail/synchronization through the DB package, the core-admin
  service/sandbox lists and linked details, the package-owned UUI session
  list/detail with exact-Worker inspection, bounded log, stale cleanup,
  termination, and session-service clickthrough, authorized service
  enable/disable and capacity changes including percentage sliders, nested
  demos, dirty reconnect, reload resume, semantic and asynchronous messages,
  adaptive one-to-five-second whole-stack hover pause, direct toast-to-history
  targeting, rapid independent and close-all dismissal, stacked-card geometry,
  bounded toast/history rendering, alternating long and short Markdown
  expansion, viewport-relative history scrolling, message-history focus,
  roundtrip clearing, TypeError/ValueError short dumps, source context,
  clipboard copy, Home recovery, per-tab Worker isolation, single-Worker
  failure, and logout; administrative polling is throttled, startup failures
  include service/log diagnostics; fresh-node bootstrap allows two minutes for
  table evaluation and ordinary per-package index jobs. Enabled `IDLE` services
  are accepted before first-request lazy provisioning, staged rootfs fixtures
  dereference symlinks only through a component-wise resolver contained by the
  source root, and process cleanup is time-bounded.
- `presentation_browser_e2e.ts` is the focused presentation-stack browser
  harness. It serves the built shell, connects it to the real UUI session engine
  over a local WebSocket, and verifies page/modal stacking, exact hidden layer
  and custom-element preservation, dirty `ScreenChannel` redraws, Escape/Back
  routing, reload of a later page plus modal, and restoration of the earlier
  page-plus-modal continuation. Run it with
  `deno task test:presentation-browser`; it is not part of the ordinary
  unit-test glob. Pass `--browser=/path/to/chromium` when Chromium is not at the
  default path.
- `download_browser_e2e.ts` connects the real session service and built shell
  over a local WebSocket. `deno task test:download-browser` verifies concurrent
  native Chromium downloads, partial disk writes before production completes,
  byte-exact results, interactive screens, producer errors, native cancellation,
  generator cleanup, reconnect without download replay, and zero backend file
  requests. `downloads_test.ts` covers shared flow-control bounds, large source
  chunks, async context, completion, cancellation, and protocol validation.
- The download browser harness also opens the real demo form and verifies its
  text file, default 100,000-row calculation CSV, slider-selected export size,
  and field-group action placement without duplicate footer buttons at desktop
  and mobile widths.
- Browser E2E distinguishes selectable untruncated messages from responsive
  overflow triggers and verifies that full-message popovers stay beside their
  field while remaining inside the viewport.

- `lists_test.ts`, `list_values_test.ts`, and `uui_test.ts` cover projections,
  source mappings, identities, typed semantics, atomic edits/query events, and
  page-five retention across selection and data refresh.
- `deno task test:lists-browser` exercises real Chromium search/filter/sort,
  focus/caret, empty counts, local/synchronized scroll, reload/reconnect,
  capacities, overflow, and same-surface plus nested page/modal returns.
