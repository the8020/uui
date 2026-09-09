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

- One live socket controls a session. Code 4001 opens a native modal with a
  full-screen blurred backdrop, "This session has been taken over by another
  window.", and Take control, disabling the covered UI. The inactive tab
  receives no screen updates and polls shell control every two seconds.
  Promotion reconnects with a full snapshot; discard its old pending edits on
  takeover. Ordinary interrupted connections retain pending edits.
- Normal URLs stay free of session IDs. Remember the current ID in the
  shell-path-scoped `the8020_uui_session` browser session cookie
  (`SameSite=Lax`, `Secure` on HTTPS), separate from authentication. Explicit
  `?session=...` links override the cookie and retain their query parameter.
  Resolve either reference through shell control before WebSocket admission.
- Known ended or missing sessions show "This session has ended." and an enabled
  Reload page button. The button clears the remembered session and route,
  removes any explicit session query, and reloads to start a new session.
  Missing executions never recreate their program automatically.

- Reconcile stable surfaces and retained DOM while preserving dirty values,
  focus, custom elements, and list state. Identical snapshots that retain DOM
  must also retain its bound model object so later edits reach submitted data.
- Keep one shell-owned in-flight interaction gate, bounded message/history
  rendering, and consumption-based download flow control.
- My account in the session menu sends the reserved `ACCOUNT_EVENT` with the
  active screen's dirty bindings through that same gate. Disable it while no
  screen is active, an interaction is pending, or My account is already active.
  The server calls the users program; no account code enters the browser bundle.
- Native browser Back traverses the marked base entry, restores the existing
  guard with `history.forward()`, then dispatches UUI Back. Never push a new
  guard after traversal; Chromium may skip it on later native Back presses.
  Reload adopts the current guard.
- Use the shared responsive geometry, accessible dialogs, complete local
  Material Symbols catalogue, and browser-only theme state.
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
- Use `deno task test:connection-browser`, `test:presentation-browser`,
  `test:lists-browser`, `test:programs-browser`, or `test:download-browser` for
  the affected end-to-end path. `test:native-back-browser` uses Xvfb and xdotool
  to test actual browser Back with CDP userGesture disabled for assertions.
- `test:presentation-browser --field-help` checks native Tab/Shift+Tab, F1–F4
  and Shift+F2/Shift+F3, relative and wrapping navigation,
  read-only/hidden/disabled/inert exclusions, modal focus, native disclosures,
  and dialog/page Back.

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
