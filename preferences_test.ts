import { assertEquals, assertRejects } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import {
  kernelDatabaseBackendSymbol,
  kernelInvokeSymbol,
} from "@the8020/kernel";
import { installContextProvider } from "../kernel/defaults/config/runtime/deno/context/runtime.ts";
import { createTableSQL } from "/p/the8020/db/internal/ddl.ts";
import { fetchUserPreferences, saveUserPreferences } from "./preferences.ts";

Deno.test("UUI preferences inherit per field, save only personal overrides, and clean up on user deletion", async () => {
  const globals = globalThis as unknown as Record<symbol, unknown>;
  const previousBackend = globals[kernelDatabaseBackendSymbol];
  const previousInvoke = globals[kernelInvokeSymbol];
  globals[kernelDatabaseBackendSymbol] = "sqlite";
  const { descriptorOf } = await import("/p/the8020/db/mod.ts");
  const { default: table } = await import("./tables/user_preferences.ts");
  const { default: userDeleted } = await import(
    "./programs/user-deleted/program.ts"
  );
  const database = new DatabaseSync(":memory:");
  database.exec(createTableSQL("sqlite", descriptorOf(table)));
  let authenticated = true;
  const restoreContext = installContextProvider(() => ({
    type: "program",
    id: "the8020/uui/customization",
    username: "alice",
    userId: "user:alice",
    authenticated,
    nodeId: "test",
    sandboxId: "test",
    workerId: "test",
    contextId: "test",
  }));
  globals[kernelInvokeSymbol] = (
    operation: string,
    input: Record<string, unknown>,
  ) => {
    assertEquals(operation, "database.execute");
    const statement = database.prepare(String(input.statement));
    const parameters = input.parameters as (string | null)[];
    if (input.return_rows) {
      const rows = statement.all(...parameters);
      const columns = Object.keys(rows[0] ?? {});
      return Promise.resolve({
        columns,
        rows: rows.map((row) => columns.map((column) => row[column])),
      });
    }
    const result = statement.run(...parameters);
    return Promise.resolve({
      columns: [],
      rows: [],
      affected_rows: { type: "bigint", value: String(result.changes) },
    });
  };
  const put = database.prepare(
    `INSERT INTO the8020__uui__user_preferences VALUES (?, ?)`,
  );
  try {
    assertEquals(descriptorOf(table).columns[1]?.nullable, true);
    assertEquals(await fetchUserPreferences(), { accentColor: "#5b5bd6" });
    put.run("", "#16803e");
    put.run("alice", null);
    put.run("bob", "#ff8800");
    assertEquals(await fetchUserPreferences(), { accentColor: "#16803e" });
    assertEquals(await fetchUserPreferences("bob"), { accentColor: "#ff8800" });
    const { default: shell } = await import("./services/shell/service.ts");
    const response = await shell.fetch(
      new Request("https://test/preferences?username=alice"),
      {
        signal: new AbortController().signal,
        meta: {
          contextId: "test",
          serviceId: "the8020/uui/shell",
          serviceGeneration: 1,
          canonicalBasePath: "/the8020/uui/shell",
          originalUrl: "https://test/preferences",
          client: { ipAddress: "127.0.0.1", networkScope: "loopback" },
          execution: { nodeId: "test", sandboxId: "test", workerId: "test" },
          user: { userId: "user:bob", username: "bob" },
          auth: {
            authenticated: true,
            realm: "user",
            userId: "user:bob",
            username: "bob",
          },
        },
      },
    );
    assertEquals(response.status, 200);
    assertEquals(response.headers.get("cache-control"), "no-store");
    assertEquals(await response.json(), { accentColor: "#ff8800" });
    await saveUserPreferences({ accentColor: "#AB1234" });
    assertEquals(await fetchUserPreferences(), { accentColor: "#ab1234" });
    assertEquals(await fetchUserPreferences("bob"), { accentColor: "#ff8800" });
    await assertRejects(() => saveUserPreferences({ accentColor: "red" }));
    await assertRejects(() => saveUserPreferences({ accentColor: "#fff" }));
    assertEquals(await fetchUserPreferences(), { accentColor: "#ab1234" });
    await saveUserPreferences({ accentColor: "#16803e" });
    assertEquals(
      await table.selectAll().where(table.username, "=", "alice").execute(),
      [],
    );
    await saveUserPreferences({ accentColor: "#ff8800" });
    await saveUserPreferences({ accentColor: null });
    assertEquals(await fetchUserPreferences(), { accentColor: "#16803e" });
    await saveUserPreferences({ accentColor: "#ff8800" });
    authenticated = false;
    await assertRejects(() => fetchUserPreferences(), Error, "Sign in");
    await assertRejects(
      () => saveUserPreferences({ accentColor: null }),
      Error,
      "Sign in",
    );
    authenticated = true;
    await assertRejects(() =>
      userDeleted({ name: "users.deleted", data: { username: "" } })
    );
    await userDeleted({ name: "users.deleted", data: { username: "alice" } });
    await userDeleted({ name: "users.deleted", data: { username: "alice" } });
    assertEquals(await fetchUserPreferences(), { accentColor: "#16803e" });
    assertEquals(await fetchUserPreferences("bob"), { accentColor: "#ff8800" });
    await table.delete().where(table.username, "=", "").execute();
    assertEquals(await fetchUserPreferences(), { accentColor: "#5b5bd6" });
  } finally {
    restoreContext();
    globals[kernelInvokeSymbol] = previousInvoke;
    globals[kernelDatabaseBackendSymbol] = previousBackend;
    database.close();
  }
});
