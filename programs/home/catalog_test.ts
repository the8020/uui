import { assertEquals } from "@std/assert";
import { homeCatalog, permittedTiles } from "./catalog.ts";

async function write(root: string, path: string, text: string) {
  await Deno.mkdir(`${root}/${path.split("/").slice(0, -1).join("/")}`, {
    recursive: true,
  });
  await Deno.writeTextFile(`${root}/${path}`, text);
}

Deno.test("Home catalog resolves widgets and adds default tiles for the rest", async () => {
  const root = await Deno.makeTempDir({ prefix: "the8020-home-catalog-" });
  const error = console.error;
  const logged: string[] = [];
  console.error = (message: string) => void logged.push(message);
  try {
    const program = (id: string, flags = "uui = true\n") =>
      write(
        root,
        `acme/orders/programs/${id}/program.toml`,
        `schema = 1\ndescription = "${id} program"\n${flags}`,
      );
    await program("orders");
    await program("reports");
    await program("hidden", "uui = true\ndiscoverable = false\n");
    await program("job", "");
    await program("status", "");
    await write(
      root,
      "acme/orders/widgets/orders.toml",
      `schema = 1
title = "Orders"
icon = "receipt"
category = "sales"
order = 5
[open]
program = "acme/orders/orders"
arguments = ["open"]
[data]
program = "acme/orders/status"
refresh = 30
`,
    );
    await write(
      root,
      "acme/orders/widgets/hidden.toml",
      `schema = 1\ntitle = "Hidden"\n[open]\nprogram = "acme/orders/hidden"\n[data]\nprogram = "acme/orders/reports"\n`,
    );
    await write(
      root,
      "acme/orders/widgets/job.toml",
      `schema = 1\ntitle = "Job"\n[open]\nprogram = "acme/orders/job"\n`,
    );
    await write(
      root,
      "acme/orders/widgets/categories.toml",
      `[sales]\ntitle = "Sales"\n`,
    );
    const catalog = await homeCatalog(root);
    assertEquals(
      catalog.tiles.map((tile) => [tile.id, tile.title, tile.path[0]!.title])
        .sort(),
      [
        ["acme/orders/hidden", "Hidden", "Orders"],
        ["acme/orders/orders", "Orders", "Sales"],
        ["acme/orders/reports", "Reports", "Orders"],
      ],
    );
    assertEquals(catalog.actions.get("acme/orders/orders"), {
      program: "acme/orders/orders",
      arguments: ["open"],
    });
    assertEquals(catalog.actions.has("acme/orders/job"), false);
    assertEquals(catalog.data.get("acme/orders/orders"), {
      program: "acme/orders/status",
      arguments: [],
    });
    assertEquals(
      catalog.tiles.find((tile) => tile.id === "acme/orders/orders")?.data,
      { refresh: 30 },
    );
    // An interactive program cannot supply tile data.
    assertEquals(catalog.data.has("acme/orders/hidden"), false);
    assertEquals(logged.some((line) => line.includes("acme/orders/job")), true);
  } finally {
    console.error = error;
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("Home tiles need a declared visibility permission and platform tiles always declare one", async () => {
  const root = await Deno.makeTempDir({ prefix: "the8020-home-visible-" });
  const error = console.error;
  const logged: string[] = [];
  console.error = (message: string) => void logged.push(message);
  try {
    for (
      const id of [
        "acme/orders/orders",
        "acme/orders/report",
        "acme/orders/open",
        "the8020/users/users",
        "the8020/users/public",
        "the8020/users/plain",
      ]
    ) {
      const [namespace, pkg, program] = id.split("/");
      await write(
        root,
        `${namespace}/${pkg}/programs/${program}/program.toml`,
        `schema = 1\ndescription = "${program}"\nuui = true\n`,
      );
    }
    await write(
      root,
      "acme/orders/declarations/auth.toml",
      `"acme.orders.order.view" = "View orders; value is the country."\n`,
    );
    await write(
      root,
      "the8020/users/declarations/auth.toml",
      `"the8020.users.user.view" = "View accounts; value is username."\n`,
    );
    const widget = (path: string, program: string, visible = "") =>
      write(
        root,
        path,
        `schema = 1\ntitle = "${program}"\n[open]\nprogram = "${program}"\n${visible}`,
      );
    const visible = (action: string) => `[visible]\npermission = "${action}"\n`;
    await widget(
      "acme/orders/widgets/orders.toml",
      "acme/orders/orders",
      visible("acme.orders.order.view"),
    );
    await widget(
      "acme/orders/widgets/report.toml",
      "acme/orders/report",
      visible("acme.orders.undeclared"),
    );
    await widget("acme/orders/widgets/open.toml", "acme/orders/open");
    await widget(
      "the8020/users/widgets/users.toml",
      "the8020/users/users",
      visible("the8020.users.user.view"),
    );
    await widget("the8020/users/widgets/public.toml", "the8020/users/public");
    await widget(
      "the8020/users/widgets/plain.toml",
      "the8020/users/plain",
      "[visible]\npublic = true\n",
    );

    const catalog = await homeCatalog(root);
    // Rejected widgets never fall back to a public default tile, and platform
    // programs without a widget get none either.
    assertEquals(catalog.tiles.map((tile) => tile.id).sort(), [
      "acme/orders/open",
      "acme/orders/orders",
      "the8020/users/plain",
      "the8020/users/users",
    ]);
    assertEquals(catalog.actions.has("acme/orders/report"), false);
    assertEquals(
      logged.some((line) => line.includes("not a declared permission")),
      true,
    );
    assertEquals(
      logged.some((line) => line.includes("platform tiles need [visible]")),
      true,
    );

    const asked: string[][] = [];
    const tiles = await permittedTiles(catalog, (actions) => {
      asked.push(actions);
      return Promise.resolve(new Set(["acme.orders.order.view"]));
    });
    assertEquals(tiles.map((tile) => tile.id).sort(), [
      "acme/orders/open",
      "acme/orders/orders",
      "the8020/users/plain",
    ]);
    assertEquals(asked, [[
      "acme.orders.order.view",
      "the8020.users.user.view",
    ]]);

    // An unreadable widget suppresses its package's default tiles.
    await write(root, "acme/orders/widgets/open.toml", "schema = 1\n");
    assertEquals(
      (await homeCatalog(root)).tiles.map((tile) => tile.id).sort(),
      ["acme/orders/orders", "the8020/users/plain", "the8020/users/users"],
    );
  } finally {
    console.error = error;
    await Deno.remove(root, { recursive: true });
  }
});
