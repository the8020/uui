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

- Provide the code editor as a prebuilt custom field in its own shell component
  folder. Vendor libraries, load only on demand, inherit field binding/sizing
  and light/dark colors, and include copy/fullscreen plus optional line markers.
- All components may keep bounded JSON presentation data in their screen element
  metadata, synchronized with ordinary interactions; persistence is not
  list-only.
- UUI sessions must support creation, inspection, and control by external
  clients without a browser. Agent clients connect to the backend session;
  operating an existing frontend must not be a prerequisite.
- Agent screen transcriptions preserve actual placement, including fields and
  buttons in headers and field groups. Start with `screenCall`, the source path
  and line of the actual `callScreen()` invocation; omit the program ID. Show
  labels, descriptions, values, editability, and compact capabilities such as
  `value-help: true`; keep bindings, raw events, and transport bookkeeping
  inside the adapter. Ordinary commands address element IDs; raw event emission
  is an escape hatch for agents that inspect the owning screen code.
- Agent value-help commands query the field's value-help provider directly; they
  do not open the field-help modal. Screen commands carry the observed revision
  and return the latest transcription, including on stale rejection. A stale
  warning explains `--force`, which may bypass the revision mismatch for the
  same available target but never authorization or field validation.
- Session discovery and attachment must serve ordinary UUI clients as well as
  agents. Owners must be able to list and take over their live sessions while
  retaining the original presentation and pending `callScreen()` promise. Keep
  one active client connection per session. Displaced clients show a full
  blurred, inert backdrop with a Take control button and receive no screen
  updates. Preserve controller order so releasing control can return it to the
  previous available client. Session timeout starts after the last active
  connection disconnects. Keep authorization separate from controller identity
  so future authorized administration can reuse takeover.
- Prefer ordinary JSON request/response commands for sandbox agents, with
  temporary client attachment and the existing persistent execution retained
  after the request. Build on standard services, signed reconnection routes, and
  registered Worker functions; UUI remains an ordinary persistent service.
- Custom component definitions own their agent fallback: named inputs, outputs,
  and actions, reused unchanged by every screen. Inputs/outputs address paths
  relative to the bound value (`""` is the whole value); actions declare the
  existing event. Object-valued custom fields remain one binding. Terminal
  fallback is deferred. Component-specific terminal behavior stays with the
  providing package.

## Child DOX Index

This root retains repository-wide contracts and files outside the child scopes
below.

- [frontend/AGENTS.md](frontend/AGENTS.md): Provide shared browser Markdown
  rendering outside service-owned source trees.
- [programs/AGENTS.md](programs/AGENTS.md): Own standard Home, Program
  terminated, and session administration programs.
- [services/AGENTS.md](services/AGENTS.md): Declare and expose the login, shell,
  and persistent session services.
- [src/AGENTS.md](src/AGENTS.md): Own shared session/short-dump fields,
  short-dump shaping, and focused standard-program tests.
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
  package-local layouts, generic program-supplied custom elements and public
  asset delivery, shared Markdown rendering, and the shell message center.
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
- The browser sends its HTTP(S) origin, language, and time zone as JSON during
  HTTP establishment and as `browser` in each `session.connect` handshake. The
  session service validates and freezes these values before starting the
  program, retains them in its Worker-local session binding, and refreshes them
  on reattachment. `currentBrowser()` returns this read-only context, or
  `undefined` for channels without browser metadata. It is browser-reported
  presentation input, separate from trusted runtime identity and observed IP. Do
  not persist it in session rows or put it in generic kernel context.
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
- `POST /connect` also accepts `{program?, inputs?, browser?}` and returns
  `the8020-session` with the ordinary signed route. Omitted program starts Home.
  Headless creation starts the same program continuation as browser creation.
- `agent.ts` projects the actual header/layout into compact YAML beginning with
  `screenCall`, captured at `callScreen()` using shared stack-path parsing.
  Expose IDs, values, labels/help, read-only status and value-help availability;
  hide bindings/events, hidden fields/columns and password text. Lists include
  up to 100 displayed rows and their selection indices; page for more.
- `POST /command` uses the claimed client ticket and existing screen validation
  and dispatch. `set` commits through the complete schema without resolving an
  ordinary nonreactive screen; click/enter/custom actions resolve its original
  promise. Direct value help shares the field-help provider reader. Every
  accepted or rejected command returns a fresh transcript. Expected references
  include presentation revision and surface/screen/model identity; `force` skips
  only the revision check. Replayed snapshots do not advance revision.
- Commands release control when their request finishes. After an event, wait up
  to two seconds for the next interactive presentation, then return `busy` for
  later inspection without repeating the action. Commands in progress prevent
  competing claims. Responses include session completion and up to ten recent
  notifications. Worker control functions never perform the screen command.
- The shell resolves a session ID to its stored placement, checks its owner,
  invokes `uui.session.control`, and signs a route using
  `kernel.services.route`. Claims close the previous socket before ordinary
  concurrency-one admission. The session keeps at most 16 client IDs in takeover
  order; waiting clients refresh their presence through stateless polling and
  expire after two minutes. Release/disconnect promotes the previous client;
  polling never resets the disconnect grace. New sessions also start this grace
  before their first client.
- Browser URLs carry `?session=uis-...`. A missing execution remains
  unavailable; a URL never recreates its program. Only the owner can attach
  today; ownership checks are separate from client IDs and tickets.
  `openSession()` asks the browser to navigate through this same shell path.
- The handler atomically maintains one row per live session in
  `the8020__uui__sessions`, containing exact execution placement, authenticated
  user identity, lifecycle timestamps/state, latest kernel-observed client IP
  address and network scope, and bounded current-screen metadata. Reconnection
  replaces the address fields with the latest observation. It never stores
  passwords, cookies, route tokens, replay buffers, or unbounded messages. Clean
  termination removes the record after signaling generic persistent completion;
  abnormal loss may leave recoverable stale metadata.
- Session IDs use the shared `newId("uis")` helper with ten random lowercase
  alphanumeric characters. Initial metadata creation is an insert protected by
  the database primary key; an ID collision fails creation and releases the
  local binding without replacing or deleting another session's metadata. Later
  metadata updates belong only to that registered session.
- `the8020/uui/sessions` lists bounded database metadata rows, validates a
  selected record against its exact Worker with `kernel.worker.invoke()`, passes
  the selected persistent-execution identity, and calls package-owned inspect,
  bounded message-log, or terminate functions. Missing targets are stale and may
  be cleaned by the program; no kernel Worker scan or UUI administration command
  exists. The registered inspect result includes the active screen title.
  Session lists page 200 rows at a time; selected refreshes query the exact row.
  The main detail shows user/activity, Advanced owns execution references and
  message logs, and ending a live session requires confirmation.
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
- Browser startup without a session ID performs normal `POST /connect`, reads
  `the8020-session` and `the8020-route`, and records the session ID in its URL.
  Existing session URLs resolve through the stateless shell control endpoint. It
  opens/reconnects the standard `the8020.uui.v1` WebSocket using the signed
  token as the `route` query parameter and a current client/control ticket. Lost
  executions require starting a new session explicitly. Transient establishment
  failures stay inside the bounded reconnect loop rather than escaping as
  unhandled browser errors. HTTP redirects from establishment or recovery end
  reconnecting, clear the stored route, and navigate to the response URL before
  interpreting status or route headers. Browser WebSocket handshakes hide
  redirects, so failed upgrades use this same HTTP path. The session manifest
  declares the login redirect through ordinary service access policy; the
  browser never guesses an authentication destination from a close code or 401.
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
  Identical snapshots retain both the control DOM and its bound model object.
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
  error/resync, session end, or a matching list data response releases it.
  Independent reads leave dirty values pending and reject on disconnect.
- `Model(data)` retains the business-data reference and owns typed screen state.
  `callScreen()` validates and edits `model.data`; reusing the wrapper preserves
  a logical screen identity, query/page state, scroll, and toolbar expansion.
  Programs or navigation frames retain wrappers across refreshes and returns.
  `resetScreen()` explicitly increments a reset version and clears presentation
  state. Never attach one Model to multiple pending calls.
- Field catalogs and list columns consume shared Zod semantic fields from
  `the8020/db/fields.ts`. UUI `field(schema, options)` returns an independent
  schema with local presentation metadata, retaining shared names, Markdown
  descriptions, and server callbacks through nullable/optional wrappers. Reusing
  or customizing a field never mutates another screen's definition. Field
  callbacks are excluded from wire descriptors. Structures remain normal Zod
  objects and arrays. Control and list inference use the underlying primitive
  kind, including formatted numbers such as `z.int()` and `z.float64()`.
  Declared decimal storage supplies text controls with decimal input mode and
  exact decimal list semantics. Forms and help retain strings; sorting and
  comparison filters never convert monetary values to floating point.
- UUI `enterEvent` is optional non-empty per-input action metadata; it is not a
  boolean and has no default event. Native editable inputs dispatch the named
  ordinary action with dirty values; textareas retain multiline behavior.
  `KeyboardShortcut` descriptors on fields/controls/actions allow F5–F12 with
  exact optional Control/Alt/Shift flags. Validate at field/control construction
  and reject duplicate combinations across screen body/header before publishing.
  Explicit list layouts inherit the bound control's shortcut. Layout reference
  resolution rejects ambiguous shortcut bindings and repeated placement of a
  shortcut-bearing control; repeated lists can use separate controls placed by
  ID with distinct shortcuts. Lists without shortcuts retain existing placement.
  Browser keyboard dispatch and focus remain owned by the browser child
  contract.
- Scalar fields expose a pencil or read-only Chevron Right button and
  focused-field F1/F4 help. The modal owns an isolated draft and keeps the
  caller Model and surface reserved. Only Done validates against the complete
  caller schema and commits; Close, Back, and Escape discard even invalid
  drafts. Show Done only in edit mode, followed by Navigate when semantic
  `open(value)` exists. Navigate opens a related page without committing and
  restores help on return. Markdown descriptions appear in full.
  `fieldHelp: false` suppresses help. Editable help shows a Value help card
  below the value when the field has a provider or ordinary control options. Its
  standard list opens with search visible; selecting a row fills the draft.
  `valueHelp({ query, offset, limit })` receives the complete ordinary list
  query and fetches a page bounded by measured capacity (1–500). Providers
  return a Zod row schema, at most `limit` rows, `more`, and optional
  matching/unfiltered totals. The first schema field supplies the selected
  value; every column uses ordinary field types, labels, help, sorting,
  filtering, and list tools. `queryValueHelp()` in `lists.ts` shares ordinary
  array-list projection for already available snapshots; SQL-backed providers
  filter/sort before paging at the database owner.
- Help uses ordinary screen, modal, list, and page machinery. Inline edits are
  flushed before opening. A reactive field returns one ordinary change event
  only after Done commits a changed value. The caller and its ScreenChannel stay
  pending during help: background redraws update the covered snapshot;
  exit/failure settles after help returns. Read-only controls reject client
  edits at the session boundary and never load choices.
- A Model creates its `mdl-*` screen identity through the shared operational ID
  helper and retains it for the wrapper's lifetime. IDs are scoped to the UUI
  session; registering a screen rejects a collision with any pending Model
  without replacing the original screen or its continuation.
- Normalize element identities before constructing a screen: reserve every
  explicit ID across controls, actions, custom descriptors, and layout regions;
  reject duplicates; hash stable declaration metadata for omitted IDs. Collision
  ordinals belong only to the collision group, never a global sibling position.
  Identical duplicates cannot retain individual identity when those duplicates
  themselves move or disappear; explicit IDs resolve that ambiguity. Binding
  references resolve to control IDs centrally, and each descriptor has one
  placement. Column IDs are list-local; framework DOM IDs also include surface
  and Model identity. Component internals remain owned by the providing package.
- Protocol version 9 adds model-bound custom fields and general component
  metadata to independent list reads alongside custom-element modules and
  retains exact decimal list semantics and the validated `field-help` screen
  event, and puts Model state and independent list snapshots in each screen.
  Wire business list bindings contain empty arrays; displayed values live
  exclusively in `screen.lists`. `ScreenLists` owns search/filter, stable typed
  sort, pagination, and displayed-to-source mappings for explicit and inferred
  lists. Views never reorder or truncate the source array. Mapping validation
  checks the exact source identity, row order/content, and view revision before
  applying a selection or edit. Stale views reject and publish a fresh snapshot;
  invalid dirty edits change neither business nor screen state.
- `screen.list` carries bounded page, query, or browser-measured capacity
  requests on the existing WebSocket. Queries reset only their list to page 1.
  Default queries remain inside the pending call; `triggerFilterEvents: true`
  resolves a typed `list-query` event after valid edits/metadata and the query
  are merged. Repeated queries, pages, capacity, and redraws emit no query
  event. Ordinary arrays retain local processing and exact counts.
  `pageSource: { more, searchOnly?, totalItems?, totalSourceItems? }` declares
  one server-supplied page with optional matching and unfiltered totals.
  Preserve its order and matching without re-slicing; query changes return
  `list-query` and page/capacity changes return `list-page`. `reloadLists`
  identifies every changed page source, including batched capacities. Programs
  reload from the retained page/query state before presenting again. Reject
  oversized pages and unavailable page numbers. Search-only sources hide and
  reject column queries. Field help uses the full query contract. Retain the
  unfiltered count or observed source-size lower bound in Model list state so
  filtered pages and reloads reserve the same body and footer space.
- Independent `screen.list` reads are exclusive of updates/edits and return
  `screen.list.data` on the same authenticated channel, bounded to 1,000 rows.
  `ScreenLists` reuses its filtered/sorted projection and validates source/view
  identity. Reads acknowledge their client sequence for reconnect/reload while
  preserving the pending call, UUI page, and dirty form values. Page sources can
  supply `callScreen({ listReaders })`, keyed by list ID; callbacks receive the
  retained query and bounded 500-row requests. Readers can return an exact
  matching total; otherwise the total stays unknown until the reader reaches the
  end. Field help exposes its provider's typed displayed columns.
- Capture scroll and toolbar metadata with existing interactions, including
  Back, paging, queries, and capacity. Never send standalone or periodic scroll
  updates. Browser-local positions survive redraw and surface/instance returns;
  reload needs only the last synchronized position. Persistence ends with the
  live Worker. A new Model starts at the top even on an existing surface.
- `ScreenElementState.data` is bounded component-owned JSON, available to every
  component. Custom contexts expose current state, control/value, and
  `setValue`; custom fields use ordinary schema validation, read-only checks,
  dirty edits, reactivity, and field geometry. Custom state captures run before
  interactions.
- Browser lists measure a bounded row capacity from page/modal and card
  geometry, including toolbar, headers, footer, and horizontal scrollbar. The
  first snapshot has one measurement row; there is no fixed 25-row default.
  Resizing and visibility/toolbar changes may remeasure; scrolling may not.
  Capacity changes keep the former first row within the new page when possible.
  Tab selection is element state, so measuring a revealed list retains its tab.
  Rows have a fixed height, nowrap ellipsis, and full values through a distinct,
  subtle ellipsis button. Clicking the value retains standard row selection even
  when every column overflows. Reserve body space from the unfiltered source
  total up to one page's capacity, including after reload; short pages and
  filtered results retain the card height and pagination position.
- List headers use full/short headings and semantic widths from schema and
  declarative `columnOptions`. Only genuinely wider columns overflow
  horizontally; fractional sizing and invisible heading measurements must not
  create scrollbars. Header popovers expose full headings, shared field
  descriptions, typed filters, sort, and clear actions; icons use the vendored
  `[[icon=...]]` registry. The rightmost List tools disclosure opens the search
  toolbar. Drafts, focus/caret, expansion, and horizontal scroll survive
  updates. The pagination footer is hidden for single-page and empty results;
  sources that fit on one page reserve no footer space. Clearing controls appear
  only for active queries. The
  [browser contract](services/shell/frontend/AGENTS.md) owns list control layout
  and confirmation behavior. Encapsulate browser lists and their data tools in
  `services/shell/frontend/components/list/`. The expanded toolbar includes
  icon-only Table processor, Export, Copy page, and Copy all actions with
  tooltips. A read-only spreadsheet dialog has a free positive integer page-size
  input, default 1000, followed by `(N total)` when known. Larger viewer pages
  accumulate bounded reads independently of UUI pagination. Export offers CSV,
  JSON, XML, YAML, XLSX, and ODS with an inclusive range. Copy writes
  spreadsheet-compatible text and HTML using displayed columns.
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
  restores it with `history.forward()` before invoking the same Back path. Never
  recreate it with pushState after traversal: Chromium can skip replacement
  entries during subsequent native Back actions. Reload adopts the existing
  guard instead of adding another. Program header controls and actions render
  from the screen snapshot between Back and the always-visible session
  disclosure. That disclosure combines one `8px` status circle, the
  authenticated username, and a Material `menu` icon in one button. Connected is
  green; connecting and reconnecting are red, while a visually hidden live label
  preserves the complete textual state. The username remains one line and
  ellipsizes at constrained widths. Its locally anchored, light-dismiss menu
  owns My account, labeled light/dark theme switching, and clean logout. Logout
  ends the persistent UUI session through the typed client protocol before
  redirecting through the configured logout route, with direct navigation as a
  disconnected-client fallback. The left brand/Back cluster and right session
  cluster use explicit grid positions, so hiding or emptying the dynamic middle
  never moves the right cluster away from the navbar's right edge. Page header
  controls remain in this global area; modal header controls render inside their
  own semantic native dialog. Program presentation dialogs and shell-owned
  dialogs such as Messages share the same `uui-dialog` frame, toolbar, body,
  close affordance, backdrop, responsive bounds, and scrolling design; their
  distinct ownership changes behavior, not appearance. Dialog focus is contained
  and restored, covered layers are inert, close and Escape route through
  `BACK_EVENT`, and responsive modal bodies scroll within bounded viewport
  dimensions. The navbar remains one row at every width. As the dynamic area
  shrinks, a measured stable prefix remains visible while items move from right
  to left into an accessible More disclosure without recreating their DOM
  controls. More sits immediately after the last visible dynamic control, or at
  the dynamic area's start when none remain; opening it stacks every hidden
  control vertically in original order and clamps the popover to a `10px`
  viewport edge gutter.
- The quick menu's reserved `ACCOUNT_EVENT` opens `the8020/users/my-account`
  directly through an ordinary page presentation. It shares field help's
  pending-call protection, retains the previous screen and draft, and restores
  it on Back. The users program resolves authenticated identity and owns
  profile/password behavior. This core-to-core call needs no hook, registry,
  kernel execution, or command-bus dispatch.
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
  The complete locally hosted Material Symbols font and its generated
  name/codepoint catalogue resolve every icon in the collection, including
  digit-leading names. Inline icons are `1.2em`, button icons are `1.5em`, and
  explicitly sized shell icons remain `20px`; icon glyphs fit their full boxes
  without cropping. Unrecognized names and invalid colors remain literal text.
  Shell-owned affordances use the same renderer; programs need no per-icon
  registration or external network request. `vendor_material_symbols.py` updates
  the pinned font, generated catalogue, and stylesheet reference together.
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
  their source-order position, leaving holes instead of backfilling. All fields
  use one exact row metric shared by sibling groups, including groups containing
  only default one-row controls: an `N`-row field consumes `N` standard label,
  control, and supporting-message row heights plus `N - 1` 20px row gaps,
  aligning its underline and reserved message slot with the `N`th ordinary
  field. Every field reserves the same supporting-message slot even when empty.
  Hints occupy exactly one ellipsized line in that slot; truncated hints open
  the complete text in a light-dismiss popover. The renderer and semantic
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
  and value styling. Editable controls receive the muted Material `edit` icon
  and read-only controls receive `chevron_right` in field-help buttons outside
  the Tab order at the exact field end. Read-only text values remain focusable
  and selectable; disabled native choices expose F1/F4 on their field wrapper.
  Textarea and radio buttons keep the same underline-relative bottom offset,
  while select chevrons and native input affordances remain immediately before
  the pencil. Password controls retain this shared layout while masking their
  current browser value; programs must start sensitive edit models empty and
  never redisplay stored values. Interactive hover feedback changes paint-only
  properties such as color, border, background, and shadow; it never transforms
  or repositions a pointer hitbox. Neutral elevation shadows are dark-tinted in
  light mode and black in dark mode; dark-mode surfaces never use text-derived
  light shadows. Theme state is browser-only: `sessionStorage` keeps the current
  UUI session override through redraw/reconnect/reload, while `localStorage`
  supplies the default for future tabs. Shell markup defaults to dark, and a
  CSP-nonced initializer in the head resolves the browser-only stored or
  operating-system preference before CSS and first paint; theme state never
  enters UUI messages, service requests, kernel APIs, or backend storage.
- List values, field hints, and column descriptions share the browser's
  `createOverflowText` component. Text stays selectable and keeps its ordinary
  click behavior; only the separate font-sized ellipsis opens full content.
  Buttons use transparent, borderless pencil styling with subtle hover fill;
  keyboard focus remains visible. Column descriptions come from shared Zod
  metadata, preview at most 100 characters and three lines between the heading
  and query controls, and disclose the full description through that button.
- `AnchoredPopover` owns native light dismissal, nested popovers, Escape focus
  return, viewport clamping, and resize/scroll positioning. Overflow popovers
  expand below and left from their right-edge button, flipping above only when
  needed, and scroll within 24rem and the viewport. Full content uses shared
  safe Markdown; hint and description previews use selectable plain text.
  Responsive measurement removes buttons and reserved space when content fits.
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
- Custom elements are generic wrappers for program-supplied browser modules and
  styles. UUI owns validation, lazy loading, stable wrappers, scoped screen
  actions, activity, and disposal. Programs own component code, dependencies,
  CSS, assets, and behavior. Never put a terminal or another program-specific
  implementation in the shell bundle or a framework initializer registry.
- Descriptors contain same-origin `module` URLs, optional `styles`, bounded JSON
  `config`, optional `preserve`, and optional component-owned `fallback`
  capabilities. Modules default-export the browser-only `custom_element.ts`
  mount contract. Styles finish loading before mount; asynchronous removal
  aborts the signal and disposes late instances. Preserved elements receive
  updates and presentation activity without DOM replacement.
- The prebuilt `codeEditor()` descriptor lives in the shell's standalone code
  editor folder and uses this same host as a model-bound field. Its CodeMirror
  dependencies and language chunks are vendored and loaded on demand. Local
  parser diagnostics never resolve external references. The terminated program
  uses read-only source excerpts with original line numbers and error markers.
- Custom-element hosts expose `renderText(target, text)` for the shared plain
  text/Material icon renderer. `uui-content-fullscreen` is a generic CSS hook
  for filling the content viewport; the shell measures `--uui-content-top` from
  its global bar and suppresses background scrolling while expanded. Components
  own their toggle, sizing, accessible labels, and cleanup on deactivation.
- `packageAssetURL(packageId, path)` addresses only that package's explicit
  `public/` directory through the authenticated shell. Real-path confinement
  rejects traversal and symlinks outside the publication directory. Programs
  build and version their own assets; UUI has no per-component registry.
- Shell builds are minified. Shell asset URLs carry their content hash; hashed
  package filenames must match the bytes. Assets use ETags, conditional 304
  responses, and immutable caching only for matching versions. The Deno
  supervisor owns automatic response compression; asset handlers return source
  bytes and never duplicate encoding negotiation or retain compressed variants.
  The per-Worker byte cache is bounded and invalidated by native file metadata.
- `THIRD_PARTY_NOTICES.md` records the MIT/BSD Markdown dependency notices and
  the Apache-2.0 license and pinned source for the local Material Symbols font.
  It also records the MIT Tabulator and Apache-2.0 SheetJS dependencies,
  vendored inside the list component and loaded only for its data tools. Program
  component dependency notices remain in their owning packages. The optional
  CodeMirror/Lezer editor dependency licenses are retained in the code editor's
  vendor folder and indexed in the root notices.
- Reload resume synchronizes the Worker-acknowledged client sequence before a
  new event is emitted, preventing post-reload actions from being mistaken for
  duplicates.
- `.generated/main.js` and its source map are build products from
  `services/shell/frontend/main.ts` and are never source-of-truth files. The
  package-local build script uses this repository's `deno.json`; it does not
  locate or invoke a kernel checkout.

# Work Guidance

- Keep the framework generic and application workflows in their providing
  packages. Reuse ordinary Zod schemas, UUI models, and presentation mechanisms;
  new components carry their own code, dependencies, and assets through generic
  hosting contracts.
- Keep UUI protocol and session behavior in this package, authentication policy
  in users, and native execution foundations in the kernel. A UUI feature alone
  does not justify a kernel change.
- Keep browser connection, UUI session, Worker, and sandbox lifetimes distinct.
  Bound retained presentation and transport state, and repair shared behavior at
  its owner with the existing browser or runtime verification for the affected
  flow.

- Keep standard layouts declarative and rendering local, semantic,
  keyboard-accessible, and responsive. Optional custom-element code and CSS
  belong to the providing package and load through the generic host contract.
- User-visible descriptions, hints, placeholders, notices, and empty-state copy
  must help the user act or understand a user-visible outcome. Never add copy
  solely to explain internal architecture, storage, persistence, sessions,
  transport, or implementation details; omit it entirely and keep those details
  in DOX or developer documentation. For example, never show
  `Value is stored per-session in the user storage.` or
  `The value is sent directly to kernel secret storage and is not shown again.`
  in the UI.

# Verification

- `deno task test:asset-delivery` checks the actual shell Worker, native Deno
  supervisor listener, and Go supervisor client together for encoding, cache,
  conditional-request, and HEAD behavior. See the shell service DOX for scope.
- `deno task test:connection-browser` uses the existing Chromium harness to
  cover the session manifest's login redirect after a rejected reconnect,
  redirects during initial establishment and session lookup, missing execution
  handling without recreation, terminal navigation without further connection
  attempts, and transient recovery with retained dirty values. Redirected error
  pages remain navigation outcomes.
- `deno task test:presentation-browser` covers page/modal restoration and exact
  field heights and underlines across desktop, tablet, and mobile widths,
  including default one-row textareas and explicit multiple-row controls.
- `deno task test:programs-browser` drives the actual Programs catalog and
  shared execution form through Chromium against deterministic kernel/job
  fixtures. It checks all-program visibility, metadata, preselection, input
  validation, retained inputs, captured job output, current-session UUI
  execution, Back, and mobile sizing. Job fixtures retain canonical execution
  references and serve bounded `logs.query` pages separately from run metadata;
  browser assertions verify rendered log messages and execution usernames. It
  also drives the real Users program against SQLite: account creation, password
  changes, full-name creation/editing, My account through the quick menu,
  password-mismatch clearing, authenticated self-targeting, password
  replacement, profile cancellation, and pending configuration drafts across My
  account, enable/disable, Advanced confirmation, user-filtered UUI sessions,
  and shared user-field record navigation at desktop/mobile widths.
  Program/package clickthrough covers the compact overview, Advanced, row/tag
  version selection, and a package credential opening the real empty secret
  editor through shared help. Package tests cover Home filtering and silent
  returns. The same fixture covers service settings/draft retention and Service
  → Sandbox → Worker navigation, with desktop and mobile inspection. It covers a
  selected session older than 200 unrelated rows, exact refresh, lazy Advanced
  message logs, sandbox clickthrough, and cancelling session termination.
  Database coverage includes compact/Advanced/field views, related tables, table
  help in SQL, executing the prepared SELECT, and row filtering with return
  navigation. Development coverage checks the combined settings group, SSH
  subtitle, reset confirmation, activation validation, related packages,
  retained draft messages, and console DOM preservation without starting a real
  sandbox.
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
  the suite must never depend on removed legacy command aliases. Browser input
  helpers wait for reactive field roundtrips before the next edit or action. The
  nodes share the signing key and users-package authentication database; CDP
  commands are bounded and the test injects a UUI-subprotocol-only socket handle
  to force a deterministic brief reconnect without altering package timing
  constants. Targeted service edits converge between nodes; invalid index
  publication preserves healthy fragments, and ordinary local package commands
  repair a boot with broken service defaults. Signed routes cover cross-node
  HTTP and browser WebSocket forwarding, case-insensitive platform headers,
  stripped forged internal metadata, unavailable-node failure without replay,
  and stale execution rejection. Forwarding checks release the original
  WebSocket before another request, respecting UUI's strict single-request
  concurrency, then resume the same browser execution. Kernel-restart recovery
  distinguishes the replacement live session from recoverable stale metadata and
  cleans the stale record through the package-owned sessions program. The suite
  then covers a real managed job's result and bounded persisted log view,
  including its execution username and canonical node/sandbox/Worker/context/job
  identities. It opens that job's real archived-sandbox screen and checks
  first/recent log pages with the original invocation and username after normal
  completed-job native cleanup. It also covers login/cookie sharing, persistent
  Canvas-rendered xterm Bash consoles in both a real development sandbox and an
  ordinary runtime sandbox, `xterm-256color`/`clear`, exact bottom-row fitting,
  visibly rendered mouse selection, confirmed source and factory reset controls
  with preserved source-reset identity and a fresh canonical sandbox identity
  after factory reset, development activation preview statistics,
  required-message validation, independent package commits, and clean overlay
  reset, per-session theme persistence and future-tab theme inheritance, dark
  and light reload initialization before first paint, responsive two/four-group
  layouts, semantic field lengths, reserved hinted/unhinted supporting-message
  alignment, accessible full-hint popovers, and source-ordered multi-row field
  placement including its message slot at desktop/tablet/mobile widths,
  persistent standard Back navigation, header action/control rendering, one-row
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
  include service/log diagnostics; fresh-node bootstrap allows two minutes for
  table evaluation and ordinary per-package index jobs. Enabled `IDLE` services
  are accepted before first-request lazy provisioning, staged rootfs fixtures
  dereference symlinks only through a component-wise resolver contained by the
  source root, and process cleanup is time-bounded.
- The native browser harness accepts `--fixture=<module>` to run a package's
  default-exported scenario after its normal node setup and real login. The
  `NativeBrowserFixtureContext` supplies the browser, disposable node
  references, ordinary administrative commands for each node (`admin` and
  `otherAdmin`), bounded `restartNodes` for startup-only node configuration, and
  shared interaction helpers. The default UUI scenario remains the default;
  fixture runs share exception checks and bounded teardown and add no
  application behavior to the runtime.
- `--fixture=./agent_native_fixture.ts` verifies the real sandbox CLI, code
  editor fallback, direct value help, browser takeover/automatic return, exact
  Worker retention, cross-node routing, and local allowance
  rejection/revocation.
- `presentation_browser_e2e.ts` is the focused presentation-stack browser
  harness. It serves the built shell, connects it to the real UUI session engine
  over a local WebSocket, and verifies page/modal stacking, exact hidden layer
  and custom-element preservation, dirty `ScreenChannel` redraws, Escape/Back
  routing, reload of a later page plus modal, and restoration of the earlier
  page-plus-modal continuation. It also exercises pencil/Chevron Right/F1/F4
  field help drafts, invalid Close cancellation, Done-only commits, Markdown,
  bounded search and standard pagination over 2,001 choices, related-record
  navigation, and desktop/mobile sizing. Interaction helpers wait for the
  shell's in-flight gate to release before clicking. Run it with
  `deno task test:presentation-browser`; it is not part of the ordinary
  unit-test glob. Pass `--browser=/path/to/chromium` when Chromium is not at the
  default path. `--field-help` focuses on field help, all local icon glyphs,
  Chevron Right sizing, and editing after an identical retained snapshot.
- The Programs browser suite checks the development conflict screen with the
  existing code editor, Git line annotations, saved text, file deletion, and
  activation continuation. Its kernel replies are deterministic doubles; the
  development native fixture verifies the adapter against real Git state.
  Keyboard checks cover Tab exclusions, F2 clicks, F3 dialog/page Back, and
  Shift+F2/Shift+F3 editable-control looping and relative focus in the active
  surface. `--programs --runtime` focuses the program suite through service
  configuration and Sandbox/Worker navigation.
- The presentation harness accepts `--fixture=<module>` for package-owned
  browser checks. The module's default factory receives the temporary root and
  returns `run`, `serve`, `verify`, and `close`; `verify` receives the browser
  and a function to open another tab. Fixtures own their optional assets,
  protocol endpoints, and teardown. This test extension adds no
  component-specific behavior to the UUI frontend or production services.
- `download_browser_e2e.ts` connects the real session service and built shell
  over a local WebSocket and checks browser context before the first screen.
  `deno task test:download-browser` verifies concurrent native Chromium
  downloads, partial disk writes before production completes, byte-exact
  results, interactive screens, producer errors, native cancellation, generator
  cleanup, reconnect without download replay, and zero backend file requests.
  `downloads_test.ts` covers shared flow-control bounds, large source chunks,
  async context, completion, cancellation, and protocol validation.
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
  toolbar copy/export and spreadsheet selection/paging, real downloaded files,
  shared semantic field headings, focus/caret, empty counts, local/synchronized
  scroll, reload/reconnect, capacities, fractional widths, long-heading
  containment, inline query confirmation, conditional toolbar actions, stable
  card/footer geometry on short or filtered pages and reload, and same-surface
  plus nested page/modal returns, including rows with every column truncated.

- `deno task test:native-back-browser` uses headed Chromium under Xvfb and
  xdotool's native Alt+Left shortcut. It covers consecutive page/modal returns,
  reload in the middle, repeated home Back, and unchanged history entry IDs.
  Read assertions disable CDP userGesture so they cannot mask Chromium's history
  manipulation intervention. Xvfb and xdotool are test-only dependencies.

- `deno task test:keyboard-browser` runs the focused keyboard fixture through
  the real browser/session boundary, including explicit and inferred list
  shortcuts; the Programs browser suite waits for the WHERE input's interaction
  gate before verifying Enter through the existing database row-browser action.
