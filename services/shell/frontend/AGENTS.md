Parent DOX: [uui/services/shell DOX](../AGENTS.md).

# Purpose

- Implement browser presentation, forms, lists, messages, downloads, and custom
  elements.

# Ownership

- Own main/renderer/model/presentation modules, geometry helpers, styles,
  download worker, custom elements, and colocated tests.
- The list child owns list rendering, geometry, tools, styles, and optional
  spreadsheet dependencies. The assets child owns vendored icon files; shared
  Markdown lives at the repository's frontend root.
- The code editor child owns the optional prebuilt custom field and its vendored
  editor and language modules.

# Local Contracts

- Back, Exit, and New form one gapless segmented navigation group. Exit sends
  `session.exit` and uses the upward arrow icon. It follows the server-selected
  entry URL after termination clears per-tab state. New is a normal base-URL
  anchor with `target="_blank"` and `rel="noopener"`, using fresh-navigation
  startup.

- One live socket controls a session. Code 4001 opens a native modal with a
  full-screen blurred backdrop, "This session has been taken over by another
  window.", and Take control, disabling the covered UI. The inactive tab
  receives no screen updates and polls shell control every two seconds.
  Promotion reconnects with a full snapshot; discard its old pending edits on
  takeover. Ordinary interrupted connections retain pending edits.
- Normal URLs stay free of session IDs. Fresh navigation creates a session;
  reload reconnects using `the8020.session:<websocketUrl>` in per-tab
  `sessionStorage`. Ignore inherited storage on fresh navigation, including new
  tabs. Explicit `?session=...` links select that session and retain their query
  parameter. Resolve remembered and explicit references through shell control
  before WebSocket admission. Authentication alone uses the shared cookie.
- Known ended or missing sessions show "This session has ended." and an enabled
  Reload page button. The button clears the remembered session and route,
  removes any explicit session query, and reloads to start a new session.
  Missing executions never recreate their program automatically.
- Take control and Reload page use the shared `btn btn-primary` styling.

- The navbar right cluster permits shrinking at narrow widths so the session
  username can ellipsize without overflowing the viewport.
- Reconcile stable surfaces and retained DOM while preserving dirty values,
  focus, custom elements, and list state. Identical snapshots that retain DOM
  must also retain its bound model object so later edits reach submitted data.
- Apply descriptor `class` and `style` through `component_style.ts` to each
  component's root: field wrapper, list card, layout region, button, separator,
  custom host, or screen article. Add classes and apply native CSS declarations
  without replacing framework classes or unrelated inline styles. On retained
  hosts, restore overridden styles and remove only added classes before applying
  new descriptors; clearing styling preserves the host and its lifecycle.
- `main.ts` uses ChannelRouter for ordinary ID/data and binary traffic. Channels
  expose send(id, data)/subscribe(pattern, handler), returning the same shared
  canonical ChannelSubscription (id, original handler, unsubscribe). Only * is
  special in full-ID filtering for ordinary messages and stream-open.
  ChannelBindings owns retention/reattachment and disposal for both backend
  Channels and browser component/program subscriptions, without handler records.
  Backend retention ends at logical screen settlement; browser hosts retain
  subscriptions only through their owning descriptor. Every screen has its
  automatically managed program attachment; unconsumed ordinary data drops and
  streams cancel before source demand. No payload/result schemas or method
  registry exist. Opaque routing references come from each owning
  descriptor/program; there is no endpoint catalog or authority layer. Browser
  custom contexts acquire a component view or owning program view without named
  wiring. Preserved hosts reattach subscriptions through the current owner;
  saved views retain their original call/connection and cannot register/send
  into replacements. Acquire a view before awaiting. Outgoing streams inherit
  their host lifetime, including program sends; disposal/remount cancels them
  even while the screen call remains attached. Handler failures leave other
  subscriptions usable; stream data requires one matching consuming subscriber,
  never automatic tee/buffering. Only matching list-domain results/errors or
  valid presentations release the list request gate. Ordinary messages and
  stream controls do not. No server mod.ts imports enter the bundle.
- Each call registers its built-in message-center append/history consumer
  through the same core. Validated snapshots reconstruct accepted domain
  history; message-kind refresh never releases the interaction gate. Monotonic
  message identity prevents duplicate/dismissed toasts across
  replacement/reconnect; initialization/reload restores history only. Retain 100
  history entries and ten toasts, existing Markdown/dialog/badge/focus/dismissal
  behavior, and roundtrip collection clearing. Live output retains the captured
  screen/connection; stale frames cannot mutate the message collection.
- Ordinary list updates and independent reads use the list namespace's update
  and read messages on this same core. Updates carry captured dirty bindings and
  screen state; only matching results acknowledge those drafts. Capacity batches
  remain one transaction. Browser list tools use provider totals and revisions;
  no program reload loop is required for visible browsing.
- Keep one shell-owned in-flight interaction gate, bounded message/history
  rendering, and shared consumption-based stream flow control.
- Native saves subscribe to `save` metadata and its domain transfer-ID stream
  data on the screen's attached channel through that same core. Filename/content
  type and windows remain at download_metadata; local worker/MessagePort
  controls remain at downloads/download-worker. Await native
  response-consumption acknowledgement before resolving handoff; preserve the
  bounded completed iframe tail. Screen/connection replacement cancels
  unfinished saves without replay or backend file-byte requests.
- My account in the session menu sends the reserved `ACCOUNT_EVENT` with the
  active screen's dirty bindings through that same gate. Disable it while no
  screen is active, an interaction is pending, or My account is already active.
  The server calls the users program; no account code enters the browser bundle.
- Customization uses reserved `CUSTOMIZATION_EVENT` through that same gate and
  stays disabled while unavailable or already active. `presentation.show`
  refreshes effective preferences from the uncached authenticated shell
  endpoint. Abort superseded requests and bound reads to ten seconds; errors
  preserve the applied accent and show a notice. `accent.ts` applies shared
  accent/hover/soft and contrasting foreground tokens in both themes; built-in
  purple clears overrides. Light/dark switching reapplies the last accent
  immediately.
- The shared CSS uses the accent token for navbar underlines, every field-group,
  detail, and list card outline (including title tabs), and dialog frames and
  toolbar underlines in both themes. Saved colors and defaults apply across all
  screens, including field help and its value list. Primary buttons have no
  colored elevation shadow; keyboard focus remains visible.
- Native `color` fields reuse string binding and field geometry/help. Read-only
  color inputs are disabled; field help remains available through the wrapper.
- Native browser Back traverses the marked base entry, restores the existing
  guard with `history.forward()`, then dispatches UUI Back. Never push a new
  guard after traversal; Chromium may skip it on later native Back presses.
  Reload adopts the current guard.
- `renderElements` shares ordered native/custom controls, actions, and
  `{ type: "separator" }` gaps between list toolbars, program/modal headers, and
  layout element rows. Separators share free flex space, have no focus target,
  and are ignored when measuring the header's minimum item widths. Header
  overflow hides its separators; ordinary element rows wrap at narrow widths.
- Use the shared responsive geometry, accessible dialogs, complete local
  Material Symbols catalogue, and browser-only theme state.
- Dialogs grow with their content up to 90% of the dynamic viewport height;
  mobile dialogs leave a 12px outer height gutter. Keep tall-window list pages
  governed by the viewport instead of a fixed maximum height.
- Startup and failed WebSocket admission share HTTP route establishment. A
  redirected response ends reconnecting, clears the route, and navigates to its
  final URL before checking status or route headers. Preserve retry behavior for
  transport failures; resolve an existing session through shell control and stop
  on a missing execution instead of creating another one.
- Send browser origin, language, and time zone in the HTTP establishment body
  and each WebSocket `session.connect`. The package session binding owns these
  presentation values; authenticated identity remains runtime-owned.
- The generic custom-element context exposes `renderText` for shared text and
  icons. `uui-content-fullscreen` fills only the content viewport, using the
  measured global-bar height in `--uui-content-top`, and locks background
  scrolling. The component owns its toggle, geometry, and deactivation cleanup.
- Custom fields use the ordinary host through `control.custom`, inherit field
  geometry and help, and expose live `control`, `value`, and `setValue` through
  the host. Binding synchronization stays within the owning surface, across
  native and custom controls. A changed Model or reset disposes old instances.
- `clipboard.ts` owns plain-text writes and the native selection fallback for
  shell commands and custom code fields, retaining focus and active modal scope.
- Every component may store bounded JSON in its screen element's `data` through
  `screenElement` or the custom context's live `state`. Capture custom state
  before interactions/redraws, retain it across navigation, and synchronize with
  ordinary events. Custom fields own their scroll; generic wrapper capture must
  not replace it with wrapper offsets.
- Scalar fields expose a pencil or read-only Chevron Right button outside the
  Tab order; button clicks and focused-field F1/F4 send the shared `field-help`
  event with dirty bindings. `fieldHelp: false` suppresses it. Keep read-only
  text selectable and use the wrapper for disabled choices' help focus. Full
  descriptions use shared safe Markdown; the reserved hint line shows plain
  text.
- `keyboard.ts` owns the frontend key-to-action map and focus navigation. Keep
  shortcuts separate from rendering and transport so later customization stays
  local. Tab uses native field/control and standalone-button order; field-help
  and overflow-ellipsis buttons have `tabIndex = -1`. Unmodified F1/F4 click the
  focused field's help button, F2 clicks the focused element, and F3 uses the
  shared Back action, requesting native dialog closure before page navigation.
  Shift+F2/Shift+F3 loop backward/forward through visible, enabled, editable
  controls and buttons in the active screen and its header, or the active native
  modal. Skip read-only fields, inert/hidden controls, and auxiliary buttons.
  From other focused elements, use their DOM position; with no focus, choose the
  first eligible control in document order. Modal restoration uses the same
  focus eligibility, including read-only fields.
- Run global shortcuts during bubbling, after component handlers. Respect
  prevented/default-consumed events so custom editors and terminal components
  keep their native keys before the shell considers its own actions.
- `enterEvent` binds editable native inputs to the configured ordinary action;
  omit it for no Enter roundtrip. Textareas and custom editors keep Enter. Dirty
  values and event values use the existing renderer/model/interaction gate.
- Screen `shortcut` descriptors bind F5–F12 plus exact Control/Alt/Shift
  modifiers. Buttons click; other descriptors focus their first eligible
  descendant. Explicit list regions bind the shortcut from their bound control;
  shared layout validation guarantees a single placement. Hidden controls do not
  contribute a shortcut to an explicit list. Only active roots or the top native
  modal participate. Closed overflow, hidden, disabled, detached, and inert
  elements are excluded. Shared screen construction rejects duplicate
  combinations across body/header, including hidden elements. No per-screen
  listeners survive replacement; Enter callbacks use a WeakMap. Ignore
  composition and already-consumed events; suppress handled repeats and prevent
  defaults only when a target/action exists. Browser/OS interception remains
  outside the shell's control; preserve ordinary UI access.
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
  and borderless with the pencil's subtle hover fill and visible focus. Fitting
  text has no button or reserved button space.
- Inline icons in overflow text must fit the text line box; icon baseline
  overflow alone must not produce an ellipsis for otherwise fitting content.
- `popover.ts` owns `AnchoredPopover`: native nested light dismissal, Escape
  focus return, resize/scroll positioning, and a ten-pixel viewport gutter.
  Overflow aligns below the row and left from the button's right edge, flipping
  above only when necessary. Popovers scroll within 24rem and the available
  viewport; use the existing safe Markdown renderer for full content.
- Column descriptions inherit shared Zod metadata. Put their plain-text preview
  between the heading and query controls, capped at 100 characters and three
  lines, with the same ellipsis for the complete Markdown description.

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
- `deno task test:component-style-browser` checks root styling and redraws on
  ordinary components and retained custom hosts through the session engine,
  including custom-field channel traffic after a shared-binding edit and real
  default component/program subscribe/send with no backend listener.
- `test:programs-browser --runtime --screenshots` checks accent borders and
  shadow-free primary buttons in both themes across Service detail, Configure,
  Customization, read-only/editable field help, and mobile dialogs. Screenshots
  are written to `/tmp/uui-accent-*.png` for visual review.
- Use `deno task test:connection-browser`, `test:presentation-browser`,
  `test:lists-browser`, `test:programs-browser`, or `test:download-browser` for
  the affected end-to-end path. `test:native-back-browser` uses Xvfb and xdotool
  to test actual browser Back with CDP userGesture disabled for assertions.
- `deno task test:custom-elements-browser` checks delayed handler cancellation,
  stale output views and fresh operations through retained hosts across full
  screen replacement and reconnect, alongside component/program routing,
  inspectable wildcard subscriptions, Model resets, host remount cancellation of
  outgoing program streams within one call, and repeated redraws without
  duplicate deliveries. Framework maps and owners are inspected for
  deterministic release; these checks do not measure garbage-collector memory
  usage.
- `test:presentation-browser --field-help` checks native Tab/Shift+Tab, F1–F4
  and Shift+F2/Shift+F3, relative and wrapping navigation,
  read-only/hidden/disabled/inert exclusions, modal focus, native disclosures,
  and dialog/page Back.

- `deno task test:list-selection-browser` checks shared element rows, bound
  toolbar controls, and list selection through the real demo and session engine.

- `deno task test:keyboard-browser` exercises named Enter events through the
  real session engine, key/modifier matching, hidden/disabled/inert exclusions,
  modal scope, stale DOM, composition, repeats, explicit/inferred list focus,
  and backend draft application.

# Child DOX Index

- [components/code-editor/AGENTS.md](components/code-editor/AGENTS.md): Own the
  optional code field, local syntax diagnostics, line markers, and vendored
  editor.

- [components/list/AGENTS.md](components/list/AGENTS.md): Own list rendering,
  spreadsheet viewing, range export, clipboard actions, and local dependencies.

- [assets/AGENTS.md](assets/AGENTS.md): Hold the complete local Material Symbols
  font and its generated icon catalogue.
