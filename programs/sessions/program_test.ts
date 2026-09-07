import { assertEquals } from "@std/assert";
import {
  kernelDatabaseBackendSymbol,
  kernelInvokeSymbol,
} from "@the8020/kernel";

Deno.test("selected session refresh queries its identity outside the recent list window", async () => {
  const globals = globalThis as unknown as Record<symbol, unknown>;
  const previous = globals[kernelInvokeSymbol];
  const previousBackend = globals[kernelDatabaseBackendSymbol];
  globals[kernelDatabaseBackendSymbol] = "sqlite";
  globals[kernelInvokeSymbol] = (
    operation: string,
    input: Record<string, unknown>,
  ) => {
    assertEquals(operation, "database.execute");
    const statement = String(input.statement);
    assertEquals(
      statement.includes('where "the8020__uui__sessions"."sessionId" ='),
      true,
    );
    assertEquals(statement.includes("limit"), false);
    assertEquals(input.parameters, ["uis-0123456789"]);
    return Promise.resolve({
      columns: ["sessionId", "authenticatedUser"],
      rows: [["uis-0123456789", "older-user"]],
    });
  };
  try {
    const { readSession } = await import("./program.ts");
    const record = await readSession("uis-0123456789");
    assertEquals(record?.sessionId, "uis-0123456789");
    assertEquals(record?.authenticatedUser, "older-user");
  } finally {
    globals[kernelInvokeSymbol] = previous;
    globals[kernelDatabaseBackendSymbol] = previousBackend;
  }
});
