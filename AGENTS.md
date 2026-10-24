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

- Administration provides System customization for the server title, favicon,
  and social preview. Defaults are `80|20`, the square yellow `80` icon, and the
  branded social image. Center-crop uploads with minimal removal and convert to
  optimized output formats; custom images live in the database, defaults in the
  shell package. Browser titles combine the saved server title and screen title.

- Group Back, Exit, and New beside the brand as one gapless segmented control.
  Exit terminates the current session and returns to the entry screen, retaining
  authentication. New opens the base UUI URL with target blank.

When the user requests a durable behavior change, record it here or in the
relevant child AGENTS.md

- Customization opens from the hamburger menu as an ordinary UUI page and owns
  user preferences. Accent color applies on Save in light and dark themes;
  purple remains the built-in default. Nullable preference columns store only
  personal overrides, inheriting the empty-username row and then built-ins.

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
- Closed browser connections persist `DISCONNECTED`; sessions end after one hour
  without an active client. Metadata writes and disconnect expiry run in the
  session's establishment context, independent of a closed socket's aborted
  request context.
- Prefer ordinary JSON request/response commands for sandbox agents, with
  temporary client attachment and the existing persistent execution retained
  after the request. Build on standard services, signed reconnection routes, and
  registered Worker functions; UUI remains an ordinary persistent service.
- Keep normal browser URLs free of session IDs. A new tab starts its own
  session; per-tab storage reconnects that session on reload. Use a session
  query only for deliberately targeted links. Ended sessions offer Reload page;
  displaced sessions offer Take control.
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
  terminated, customization, user cleanup, and session administration programs.
- [events/AGENTS.md](events/AGENTS.md): Subscribe to account deletion for UUI
  preference cleanup.
- [jobs/AGENTS.md](jobs/AGENTS.md): Schedule hourly obsolete-session cleanup.
- [services/AGENTS.md](services/AGENTS.md): Declare and expose the login, shell,
  and persistent session services.
- [src/AGENTS.md](src/AGENTS.md): Own shared preference/session/short-dump
  fields, short-dump shaping, and focused standard-program tests.
- [tables/AGENTS.md](tables/AGENTS.md): Own user preference overrides and
  bounded persistent metadata for UUI application sessions.

# Purpose

- Provide the first-party 80|20 Unified User Interface services and standard
  session programs.
- This file is the root contract of the independent `the8020/uui` Git
  repository.

# Ownership

- `widgets/` declares this package's Home tiles and categories through the
  `the8020/packages/widgets.ts` format; the Sessions tile is visible with
  `the8020.uui.session.view`.
- Own the public login service, authenticated browser shell, authenticated
  persistent UUI service, Home and Program terminated programs, browser
  protocol/configuration, session metadata and administration, source/build,
  package-local layouts, generic program-supplied custom elements and public
  asset delivery, shared Markdown rendering, and the shell message center.
- Do not own authentication storage/validation, cookie construction, sandbox
  placement, physical WebSockets, or kernel routing.

# Local Contracts

- List-specific controls and actions belong in that list's `toolbar`, including
  creation, selection operations, refresh, and backend paging. Screen navigation
  and form-wide Save/Cancel stay in the page header. Every list reserves the
  shared navbar-height toolbar row, even when empty; controls keep one line and
  overflow into the same ordered three-dot disclosure as page headers.

- UUI `0.8.2` and demo `0.8.0` are the paired managed-channel releases for the
  kernel `0.8` line. Package tags use bare semantic versions; package manifests
  and runtime `/p/` imports remain unversioned.

- `session.exit` uses ordinary session termination and redirects to the
  configured post-login entry URL without signing out.

- `preferences.ts` exposes `fetchUserPreferences(username?)`, resolving each
  nullable field from the named user, the empty-username default, and built-ins.
  Omitted username uses the authenticated identity. `saveUserPreferences` writes
  only that identity's overrides; null or matching the current default removes
  the override. With only accent color, an all-default personal row is deleted.
  `tables/user_preferences.ts` owns storage; `users.deleted` asynchronously
  deletes only the named user's row and preserves the system default.
- The shell reads effective preferences through authenticated, uncached
  `GET /preferences` on each presentation update. The most recent bounded
  request owns application; no polling or browser preference persistence is
  added. Theme switching immediately reapplies the last accent. Read failures go
  to `console.error` and preserve the current accent.
- The reserved `CUSTOMIZATION_EVENT` opens `the8020/uui/customization` through
  the same protected page path as My account, retaining the pending caller and
  draft. Back discards unsaved preferences. Use system default changes the
  draft; Save commits it. The reusable `color` control uses native HTML color
  input, ordinary string binding, schema validation, help, and disabled
  read-only input.

- Deployed service identity and canonical paths derive from
  `packages/the8020/uui`; login, shell, and session are ordinary default-enabled
  services.
- `the8020/uui/home` and `the8020/uui/program-terminated` are hidden ordinary
  programs selected by package-local `ui-config.json`. Home keeps its catalog
  for the session and rebuilds it on Refresh, batching fresh permission checks
  on each render; Program terminated defensively presents bounded exception,
  stack, source context, and copyable dump data.
- `program.toml` declares `uui` as an optional boolean defaulting to false. Home
  includes only programs with `uui = true` and `discoverable = true`, and
  returns silently after invocation. Discovery logs and skips an invalid
  manifest, so one package cannot stop Home. Hidden helpers retain their UUI
  flag. The program loader uses the shared `the8020/packages/programs.ts`
  manifest reader, which validates application metadata and duplicate keys. UUI
  owns Home filtering and invokes default exports with positional arguments.
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
- The first browser attachment after headless actions is a resume: send the
  current client-sequence watermark before the current presentation. Do not
  replay stale screens as a new sequence-zero browser session.
- The shell resolves a session ID to its stored placement, checks its owner,
  invokes `uui.session.control`, and signs a route using
  `kernel.services.route`. Claims close the previous socket before ordinary
  concurrency-one admission. The session keeps at most 16 client IDs in takeover
  order; waiting clients refresh their presence through stateless polling and
  expire after two minutes. Release/disconnect promotes the previous client;
  polling never resets the disconnect grace. New sessions also start this grace
  before their first client.
- Browser sessions normally use per-tab storage; explicit `?session=uis-...`
  links override it. A missing execution remains unavailable until the user
  chooses Reload page to start a new session. Only the owner can attach today;
  ownership checks are separate from client IDs and tickets. `openSession()`
  asks the browser to navigate through this same shell path with an explicit ID.
- The handler atomically maintains one row per live session in
  `the8020__uui__sessions`, containing exact execution placement, authenticated
  user identity, lifecycle timestamps/state, latest kernel-observed client IP
  address and network scope, and bounded current-screen metadata. Reconnection
  replaces the address fields with the latest observation. It never stores
  passwords, cookies, route tokens, replay buffers, or unbounded messages. Clean
  termination removes the record before signaling generic persistent completion;
  abnormal loss may leave recoverable stale metadata.
- `jobs/cleanup-sessions.toml` schedules `the8020/uui/sessions-cleanup` hourly
  through the jobs package, once per system by default. Root
  `session_cleanup.ts` pages metadata older than the disconnect grace in 100-row
  keyset batches with a four-minute scan budget. It removes only exact targets
  reported missing, conditionally on unchanged placement and timestamp. Live
  idle sessions and ambiguous failures remain; age alone is never proof of
  disconnection. Counts and scan completion are retained in ordinary job
  results. Normal live disconnect expiry stays in the session Worker.
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
- Login and shell each keep one Worker warm by default; session retains zero
  minimum Workers. All three declare zero additional minimum sandboxes. Login
  and shell share sandbox group `uui`, permit 128 Workers at 64 per sandbox, use
  concurrency 16, target 70% utilization, and retain idle Workers for two
  minutes. The session service also uses group `uui`, has an unbounded zero
  maximum, keeps 64 Workers per sandbox, uses canonical `session` lifecycle with
  concurrency one and 100% target utilization, and retains an inactive session
  environment for one hour. These are worker/sandbox policies, not legacy
  instance reservations.
- Initial program output may precede the physical WebSocket. The service replays
  that retained output in server-sequence order before `session.ready`, so the
  shell always receives the first presentation instead of remaining on its
  opening placeholder.
- `messages.ts` owns validated bounded semantic MessageHistory, shared by the
  session engine and authenticated service/headless adapter. `sendMessage`
  accepts synchronous program outcomes before/between calls as domain state; the
  next explicit presentation carries it, with no detached operation
  backlog/rebinding. Live append/history/refresh use the ordinary registered
  message-center namespace of each call, including built-in calls with managed
  ScreenChannels. `captureMessages()` captures trusted async context and the
  current screen and connection before asynchronous work;
  stale/cancelled/covered output rejects before history mutation.
  Download/provider error callbacks use captures. Four semantic kinds and
  nonempty Markdown up to 20,000 characters remain. Keep 100 accepted records
  and ten recent headless messages at this one owner. Accepted interactions
  clear preceding outcomes, preserving records accepted during asynchronous
  work. Browser initialization/reload restores history without old toasts;
  replacement/reconnect deduplicates by monotonic record identity. Namespace
  history refresh is state transfer, never operation replay, draft commit or
  request-gate release. Arbitrary background work must retain a captured output
  rather than rediscover an ambient future call.
- Programs call `download(options, channel.downloads)` only under an explicit
  pending managed ScreenChannel attachment. The captured endpoint owns its
  screen and connection; detached/old starts fail before source demand. Prepare
  options between screens, create the next pending call explicitly, then start
  there. Settlement/replacement, reset/removal/disposal, coverage, exit/failure
  and disconnect/takeover cancel unfinished streams, without replay or
  buffering. Background producers retain their initiating trusted context;
  abort-ignoring awaits may continue internally while late framework output is
  dropped.
- `downloads.ts` is a native-save domain helper calling the shared stream core;
  `download_metadata.ts` owns filename/content-type validation and native bounds
  (64 KiB frames, 64 MiB source chunks, 32 active transfers, four per-stream, 16
  per-direction and 32 aggregate frames, 30-second startup). Filename errors and
  source/sink failures remain attributable through the message center. Browser
  `downloads.ts` and `download-worker.js` own local MessagePort
  registration/forget, one-use native response, consumption acknowledgement and
  a bounded completed iframe tail. No backend file-byte request is made. Source
  EOF, accepted native handoff and browser/disk completion are distinct; `done`
  attests only to response consumption/handoff. Completed output is not
  truncated by later screen replacement. See README for browser support limits.
- Fresh browser navigation without an explicit session link performs normal
  `POST /connect`, reads `the8020-session` and `the8020-route`, and remembers
  the ID in per-tab `sessionStorage` for reload without adding a URL parameter.
  Fresh navigation ignores stored IDs, including storage copied from an opener;
  a login redirect therefore cannot resume an earlier user's or instance's work.
  Existing session references resolve through the stateless shell control
  endpoint. It opens/reconnects the standard `the8020.uui.v1` WebSocket using
  the signed token as the `route` query parameter and a current client/control
  ticket. Lost executions require starting a new session explicitly. Transient
  establishment failures stay inside the bounded reconnect loop rather than
  escaping as unhandled browser errors. HTTP redirects from establishment or
  recovery end reconnecting, clear the stored route, and navigate to the
  response URL before interpreting status or route headers. Browser WebSocket
  handshakes hide redirects, so failed upgrades use this same HTTP path. The
  session manifest declares the login redirect through ordinary service access
  policy; the browser never guesses an authentication destination from a close
  code or 401.
- Programs obtain the current authenticated identity on demand through
  `currentUser()` from `/p/the8020/users/mod.ts` instead of receiving identity
  or infrastructure dependencies through their function parameters.
- Programs are plain default-exported functions with ordinary TypeScript call
  stacks, classes, and closures; there is no program wrapper or decorator.
  `callScreen()` remains presentation-neutral and defaults to the root page.
  `presentModal(() => program())` and `presentPage(() => program())` alone push
  presentation surfaces, and an async-safe ambient context makes direct calls
  and awaited descendants inherit their caller's surface.
- `confirm.ts` owns confirmations:
  `confirmAction({ id?, title, message?,
  confirm, kind?, cancel? })` presents
  a modal with a short title, the consequence as Markdown body text, one
  confirming header action (`confirm`, `danger` by default) and an optional
  cancel; it resolves true only for `confirm`, closing cancels. Its screen class
  `CONFIRM_CLASS` (`uui-confirm`) makes the shell render a narrow dialog with a
  body-size title and text, from one stylesheet rule. Programs use it for every
  yes/no question; dialogs that confirm with extra fields set
  `class: CONFIRM_CLASS` themselves.
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
- `currentScreenChannel()` and `nextScreenChannel()` are read-only getters for
  the existing async presentation surface. Next exists before the first call;
  current is undefined until presentation. Plain `callScreen(options)` promotes
  its exact captured next only after preparation finishes and that call's
  snapshot is successfully published, then creates a fresh next. A prepared
  hidden call stays next until its first visible publication on restoration.
  Current retains its disposed reference after settlement until the next
  successful call. Redraw, reset, reconnect and restoration of already-presented
  calls do not rotate logical ownership. ScreenChannel is exported only as a
  type; callScreen has no channel option or author-facing preparation wrapper.
- Captured ScreenChannels control their one call: coalesced redraw, honest
  framework-originated exit and failure. Settled controls drop; sends and
  subscriptions reject. Covered redraws update the cached snapshot. Failed
  validation/preparation/presentation before promotion disposes the candidate
  and supplies a fresh next without replacing current. Recreate candidate
  components before retrying. Same-surface concurrent rejection leaves the pair
  unchanged; late failed preparation cannot overwrite a successor.
- Each `new Channel()` acquires next internally and belongs to that logical
  screen. Its declaration reference preserves existing per-instance namespaces.
  Screen settlement disposes all owning logical bindings, including unrendered
  ones. Channel.dispose() explicitly abandons pending components; unsubscribe()
  abandons one subscription. Their signals let setup timers/resources stop
  without GC/finalizers. Surface/session closure clears current and pending
  next.
- `channel.ts` owns the sole browser-safe ChannelRouter on the existing
  authenticated socket. Applications use send(ID, data) and subscribe(pattern,
  handler), returning a canonical ChannelSubscription with readonly id/original
  handler and idempotent unsubscribe(). ChannelBindings shares logical retention
  and physical reattachment across backend Channels and browser hosts; router
  storage and dispatch use that same object. Only * is special in full-ID
  matching (zero or more characters including dots); other text is literal.
  Ordinary messages and stream-open use the same matcher. No required method
  schemas, operation maps, peer declarations or generic RPC layer remain. Data
  is JSON or a byte stream through that same subscription; application
  validation and business policy belong to the consumer. Ordinary messages fan
  out; handler failures are isolated; no listeners means drop, never
  buffering/replay.
- Every callScreen attaches its managed next ScreenChannel; browser
  component/program channels are always available while live. Unconsumed
  ordinary messages drop and streams cancel before source demand. ScreenChannel
  implements program send/subscribe directly. Custom declarations and
  custom-field options attach a Channel reference, removed from wire data. UUI
  generates separate opaque component/list/program routing identities and
  publishes only owning descriptor references, with no catalog, grants or
  component-kind router. Authors never repeat element IDs as channel namespaces.
  Shared declaration cloning preserves live references through body/header,
  layout and list-toolbar placements; wire descriptors omit them. Field
  presentation metadata uses weak schema keys and retains channel references
  separately from serializable cloned presentation options.
- Every callScreen/reset generation owns its registrations, in-flight subscriber
  work and streams. Settlement/removal/exit/failure disposes them. Backend
  Channels reattach within the same logical call after reset; retained browser
  hosts reattach through their owning descriptor without replay. Coverage aborts
  in-flight work and rejects admission. Backend handlers retain initiating
  trusted async context; old handlers cannot send or subscribe into a later
  logical screen. Browser views retain their acquired generation and connection;
  acquire at the start of new work, retain across awaits. Preserved
  subscriptions reacquire their owner for each new invocation, never retarget
  saved output views. Unsubscribe aborts its work and cancels streams it
  consumes. Browser stream sends inherit the host lifetime, including sends
  through its program channel, so same-call remount/disposal cancels the removed
  host's transfers.
- Transient frame admission retains current session/controller/socket checks,
  transport JSON/size validation, per-side sequence and screen/connection
  generations. Disconnect/takeover aborts work; a pending call may reconnect.
  Replay exhaustion tracks retained output eviction, never transient sequence
  gaps. Lists alone own the token/result/cancel messages their actual exchanges
  require; no transport RPC catalog or common request correlation is added.
  Headless list transactions share the domain validation and connection abort
  signal. Matching list results/errors or valid presentations release the shell
  gate; ordinary messages, streams and acknowledgements do not.
- Message-center append/history/refresh are generic ID/data subscribers. Native
  saves send validated filename/content-type metadata, then stream data under
  their domain transfer ID; completion/admission failure forgets staged
  metadata. Lists/providers/field help keep their own schemas, atomic edits, and
  read limits. Independent PTY/service authority remains in its owning package.
- `channel_streams.ts` retains the sole binary codec, lazy producer pump and
  consumption-credit accounting. Generic streams need exactly one matching
  subscriber, which consumes EOF and resolves only after consumption/handoff.
  Missing or ambiguous consumers reject before source demand; failure/cancel
  affects only the transfer. Ordinary data may fan out. No tee, replay or
  listener backlog. Transport defaults are four frames per stream, 64 KiB frames
  and 64 MiB source chunks; there is no central application quota/fairness
  scheduler. Stream-open advertises the sender window; receiver credit respects
  both peers. Optional owner policies preserve source/active/direction/aggregate
  bounds and startup deadlines for domains such as downloads. Known errors
  cancel only their transfer; unsafe framing/session/size remains rejected at
  session_service.
- Runtime-loaded package modules address shared package APIs through the generic
  `/p/` mount alias. The package does not depend on a UUI-specific runtime
  import-map entry that the generic image would have to know.
- `deno.json` owns package dependencies, compiler settings, and tasks. The
  shared 80|20 Deno workspace supplies platform imports for checks and browser
  builds.
- Layouts and future overrides are serializable data without executable code;
  user-specific layout variants are not persisted in this phase.
- Every component descriptor accepts optional string `class` and `style`:
  controls (including inferred lists and custom fields), actions, separators,
  layout regions (including explicit lists and field groups), and custom hosts.
  `field()` metadata supplies defaults; control declarations may override them.
  `callScreen` itself applies them to the screen article. Classes add to the
  component root's existing classes; style contains native inline CSS
  declarations, such as `border: 1px solid red;`. Header and toolbar elements
  use the same contract. Changes do not affect element identity; omitted or
  empty values clear previous authored styling on redraw, including preserved
  hosts.
- List options accept `toolbar: ScreenElementDeclaration[]`, rendered above the
  list independently of the collapsible List tools. The same ordered element
  arrays are available as `header.elements` and layout-node `elements`. Entries
  are ordinary control declarations (`bind`), action declarations (`label`), or
  `{ type: "separator", id? }` flexible gaps. Screen construction resolves all
  inline controls/actions through the normal schema, identity, shortcut, help,
  custom-host, and event contracts; toolbar fields bind the screen model.
- Lists opt into checkbox selection with `selection: "row.boolean.path"` on
  explicit layout lists or inferred control list options. The first column edits
  that boolean, independently of the ordinary row navigation action. The header
  selects/clears every source row, including other pages and filtered-out rows.
  Shift and pointer-drag ranges use the current filtered/sorted order across
  pages. Selection uses validated source mappings and commits atomically with
  dirty controls without resolving the pending call. An explicitly declared
  editable selection boolean remains available on a read-only collection; other
  row edits still respect collection and field read-only rules. Source arrays
  stay ordered. The footer shows selected/source totals even for a single or
  empty page. Headless `list` commands accept
  `selection: { selected, range?: { from, to } }` through the same validation
  path; transcripts show selected row flags and totals. Selection requires the
  complete bound array and an editable boolean row field; registered paged
  sources cannot supply whole-table row-model updates and reject this option.
- Paged sources keep a selection by key instead:
  `setListSource(model, id,
  source, { selection })` with `ListSourceSelection`
  (`mode`, `isSelected`, `count`, `set`, optional `matching` and `allSelected`).
  Snapshot rows carry `__uuiSelected`, and `selection` reports `mode` and
  `allSelected`. `multiple` shows checkboxes; a row click or its checkbox
  toggles that row, and the header selects or clears every row `matching`
  returns for the current query (it may refuse, e.g. above a limit). Rows are
  read while preparing the list transaction and the owner's `set` applies on
  commit. `single` shows no checkboxes and highlights the selected row. Row
  events with `eventType: "activate"` (double-click, or Enter on a highlighted
  list) choose decisively; a single click waits 250 ms so a double-click is not
  also a select. `focusSearch: true` opens List tools on first display and gives
  a new modal's first focus to its search.
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
- The shell window title combines the configured server title (default `80|20`)
  and normalized heading text from the active page or modal. Without a
  presentation it shows only the server title. Branding refreshes with ordinary
  presentation preference reads.
- `branding.ts` owns the singleton title and custom image overrides, guarded on
  writes by `the8020.uui.branding.edit`. System customization is an
  Administration tile separate from personal Customization. The shell serves
  fixed PNG/JPEG files from the database or disk defaults, also exposed through
  public login routes so Open Graph and Twitter previews work before
  authentication.
- Sending any `screen.event` or structured request enters one shell-owned
  in-flight interaction state for the top surface. It immediately makes
  presentation and applicable header controls inert, disables Back, rejects
  additional event sends in JavaScript, and activates a transparent page- or
  modal-local pointer shield. If still pending after `500ms`, the same state
  reveals a blurred overlay and loading indicator. An early `server.ack` does
  not unlock stale content; an atomic presentation with an active surface, a
  session error/resync, session end, or a matching structured response releases
  it. Independent reads leave dirty values pending and reject on disconnect.
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
  drafts. On every screen, Back (Close, Escape) applies the edits it carries
  when they are valid and otherwise discards them; it is never refused for an
  invalid draft. Empty separated tags send no value rather than `""`. A cleared
  input (`""`) of an optional field is stored as no value. Validation problems
  are reported through `describeError(error, schema?, bind?)` (`errors.ts`,
  exported from `mod.ts`): the field's label and a plain message, with "Enter a
  value." for empty or missing required values; programs use it instead of
  showing raw Zod messages. Show Done only in edit mode, followed by Navigate
  when semantic `open(value)` exists. Navigate opens a related page without
  committing and restores help on return. Markdown descriptions appear in full.
  `fieldHelp: false` suppresses help. Field help shows a Value help card below
  the value when the field has a provider or ordinary control options. Its list
  opens with search visible and focused (`focusSearch`), and its value's field
  group is a layout `summary`: once it scrolls away, the dialog shows a compact
  bar under its toolbar (outside the scrolling body) with the label, the value
  or tags (removable there, at most three lines, then `+N more`, which scrolls
  back to the field) and a search mirroring the list's. One value: the current
  value's row is highlighted, a click selects it into the draft, and a
  double-click or Enter selects it and finishes like Done. Several values
  (arrays of scalars, or text declaring `multiple`): rows have checkboxes kept
  by key across pages and searches; the header selects every match within the
  on-screen limit (`SELECT_ALL_LIMITS`, default 500, read in pages of 500) or
  refuses above it; values not offered by help, such as ranges, stay as written;
  the schema's array maximum refuses more; selection order is kept; there is no
  double-click finish, only Done. Read-only fields retain lookup and navigation,
  but choices never edit their bound value.
- Fields holding several values default to the `tags` control: separated text,
  and arrays whose element has value help or enum options (other scalar arrays
  stay lists unless `control: "tags"`). `FieldDescriptor.multiple` carries the
  separator, escape characters and array maximum. Tags show each value with a
  remove button; typing adds values on Enter or the separator (typed text keeps
  the field's grammar), Backspace on an empty input removes the last, and the
  edit pencil opens field help. Values in grammar (ranges, exclusions) show as
  outlined expressions. Identifier screens retain their semantic `open`
  callbacks. `valueHelp({ query, offset, limit })` receives the complete
  ordinary list query and fetches a page bounded by measured capacity (1–500).
  Providers return a Zod row schema, at most `limit` rows, `more`, and optional
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
  edits at the session boundary.
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
- Protocol version 12 carries generic ID/data channel frames and internally
  assigned component routing within each screen generation; it retains
  model-bound custom fields, component metadata, exact decimal semantics and
  field help. Model state and list snapshots remain screen-owned. Wire business
  list bindings contain empty arrays; displayed values live exclusively in
  `screen.lists`. `ScreenLists` owns search/filter, stable typed sort,
  pagination, and displayed-to-source mappings for explicit and inferred lists.
  Views never reorder or truncate the source array. The pending call retains
  displayed-to-source mappings for selections, edits and reads. Do not compare
  list revisions, source identity, row order or contents before accepting input.
  Invalid dirty edits change neither business nor screen state.
- The list-owned `update` namespace operation carries validated page, query,
  capacity, refresh and checkbox changes. Browser and authenticated headless
  commands invoke the same registered owner with current surface/Model
  admission. Multi-list capacity updates stage and validate all edits/provider
  results before committing one transaction. Invalid, read-only or malformed
  input changes neither business nor presentation state. Dirty row edits retain
  exact source mappings and read-only schema fields.
- Bound arrays use local typed/decimal projection.
  `setListSource(model, id,
  source, { searchOnly? })` retains a
  program-selected async source and returns a disposer. Providers receive query,
  offset, 1–500-row limit and AbortSignal; return rows, more and optional
  matching/unfiltered totals. ScreenLists owns initial loading, visible refresh,
  result state while callScreen stays pending. Redraw refreshes providers, and
  covered redraws refresh on restoration. Provider ordering is preserved;
  source-size lower bounds retain geometry when totals are unknown. Known source
  shrinkage clamps the page and loads its current rows. Source
  replacement/disposal cancels its outstanding work.
- Provider page rows belong to each list ID, never to the shared business array
  binding. Separate provider and array views may share a binding without
  replacing each other's data. Provider row edits reject the whole transaction
  before data or list-state commit because the source contract has no writeback;
  ordinary array row edits and other dirty controls retain atomic validation.
- Row schema/columns are fixed for a call. Providers returning a changed schema
  are rejected; a genuine contract change requires a new explicit callScreen.
  `triggerFilterEvents: true` remains a deliberate changed-query program event
  after valid edits/state merge; repeat query/page/capacity/refresh emits none.
- Independent `read` uses the same namespace, fixed row-schema validation and
  range validation without changing visible page or drafts. Results are bounded
  to 1,000 rows and 900,000 JSON bytes, in at most 500-row batches. Provider
  replacement/disposal, reset, settlement/removal, coverage and connection loss
  cancel owning work and drop late output. Unabortable queries may continue
  internally; remote consistency remains source-owned. Field help retains typed
  columns, first-column selection, isolated drafts and Done-only commits without
  ordinary browsing screen reissue.
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
  first snapshot has one measurement row; there is no fixed 25-row default. A
  browser-remembered `Rows per page` choice in the expanded toolbar may replace
  measured capacity with 25, 50, 100, or 200 rows. Resizing and
  visibility/toolbar changes may remeasure; scrolling may not. Capacity changes
  keep the former first row within the new page when possible. Tab selection is
  element state, so measuring a revealed list retains its tab. Rows have a fixed
  height, nowrap ellipsis, and full values through a distinct, subtle ellipsis
  button. Clicking the value retains standard row selection even when every
  column overflows. Reserve body space from the unfiltered source total up to
  one page's capacity, including after reload; short pages and filtered results
  retain the card height and pagination position.
- List headers use full/short headings and semantic widths from schema and
  declarative `columnOptions`. Only genuinely wider columns overflow
  horizontally; fractional sizing and invisible heading measurements must not
  create scrollbars. Header popovers expose full headings, shared field
  descriptions, typed filters, sort, and clear actions; icons use the vendored
  `[[icon=...]]` registry. The rightmost List tools disclosure opens the search
  toolbar. Drafts, focus/caret, expansion, and horizontal scroll survive
  updates. The pagination footer is hidden for single-page and empty results
  without selection; sources that fit on one page reserve no footer space.
  Clearing controls appear only for active queries. The
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
  owns My account, Customization, labeled light/dark theme switching, and clean
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
- The quick menu's reserved `ACCOUNT_EVENT` opens `the8020/users/my-account`
  directly through an ordinary page presentation. It shares field help's
  pending-call protection, retains the previous screen and draft, and restores
  it on Back. The users program resolves authenticated identity and owns
  profile/password behavior. This core-to-core call needs no hook, registry,
  kernel execution, or command-bus dispatch.
- The session disclosure menu owns a Messages action whose badge counts all
  messages received since the current screen interaction began. A new
  `screen.event`, list update, or route begins a fresh collection. At most the
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
  honors `short`, `medium`, `long`, and `full` field lengths via container
  breakpoints, preserves source order, distributes unused row width in canonical
  grid units, and restricts long and medium field starts to half-row and
  quarter-row boundaries respectively. `full` reserves the entire enclosing
  field grid width at every breakpoint, including for custom fields and control
  overrides. List columns infer `long` from a `full` field unless column options
  override it. Bounded field row spans reserve their complete grid rectangle at
  every breakpoint; later fields use only legal space at or after their
  source-order position, leaving holes instead of backfilling. All fields use
  one exact row metric shared by sibling groups, including groups containing
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
  light shadows. Custom accents derive readable theme shades and contrasting
  primary-control text; built-in purple retains its existing theme tokens.
  Light/dark theme state is browser-only: `sessionStorage` keeps the current UUI
  session override through redraw/reconnect/reload, while `localStorage`
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
- `fileUpload()` supplies a bounded transient receiver and a standalone native
  file picker through the same custom-field and binary Channel contracts. Only
  filenames enter Models; programs consume completed bytes after a screen action
  and validate their formats. File fields suppress text-value help.
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

- Build only what the request and established contracts require. Before adding a
  mechanism, identify that need and why existing owners or standard tools cannot
  meet it. Do not invent stronger guarantees for hypothetical cases. Remove
  unsupported additions at closeout; agent-written tests and DOX do not
  authorize them. Preserve required correctness, security, and data integrity.

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

- Authored declaration cloning preserves live Channel references, including
  inline layout elements and list toolbars. Layout normalization reuses
  canonical resolved elements so every placement receives the same
  lifecycle-owned routing identity.

## UI Rules

- Use the existing message-center notifications for user-facing outcomes and
  validation failures. Do not render warning/error banners. Frontend diagnostics
  use `console.error`. Resynchronization requests a fresh snapshot directly.
- Do not add explanatory helper copy that restates what the control already
  implies (e.g. "optional", "works without selection", "failure falls back to
  X"). Prefer clear labels and option text; surface status in results when
  needed, not as instructional paragraphs under every field.
- Keep UI copy concise. Avoid tutorial-style descriptions unless the user
  explicitly asks for onboarding help.

# Verification

- `deno run -A presentation_browser_e2e.ts
  --fixture=./datetime_browser_fixture.ts`
  checks shared datetime rendering and editing.
  `deno task test:programs-browser --users` runs the Users flow alone, including
  Sign-ins list-to-detail navigation and its readonly login/expiration
  timestamps.

- `deno task test:file-upload-browser` checks real browser byte transfer,
  oversized replacements, single consumption, and cancellation of partial
  uploads. File bytes never enter the bound Model.

- `preferences_test.ts` covers the actual nullable table descriptor through
  SQLite, per-field inheritance, own-user saves, override removal, validation,
  authenticated preference responses, and idempotent account-deletion cleanup.
  `accent_test.ts` checks readable light/dark accents and default restoration.
  `test:programs-browser --runtime` covers Customization from the menu, save,
  cancellation, reset, external default changes, retained drafts, and mobile
  sizing.

- `deno task test:component-style-browser` verifies root classes, computed
  borders, field binding, and replacing/clearing styling across fields, lists,
  groups, actions, separators, header/toolbar elements, and preserved custom
  hosts through the real session and built shell.

- `deno task test:asset-delivery` checks the actual shell Worker, native Deno
  supervisor listener, and Go supervisor client together for encoding, cache,
  conditional-request, and HEAD behavior. See the shell service DOX for scope.
- `deno task test:connection-browser` uses the existing Chromium harness to
  cover the session manifest's login redirect after a rejected reconnect,
  redirects during initial establishment and session lookup, missing execution
  handling without recreation, terminal navigation without further connection
  attempts, automatic snapshot resynchronization without a banner, and transient
  recovery with retained dirty values. It verifies clean URLs, per-tab reload,
  explicit-link precedence, takeover, and starting a new session through Reload
  page after an execution disappears. Redirected error pages remain navigation
  outcomes.
- `deno task test:presentation-browser` covers page/modal restoration and exact
  field heights and underlines across desktop, tablet, and mobile widths,
  including default one-row textareas and explicit multiple-row controls.
- `deno task test:programs-browser --runtime` verifies readable sandbox RAM/CPU
  and Worker heap/CPU through the actual administration screens and linked
  navigation, including the targeted sandbox refresh on detail entry.
- `deno task test:programs-browser` drives the actual Programs catalog and
  shared execution form through Chromium against deterministic kernel/job
  fixtures. It checks all-program visibility, metadata, preselection, input
  validation, retained inputs, captured job output, current-session UUI
  execution, Back, and mobile sizing. Job fixtures retain canonical execution
  references and serve bounded `logs.query` pages separately from run metadata;
  browser assertions verify rendered log messages and execution usernames. It
  supplies deterministic test-only digests through the kernel bridge, and drives
  the real Users program against SQLite: account creation, password changes,
  full-name creation/editing, My account through the quick menu,
  password-mismatch clearing, authenticated self-targeting, password
  replacement, profile cancellation, and pending configuration drafts across My
  account, enable/disable, Advanced confirmation, user-filtered UUI sessions,
  and shared user-field record navigation at desktop/mobile widths. Service
  status help checks searchable known states, read-only values, and returning to
  the original overview. Program/package clickthrough covers the compact
  overview, Advanced, row/tag version selection, and a package credential
  opening the real empty secret editor through shared help. Package tests cover
  Home filtering and silent returns. The same fixture covers service
  settings/draft retention, ordered visibility controls, Public/Private saves
  through SQLite and the services indexer, and Service → Sandbox → Worker
  navigation at desktop/mobile widths. It covers a selected session older than
  200 unrelated rows, exact refresh, lazy Advanced message logs, sandbox
  clickthrough, and cancelling session termination. Database coverage includes
  compact/Advanced/field views, related tables, table help in SQL, executing the
  prepared SELECT, and row filtering with return navigation. Development
  coverage checks the combined settings group, SSH subtitle, reset confirmation,
  activation validation, changed-file navigation with edit/add/remove icons,
  lazily loaded read-only code-editor diffs including deletion and binary
  notices, retained draft messages, and console DOM preservation without
  starting a real sandbox.
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
  required-message validation, independent package commits, and process
  preservation, per-session theme persistence and future-tab theme inheritance,
  dark and light reload initialization before first paint, responsive
  two/four-group layouts, semantic field lengths, reserved hinted/unhinted
  supporting-message alignment, accessible full-hint popovers, and
  source-ordered multi-row field placement including its message slot at
  desktop/tablet/mobile widths, persistent standard Back navigation, header
  action/control rendering, one-row right-to-left responsive hiding,
  synchronized browser titles, vertical overflow disclosure, and mobile
  viewport-edge clamping; an open disclosure remains open across responsive
  refits while overflow is still required. It also covers modal
  stacking/focus/inertness, modal-local headers, Escape and browser-Back
  routing, page-over-modal suspension, later-page reload and exact continuation
  restoration, dirty background redraws, immediate rapid-event suppression and
  delayed loading feedback, Home tile invocation, the summary-only core-admin
  package list and selected package manifest/Git/content detail with vertically
  spaced content cards and service clickthrough, live database catalog
  list/detail/synchronization through the DB package, the core-admin
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
  source root, and process cleanup is time-bounded. Stage the complete native
  `bin/` owner so its relative sentry alias resolves to the same runsc engine.
- The native browser harness accepts `--fixture=<module>` to run a package's
  default-exported scenario after its normal node setup and real login. Node
  setup uses the ordinary `install-development-assets.sh` so development tools
  and their runtime SDK mounts are staged together. The
  `NativeBrowserFixtureContext` supplies the browser, disposable node
  references, ordinary administrative commands for each node (`admin` and
  `otherAdmin`), bounded `restartNodes` for startup-only node configuration, and
  shared interaction helpers. Button clicks target visible, enabled controls on
  active surfaces. The default UUI scenario remains the default; fixture runs
  share exception checks and bounded teardown and add no application behavior to
  the runtime.
- `--fixture=./branding_native_fixture.ts` grants its test user the managed
  administrator role and checks default images, converted uploads, database
  persistence, public delivery across nodes, custom titles, reload, and reset.
  Run against installed nodes natively or inside Docker. Screen waits require
  the interaction gate to clear and accept a customized server-title prefix; the
  branding fixture checks that prefix explicitly.
- Native browser startup seeds an obsolete UUI session cookie before login and
  requires the first login to reach Home without an ended-session reload.
- `--fixture=./connections_native_fixture.ts` checks real entity lookups and
  navigation, independent tabs sharing authentication, same-tab reload, explicit
  takeover, and automatic return after the controller leaves.
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
  `channel_streams_test.ts` covers both-direction policy bounds,
  queued/in-flight reservations, credit/demand, error isolation, duplicate
  controls, empty/partial EOF and late producers. `downloads_test.ts` covers
  explicit attachment startup, metadata and both-direction screen lifecycle
  cleanup. The custom browser fixture exercises binary streams on two actual
  custom hosts and the owning program; download browser checks also send real
  browser bytes to an authenticated backend sink. Session-service tests reject
  unsafe binary ingress.
- The download browser harness also opens the real demo form and verifies its
  text file, default 100,000-row calculation CSV, slider-selected export size,
  and field-group action placement without duplicate footer buttons at desktop
  and mobile widths.
- Browser E2E distinguishes selectable untruncated messages from responsive
  overflow triggers and verifies that full-message popovers stay beside their
  field while remaining inside the viewport.

- `channel_test.ts` checks both-direction ordinary JSON and stream
  subscriptions, fan-out, unsubscribe, sync/async failures, malformed framing,
  duplicate and stale traffic, independent owners and a healthy sibling.
  Canonical object identity, literal/global/prefix/internal-star matching,
  matching stream admission and repeated shared-binding cleanup are covered;
  default-screen routes reject unconsumed streams without source credit.
  `uui_test.ts` checks automatic current/next identities, failure cleanup,
  pending disposal, preparation failure under page/modal coverage, session end
  during preparation, first visible publication after hidden preparation, nested
  ownership, independent Workers, call/reset/connection lifetimes, trusted
  context, opaque identity isolation and custom-field binding serialization. The
  custom browser fixture uses two live component instances and the program with
  distinct byte content both ways, cancellation, preserved hosts and aborted
  saved views after replacement/reconnect.
- `lists_test.ts`, `list_values_test.ts`, and `uui_test.ts` cover projections,
  retained source mappings without identity checks, typed semantics, atomic
  edits/query events, notification errors, and page-five retention across
  selection and data refresh. Row clicks survive capacity updates and
  replacement of business arrays within the pending call.
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

- `deno task test:list-selection-browser` exercises the actual master-detail
  demo's add, bulk confirm, delete/cancel, and delete-all flows through the
  built shell and real session engine. It verifies checkbox/keyboard/drag/Shift
  selection, cross-page ranges, filtered whole-table selection, reload, selected
  counts, explicit/inferred toolbars, native/custom field binding, and flexible
  separators in desktop/mobile list, program-header, and modal action rows. It
  also verifies fixed toolbar heights, adjacent table alignment with empty
  toolbars, and bound controls inside the shared overflow disclosure.
