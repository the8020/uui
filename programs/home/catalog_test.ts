import { assertEquals } from "@std/assert";
import { homeCatalog } from "./catalog.ts";

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
