import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import {
  kernelDatabaseBackendSymbol,
  kernelInvokeSymbol,
} from "@the8020/kernel";
import { installContextProvider } from "../kernel/defaults/config/runtime/deno/context/runtime.ts";
import { createTableSQL } from "/p/the8020/db/internal/ddl.ts";
import {
  type DatabaseValue,
  decodeDatabaseValue,
  encodeDatabaseValue,
} from "/p/the8020/db/src/values.ts";

/** SQLite fixture exercises authored schemas and the real package database codec. */
export async function brandingDatabase() {
  const globals = globalThis as unknown as Record<symbol, unknown>;
  const backend = globals[kernelDatabaseBackendSymbol];
  const invoke = globals[kernelInvokeSymbol];
  globals[kernelDatabaseBackendSymbol] = "sqlite";
  const database = new DatabaseSync(":memory:");
  const { descriptorOf } = await import("/p/the8020/db/mod.ts");
  for (
    const path of [
      "./tables/branding.ts",
      "./tables/user_preferences.ts",
      "../auth/tables/roles.ts",
      "../auth/tables/user_roles.ts",
      "../auth/tables/role_includes.ts",
      "../auth/tables/failures.ts",
      "../auth/tables/grants.ts",
      "../auth/tables/audit_flags.ts",
    ]
  ) {
    const { default: table } = await import(
      new URL(path, import.meta.url).href
    );
    database.exec(createTableSQL("sqlite", descriptorOf(table)));
  }
  let username = "system";
  const restoreContext = installContextProvider(() => ({
    type: "program",
    id: "the8020/uui/system-customization",
    username,
    userId: `user:${username}`,
    authenticated: true,
    nodeId: "test",
    sandboxId: "test",
    workerId: "test",
    contextId: "test",
  }));
  globals[kernelInvokeSymbol] = (
    operation: string,
    input: Record<string, unknown>,
  ) => {
    if (operation === "database.transaction.begin") {
      database.exec("BEGIN");
      return Promise.resolve({ transaction: "branding-test" });
    }
    if (
      operation === "database.transaction.commit" ||
      operation === "database.transaction.rollback"
    ) {
      database.exec(operation.endsWith("commit") ? "COMMIT" : "ROLLBACK");
      return Promise.resolve();
    }
    if (operation !== "database.execute") {
      throw new Error(`Unexpected ${operation}`);
    }
    const statement = database.prepare(String(input.statement));
    const parameters = (input.parameters as DatabaseValue[]).map((value) => {
      if (typeof value === "object" && value?.type === "json") {
        return JSON.stringify(value.value);
      }
      const decoded = decodeDatabaseValue(value);
      return (decoded instanceof Date
        ? decoded.toISOString()
        : typeof decoded === "boolean"
        ? Number(decoded)
        : decoded) as SQLInputValue;
    });
    if (input.return_rows) {
      const rows = statement.all(...parameters);
      const columns = Object.keys(rows[0] ?? {});
      return Promise.resolve({
        columns,
        rows: rows.map((row) =>
          columns.map((column) => encodeDatabaseValue(row[column]))
        ),
      });
    }
    const result = statement.run(...parameters);
    return Promise.resolve({
      columns: [],
      rows: [],
      affected_rows: { type: "bigint", value: String(result.changes) },
    });
  };
  return {
    database,
    user(value: string) {
      username = value;
    },
    close() {
      restoreContext();
      globals[kernelInvokeSymbol] = invoke;
      globals[kernelDatabaseBackendSymbol] = backend;
      database.close();
    },
    [Symbol.dispose]() {
      this.close();
    },
  };
}
