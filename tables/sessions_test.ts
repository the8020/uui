import { assertEquals } from "@std/assert";
import { kernelDatabaseBackendSymbol } from "@the8020/kernel";

(globalThis as unknown as Record<symbol, unknown>)[
  kernelDatabaseBackendSymbol
] = "sqlite";
const { descriptorOf } = await import("@the8020/db");
const Sessions = (await import("./sessions.ts")).default;

Deno.test("UUI owns its application session metadata", () => {
  assertEquals(Sessions.table, "the8020__uui__sessions");
  assertEquals(descriptorOf(Sessions).columns[0]?.name, "sessionId");
  assertEquals(
    descriptorOf(Sessions).columns.at(-1)?.name,
    "terminationFailure",
  );
});
