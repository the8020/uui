import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "@std/assert";
import { z } from "@the8020/http";
import { buildControls, buildFieldCatalog } from "./fields.ts";
import { resolveElementIDs } from "./identifiers.ts";
import { validateLayout } from "./layout.ts";
import { queryValueHelp, ScreenLists, StaleListView } from "./lists.ts";
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
    revision: shown[0]!.revision,
    operation: "page" as const,
    page: 5,
  };
  lists.validateRequests([request], data);
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
    revision: shown.revision,
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
    revision: shown.revision,
    operation: "query" as const,
    query,
  };
  lists.validateRequests([request], data);
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
    revision: shown.revision,
    query: emptyListQuery(),
  };
  lists.update(clear);
  assertEquals(lists.present(data)[0]!.totalItems, 130);
});

Deno.test("mapped edits and selection resolve original rows after sorting and filtering", () => {
  const { data, lists } = fixture();
  const initial = lists.present(data)[0]!;
  lists.update({
    id: "first",
    revision: initial.revision,
    operation: "query",
    query: {
      search: "",
      filters: { enabled: "true" },
      sort: { column: "id", direction: "desc" },
    },
  });
  const shown = lists.present(data)[0]!;
  assertEquals(
    lists.select({ id: "first", revision: shown.revision, index: 1 }, data)
      .value,
    126,
  );
  const candidate = structuredClone(data);
  lists.applyEdits(
    [{
      id: "first",
      revision: shown.revision,
      rows: [{ index: 1, value: { ...candidate.rows[126]!, name: "Edited" } }],
    }],
    data,
    candidate,
  );
  assertEquals(candidate.rows[126]!.name, "Edited");
  assertEquals(candidate.rows[1]!.name, "Row 1");
  assertEquals(data.rows[126]!.name, "Row 126");
});

Deno.test("stale mappings reject reordered and replaced sources even with identical values", () => {
  for (
    const mutation of [
      (data: ReturnType<typeof fixture>["data"]) => data.rows.reverse(),
      (data: ReturnType<typeof fixture>["data"]) =>
        data.rows = structuredClone(data.rows),
      (data: ReturnType<typeof fixture>["data"]) =>
        data.rows[0]!.name = "Changed",
    ]
  ) {
    const { data, lists } = fixture();
    const shown = lists.present(data)[0]!;
    mutation(data);
    assertThrows(
      () =>
        lists.select({ id: "first", revision: shown.revision, index: 0 }, data),
      StaleListView,
    );
    const fresh = lists.present(data)[0]!;
    assertNotEquals(fresh.revision, shown.revision);
  }
});

Deno.test("query events are opt-in and do not fire for repeat queries or capacity changes", () => {
  const { data, lists } = fixture(false, true);
  let shown = lists.present(data)[0]!;
  const request = {
    id: "first",
    revision: shown.revision,
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
  shown = lists.present(data)[0]!;
  assertEquals(
    lists.update({
      id: "first",
      revision: shown.revision,
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
    revision: shown.revision,
    operation: "capacity",
    pageSize: 10,
  });
  shown = lists.present(model.data)[0]!;
  lists.update({
    id: shown.id,
    revision: shown.revision,
    operation: "page",
    page: 5,
  });
  shown = lists.present(model.data)[0]!;
  lists.update({
    id: shown.id,
    revision: shown.revision,
    operation: "capacity",
    pageSize: 15,
  });
  shown = lists.present(model.data)[0]!;
  assert(shown.rows.includes(40));
});

Deno.test("page sources retain remote ordering, selection mappings, and bounded next-page access", () => {
  const model = new Model({
    rows: [{ id: 20, name: "Remote match", enabled: true }, {
      id: 21,
      name: "Second",
      enabled: false,
    }],
  });
  const layout = validateLayout({
    schema: 1,
    id: "external",
    root: {
      id: "rows",
      type: "list",
      bind: "rows",
      key: "id",
      pageSource: { more: true, searchOnly: true },
    },
  });
  const lists = new ScreenLists(
    schema,
    buildControls(buildFieldCatalog(schema)),
    layout,
    model.screen,
  );
  const state = model.screen.elements.rows!.list!;
  state.page = 11;
  state.pageSize = 2;
  state.query.search = "server-defined matching";
  const view = lists.present(model.data)[0]!;
  assertEquals(
    view.rows,
    model.data.rows,
    "page sources are not filtered or sliced again",
  );
  assertEquals(view.totalPages, 12);
  assertEquals(
    lists.select({ id: "rows", revision: view.revision, index: 1 }, model.data)
      .value,
    21,
  );
  lists.validateRequests([{
    id: "rows",
    revision: view.revision,
    operation: "page",
    page: 12,
  }], model.data);
  assertThrows(
    () =>
      lists.validateRequests([{
        id: "rows",
        revision: view.revision,
        operation: "page",
        page: 13,
      }], model.data),
    TypeError,
    "out of bounds",
  );
  assertThrows(
    () =>
      lists.validateRequests([{
        id: "rows",
        revision: view.revision,
        operation: "query",
        query: { search: "", filters: { name: "Second" }, sort: null },
      }], model.data),
    TypeError,
    "quick search only",
  );
  const event = lists.update({
    id: "rows",
    revision: view.revision,
    operation: "capacity",
    pageSize: 4,
  });
  assertEquals(event?.change, "capacity");
  assertEquals(state.page, 6);
  assertEquals(model.data.rows.length, 2);
});

Deno.test("independent reads share the filtered sorted projection and preserve the displayed page", async () => {
  const { lists, model } = fixture();
  let shown = lists.present(model.data)[0]!;
  lists.update({
    id: shown.id,
    revision: shown.revision,
    operation: "query",
    query: {
      search: "Row",
      filters: { enabled: "true" },
      sort: { column: "id", direction: "desc" },
    },
  });
  lists.update({
    id: shown.id,
    revision: shown.revision,
    operation: "page",
    page: 3,
  });
  shown = lists.present(model.data)[0]!;
  const state = structuredClone(model.screen);
  const data = structuredClone(model.data);
  const request = {
    id: shown.id,
    revision: shown.revision,
    offset: 9,
    limit: 1000,
  };
  const page = await lists.read(request, model.data);
  assertEquals(
    page.rows.map((row) => (row as { id: number }).id),
    Array.from({ length: 56 }, (_, i) => 110 - i * 2),
  );
  assertEquals(page.totalItems, 65);
  assertEquals(page.more, false);
  assertEquals(model.screen, state);
  assertEquals(model.data, data);
  assertStrictEquals(lists.present(model.data)[0], shown);
  for (
    const invalid of [{ offset: -1 }, { limit: 1001 }, { limit: 0 }, {
      offset: 0.5,
    }]
  ) {
    await assertRejects(
      () => lists.read({ ...request, ...invalid }, model.data),
      TypeError,
    );
  }
  model.data.rows[0]!.name = "changed";
  await assertRejects(() => lists.read(request, model.data), StaleListView);
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
      pageSource: { more: true },
    },
  });
  const requests: Array<{ offset: number; limit: number }> = [];
  const lists = new ScreenLists(schema, [], layout, model.screen, [], {
    rows: ({ offset, limit }) => {
      requests.push({ offset, limit });
      return {
        rows: Array.from(
          { length: Math.min(limit, 1205 - offset) },
          (_, i) => ({ id: offset + i }),
        ),
        more: offset + limit < 1205,
      };
    },
  });
  const shown = lists.present(model.data)[0]!;
  const request = {
    id: shown.id,
    revision: shown.revision,
    offset: 0,
    limit: 1000,
  };
  assertEquals((await lists.read(request, model.data)).rows.length, 1000);
  assertEquals(requests, [{ offset: 0, limit: 500 }, {
    offset: 500,
    limit: 500,
  }]);
  const last = await lists.read({ ...request, offset: 1000 }, model.data);
  assertEquals(last.totalItems, 1205);
  assertEquals(last.rows.length, 205);
  assertEquals(last.more, false);
  const beyond = await lists.read({ ...request, offset: 2000 }, model.data);
  assertEquals(beyond.rows, []);
  assertEquals(beyond.totalItems, undefined);
  assertEquals(model.data.rows.length, 1);
  assertEquals(model.screen.elements.rows!.list!.pageSize, 1);
  assertStrictEquals(lists.present(model.data)[0], shown);
});

Deno.test("remote list source size survives filtered pages and rebuilt screens", () => {
  const model = new Model({ rows: [{ id: 1, name: "One", enabled: true }] });
  const show = (more: boolean, totalItems?: number) => {
    const layout = validateLayout({
      schema: 1,
      id: "remote",
      root: {
        type: "list",
        id: "rows",
        bind: "rows",
        key: "id",
        pageSource: { more, totalItems },
      },
    });
    return new ScreenLists(
      schema,
      buildControls(buildFieldCatalog(schema)),
      layout,
      model.screen,
    ).present(model.data)[0]!;
  };
  assertEquals(show(true).totalSourceItems, 2);
  const state = model.screen.elements.rows!.list!;
  state.pageSize = 10;
  model.data.rows = Array.from(
    { length: 10 },
    (_, id) => ({ id, name: String(id), enabled: true }),
  );
  assertEquals(show(true).totalSourceItems, 11);
  state.query.search = "no matches";
  model.data.rows = [];
  assertEquals(show(false, 0).totalSourceItems, 11);
  assertEquals(show(false, 0).totalPages, 1);
  state.query.search = "";
  assertEquals(show(false, 0).totalSourceItems, 0);
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
