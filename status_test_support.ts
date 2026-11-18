import { DatabaseSync } from "node:sqlite";
import { createTableSQL } from "/p/the8020/db/internal/ddl.ts";
import {
  kernelDatabaseBackendSymbol,
  kernelInvokeSymbol,
} from "@the8020/kernel";
import { installContextProvider } from "../kernel/defaults/config/runtime/deno/context/runtime.ts";

export async function statusTestContext() {
  const globals = globalThis as unknown as Record<symbol, unknown>;
  const previousInvoke = globals[kernelInvokeSymbol];
  const previousBackend = globals[kernelDatabaseBackendSymbol];
  globals[kernelDatabaseBackendSymbol] = "sqlite";
  const { descriptorOf } = await import("/p/the8020/db/mod.ts");
  const { default: Users } = await import("/p/the8020/users/tables/users.ts");
  const { default: Settings } = await import(
    "/p/the8020/system/tables/settings.ts"
  );
  const database = new DatabaseSync(":memory:");
  for (const table of [Users, Settings]) {
    database.exec(createTableSQL("sqlite", descriptorOf(table)));
  }
  const restoreContext = installContextProvider(() => ({
    type: "service",
    id: "the8020/uui/session",
    authenticated: true,
    username: "alice",
    userId: "user:alice",
    nodeId: "nod-status0001",
    sandboxId: "sbx-status0001",
    workerId: "wrk-status0001",
    contextId: "ctx-status0001",
    persistentExecutionId: "exe-status0001",
  }));
  const calls: string[] = [];
  globals[kernelInvokeSymbol] = (
    operation: string,
    input: Record<string, unknown>,
  ) => {
    if (operation === "database.execute") {
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
    }
    if (operation === "admin.execute" && input.command_id === "kernel.status") {
      calls.push("kernel.status");
      return Promise.resolve({
        protocol_version: 2,
        success: true,
        result: {
          build_id: "0.10.3+kernelcommit",
          instance_root: "/private/instance",
        },
      });
    }
    if (operation === "runtime.operation") {
      const request = input.input as Record<string, unknown>;
      calls.push(`${input.operation}:${request.package_id}`);
      if (input.operation === "package.repository.inspect") {
        return Promise.resolve({
          success: true,
          result: {
            repository: {
              head: "1234567890abcdef",
              clean: request.package_id !== "the8020/uui",
              remote_url: "https://private.invalid/secret",
              path: "/private/source",
            },
          },
        });
      }
    }
    throw new Error(
      `Unexpected status test operation: ${operation} ${input.operation}`,
    );
  };
  await Users.insert({
    username: "alice",
    fullName: "Alice Example",
    language: null,
  }).execute();
  database.prepare(
    "INSERT INTO the8020__system__settings (key, value, definitionHash) VALUES (?, ?, ?)",
  ).run(
    "system.profile",
    JSON.stringify({ id: "sys-status0001", name: "Status test", role: "test" }),
    "test",
  );
  return {
    calls,
    close() {
      restoreContext();
      database.close();
      globals[kernelInvokeSymbol] = previousInvoke;
      globals[kernelDatabaseBackendSymbol] = previousBackend;
    },
  };
}
