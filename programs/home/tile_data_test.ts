import { assertEquals, assertThrows } from "@std/assert";
import { readTileData, tileData } from "./tile_data.ts";

Deno.test("tile data keeps bounded display fields", () => {
  assertEquals(
    tileData({ value: 12, detail: "3 disabled", status: "warning" }),
    {
      value: "12",
      detail: "3 disabled",
      status: "warning",
    },
  );
  assertEquals(tileData({}), {});
  for (
    const [value, message] of [
      [null, "must be an object"],
      [{ value: "x", extra: 1 }, "unknown tile data field extra"],
      [{ status: "red" }, "status must be"],
      [{ value: "x".repeat(25) }, "value must be text"],
      [{ detail: {} }, "detail must be text"],
    ] as const
  ) assertThrows(() => tileData(value), TypeError, message);
});

Deno.test("tile data programs report results, failures and timeouts", async () => {
  const root = await Deno.makeTempDir({ prefix: "the8020-tile-data-" });
  const error = console.error;
  const logged: string[] = [];
  console.error = (message: string) => void logged.push(message);
  try {
    const program = async (name: string, source: string) => {
      const dir = `${root}/acme/orders/programs/${name}`;
      await Deno.mkdir(dir, { recursive: true });
      await Deno.writeTextFile(
        `${dir}/program.toml`,
        `schema = 1\ndescription = "${name}"\n`,
      );
      await Deno.writeTextFile(`${dir}/program.ts`, source);
    };
    await program(
      "counts",
      "export default (scope) => ({ value: 7, detail: `open ${scope}` });",
    );
    await program("broken", 'export default () => { throw new Error("no"); };');
    await program("invalid", 'export default () => ({ status: "red" });');
    await program("slow", "export default () => new Promise(() => {});");
    const read = (name: string, args: string[] = [], timeout?: number) =>
      readTileData(
        `acme/orders/${name}`,
        { program: `acme/orders/${name}`, arguments: args },
        root,
        timeout,
      );
    assertEquals(await read("counts", ["today"]), {
      tile: "acme/orders/counts",
      value: "7",
      detail: "open today",
    });
    for (const name of ["broken", "invalid"]) {
      assertEquals(await read(name), {
        tile: `acme/orders/${name}`,
        error: true,
      });
    }
    assertEquals(await read("slow", [], 50), {
      tile: "acme/orders/slow",
      error: true,
    });
    assertEquals(logged.length, 3);
    assertEquals(logged[2]!.includes("timed out after 50 ms"), true);
  } finally {
    console.error = error;
    await Deno.remove(root, { recursive: true });
  }
});
