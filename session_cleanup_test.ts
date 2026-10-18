import { assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import {
  kernelDatabaseBackendSymbol,
  kernelInvokeSymbol,
} from "@the8020/kernel";
import { createTableSQL } from "/p/the8020/db/internal/ddl.ts";

Deno.test("hourly cleanup removes only confirmed obsolete sessions across bounded pages", async () => {
  const globals = globalThis as unknown as Record<symbol, unknown>;
  const previousBackend = globals[kernelDatabaseBackendSymbol];
  const previousInvoke = globals[kernelInvokeSymbol];
  globals[kernelDatabaseBackendSymbol] = "sqlite";
  const { cleanupSessions } = await import("./session_cleanup.ts");
  const { descriptorOf } = await import("/p/the8020/db/mod.ts");
  const { default: Sessions } = await import("./tables/sessions.ts");
  const database = new DatabaseSync(":memory:");
  database.exec(createTableSQL("sqlite", descriptorOf(Sessions)));
  const now = new Date("2026-10-18T12:00:00.000Z");
  const old = new Date("2026-10-11T12:00:00.000Z");
  const inspected: string[] = [];
  const failures = [
    "timeout",
    "unavailable",
    "application_error",
    "function_not_found",
    "target_mismatch",
  ];
  globals[kernelInvokeSymbol] = (
    operation: string,
    input: Record<string, unknown>,
  ) => {
    if (operation === "worker.invoke") {
      const id = (input.input as { sessionId: string }).sessionId;
      inspected.push(id);
      assertEquals(input.function, "uui.session.inspect");
      assertEquals(input.persistentExecutionId, "pex-0123456789");
      const number = Number(id.slice(4));
      if (number === 0 || number === 1) {
        return Promise.resolve({
          ok: true,
          output: { state: number ? "DISCONNECTED" : "CONNECTED" },
        });
      }
      if (number >= 2 && number < 7) {
        return Promise.resolve({
          ok: false,
          error: { code: failures[number - 2], message: "Try later" },
        });
      }
      if (number === 7) {
        database.prepare(
          "UPDATE the8020__uui__sessions SET updatedAt = ? WHERE sessionId = ?",
        ).run(now.toISOString(), id);
      }
      return Promise.resolve({
        ok: false,
        error: { code: "target_not_found", message: "Worker no longer exists" },
      });
    }
    assertEquals(operation, "database.execute");
    const sql = String(input.statement);
    if (sql.startsWith("select")) assertEquals(sql.includes("limit"), true);
    const statement = database.prepare(sql);
    const parameters = (input.parameters as unknown[]).map((value) => {
      if (value !== null && typeof value === "object") {
        return String((value as { value: unknown }).value);
      }
      return value as string | number | null;
    });
    if (input.return_rows) {
      const rows = statement.all(...parameters);
      const columns = statement.columns().map((column) => column.name);
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
  try {
    // More than two pages, with equal timestamps, proves deletion-safe keyset paging.
    for (let i = 0; i < 215; i++) {
      database.prepare(`INSERT INTO the8020__uui__sessions
        (sessionId, serviceId, persistentExecutionId, nodeId, sandboxId, workerId,
         authenticatedUserId, authenticatedUser, latestIpAddress, latestNetworkScope,
         state, createdAt, updatedAt, lastConnectionAt, currentScreenId, terminationFailure)
        VALUES (?, 'the8020/uui/session', 'pex-0123456789', 'nod-0123456789', 'sbx-0123456789', 'wrk-0123456789',
          'user:alice', 'alice', '127.0.0.1', 'loopback', 'CONNECTED', ?, ?, ?, NULL, NULL)`)
        .run(
          `uis-${String(i).padStart(10, "0")}`,
          old.toISOString(),
          (i === 214 ? now : old).toISOString(),
          old.toISOString(),
        );
    }
    const result = await cleanupSessions(now);
    assertEquals(result, {
      scanned: 214,
      removed: 206,
      unavailable: 5,
      complete: true,
    });
    assertEquals(new Set(inspected).size, 214);
    assertEquals(inspected.includes("uis-0000000214"), false);
    assertEquals(
      database.prepare("SELECT count(*) AS n FROM the8020__uui__sessions")
        .get()!.n,
      9,
    );
    assertEquals((await cleanupSessions(now)).removed, 0);
  } finally {
    globals[kernelDatabaseBackendSymbol] = previousBackend;
    globals[kernelInvokeSymbol] = previousInvoke;
    database.close();
  }
});
