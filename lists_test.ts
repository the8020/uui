import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "@std/assert";
import { z } from "/p/the8020/db/fields.ts";
import { buildControls, buildFieldCatalog, field } from "./fields.ts";
import { resolveElementIDs } from "./identifiers.ts";
import { validateLayout } from "./layout.ts";
import { queryValueHelp, ScreenLists, setListSource } from "./lists.ts";
import { Model } from "./model.ts";
import { emptyListQuery } from "./screen_state.ts";
import { field as sharedField, money } from "/p/the8020/db/fields.ts";

const schema = z.object({
  rows: z.array(
    z.object({ id: z.number(), name: z.string(), enabled: z.boolean() }),
  ),
});

Deno.test("lists use shared structure field names and Zod value types", () => {
  const summary = z.object({
    owner: sharedField(z.string(), {
      label: "Responsible user",
      description: "The **account** responsible for this work.",
    }).nullable().optional(),
    attempts: sharedField(z.int(), { label: "Attempts" }),
    amount: money().nullable(),
    enabled: sharedField(z.boolean(), { label: "Enabled" }),
  });
  const schema = z.object({ rows: summary.array() });
  const model = new Model({
    rows: [{ owner: "alice", attempts: 2, amount: "9.25", enabled: true }],
  });
  const controls = buildControls(buildFieldCatalog(schema));
  const lists = new ScreenLists(schema, controls, undefined, model.screen);
  const list = Object.values(lists.present(model.data))[0]!;
  assertEquals(
    list.columns[0]!.description,
    "The **account** responsible for this work.",
  );
  assertEquals(list.columns[1]!.description, undefined);
  assertEquals(
    list.columns.map(({ heading, semanticType }) => ({
      heading,
      semanticType,
    })),
    [
      { heading: "Responsible user", semanticType: "text" },
      { heading: "Attempts", semanticType: "number" },
      { heading: "Amount", semanticType: "decimal" },
      { heading: "Enabled", semanticType: "boolean" },
    ],
  );
});

function fixture(duplicate = false, triggerFilterEvents = false) {
  const data = {
    rows: Array.from(
      { length: 130 },
      (_, id) => ({ id, name: `Row ${id}`, enabled: id % 2 === 0 }),
    ),
  };
  const model = new Model(data);
  const layout = validateLayout({
    schema: 1,
    id: "lists",
    root: {
      type: "stack",
      children: [
        {
          id: "first",
          type: "list",
          bind: "rows",
          key: "id",
          display: ["id", "name", "enabled"],
          triggerFilterEvents,
        },
        ...(duplicate
          ? [{
            id: "second",
            type: "list",
            bind: "rows",
            key: "id",
            display: ["name"],
          }]
          : []),
      ],
    },
  });
  const lists = new ScreenLists(schema, [], layout, model.screen);
  model.screen.elements.first!.list!.pageSize = 10;
  return { data, model, layout, lists };
}

Deno.test("Model retains typed data and resets presentation state independently", () => {
  const data = { name: "original" };
  const model = new Model(data);
  assertStrictEquals(model.data, data);
  model.data.name = "edited";
  assertEquals(data.name, "edited");
  const instanceId = model.screen.instanceId;
  model.screen.scroll.y = 123;
  model.resetScreen();
  assertEquals(model.screen.scroll.y, 0);
  assertEquals(model.screen.version, 1);
  assertEquals(model.screen.instanceId, instanceId);
  assertNotEquals(new Model(data).screen.instanceId, instanceId);
  model.data = { name: "refreshed" };
  assertEquals(model.screen.instanceId, instanceId);
});

Deno.test("implicit IDs survive unrelated declarations and resolve duplicate groups", () => {
  const declarations = [{ bind: "name", label: "Name" }, {
    bind: "name",
    label: "Name",
  }, { bind: "name", label: "Other" }];
  const resolve = (
    items: Array<{ id?: string; bind: string; label: string }>,
  ) =>
    resolveElementIDs(
      items,
      (item) => ({ bind: item.bind, label: item.label }),
    );
  const original = resolve(declarations);
  assertEquals(
    resolve([{ bind: "extra", label: "Extra" }, ...declarations]).slice(1),
    original,
  );
  assertEquals(new Set(original.map((item) => item.id)).size, 3);
  assertEquals(original[0]!.id.slice(0, -1), original[1]!.id.slice(0, -1));
  assertNotEquals(original[0]!.id.slice(0, -1), original[2]!.id.slice(0, -1));
  const reserved = resolve([{
    id: original[0]!.id,
    bind: "reserved",
    label: "Reserved",
  }, ...declarations]);
  assertEquals(new Set(reserved.map((item) => item.id)).size, 4);
  assertThrows(
    () =>
      resolve([{ id: "same", bind: "a", label: "A" }, {
        id: "same",
        bind: "b",
        label: "B",
      }]),
    TypeError,
  );
  const fields = buildFieldCatalog(z.object({ name: z.string() }));
  assertEquals(buildControls(fields, declarations).length, 3);
});

Deno.test("independent list projections retain source order and stable pages", () => {
  const { data, model, lists, layout } = fixture(true);
  const source = data.rows;
  const initial = structuredClone(source);
  let shown = lists.present(data);
  const request = {
    id: "first",
    operation: "page" as const,
    page: 5,
  };
  lists.validateRequests([request]);
  lists.update(request);
  shown = lists.present(data);
  assertEquals(shown[0]!.rows[0], initial[40]);
  assertEquals(shown[1]!.rows[0], initial[0]);
  const repeated = new ScreenLists(schema, [], layout, model.screen);
  assertEquals(repeated.present(data)[0]!.state.page, 5);
  assertStrictEquals(data.rows, source);
  assertEquals(data.rows, initial);
  assertEquals(lists.presentModel(data), { rows: [] });
});

Deno.test("query processing uses typed values, resets pages, and reports array totals", () => {
  const { data, model, lists } = fixture();
  let shown = lists.present(data)[0]!;
  lists.update({
    id: "first",
    operation: "page",
    page: 5,
  });
  shown = lists.present(data)[0]!;
  const query = {
    search: "row",
    filters: { enabled: "true", id: ">=100" },
    sort: { column: "id", direction: "desc" as const },
  };
  const request = {
    id: "first",
    operation: "query" as const,
    query,
  };
  lists.validateRequests([request]);
  assertEquals(lists.update(request), undefined);
  shown = lists.present(data)[0]!;
  assertEquals(shown.state.page, 1);
  assertEquals((shown.rows[0] as { id: number }).id, 128);
  assertEquals(shown.totalItems, 15);
  assertEquals(shown.totalSourceItems, 130);
  assert(shown.filtered);
  assertEquals(model.screen.elements.first!.list!.query, query);
  const clear = {
    ...request,
    query: emptyListQuery(),
  };
  lists.update(clear);
  assertEquals(lists.present(data)[0]!.totalItems, 130);
});

Deno.test("mapped edits and selection resolve original rows after sorting and filtering", () => {
  const { data, lists } = fixture();
  lists.present(data);
  lists.update({
    id: "first",
    operation: "query",
    query: {
      search: "",
      filters: { enabled: "true" },
      sort: { column: "id", direction: "desc" },
    },
  });
  lists.present(data);
  assertEquals(
    lists.select({ id: "first", index: 1 })
      .value,
    126,
  );
  const candidate = structuredClone(data);
  lists.applyEdits(
    [{
      id: "first",
      rows: [{ index: 1, value: { ...candidate.rows[126]!, name: "Edited" } }],
    }],
    candidate,
  );
  assertEquals(candidate.rows[126]!.name, "Edited");
  assertEquals(candidate.rows[1]!.name, "Row 1");
  assertEquals(data.rows[126]!.name, "Row 126");
});

Deno.test("selections use the retained source after array replacement and row edits", () => {
  const { data, lists } = fixture();
  lists.present(data);
  const retained = data.rows;
  data.rows = structuredClone(data.rows);
  data.rows.reverse();
  retained[0]!.name = "Changed";
  assertEquals(lists.select({ id: "first", index: 0 }).value, 0);
  assertEquals(retained[0]!.name, "Changed");
});

Deno.test("query events are opt-in and do not fire for repeat queries or capacity changes", () => {
  const { data, lists } = fixture(false, true);
  lists.present(data);
  const request = {
    id: "first",
    operation: "query" as const,
    query: { ...emptyListQuery(), search: "Row 129" },
  };
  assertEquals(lists.update(request), {
    id: "first",
    bind: "rows",
    query: request.query,
    change: "search",
  });
  assertEquals(lists.update(request), undefined);
  lists.present(data);
  assertEquals(
    lists.update({
      id: "first",
      operation: "capacity",
      pageSize: 30,
    }),
    undefined,
  );
  assertEquals(lists.present(data)[0]!.totalItems, 1);
});

Deno.test("empty and implicit scalar lists retain columns and handle capacity anchors", () => {
  const scalarSchema = z.object({ values: z.array(z.number()) });
  const model = new Model({ values: [] as number[] });
  const controls = buildControls(buildFieldCatalog(scalarSchema));
  const lists = new ScreenLists(
    scalarSchema,
    controls,
    undefined,
    model.screen,
  );
  let shown = lists.present(model.data)[0]!;
  assertEquals(shown.columns.length, 1);
  assertEquals(shown.totalItems, 0);
  assertEquals(shown.totalPages, 1);
  model.data.values = Array.from({ length: 100 }, (_, index) => index);
  shown = lists.present(model.data)[0]!;
  lists.update({
    id: shown.id,
    operation: "capacity",
    pageSize: 10,
  });
  shown = lists.present(model.data)[0]!;
  lists.update({
    id: shown.id,
    operation: "page",
    page: 5,
  });
  shown = lists.present(model.data)[0]!;
  lists.update({
    id: shown.id,
    operation: "capacity",
    pageSize: 15,
  });
  shown = lists.present(model.data)[0]!;
  assert(shown.rows.includes(40));
});

Deno.test("retained providers preserve remote ordering and reject unsupported queries", async () => {
  const model = new Model({
    rows: [{ id: 20, name: "Remote match", enabled: true }, {
      id: 21,
      name: "Second",
      enabled: false,
    }],
  });
  setListSource(model, "rows", () => ({ rows: model.data.rows, more: true }), {
    searchOnly: true,
  });
  const lists = new ScreenLists(
    schema,
    [{ id: "rows", bind: "rows", control: "list", list: { key: "id" } }],
    undefined,
    model.screen,
    [],
    model,
  );
  model.screen.elements.rows!.list!.page = 11;
  model.screen.elements.rows!.list!.pageSize = 2;
  model.screen.elements.rows!.list!.query.search = "server-defined matching";
  let view = lists.present(model.data)[0]!;
  await browse(lists, [{
    id: "rows",
    operation: "refresh",
  }]);
  view = lists.present(model.data)[0]!;
  assertEquals(view.rows, model.data.rows);
  assertEquals(view.totalPages, 12);
  assertEquals(
    lists.select({ id: "rows", index: 1 })
      .value,
    21,
  );
  lists.validateRequests([{
    id: "rows",
    operation: "page",
    page: 12,
  }]);
  assertThrows(
    () =>
      lists.validateRequests([{
        id: "rows",
        operation: "page",
        page: 13,
      }]),
    TypeError,
    "out of bounds",
  );
  assertThrows(
    () =>
      lists.validateRequests([{
        id: "rows",
        operation: "query",
        query: { search: "", filters: { name: "Second" }, sort: null },
      }]),
    TypeError,
    "quick search only",
  );
  assertEquals(
    lists.update({
      id: "rows",
      operation: "capacity",
      pageSize: 4,
    }),
    undefined,
  );
});

async function browse(
  lists: ScreenLists,
  requests: import("./screen_state.ts").ListRequest[],
) {
  const staged = await lists.prepareUpdates(
    requests,
    new AbortController().signal,
  );
  staged.commit();
}

Deno.test("independent reads share the filtered sorted projection and preserve the displayed page", async () => {
  const { lists, model } = fixture();
  let shown = lists.present(model.data)[0]!;
  lists.update({
    id: shown.id,
    operation: "query",
    query: {
      search: "Row",
      filters: { enabled: "true" },
      sort: { column: "id", direction: "desc" },
    },
  });
  lists.update({
    id: shown.id,
    operation: "page",
    page: 3,
  });
  shown = lists.present(model.data)[0]!;
  const state = structuredClone(model.screen);
  const data = structuredClone(model.data);
  const request = {
    id: shown.id,
    offset: 9,
    limit: 1000,
  };
  const page = await lists.read(request);
  assertEquals(
    page.rows.map((row) => (row as { id: number }).id),
    Array.from({ length: 56 }, (_, i) => 110 - i * 2),
  );
  assertEquals(page.totalItems, 65);
  assertEquals(page.more, false);
  assertEquals(model.screen, state);
  assertEquals(model.data, data);
  assertEquals(lists.present(model.data)[0], shown);
  for (
    const invalid of [{ offset: -1 }, { limit: 1001 }, { limit: 0 }, {
      offset: 0.5,
    }]
  ) {
    await assertRejects(
      () => lists.read({ ...request, ...invalid }),
      TypeError,
    );
  }
  model.data.rows[0]!.name = "changed";
  assertEquals((await lists.read(request)).rows.at(-1), {
    id: 0,
    name: "changed",
    enabled: true,
  });
});

Deno.test("page-source readers fill independent pages in bounded batches without changing the program page", async () => {
  const model = new Model({ rows: [{ id: 0, name: "Row 0", enabled: true }] });
  const layout = validateLayout({
    schema: 1,
    id: "remote",
    root: {
      id: "rows",
      type: "list",
      bind: "rows",
    },
  });
  const requests: Array<{ offset: number; limit: number }> = [];
  setListSource(model, "rows", ({ offset, limit }) => {
    requests.push({ offset, limit });
    return {
      rows: Array.from(
        { length: Math.max(0, Math.min(limit, 1205 - offset)) },
        (_, i) => ({
          id: offset + i,
          name: `Row ${offset + i}`,
          enabled: true,
        }),
      ),
      more: offset + limit < 1205,
    };
  });
  const lists = new ScreenLists(schema, [], layout, model.screen, [], model);
  const shown = lists.present(model.data)[0]!;
  const request = {
    id: shown.id,
    offset: 0,
    limit: 1000,
  };
  assertEquals((await lists.read(request)).rows.length, 1000);
  assertEquals(requests, [{ offset: 0, limit: 500 }, {
    offset: 500,
    limit: 500,
  }]);
  const last = await lists.read({ ...request, offset: 1000 });
  assertEquals(last.totalItems, 1205);
  assertEquals(last.rows.length, 205);
  assertEquals(last.more, false);
  const beyond = await lists.read({ ...request, offset: 2000 });
  assertEquals(beyond.rows, []);
  assertEquals(beyond.totalItems, undefined);
  assertEquals(model.data.rows.length, 1);
  assertEquals(model.screen.elements.rows!.list!.pageSize, 1);
  assertEquals(lists.present(model.data)[0], shown);
});

Deno.test("list source disposal cancels pending batches and typed results cannot bypass the owning row schema", async () => {
  const model = new Model({ rows: [{ id: 0, name: "Row", enabled: true }] });
  const layout = validateLayout({
    schema: 1,
    id: "source",
    root: {
      type: "list",
      id: "rows",
      bind: "rows",
    },
  });
  const gate = Promise.withResolvers<{ rows: unknown[]; more: boolean }>();
  let signal: AbortSignal | undefined;
  let calls = 0;
  const dispose = setListSource(model, "rows", (request) => {
    signal = request.signal;
    calls++;
    return gate.promise;
  });
  const lists = new ScreenLists(schema, [], layout, model.screen, [], model);
  lists.present(model.data);
  const request = {
    id: "rows",
    offset: 0,
    limit: 1000,
  };
  const pending = lists.read(request);
  dispose();
  assertEquals(signal?.aborted, true);
  gate.resolve({ rows: [{ id: 1, name: "Late", enabled: true }], more: true });
  await assertRejects(() => pending, DOMException);
  assertEquals(calls, 1);
  const remove = setListSource(
    model,
    "rows",
    () => ({ rows: [{ id: "wrong" }], more: false }),
  );
  try {
    lists.present(model.data);
    await assertRejects(
      () => lists.read(request),
      z.ZodError,
    );
    assertEquals(model.data.rows, [{ id: 0, name: "Row", enabled: true }]);
  } finally {
    remove();
  }
});

Deno.test("provider updates stage rows and totals atomically and require explicit schema rebuilds", async () => {
  const model = new Model({
    rows: [{ id: 0, name: "Original", enabled: true }],
  });
  let result: unknown = { rows: [{ id: "wrong" }], more: false };
  setListSource(
    model,
    "rows",
    () => result as import("./lists.ts").ListSourcePage,
  );
  const lists = new ScreenLists(
    schema,
    [{ id: "rows", bind: "rows", control: "list" }],
    undefined,
    model.screen,
    [],
    model,
  );
  lists.present(model.data);
  const before = structuredClone(model.screen);
  const request = {
    id: "rows",
    operation: "query" as const,
    query: { search: "new", filters: {}, sort: null },
  };
  for (
    const invalid of [
      result,
      { rows: [], more: true },
      { rows: [], more: false, totalItems: -1 },
      { rows: model.data.rows, more: true, totalItems: 1 },
      {
        rows: model.data.rows,
        more: false,
        totalItems: 1,
        totalSourceItems: 0,
      },
      {
        rows: model.data.rows,
        more: false,
        schema: z.object({ id: z.string() }),
      },
    ]
  ) {
    result = invalid;
    await assertRejects(() => browse(lists, [request]));
    assertEquals(model.screen, before);
    assertEquals(model.data.rows, [{ id: 0, name: "Original", enabled: true }]);
  }
  result = {
    rows: [{ id: 9, name: "Fresh", enabled: false }],
    more: false,
    totalItems: 1,
    totalSourceItems: 7,
  };
  await browse(lists, [request]);
  const fresh = lists.present(model.data)[0]!;
  assertEquals([
    fresh.state.query.search,
    fresh.totalItems,
    fresh.totalSourceItems,
    fresh.source?.more,
  ], ["new", 1, 7, false]);
  const rebuiltSchema = z.object({
    rows: z.object({ key: z.string(), rank: z.number() }).array(),
  });
  model.data.rows = [];
  result = {
    rows: [{ key: "new-contract", rank: 2 }],
    more: false,
    schema: rebuiltSchema.shape.rows.element,
  };
  const rebuilt = new ScreenLists(
    rebuiltSchema,
    [{ id: "rows", bind: "rows", control: "list" }],
    undefined,
    model.screen,
    [],
    model,
  );
  rebuilt.present(model.data);
  await browse(rebuilt, [{
    id: "rows",
    operation: "refresh",
  }]);
  assertEquals(
    rebuilt.present(model.data)[0]!.columns.map((column) => column.key),
    ["key", "rank"],
  );
});

Deno.test("provider replacement disposal and reset cancel visible work", async () => {
  for (const action of ["replace", "dispose", "reset"]) {
    const model = new Model({
      rows: [{ id: 0, name: "Original", enabled: true }],
    });
    const gate = Promise.withResolvers<import("./lists.ts").ListSourcePage>();
    let signal: AbortSignal | undefined;
    const dispose = setListSource(model, "rows", (request) => {
      signal = request.signal;
      return gate.promise;
    });
    const lists = new ScreenLists(
      schema,
      [{ id: "rows", bind: "rows", control: "list" }],
      undefined,
      model.screen,
      [],
      model,
    );
    lists.present(model.data);
    const pending = browse(lists, [{
      id: "rows",
      operation: "refresh",
    }]);
    if (action === "reset") model.resetScreen();
    else if (action === "dispose") dispose();
    else setListSource(model, "rows", () => ({ rows: [], more: false }));
    assertEquals(signal?.aborted, true);
    gate.resolve({
      rows: [{ id: 99, name: "Late", enabled: true }],
      more: false,
      totalItems: 100,
    });
    await assertRejects(() => pending, DOMException);
    assertEquals(model.data.rows[0]!.name, "Original");
  }
});

Deno.test("mapped row edits preserve readonly schema fields and complete rows", () => {
  const row = z.object({
    key: field(z.string(), { readOnly: true }).optional(),
    value: z.number(),
    locked: z.string().readonly().optional(),
  });
  const model = new Model({
    rows: [{ key: "original", value: 1, locked: "fixed" }],
  });
  const lists = new ScreenLists(
    z.object({ rows: row.array() }),
    [{ id: "rows", bind: "rows", control: "list" }],
    undefined,
    model.screen,
  );
  lists.present(model.data);
  const edit = (value: unknown) =>
    lists.applyEdits(
      [{ id: "rows", rows: [{ index: 0, value }] }],
      structuredClone(model.data),
    );
  assertThrows(
    () => edit({ key: "changed", value: 2, locked: "fixed" }),
    TypeError,
    "read-only",
  );
  assertThrows(
    () => edit({ key: "original", value: 2, locked: "changed" }),
    TypeError,
    "read-only",
  );
  assertThrows(() => edit({ value: 2 }), TypeError, "read-only");
  edit({ key: "original", value: 2, locked: "fixed" });
  assertEquals(model.data.rows[0]!.value, 1);
  const selectionModel = new Model({
    rows: [{ key: "original", selected: false }],
  });
  const selected = new ScreenLists(
    z.object({
      rows: field(
        z.object({ key: z.string(), selected: z.boolean() }).array(),
        { readOnly: true },
      ),
    }),
    [{
      id: "rows",
      bind: "rows",
      control: "list",
      readOnly: true,
      list: { selection: "selected" },
    }],
    undefined,
    selectionModel.screen,
  );
  selected.present(selectionModel.data);
  const candidate = structuredClone(selectionModel.data);
  selected.applySelection(
    [{
      id: "rows",
      operation: "selection",
      selected: true,
    }],
    candidate,
  );
  assertEquals(candidate.rows, [{ key: "original", selected: true }]);
  const explicit = new ScreenLists(
    z.object({
      rows: z.object({ key: z.string(), selected: z.boolean() }).array(),
    }),
    [{ id: "control", bind: "rows", control: "list", readOnly: true }],
    {
      schema: 1,
      id: "readonly-layout",
      root: { id: "readonly-view", type: "list", bind: "rows" },
    },
    selectionModel.screen,
  );
  const explicitView = explicit.present(selectionModel.data)[0]!;
  assertThrows(
    () =>
      explicit.applyEdits(
        [{
          id: explicitView.id,
          rows: [{ index: 0, value: { key: "forged", selected: false } }],
        }],
        candidate,
      ),
    TypeError,
    "read-only",
  );
  assertThrows(
    () =>
      selected.applyEdits(
        [{
          id: "rows",
          rows: [{ index: 0, value: { key: "forged", selected: true } }],
        }],
        candidate,
      ),
    TypeError,
    "read-only",
  );
});

Deno.test("provider results retain unfiltered geometry across searches and rebuilds", async () => {
  const model = new Model({ rows: [{ id: 1, name: "One", enabled: true }] });
  let more = true;
  let totalItems: number | undefined = undefined;
  setListSource(
    model,
    "rows",
    () => ({ rows: model.data.rows, more, totalItems }),
  );
  const show = async () => {
    const lists = new ScreenLists(
      schema,
      [{ id: "rows", bind: "rows", control: "list" }],
      undefined,
      model.screen,
      [],
      model,
    );
    lists.present(model.data);
    await browse(lists, [{
      id: "rows",
      operation: "refresh",
    }]);
    return lists.present(model.data)[0]!;
  };
  assertEquals((await show()).totalSourceItems, 2);
  const state = model.screen.elements.rows!.list!;
  state.pageSize = 10;
  model.data.rows = Array.from(
    { length: 10 },
    (_, id) => ({ id, name: String(id), enabled: true }),
  );
  assertEquals((await show()).totalSourceItems, 11);
  state.query.search = "no matches";
  model.data.rows = [];
  more = false;
  totalItems = 0;
  assertEquals((await show()).totalSourceItems, 11);
  assertEquals((await show()).totalPages, 1);
  state.query.search = "";
  assertEquals((await show()).totalSourceItems, 0);
});

Deno.test("value help uses ordinary multi-column typed queries before paging", () => {
  const schema = z.object({
    key: z.string(),
    rank: z.number(),
    amount: money(),
    enabled: z.boolean(),
  });
  const rows = [
    { key: "first", rank: 100, amount: "90071992547409.91", enabled: true },
    { key: "second", rank: 2, amount: "90071992547409.92", enabled: true },
    { key: "third", rank: 10, amount: "0.00", enabled: false },
  ];
  const read = (filters: Record<string, string>, column: string, offset = 0) =>
    queryValueHelp(schema, rows, {
      query: { search: "", filters, sort: { column, direction: "asc" } },
      offset,
      limit: 1,
    });
  assertEquals(read({}, "rank").rows, [rows[1]!]);
  const page = read({ enabled: "true" }, "amount", 1);
  assertEquals(page.rows, [rows[1]!]);
  assertEquals([page.more, page.totalItems, page.totalSourceItems], [
    false,
    2,
    3,
  ]);
  assertEquals(read({ amount: ">90071992547409.91" }, "amount").rows, [
    rows[1]!,
  ]);
  assertThrows(() => read({ missing: "x" }, "key"), TypeError);
});

Deno.test("selection requires an editable boolean in a complete row collection", () => {
  const make = (selection: string, provider = false) => {
    const model = new Model({ rows: [] });
    if (provider) {
      setListSource(model, "rows", () => ({ rows: [], more: false }));
    }
    return new ScreenLists(
      schema,
      [{
        id: "rows",
        bind: "rows",
        control: "list",
        list: { selection },
      }],
      undefined,
      model.screen,
      [],
      model,
    );
  };
  assertThrows(() => make("id"), TypeError, "boolean");
  assertThrows(() => make("missing"), TypeError, "boolean");
  assertThrows(() => make("__proto__.selected"), TypeError, "field path");
  assertThrows(
    () => make("enabled", true),
    TypeError,
    "complete bound array",
  );
  const lists = make("enabled");
  const model = { rows: [{ id: 1, name: "One", enabled: false }] };
  const snapshot = lists.present(model)[0]!;
  assertEquals(snapshot.columns.map((column) => column.key), ["id", "name"]);
  assertThrows(
    () =>
      lists.validateRequests([{
        id: "rows",
        operation: "selection",
        selected: true,
        range: { from: 0, to: 1 },
      }]),
    TypeError,
    "selection range",
  );
  setListSource(lists.model!, "rows", () => ({ rows: [], more: false }));
  assertThrows(() => lists.present(model), TypeError, "complete bound array");
});
