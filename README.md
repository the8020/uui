# UUI

Programs import the standard UUI functions from `/p/the8020/uui/mod.ts`.

## Program declarations and launching

Mark interactive programs in `programs/<name>/program.toml`:

```toml
schema = 1
description = "Orders"
entrypoint = "program.ts"
uui = true
```

`uui` defaults to `false`; `discoverable` defaults to `true`. Home lists only
programs with both flags enabled. Set `discoverable = false` on helper screens
that require inputs or should be opened from another program. Returning to Home
does not emit a completion notification. These flags classify programs; they do
not restrict generic kernel execution.

The **Programs** application (`the8020/admin-core/programs`) lists every ready
program, including hidden and non-UUI programs. Its main page shows the
description, execution kind, and linked package; **Advanced** exposes flags,
entrypoint, and active commit. **Execute** opens the shared
`the8020/jobs/run-program` form with that program selected. Enter positional
arguments as a JSON array, such as `[{"customer":"Example"},42]`.

The manual form opens UUI programs in the current authenticated session. Job
programs offer execution user, sandbox group, and node options, then open their
captured result and logs. Selecting another program preserves entered inputs.

Dynamic UUI calls use the same positional argument convention:

```ts
import { invokeProgram } from "/p/the8020/uui/mod.ts";
await invokeProgram("example/sales/orders", [{ customer: "Example" }, 42]);
```

Pass a single argument inside an array; omit the array for parameterless
programs. The function retains ordinary calls, presentation context, and
standard program-failure recovery. Manifests are parsed as TOML and validated,
including boolean flags and duplicate-key rejection.

## Models and screen lifetime

Create a `Model` once for each logical screen and retain it in your function,
class, closure, or navigation entry:

```ts
import { BACK_EVENT, callScreen, Model, z } from "/p/the8020/uui/mod.ts";

const Screen = z.object({ my: z.string() });
const data = { my: "screen_data" };
const model = new Model(data);

while (true) {
  const event = await callScreen({ id: "example", schema: Screen, model });
  if (event.action === BACK_EVENT) break;
}

model.data.my; // string; model.data === data until explicitly replaced
model.screen.scroll.y; // number
```

Business validation and dirty edits apply to `model.data`. `model.screen` holds
framework state: a logical `instanceId`, reset `version`, screen scroll, and an
`elements` dictionary keyed by resolved element ID. A list element's `list`
state contains its page, measured page size, and complete query; `scroll` and
`toolbarOpen` hold its presentation state. Tab regions retain `selectedTab` so
measuring a newly revealed list does not switch its tab. Transport snapshots are
plain data.

Reassign `model.data` when refreshing results. Reusing the wrapper preserves its
query, page (clamped when results shrink), and viewport. Creating a new wrapper
starts a separate screen at the top. Call `model.resetScreen()` to intentionally
clear presentation state while keeping the data and logical instance identity.
One wrapper may belong to only one pending screen call at a time.

Ordinary functions remain ordinary navigation. `presentPage()` and
`presentModal()` create presentation surfaces; `callScreen()` can also replace a
screen on the current surface. Keep the caller's wrapper while awaiting a child
function, or retain it in the corresponding navigation-history entry. A frame
must also retain program-owned context such as a backend batch cursor.

The browser captures screen and element scroll with actions, changes, Back,
paging, queries, and capacity updates. Scrolling itself sends no traffic. Newer
local scroll survives redraws and navigation within the current browser; reload
restores the last synchronized position. Brief reconnects preserve live browser
state. This lasts within the live session/Worker; there is no database
view-state storage or recovery of program continuations after Worker loss.

## Channels

Programs and browser components use `send(id, data)` and
`subscribe(pattern, (id, data, context) => ...)`. The returned
`ChannelSubscription` exposes readonly `id`, the identical original `handler`,
and idempotent `unsubscribe()`; framework owners store and dispatch that same
object in the backend and browser. Data is ordinary JSON or a readable byte
stream/lazy async iterable. IDs name application messages; no method
registration, payload/result schema, peer catalog or separate stream-handler map
is needed. Subscribers own business validation and any actual request/reply
correlation. `context.signal` cancels work when its subscription, screen or
connection loses ownership.

UUI provides read-only `currentScreenChannel()` and `nextScreenChannel()`
getters for the current presentation surface. Next exists before its first
screen. Capture it during setup; plain `callScreen(options)` promotes that exact
object after preparation finishes and its snapshot is first successfully
presented, then provides a fresh next. A prepared hidden call stays next until
restoration first presents it. Current is undefined before that first
presentation and retains the settled reference until the next successful call.
Redraw, Model reset, reconnect and restoration of already-presented calls keep
the logical pair; physical endpoints still expire at their existing boundaries.

`ScreenChannel` is a type, not an author-created controller. The `channel`
option of `callScreen` is removed. Validation, preparation or presentation
failure before promotion disposes its candidate and creates a fresh next;
recreate its component bindings before retrying. A rejected concurrent call
leaves the active pair alone. Surface/session closure disposes both owners,
including never-rendered components.

Release pairing: use UUI `0.8.1` with demo `0.8.0` for this managed-channel API.
The kernel `0.8` release selector accepts these bare version tags; the `0.7`
selector continues to select the older packages. External consumers must remove
the `callScreen` channel option and use the managed getters.

Each backend `new Channel()` internally acquires that surface's next owner. Keep
its reference in the component declaration for per-instance routing; do not
share one binding among components or across logical calls. `Channel.dispose()`
abandons a component even before rendering, and `subscription.unsubscribe()`
releases an individual subscription. Its `signal` ends with explicit disposal or
screen settlement; use it to stop setup timers and other component resources.
UUI assigns internal identities; authors never repeat component IDs for wiring:

```ts
import {
  callScreen,
  Channel,
  Model,
  nextScreenChannel,
  packageAssetURL,
  z,
} from "/p/the8020/uui/mod.ts";

const program = nextScreenChannel();
const widget = new Channel();
widget.subscribe("*", async (id, data) => {
  if (data instanceof ReadableStream) {
    const bytes = new Uint8Array(await new Response(data).arrayBuffer());
    widget.send("uploaded", { bytes: bytes.length });
    return;
  }
  if (id === "ready") widget.send("update", { label: "Ready" });
  if (id === "selection") widget.send("selected", { value: data });
});
program.subscribe("status", (_id, data) => {
  program.send("status-result", { running: true });
});
const pending = callScreen({
  id: "channel-example",
  schema: z.object({}),
  model: new Model({}),
  customElements: [{
    id: "widget",
    module: packageAssetURL("example/widget", "widget.js"),
    config: {},
    channel: widget,
  }],
  layout: {
    schema: 1,
    id: "channel-layout",
    root: { type: "custom", customElement: "widget" },
  },
});
await pending;
```

The schema above belongs to the screen model. Channels have no required schemas.
Custom fields can likewise supply `channel` in their `custom` options. A browser
module uses the automatically attached component or owning program:

```js
export default function mount(context) {
  const subscription = context.channel.subscribe("*", async (id, data) => {
    if (data instanceof ReadableStream) {
      const bytes = new Uint8Array(await new Response(data).arrayBuffer());
      context.host.textContent = String(bytes.length);
      return;
    }
    if (id === "update") context.host.textContent = data.label;
  });
  context.channel.send("ready", null);
  context.channel.send("selection", { key: 42 });
  context.programChannel.send("status", null);
  return { dispose: subscription.unsubscribe };
}
```

Patterns match the entire ID. Only `*` is special: it matches zero or more
characters, including dots. Literal patterns match exactly; regex punctuation
and other glob characters remain literal. Internal and multiple stars use the
same rule (`dashboard.*.rows*`).

```ts
const handler = (id: string, data: unknown) => console.log(id, data);
const subscription = widget.subscribe("dashboard.updates.*", handler);
subscription.id; // "dashboard.updates.*"
subscription.handler === handler; // true
subscription.unsubscribe(); // safe to call repeatedly
```

Every screen owns its automatically managed program channel. Custom hosts and
custom fields always receive both `context.channel` and
`context.programChannel`; component Channels are also created automatically when
their declarations omit one. Backend component bindings add application
listeners. Sending to an unconsumed route drops ordinary data and cancels
streams before source demand, without a backlog. Detached, disconnected, stale
or covered owners still reject operations.

Ordinary data fans out to the matching current subscribers. Synchronous throws
and rejected handler promises are isolated; another subscriber and later
messages remain usable. Messages with no listeners are dropped. There is no
replay, backlog, automatic stream tee, central quota/fairness scheduler or
generic RPC layer. Owner-selected stream bounds and the list's 30-second read
deadline stay at their owners; transport JSON, framing and size validation
remain required.

Each full `callScreen` and Model reset creates a new physical generation.
Backend subscriptions survive reset within their logical call; preserved browser
hosts reattach to the owning descriptor. Settlement disposes backend
subscriptions and requires new bindings for the next call. In-flight work is
aborted. Settlement, removal, failure, exit and disconnect or takeover cancel
unfinished streams. Covered surfaces retain state but admit no new channel
traffic. An unsubscribe removes that subscription and cancels streams it is
consuming. Ordinary sends have no remote completion promise.

Browser `context.channel` and `context.programChannel` getters acquire a view of
the current owning call/connection. At the start of a handler or UI action,
acquire a view before awaiting and retain it for that work. Saved output views
never retarget a replacement. Backend subscribers preserve their initiating
trusted async context, and their Channel/ScreenChannel sends reject old work.
Backend work started outside a handler can use `channel.capture()` before an
await. A producer ignoring abort can continue internally; late framework output
is discarded. Arbitrary business side effects remain owner responsibilities.

One ChannelRouter handles all traffic on the existing authenticated UUI
WebSocket. The session service retains controller/socket/session checks;
internal envelopes bind messages and stream controls to their initiating side,
sequence and screen/connection generations. Protocol version 12 omits list
revisions; the pending call retains the displayed-to-source mappings. No
endpoint catalog, permission system, extra backend service or socket is exposed.
Do not import the server `mod.ts` barrel into browser modules.

Lists use ordinary `read`, `update`, `result` and `cancel` IDs and only the
list-owned token needed to match a read/update. Headless commands use the same
validated list-domain owner. Independent reads preserve dirty fields and leave
callScreen pending; updates keep existing atomic validation. Only matching list
results/errors or valid presentations release the shell's interaction gate;
ordinary messages, stream controls and acknowledgements never release it.

## Messages

User-facing outcomes and validation failures use the message center. The shell
has no warning/error banners; frontend diagnostics use `console.error`.

`sendMessage(body, kind?)` records an ordinary program outcome in the current
session's bounded message history. Kinds are `info` (default), `success`,
`warning`, and `error`; Markdown bodies must contain 1–20,000 characters.
Between screen calls, including after a modal returns or before the first
socket, this accepts semantic state only. The next explicit presentation
contains that history; no detached operation waits for or rebinds to its
channel. All existing success/error helpers use this domain contract.

For output from work started while a screen is pending, capture its owner before
an await or callback:

```ts
import { callScreen, captureMessages, Model, z } from "/p/the8020/uui/mod.ts";
const pending = callScreen({
  id: "work",
  schema: z.object({}),
  model: new Model({}),
});
const output = captureMessages();
await doWork();
output.send("Work completed", "success");
await pending;
```

Initial/headless captures may accept domain state without a physical socket; the
first connection change expires that capture too. The domain helper validates
its registered owner before accepting history; generic channel sends require a
live transport.

The built-in message center attaches through its managed ScreenChannel. Its
`append`, `history`, and `refresh` IDs use generic subscriptions on the same
ChannelRouter as lists, custom hosts and programs. Captured output preserves
trusted async context and rejects before accepting history when its call,
namespace, Model reset, connection or initiating operation becomes stale.
Coverage blocks output; cancelled handlers remain cancelled after restoration.
Disconnect/takeover cancels old output; acquire a fresh capture for new work.
Never retain the ambient `sendMessage` helper as a substitute for that capture.
Download and provider errors use their initiating capture. A source ignoring
abort may continue internally; its framework output cannot enter a new owner.

Accepted history retains at most 100 messages; authenticated headless responses
read the ten most recent from that same owner. An accepted interaction clears
prior outcomes while preserving messages accepted during its asynchronous work.
Browser roundtrips clear their interaction collection. New live records or
between-screen outcomes show at most ten toasts; history retains 100. Snapshot
initialization/reload reconstructs history without old toasts. Replacement and
reconnect merge by monotonic domain identity; dismissed or already seen records
are not reintroduced. A registered history refresh transfers state without
replaying operations or releasing an unrelated request gate. Pushes neither
commit dirty data nor reissue a pending screen. Toast/dialog Markdown, badge,
dismissal, focus, keyboard and accessibility behavior stay with the shell.

## Shared fields and field help

Define a semantic field with ordinary Zod and the runtime-independent DB helper.
Its schema can be reused in tables, forms, and list row structures:

```ts
import { field, money, z } from "/p/the8020/db/fields.ts";

export const customer = field(z.string(), {
  label: "Customer",
  description: "Choose **who receives the order**.",
  valueHelp: async ({ query, offset, limit }) => {
    // Your query returns at most limit items and whether another batch exists.
    return await findCustomers({ query, offset, limit });
    // { items: [{ value: "acme", label: "Acme", description: "London" }], more: false }
  },
  open: async (id) => {
    const { default: customerDetails } = await import("./programs/customer.ts");
    await customerDetails(id);
  },
});

export const orderSummary = z.object({ customer, total: money() });
```

Use `t.from(customer)` or `columns(orderSummary)` from the DB package for table
columns; use `orderSummary`, `.pick()`, `.extend()`, and `z.array(orderSummary)`
for UUI structures. A screen can add presentation settings without changing the
shared definition: `field(customer, { length: "long" })`, using UUI's `field`
import. Shared field storage travels with the schema; table-specific keys and
defaults stay in the table declaration.

Every scalar field has pencil help, or a Chevron Right when read-only. Click the
button or press F1 or F4 on the field to open its value with the full Markdown
description. The helper owns a separate draft. **Done** validates against the
complete caller schema and applies that draft. **Close**, Back, and Escape
discard it, including invalid input. Done is shown only for editable fields.
Read-only help shows the value and description without loading editable choices.
Use `fieldHelp: false` in UUI metadata or a control declaration to suppress help
for a particular control.

Tab visits fields, controls, and standalone buttons, skipping field-help icons
and overflow ellipses. F2 clicks the focused element. F3 goes Back, closing the
active modal before returning to a previous screen. Shift+F2/Shift+F3 loop
backward/forward through editable fields, controls, and buttons in the active
screen or modal. They skip read-only, disabled, hidden, and inert controls. From
another focused element they move relative to its position; with no focus they
select the first eligible control. F1–F4 otherwise use unmodified function keys.

### Screen keyboard actions

UUI field metadata and control declarations accept `enterEvent`, an optional
non-empty event name (excluding reserved `back` and `uui.account`). Unmodified
Enter on an editable native input dispatches that name as the ordinary
`screen.event` action (`eventType: "action"`), with the current field value and
all dirty model bindings through the existing interaction gate. Handle
`event.action` exactly as for a button. Omitting it sends nothing; there is no
boolean option or default event. Textareas, custom editors, selects, and radio
groups retain their own Enter behavior. Composition and held keys do not
dispatch additional actions. An explicitly named event can request a round trip
even when a program does no work for that name.

```ts
const schema = z.object({
  where: field(z.string(), { enterEvent: "run", shortcut: { key: "F5" } }),
});
const model = new Model({ where: "" });
const event = await callScreen({
  id: "query",
  schema,
  model,
  actions: [{
    id: "run",
    label: "Execute",
    shortcut: { key: "F6", control: true },
  }],
});
if (event.action === "run") await executeQuery(model.data.where);
```

`shortcut` is available on fields, control declarations, and body/header
actions. Its `key` is F5–F12; optional `control`, `alt`, and `shift` booleans
match exactly (omitted means false). F1–F4 are reserved even with modifiers.
Screen construction rejects duplicate combinations across body and header,
including hidden controls. Separate screens and modals may reuse a combination.
Buttons click their normal action; other controls focus their first eligible
native/custom descendant, including read-only text. Lists focus their first
eligible control. An explicit `{ type: "list", bind: "rows" }` layout uses the
shortcut of its bound list control, just like an inferred list. A shortcut may
identify only one placement: ambiguous bindings and repeated placements of a
shortcut-bearing control are rejected. For repeated list bindings, declare
separate list controls with distinct shortcuts and place them by ID in the
layout's `controls`. Hidden, disabled, inert, detached, and inactive surfaces
are excluded. The top native modal takes priority, including shell dialogs;
closed header overflow stays hidden. Component handlers run first and may
consume a key. Unhandled keys keep browser defaults. The shell installs one
listener and reads the current DOM on each key.

Browser/OS shortcuts can intercept function keys before a page receives them
(for example browser refresh, fullscreen, or developer tools), and some
keyboards require Fn. These declarations cannot guarantee interception on every
platform. Chromium CDP checks exercise Enter, F5/F6, action keys, and a
combined-modifier key; synthetic events check every supported combination and do
not prove native OS interception. Keep ordinary clickable/focusable controls
available.

The optional `valueHelp` callback runs on the server. A **Value help** list
below the value field starts with its extended toolbar collapsed. **List tools**
(`+`) reveals search and tools. Search resets to page one; pagination and
measured capacity fetch only the requested page. Return at most the requested
`limit` (1–500) of `{ value, label, description? }` items and a `more` boolean.
Raw values remain on the server; selecting a row fills the draft, which Done
commits. Enum and explicit control options also appear in the list when there is
no provider. Callbacks should import runtime queries lazily so the same fields
remain usable during table evaluation.

An optional `open(value)` callback enables **Navigate**, placed to the right of
Done. It opens the related program on a new page without committing the draft.
Returning restores the helper and its caller. The caller Model stays reserved
while help is open. A reactive field delivers one change event when help closes.
Its ScreenChannel stays attached: background redraws update the covered screen,
and exit/failure settles when help returns.

## Lists

All array controls, including inferred controls, use the same Worker-owned
pipeline: quick search and column filters, stable sorting, then pagination. The
program's source array stays intact. Each displayed list has an independent
projection even when two lists share the same binding.

```ts
const layout = {
  schema: 1,
  id: "orders-layout",
  root: {
    id: "orders-list",
    type: "list",
    bind: "orders",
    key: "id", // The Worker derives selection values from the selected row.
    display: ["number", "customer", "amount"],
    columnOptions: {
      customer: { heading: "Customer name", length: "long" },
      amount: {
        heading: "Total amount",
        shortHeading: "Total",
        length: "compact",
      },
    },
    triggerFilterEvents: false,
  },
};
```

Pass this serializable declaration as `callScreen({ ..., layout })`. Use
`LayoutDeclaration` for an explicitly typed declaration with optional region
IDs. For an inferred list, supply the same list options through
`field(z.array(Row), { list: { ... } })` or a control declaration's `list`
member. `display` selects columns in order. Scalar-array lists have a single
column with the empty-string key. `headings` is a simple full-heading map;
`columnOptions` also supports a full `heading`, `shortHeading` (including
`[[icon=...]]`), `length` (`compact`, `short`, `medium`, `long`), and
`semanticType`.

Column semantics come from the row schema. Numbers and booleans receive compact
widths; date/datetime metadata identifies date-valued strings explicitly.
Formatted strings stay text unless their declaration specifies another semantic
type. Comparisons use stable source order for ties. Null/undefined/empty strings
sort first ascending and last descending.

Filters use these rules:

| Column type     | Filter                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------ |
| Text / JSON     | Case-insensitive substring of the displayed text                                                             |
| Number          | Equality, or `=`, `!=`, `<`, `<=`, `>`, `>=` followed by a numeric value                                     |
| Boolean         | `true` / `yes` / `1`, or `false` / `no` / `0`                                                                |
| Date / datetime | ISO date or datetime, optionally prefixed with a comparison; date-only equality matches the UTC calendar day |
| Any             | `is:empty`, `is:not-empty`, or `is:null`                                                                     |

An empty filter clears that column. Invalid typed operands match no rows. Quick
search uses displayed columns, so omitted navigation fields do not affect it.
Filters combine with AND; quick search matches any displayed column. Changing a
query resets only that list to page 1. Counts refer to the supplied array:
`1–25 of 60 (filtered, total 993)`. Sorting alone does not add the filtered
suffix. Empty results retain headings, tools, filters, and `0–0 of 0` feedback.

Column headings open keyboard-accessible sort/filter popovers. The rightmost
**List tools** disclosure reveals quick search and icon-only clear-all actions
for applied sorts and filters. Clear all filters removes both quick search and
column filters while preserving sort; clear all sorts preserves filters. The
toolbar has the same height as the column header. Its disclosure overlays the
header's right edge without reserving a table column or body space; it stays
visible during horizontal scrolling. Compact headings keep the full heading
accessible and available in the popover. Its two `Sort` buttons share one row,
with ascending/descending bars matching the header indicator. The selected sort
has a trailing `X`; nonempty filters have an `X` inside the field. Selecting or
clearing sort, clearing a filter, or pressing Enter in the filter field confirms
and closes the popover. Typing filters still applies after a short debounce
without losing focus.

Rows stay one line at a fixed height; truncated cells expose complete text on
click or keyboard activation. Readable column widths overflow horizontally only
when they exceed the available width, while vertical movement chains to the page
or modal.

The expanded toolbar also has icon-only **Table processor**, **Export**, **Copy
page**, and **Copy all** buttons with tooltips. Table processor opens a large,
read-only spreadsheet grid supporting rectangular and whole-column selection and
copying. Its independent pager defaults to 1,000 rows and offers an editable
page number plus previous/next controls. All tools use the current list query,
sort, and displayed columns. Copy page uses the page visible in UUI; Copy all
traverses all matching rows. The clipboard includes a tab-separated and an HTML
table representation for Excel and other spreadsheets.

Export offers CSV, JSON, XML, YAML, XLSX, and ODS with a one-based inclusive row
range defaulting to first through last. JSON/XML/YAML identify columns by their
keys; other formats include full headings. Exact decimal text is retained in
workbooks. Data reads are bounded to 1,000 rows, using the same WebSocket while
leaving the UUI page and unsaved fields unchanged. Export/copy results are held
in browser memory. Tabulator (MIT) and SheetJS CE (Apache-2.0) are vendored
inside `services/shell/frontend/components/list/` and load only when needed.

Register an async source once with `setListSource(model, listId, source)`:

```ts
setListSource(model, "orders", async ({ query, offset, limit, signal }) => {
  return fetchAuthorizedOrders({ query, offset, limit, signal });
});
```

The program chooses the authorized source. Bound arrays use local projection;
registered sources receive the ordinary typed query, offset, a 1–500-row limit
and AbortSignal. Return `{ rows, more, totalItems?, totalSourceItems? }`. UUI
loads and refreshes the visible page, validates its fixed row schema and totals,
and updates rows and geometry while `callScreen` stays pending. Paging, queries,
capacity changes and `ScreenChannel.redraw()` do not require program reload
loops. Providers retain remote order and own filtering, sorting and consistency;
`searchOnly: true` registration options hide and reject unsupported column
queries. Whole-table checkbox selection requires a complete bound array, so
registered paged sources cannot opt into selection.

Provider pages belong to their list ID and never replace the bound business
array; separate lists may query the same binding independently. Row navigation
uses that list's accepted page. Providers expose reads only: dirty row edits on
a provider list reject the entire interaction before any data, query, capacity
or page state commits. Editable rows and checkbox updates require a complete
bound array. Other editable fields can still commit with provider browsing.

The disposer or replacement cancels the source's outstanding work. Reset, screen
settlement/replacement, coverage and connection loss cancel active work; late
results are discarded even if the source ignores abort. Covered redraws retain
presentation state and refresh when restored. Remote snapshot consistency and
interrupting unabortable queries remain source-owned. Schema and columns stay
fixed within a screen call; rebuild the screen contract explicitly to change
them. Optional source-returned value-help schemas must match that contract.
Unknown totals remain unknown until an accepted end page. The same provider
fills bounded independent `read` operations without changing the visible page or
committing drafts. Field help registers its provider automatically and retains
its first-column key, isolated draft and Done commit.

The first presentation supplies one row for measurement. The browser reports
capacity from the actual page/modal viewport and list geometry; the Worker
bounds it to 1–500 rows. Resize, toolbar, and visibility changes can update
capacity; scrolling does not. Changing capacity retains the former first row
within the new page when possible. Lists below other content receive a usable
viewport budget after being scrolled into view. The body reserves space for the
unfiltered source total up to the measured page capacity, keeping the list,
containing card, and pagination in place on shorter pages and filtered or empty
results. Reload uses the same source total even when only a few rows are shown;
genuinely small sources reserve only their own rows, with one row for an empty
source.

### Optional query events

`triggerFilterEvents` defaults to `false`: list queries and page/capacity
changes update the pending screen internally. With `true`, a changed query first
merges valid dirty data and screen metadata, then resolves the call with a
`ListQueryScreenEvent`:

```ts
if (event.eventType === "list-query") {
  event.listId; // resolved element ID
  event.bind; // source collection binding
  event.change; // "search" | "filter" | "sort"
  event.query; // { search, filters, sort: { column, direction } | null }
  // Refresh model.data as appropriate, then callScreen with the retained model.
}
```

Repeat queries, rerenders, pagination, and capacity changes do not emit query
events. Standard local array processing still applies after a program responds.
Registered providers use the same pending-screen operations as bound arrays. The
deliberate query-event option remains separate from ordinary browsing; programs
should use it only when a changed query requires program work.

## Element identity and protocol

Controls, actions, custom descriptors, and layout regions accept explicit IDs.
Omitted IDs use a canonical fingerprint of the element kind, binding, and stable
metadata such as its label/title. Values, query/page state, child collections,
and global sibling positions do not enter identity. All explicit screen IDs are
reserved before implicit IDs are generated; duplicates are rejected. A binding
reference in a layout resolves centrally to its declared controls. Each resolved
element has one placement; use separate declarations for repeated bindings.

Hash collisions and identical declarations use occurrence ordinals within their
collision group. Inserting unrelated elements preserves existing IDs. Removing
or reordering indistinguishable duplicates cannot preserve their individual
identity reliably; give them explicit IDs when that distinction matters. List
column IDs are local to their list. DOM IDs additionally include the
presentation surface and model instance, avoiding collisions between
simultaneous screens. Custom component internals remain owned by the providing
program package.

Programs supply custom browser code through `customElements`, using a
same-origin `module` URL, optional `styles`, JSON `config`, and `preserve: true`
for retained instances. UUI loads these assets only when the element is
rendered. A package can publish built files in `public/` and reference them
with:

```ts
customElements: [{
  id: "editor",
  module: packageAssetURL("example/editor", "editor.js"),
  styles: [packageAssetURL("example/editor", "editor.css")],
  preserve: true,
  config: { documentId },
}];
```

The browser module default-exports `mount(context)` using the browser-only types
in `/p/the8020/uui/custom_element.ts`. The context supplies `host`, live
`config`, an abort `signal`, `renderText` for text and `[[icon=...]]` markup,
and `send(action, value)` through the owning screen's normal interaction gate.
Return an object with optional `update`, `captureState`, `setActive`, and
`dispose` methods. Async mounts must observe cancellation; a late returned
instance is disposed automatically. The program owns the wrapper's contents,
scoped CSS, dependencies, and any additional assets. Use content-hashed build
filenames for immutable caching; unversioned files use ETag revalidation.

Custom fields use the same descriptor in
`field(schema, { custom: descriptor })`. The host exposes the current `control`,
`value`, and `setValue(value)`; writes use ordinary dirty bindings and reactive
change events, and read-only/hidden controls reject edits. `length` and
`rowSpan` use the normal field grid. A component's `update` reads the current
context after server redraws or another control changes the same binding.

Define an agent fallback once in the component descriptor. Inputs and outputs
address named paths relative to its bound value; `""` means the whole value.
Outputs are read-only, and actions use the component's existing screen events:

```ts
fallback: {
  inputs: [{ name: "input", path: "input", label: "Input", multiline: true }],
  outputs: [{ name: "output", path: "output", label: "Output" }],
  actions: [{ name: "run", label: "Run", event: "run" }],
}
```

The code editor already supplies its `value` input. The sandbox's `uui` command
can inspect it with `uui screen` and edit it with
`uui set FIELD/value --file source.ts`. The shipped `the8020-dev-uui-control`
skill documents session creation, commands, value help, and browser takeover
through the URL returned by `uui url`.

Every component can write presentation metadata through `context.state`, which
is its entry in `model.screen.elements[id]`. Use `scroll` for its scroll offsets
and `data` for component-specific JSON such as selection or expansion. `data`
has a 32,768-character JSON limit, eight nesting levels, 128 properties per
object, and 256 items per array. Built-in components use the same
`screenElement(state, id)` accessor. Optional `captureState()` flushes pending
local metadata before normal interactions and redraws. State survives redraw,
navigation, and reload after synchronization; `Model.resetScreen()` clears it.
Scroll never sends standalone network messages. Business values belong in the
model rather than metadata.

## Code editor

```ts
import { codeEditor, field, z } from "/p/the8020/uui/mod.ts";

const schema = z.object({
  source: field(z.string(), {
    label: "Source",
    custom: codeEditor({
      language: "typescript",
      markers: [{ line: 12, kind: "added", label: "+" }],
    }),
    length: "long",
    rowSpan: 5,
    readOnly: false,
    reactive: false,
  }),
});
```

The optional [CodeMirror 6](https://codemirror.net/) component and its selected
language load on demand from vendored shell assets. The checked-in browser
bundles need no editor installation or CDN access at runtime; `vendor.sh` only
refreshes dependencies during development. Supported modes are `text`,
`javascript`, `typescript`, `jsx`, `tsx`, `json`, `html`, `css`, `sql`,
`python`, `markdown`, `yaml`, `go`, `shell`, and `toml`. Structural diagnostics
use the local parser, without resolving imports, types, or external symbols.
Text, Markdown, SQL, Go, shell, and TOML have highlighting only.
`syntaxCheck: false` disables checks; use it for partial source excerpts.
Diagnostics do not block model submission or replace schema validation.

The editor follows the UUI light/dark palette and includes Copy all, undo/redo,
content fullscreen, and remembered scroll/selection. Tab retains native focus
navigation. `wrap` enables line wrapping. `firstLine` offsets source-excerpt
line numbers; `revealLine` selects the initial viewport until retained state
exists. `markers` accepts one-based line numbers with `added`, `removed`,
`error`, or `breakpoint` styling and optional gutter labels (including icon
markup). Markers refer to displayed lines; callers supply diff or debugger data.
The terminated program uses a read-only excerpt with original line numbers and
an error marker. Program-owned custom modules can wrap the editor's default
mount and use the returned `editor` (native `EditorView`) for commands and
extensions; the vendored library exports the shared CodeMirror state/view
primitives.

Protocol version 12 carries generic ID/data channel frames. Each screen snapshot
carries `state`, element-specific `lists`, and `channelGeneration`. List
bindings in the wire business model are empty arrays; displayed rows live in
`lists[].rows`. The list's `update` operation on the common namespace carries
page/capacity/query/refresh/selection with validated dirty edits and
presentation metadata; multi-list capacity updates commit as one transaction.
Independent reads use that namespace's `read` operation. Selections, edits and
reads use the mappings retained by the pending call without comparing list
identity, revision, source order or contents. Row bounds, schema validation and
editability checks remain list-owned.

## Binary streams

A byte stream is sent as the data through the same interface in either
direction:

```ts
const handle = widget.send(
  "bytes",
  ReadableStream.from([
    new Uint8Array([0, 255, 42]),
  ]),
);
await handle.done;
// handle.cancel() cancels this transfer.
```

Handle streams in the same browser subscriber used for ordinary messages (extend
that callback rather than installing a second one). Return the consumption
promise so the sender can observe completion or failure:

```js
context.channel.subscribe("bytes", async (_id, data) => {
  if (data instanceof ReadableStream) {
    const bytes = new Uint8Array(await new Response(data).arrayBuffer());
    context.host.textContent = String(bytes.length);
  }
});
// Reverse direction:
await context.channel.send(
  "upload",
  ReadableStream.from([
    new Uint8Array([128, 0, 7]),
  ]),
).done;
```

Streams require exactly one matching active subscriber, which owns consumption;
zero or multiple matching subscribers reject the transfer before source demand.
Unrelated subscriptions do not affect stream admission. The same wildcard
matcher filters ordinary data and stream-open delivery. Consume EOF and resolve
only after consumption or the domain's native handoff is accepted. Early
completion, a thrown/rejected subscriber, producer failure or stream
cancellation rejects the sender's `done`. Ordinary data may still fan out. The
core never buffers missing-listener traffic or duplicates a byte stream.

`channel_streams.ts` retains the sole binary codec, lazy pump and
consumption-credit implementation. Generic callers need no configuration. The
transport splits source chunks into at most 64 KiB frames, bounds individual
source chunks at 64 MiB, and uses four frames per stream. The stream-open frame
advertises its window so a smaller sender window is respected. Credit follows
pending reads and includes queued/in-flight reservations. There is no shared
application active-stream quota or scheduler.

Owners can pass `{ signal, policy }` as an optional third send argument when
their domain needs tighter stream bounds. Native saves retain their existing
shared policy object and startup deadline. These policies do not add required
message contracts or a separate receiving API. Streams retain screen/connection
ownership; they are transient and never replayed.

## Streaming downloads

`download(options, attachment)` starts native save through that same stream
core. Capture `channel.downloads` from an explicit pending `callScreen`, then
supply a filename and a readable byte stream or lazy async iterable:

```ts
import {
  callScreen,
  download,
  Model,
  nextScreenChannel,
  z,
} from "/p/the8020/uui/mod.ts";

const channel = nextScreenChannel();
const pending = callScreen({
  id: "export",
  schema: z.object({}),
  model: new Model({}),
});
const handle = download({
  filename: "backup.csv",
  contentType: "text/csv; charset=utf-8",
  body: csv(),
}, channel.downloads);
await pending;
```

Keep that call pending while producing the file so the UI remains interactive.
Settlement or full replacement cancels unfinished saves. Calls between screens
may prepare options, then explicitly create the next pending call and start with
its captured attachment, as the demo text/CSV producers do. Detached or saved
old attachments fail before source demand; there is no next-screen rebinding or
backlog. Ignore the handle if desired; failures are attributed to the filename
through the existing message center. Use `handle.cancel()` or await
`handle.done` while the owning screen remains pending.

For a virtual CSV file, produce one database batch at a time. In this example,
`readNextRows(afterId, limit)` is your application's query, returning rows
ordered by a unique numeric `id`, strictly after `afterId` when supplied:

```ts
async function* csv(): AsyncGenerator<Uint8Array> {
  const encoder = new TextEncoder();
  yield encoder.encode("id,name\r\n");
  let afterId: number | undefined;
  while (true) {
    const rows = await readNextRows(afterId, 1_000);
    if (rows.length === 0) return;
    yield encoder.encode(
      rows.map((row) => `${row.id},${csvCell(row.name)}\r\n`).join(""),
    );
    afterId = rows[rows.length - 1]!.id;
  }
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
```

Queries and CSV encoding belong to the program. If an export needs a consistent
database snapshot, the program must also provide that query/transaction policy.
Use the generator's `finally` block to release cursors or other resources. On
cancellation UUI calls the iterator's `return()` or the stream reader's
`cancel()`; an already running query must settle before an async generator can
finish cleanup.

Downloads share the existing authenticated WebSocket and can run concurrently.
UUI splits source chunks into at most 64 KiB frames, with a shared 16-frame
per-direction window, a 32-frame aggregate bound and at most four outstanding
frames per transfer. Credits advance as the browser consumes the stream. Memory
depends on your producer's batch/chunk size plus bounded transport buffers,
rather than total file size. Up to 32 transfers can be active under the
native-save policy. Transfers cancel on owning screen settlement/replacement,
WebSocket loss or session end; reconnect does not restart them. Source chunks
are at most 64 MiB and startup is bounded to 30 seconds.

The browser shell uses a local service worker to hand the stream to the native
download manager. File bytes never use a second backend request. This requires
HTTPS (or localhost), service workers, and transferable streams; the browser
test covers Chromium. The filename is a suggested name without a directory; the
browser chooses the destination. `done` means the native response consumed the
stream and the local service worker acknowledged handoff, not that UUI knows the
final disk path or can attest to durable storage.

Run `deno task check`, `deno task test`, rebuild with
`DENO_IMPORT_MAP="$PWD/deno.local.json" bash services/shell/build.sh`, then run
`deno task test:download-browser` for native browser download verification.

## Material icons

Use `[[icon=delete]]`, `[[icon=rocket_launch color=primary]]`, or
`[[icon=10k color=#3A7]]` in button labels, headings, or list text. The entire
vendored Google Material Symbols collection is available without registering
individual names. Browse names in the
[Google icon library](https://fonts.google.com/icons) or
`services/shell/frontend/assets/material_symbols.json` for the exact bundled
catalogue. The font is served locally and cached; clients never contact Google.
Unknown names and invalid colors remain literal text.

List cells, field hints, and column descriptions share a subtle, font-sized
ellipsis button. The text keeps its normal behavior, including row navigation
and selection. Enter or Space opens the full Markdown content; Escape returns
focus to the button. Popovers open below and to the left, stay inside the
viewport, and scroll when their content exceeds the maximum height. Column
headers inherit the shared field description, previewing up to 100 characters
and three lines before the filter and sort controls.

Browser renderers can reuse `services/shell/frontend/overflow.ts`'s
`createOverflowText(content, { label, preview: "markdown", maxCharacters: 100 })`.
Omit `maxCharacters` for width-based truncation and use the default text preview
for literal values. Append the returned element and call `disposeOverflowText`
on its owning subtree before permanent removal. `refreshOverflowText` batches
measurements when a renderer already owns a layout pass; ordinary size changes
are observed automatically. `popover.ts` owns the shared `AnchoredPopover`
controller for other local popover content.
