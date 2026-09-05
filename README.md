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
program, including hidden and non-UUI programs. Its details expose flags,
description, package, entrypoint, and active commit. **Execute** opens the
shared `the8020/jobs/run-program` form with that program selected. Enter
positional arguments as a JSON array, such as `[{"customer":"Example"},42]`.

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
**List tools** disclosure reveals quick search. Compact headings keep the full
heading accessible and available in the popover. Rows stay one line at a fixed
height; truncated cells expose complete text on click or keyboard activation.
Readable column widths overflow horizontally while vertical movement chains to
the page or modal. The toolbar reserves room for future actions; exports are not
implemented here.

The first presentation supplies one row for measurement. The browser reports
capacity from the actual page/modal viewport and list geometry; the Worker
bounds it to 1–500 rows. Resize, toolbar, and visibility changes can update
capacity; scrolling does not. Changing capacity retains the former first row
within the new page when possible. Lists below other content receive a usable
viewport budget after being scrolled into view.

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
A supplied array may be an intentionally bounded backend batch; this API does
not search rows the program has not fetched. Database search, providers, and a
`table()` search helper remain deferred.

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
simultaneous screens. Custom initializer internals remain owned by the
initializer.

Protocol version 4 carries `state` and element-specific `lists` in each screen
snapshot. List bindings in the wire business `model` are empty arrays; displayed
rows live exclusively in `lists[].rows`. Every interaction includes instance and
screen/reset revisions plus presentation-only metadata. `screen.list` carries
page/capacity/query requests. Selections and list edits name the list's
presented view revision and displayed index; the Worker owns the source-index
mapping. Stale source replacements, reorders, or content changes reject the
interaction and publish a fresh view before accepting another mapped edit. Valid
edits are schema-checked atomically before changing business data or
presentation state.

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
