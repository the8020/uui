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
- `ui-config.json` is the sole current UUI configuration source. It owns login,
  post-login, and session routes; protocol version; disconnect grace;
  heartbeat/reconnect timing; replay/message limits; and Home/Program terminated
  IDs. These values are static package constants with no kernel settings,
  environment overrides, persisted overrides, or request-metadata transport.
  Browser requests never choose redirects.
- Login/logout call the typed kernel API; passwords and opaque authentication
  cookies never enter UUI messages or browser boot data.
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
  `@packages/the8020/uui/mod.ts` surface and may call it while a screen
  roundtrip is active or from a background asynchronous task for the same bound
  session. Message kinds are `info`, `success`, `warning`, and `error`; bodies
  are non-empty Markdown bounded to 20,000 characters. Notification frames use
  the ordinary sequenced/replayable session transport and never require a client
  event to be emitted. There is no compatibility alias.
- Browser startup performs normal `POST /connect`, reads `X-80-20-Route`, and
  stores it only in `sessionStorage` under the WebSocket URL. It
  opens/reconnects the standard `the8020.uui.v1` WebSocket with the same opaque
  token as the `route` query parameter; invalid/lost routes are cleared and
  re-established. A kernel restart may preserve the browser token after its
  exact Worker is gone; the kernel returns `409`, and the shell replaces that
  stale route automatically without a page reload. Transient establishment
  failures stay inside the bounded reconnect loop rather than escaping as
  unhandled browser errors.
- Programs obtain the current authenticated identity on demand through
  `kernel.auth.currentUser()` instead of receiving identity or infrastructure
  dependencies through their function parameters.
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
  `@packages/` mount alias. The package does not depend on a UUI-specific
  runtime import-map entry that the generic image would have to know.
- `deno.json` contains the canonical deployed `/opt/runtime` and
  `/workspace/packages` mappings. Package-local checks and tests override only
  those mappings with `deno.local.json` so they resolve sibling source trees
  while retaining the production compiler options.
- Layouts and future overrides are serializable data without executable code;
  user-specific layout variants are not persisted in this phase.
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
- Sending any `screen.event` or `screen.page` enters one shell-owned in-flight
  interaction state for the top surface. It immediately makes presentation and
  applicable header controls inert, disables Back, rejects additional event
  sends in JavaScript, and activates a transparent page- or modal-local pointer
  shield. If still pending after `500ms`, the same state reveals a blurred
  overlay and loading indicator. An early `server.ack` does not unlock stale
  content; an atomic presentation with an active surface, a session
  error/resync, or session end releases it.
- List pagination renders only the server-described page and bounded page-number
  controls. A page click sends `screen.page` on the existing session WebSocket
  with the visible list slice and all dirty bindings; it does not dispatch a
  program event, and a replacement snapshot clears edits only after the Worker
  has merged and validated them.
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
  `screen.event`, `screen.page`, or route begins a fresh collection. At most the
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
  `danger`, `info`, `brand`, or a 3/4/6/8-digit hex value. Icon names resolve
  only through the fixed registry of individually vendored hashed SVGs. Inline
  text icons are `1.2em` and vertically centered; button icons are `1.5em`,
  flex-based buttons keep `0.45em` between every rendered child, and explicitly
  sized shell icons remain `20px`. Unregistered names and invalid colors remain
  literal text. Shell-owned Back, overflow, session menu, theme, edit, and
  select affordances use the same registry and ship no icon font or unused
  collection.
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
  `arrow_drop_down`, `dark_mode`, `edit`, `light_mode`, `menu`, `more_vert`,
  `refresh`, `save`, `close`, `logout`, and `tab_close` SVGs. Session menu rows
  place a fixed-width leading icon or message-count badge before a left-aligned
  label. The theme menu action shows the icon and visible label for the theme it
  will switch to and retains its accessible label.
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
  authentication through the system database; CDP commands are bounded and the
  test injects a UUI-subprotocol-only socket handle to force a deterministic
  brief reconnect without altering package timing constants. Kernel-restart
  recovery distinguishes the replacement live session from recoverable stale
  metadata and cleans the stale record through the package-owned sessions
  program. The suite then covers login/cookie sharing, persistent
  Canvas-rendered xterm Bash consoles in both a real development sandbox and an
  ordinary runtime sandbox, `xterm-256color`/`clear`, exact bottom-row fitting,
  visibly rendered mouse selection, confirmed source and factory reset controls,
  development activation preview statistics, required-message validation,
  independent package commits, and clean overlay reset, per-session theme
  persistence and future-tab theme inheritance, dark and light reload
  initialization before first paint, responsive two/four-group layouts, semantic
  field lengths, reserved hinted/unhinted supporting-message alignment,
  accessible full-hint popovers, and source-ordered multi-row field placement
  including its message slot at desktop/tablet/mobile widths, persistent
  standard Back navigation, header action/control rendering, one-row
  right-to-left responsive hiding, synchronized browser titles, vertical
  overflow disclosure, and mobile viewport-edge clamping; an open disclosure
  remains open across responsive refits while overflow is still required. It
  also covers modal stacking/focus/inertness, modal-local headers, Escape and
  browser-Back routing, page-over-modal suspension, later-page reload and exact
  continuation restoration, dirty background redraws, immediate rapid-event
  suppression and delayed loading feedback, direct home-list invocation, the
  summary-only core-admin package list and selected package manifest/Git/content
  detail with vertically spaced content cards and service clickthrough, live
  database catalog list/detail/synchronization through the DB package, the
  core-admin service/sandbox lists and linked details, the package-owned UUI
  session list/detail with exact-Worker inspection, bounded log, stale cleanup,
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
  include service/log diagnostics, enabled `IDLE` services are accepted before
  first-request lazy provisioning, staged rootfs fixtures dereference symlinks
  only through a component-wise resolver contained by the source root, and
  process cleanup is time-bounded.
- `presentation_browser_e2e.ts` is the focused presentation-stack browser
  harness. It serves the built shell, connects it to the real UUI session engine
  over a local WebSocket, and verifies page/modal stacking, exact hidden layer
  and custom-element preservation, dirty `ScreenChannel` redraws, Escape/Back
  routing, reload of a later page plus modal, and restoration of the earlier
  page-plus-modal continuation. Run it with
  `deno task test:presentation-browser`; it is not part of the ordinary
  unit-test glob. Pass `--browser=/path/to/chromium` when Chromium is not at the
  default path.
- Browser E2E distinguishes selectable untruncated messages from responsive
  overflow triggers and verifies that full-message popovers stay beside their
  field while remaining inside the viewport.

# Child DOX Index
