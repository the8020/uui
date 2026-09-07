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
button or press F4 on the field to open its value with the full Markdown
description. The helper owns a separate draft. **Done** validates against the
complete caller schema and applies that draft. **Close**, Back, and Escape
discard it, including invalid input. Done is shown only for editable fields.
Read-only help shows the value and description without loading editable choices.
Use `fieldHelp: false` in UUI metadata or a control declaration to suppress help
for a particular control.

The optional `valueHelp` callback runs on the server. A **Value help** list
below the value field opens with its standard search toolbar visible. Search
resets to page one; pagination and measured capacity fetch only the requested
page. Return at most the requested `limit` (1–500) of
`{ value, label, description? }` items and a `more` boolean. Raw values remain
on the server; selecting a row fills the draft, which Done commits. Enum and
explicit control options also appear in the list when there is no provider.
Callbacks should import runtime queries lazily so the same fields remain usable
during table evaluation.

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
or modal. Exports are not implemented here.

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
For server paging, declare `pageSource: { more, searchOnly? }` on the list and
bind only the current page's rows. UUI preserves their server order and
matching, without filtering or slicing that page again. Query changes return
`list-query`; page and capacity changes return `list-page`. `event.reloadLists`
identifies every page source needing a reload in that interaction. Use each
list's retained `model.screen.elements[id].list` to calculate
`(page - 1) * pageSize`, fetch up to `pageSize` rows, then call the screen again
with those rows and the new `more`. The pagination shows the current range and
available pages without claiming a known total. `searchOnly` hides and rejects
unsupported column sorts and filters. Ordinary array lists keep their existing
local query and count behavior. A `table()` search helper remains deferred.

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
in `/p/the8020/uui/custom_element.ts`. The context supplies `host`, `config`, an
abort `signal`, and `send(action, value)` through the owning screen's normal
interaction gate. Return an object with optional `update`, `setActive`, and
`dispose` methods. Async mounts must observe cancellation; a late returned
instance is disposed automatically. The program owns the wrapper's contents,
scoped CSS, dependencies, and any additional assets. Use content-hashed build
filenames for immutable caching; unversioned files use ETag revalidation.

Protocol version 7 adds program-supplied custom-element modules and supports
exact decimal list semantics and the `field-help` event, and carries `state` and
element-specific `lists` in each screen snapshot. List bindings in the wire
business `model` are empty arrays; displayed rows live exclusively in
`lists[].rows`. Every interaction includes instance and screen/reset revisions
plus presentation-only metadata. `screen.list` carries page/capacity/query
requests. Selections and list edits name the list's presented view revision and
displayed index; the Worker owns the source-index mapping. Stale source
replacements, reorders, or content changes reject the interaction and publish a
fresh view before accepting another mapped edit. Valid edits are schema-checked
atomically before changing business data or presentation state.

## Streaming downloads

`download()` starts a background download on the current UUI session. Supply a
filename and a `ReadableStream<Uint8Array>` or an `AsyncIterable<Uint8Array>`:

```ts
import { download } from "/p/the8020/uui/mod.ts";

const handle = download({
  filename: "backup.csv",
  contentType: "text/csv; charset=utf-8",
  body: csv(),
});
```

Return to your screen loop immediately to keep the UI interactive. You can
ignore the handle; UUI owns the transfer and reports background failures through
its message center. Use `handle.cancel()` to stop it, or `await handle.done`
when your program explicitly needs to wait. Awaiting completion before the next
`callScreen()` keeps that interaction pending.

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
window and at most four outstanding frames per transfer. Credits advance as the
browser consumes the stream. Memory depends on your producer's batch/chunk size
plus bounded transport buffers, rather than total file size. Up to 32 transfers
can be active in a session. Transfers survive ordinary screen/program navigation
and are cancelled on WebSocket loss or session end; reconnect does not restart
them.

The browser shell uses a local service worker to hand the stream to the native
download manager. File bytes never use a second backend request. This requires
HTTPS (or localhost), service workers, and transferable streams; the browser
test covers Chromium. The filename is a suggested name without a directory; the
browser chooses the destination. `done` means the stream was fully handed to the
browser, not that UUI knows the final disk path or can attest to durable
storage.

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
