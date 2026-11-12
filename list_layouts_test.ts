import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { brandingDatabase } from "./branding_test_support.ts";
import { GLOBAL_LAYOUT_PERMISSION, listLayoutCommand } from "./list_layouts.ts";
import { type ListLayout, parseLayoutCommand } from "./list_layout.ts";
import { buildControls, buildFieldCatalog } from "./fields.ts";
import { ScreenLists } from "./lists.ts";
import { Model } from "./model.ts";
import { z } from "/p/the8020/db/fields.ts";

const layout: ListLayout = {
  columns: ["name", "id"],
  query: {
    search: "",
    filters: { id: ">2" },
    sort: { column: "id", direction: "desc" },
  },
};

Deno.test("list variants enforce owners, permission, defaults, list isolation, validation and deletion cleanup", async () => {
  using fixture = await brandingDatabase();
  const { default: Users } = await import("/p/the8020/users/tables/users.ts");
  const { default: Roles } = await import("/p/the8020/auth/tables/roles.ts");
  const { default: deleted } = await import(
    "./programs/user-deleted/program.ts"
  );
  for (const username of ["alice", "bob"]) {
    await Users.insert({
      username,
      passwordHash: "",
      enabled: true,
      authVersion: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).execute();
  }
  await Roles.insert({
    name: "alice",
    permissions: { [GLOBAL_LAYOUT_PERMISSION]: "*" },
  }).execute();
  fixture.user("alice");
  await listLayoutCommand("orders", {
    operation: "save",
    global: false,
    name: "Mine",
    layout,
  });
  await listLayoutCommand("orders", {
    operation: "default",
    global: false,
    name: "Mine",
  });
  await listLayoutCommand("orders", {
    operation: "save",
    global: true,
    name: "Company",
    layout,
  });
  await listLayoutCommand("orders", {
    operation: "default",
    global: true,
    name: "Company",
  });
  assertEquals(
    (await listLayoutCommand("orders", { operation: "list" })).canManageGlobal,
    true,
  );
  fixture.user("bob");
  const bob = await listLayoutCommand("orders", { operation: "list" });
  assertEquals(bob.personal.variants, {});
  assertEquals(bob.global.defaultName, "Company");
  assertEquals(bob.canManageGlobal, false);
  for (
    const command of [
      { operation: "save", name: "Company", layout },
      { operation: "delete", name: "Company" },
      { operation: "default", name: null },
    ]
  ) {
    await assertRejects(
      () => listLayoutCommand("orders", { ...command, global: true }),
      Error,
      "Permission denied",
    );
  }
  await listLayoutCommand("orders", {
    operation: "save",
    global: false,
    name: "Mine",
    layout: { ...layout, columns: ["id"] },
  });
  assertEquals(
    (await listLayoutCommand("orders", { operation: "list" })).personal.variants
      .Mine?.columns,
    ["id"],
  );
  assertEquals(
    (await listLayoutCommand("deliveries", { operation: "list" })).global
      .variants,
    {},
  );
  assertThrows(() =>
    parseLayoutCommand({
      operation: "save",
      global: false,
      name: "X",
      layout: { ...layout, columns: ["id", "id"] },
    })
  );
  assertThrows(() =>
    parseLayoutCommand({ operation: "list", username: "alice" })
  );
  assertThrows(() =>
    parseLayoutCommand({
      operation: "default",
      global: false,
      name: "constructor",
    })
  );
  assertThrows(() =>
    parseLayoutCommand({
      operation: "save",
      global: false,
      name: "X",
      layout: {
        ...layout,
        query: {
          ...layout.query,
          sort: { column: "id", direction: "sideways" },
        },
      },
    })
  );
  await assertRejects(() =>
    listLayoutCommand("orders", {
      operation: "default",
      global: false,
      name: "Missing",
    })
  );
  fixture.user("alice");
  assertEquals(
    (await listLayoutCommand("orders", { operation: "list" })).personal.variants
      .Mine,
    layout,
  );
  await listLayoutCommand("orders", {
    operation: "default",
    global: false,
    name: null,
  });
  assertEquals(
    (await listLayoutCommand("orders", { operation: "list" })).personal
      .defaultName,
    null,
  );
  await deleted({ name: "users.deleted", data: { username: "alice" } });
  await deleted({ name: "users.deleted", data: { username: "alice" } });
  assertEquals(
    (await listLayoutCommand("orders", { operation: "list" })).personal
      .variants,
    {},
  );
  assertEquals(
    (await listLayoutCommand("orders", { operation: "list" })).global
      .defaultName,
    "Company",
  );
  fixture.user("bob");
  assertEquals(
    (await listLayoutCommand("orders", { operation: "list" })).personal.variants
      .Mine?.columns,
    ["id"],
  );
});

Deno.test("shared ScreenLists applies personal then global defaults, retires unavailable columns and preserves source rows", async () => {
  using fixture = await brandingDatabase();
  const { default: Users } = await import("/p/the8020/users/tables/users.ts");
  await Users.insert({
    username: "bob",
    passwordHash: "",
    enabled: true,
    authVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  }).execute();
  const create = async (scope = "orders", removed = false) => {
    const schema = z.object({
      rows: z.array(
        removed
          ? z.object({ id: z.number() })
          : z.object({ id: z.number(), name: z.string() }),
      ),
    });
    const model = new Model({
      rows: [{ id: 1, name: "First" }, { id: 3, name: "Third" }, {
        id: 4,
        name: "Fourth",
      }],
    });
    const controls = buildControls(buildFieldCatalog(schema));
    const lists = new ScreenLists(
      schema,
      controls,
      undefined,
      model.screen,
      [],
      model,
    );
    await lists.initializeLayouts(scope);
    const snapshot = () => lists.present(model.data)[0]!;
    return { lists, model, snapshot, id: snapshot().id };
  };
  const first = await create();
  await first.lists.layoutCommand(first.id, {
    operation: "save",
    global: true,
    name: "Company",
    layout,
  });
  await first.lists.layoutCommand(first.id, {
    operation: "default",
    global: true,
    name: "Company",
  });
  const global = await create();
  assertEquals(global.snapshot().columns.map((column) => column.key), [
    "name",
    "id",
  ]);
  assertEquals(global.snapshot().rows, [{ id: 4, name: "Fourth" }]);
  assertEquals(global.model.data.rows.map((row) => row.id), [1, 3, 4]);
  await global.lists.layoutCommand(global.id, {
    operation: "save",
    global: false,
    name: "Own",
    layout: { columns: ["id"], query: { search: "", filters: {}, sort: null } },
  });
  await global.lists.layoutCommand(global.id, {
    operation: "default",
    global: false,
    name: "Own",
  });
  await global.lists.layoutCommand(global.id, {
    operation: "save",
    global: true,
    name: "Later",
    layout: { ...layout, columns: ["name"] },
  });
  await global.lists.layoutCommand(global.id, {
    operation: "default",
    global: true,
    name: "Later",
  });
  assertEquals(
    (await create()).snapshot().columns.map((column) => column.key),
    ["id"],
  );
  assertEquals(
    (await create("deliveries")).snapshot().columns.map((column) => column.key),
    ["id", "name"],
  );
  fixture.user("bob");
  assertEquals(
    (await create()).snapshot().columns.map((column) => column.key),
    ["name"],
  );
  const removed = await create("orders", true);
  assertEquals(removed.snapshot().columns.map((column) => column.key), ["id"]);
  assertEquals(removed.snapshot().state.query.sort, {
    column: "id",
    direction: "desc",
  });
  const built = await create("fresh");
  assertEquals(built.snapshot().state.query, {
    search: "",
    filters: {},
    sort: null,
  });
  await built.lists.prepareUpdates([{
    id: built.id,
    operation: "layout",
    columns: ["id"],
    query: layout.query,
  }], new AbortController().signal).then((tx) => tx.commit());
  assertEquals(built.snapshot().columns.map((column) => column.key), ["id"]);
  await assertRejects(() =>
    built.lists.prepareUpdates([{
      id: built.id,
      operation: "layout",
      columns: ["private"],
      query: layout.query,
    }], new AbortController().signal)
  );
});

Deno.test("built-in reset retires query columns removed by a dynamic schema", () => {
  const model = new Model({ rows: [{ id: 1 }] });
  const schema = z.object({ rows: z.array(z.object({ id: z.number() })) });
  const controls = buildControls(buildFieldCatalog(schema));
  const initial = new ScreenLists(
    schema,
    controls,
    undefined,
    model.screen,
    [],
    model,
  );
  const id = initial.present(model.data)[0]!.id;
  model.screen.elements[id]!.list!.builtInQuery = {
    search: "retained",
    filters: { removed: "yes", id: ">0" },
    sort: { column: "removed", direction: "asc" },
  };
  const next = new ScreenLists(
    schema,
    controls,
    undefined,
    model.screen,
    [],
    model,
  );
  assertEquals(next.present(model.data)[0]!.state.builtInQuery, {
    search: "retained",
    filters: { id: ">0" },
    sort: null,
  });
});
