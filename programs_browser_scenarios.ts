import {
  kernelDatabaseBackendSymbol,
  type KernelInvoke,
  kernelInvokeSymbol,
  type LogPage,
  type LogQuery,
  type ProgramSummary,
} from "@the8020/kernel";
import { installContextProvider } from "../kernel/defaults/config/runtime/deno/context/runtime.ts";
import type { JobInput, JobRun } from "/p/the8020/jobs/src/types.ts";
import { callScreen, Model, z } from "./mod.ts";
import { field } from "./fields.ts";
import { DatabaseSync } from "node:sqlite";
import { username } from "/p/the8020/users/types/user.ts";

interface BrowserDriver {
  evaluate<T>(expression: string): Promise<T>;
  command<T = Record<string, unknown>>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T>;
}

const serviceId = "example/testing/api";
const runtimeWorker = {
  worker_id: "wrk-runtime001",
  owner_id: serviceId,
  workload_id: "api-version-1",
  state: "READY",
  in_flight: 2,
  entrypoint: "file:///p/example/testing/services/api/service.ts",
  release_id: "abc123",
};
const runtimeService = {
  service_id: serviceId,
  package_id: "example/testing",
  description: "Example API",
  source_entrypoint: "file:///p/example/testing/services/api/service.ts",
  canonical_base_path: "/example/testing/api",
  enabled: true,
  state: "READY",
  service_type: "stateless",
  access_mode: "public",
  desired_version: 1,
  loaded_version: 1,
  version_count: 1,
  sandbox_count: 1,
  worker_count: 1,
  sandboxes: [{
    sandbox_id: "sbx-runtime001",
    version: 1,
    worker_ids: [runtimeWorker.worker_id],
    active_requests: 2,
    active_executions: 0,
  }],
  effective_configuration: {
    execution: { anonymous_user: "robot" },
    lifecycle: { service_type: "stateless", session_keep_alive: 1800000000000 },
    scaling: {
      minimum_workers: 0,
      maximum_workers: 8,
      concurrency_per_worker: 4,
      target_utilization: 0.7,
      worker_keep_alive: 30000000000,
    },
    placement: {
      sandbox_group: "",
      minimum_sandboxes: 0,
      workers_per_sandbox: 4,
    },
  },
};

const tableId = "example__testing__people";
const tableColumns = [
  {
    name: "id",
    logical_type: "integer",
    nullable: false,
    primary_key: true,
    generated: true,
    unique: false,
  },
  {
    name: "name",
    logical_type: "text",
    nullable: false,
    primary_key: false,
    generated: false,
    unique: false,
  },
  {
    name: "parentId",
    logical_type: "integer",
    nullable: true,
    primary_key: false,
    generated: false,
    unique: false,
    reference: { table: tableId, column: "id" },
  },
];
const databaseTable = {
  table_id: tableId,
  source_package: "example/testing",
  source_commit: "abc123",
  source_module: "/p/example/testing/tables/people.ts",
  state: "active",
  synchronization_state: "synchronized",
  descriptor_hash: "fixture",
  active_columns: 3,
  retired_columns: 0,
  descriptor: { columns: tableColumns, indexes: [] },
  columns: tableColumns.map((column) => ({
    column_name: column.name,
    logical_type: column.logical_type,
    state: "active",
    definition_json: JSON.stringify(column),
  })),
  physical_columns: tableColumns.map((column) => ({
    ...column,
    type: column.logical_type === "integer" ? "INTEGER" : "TEXT",
  })),
  physical_indexes: [],
  physical_checks: [],
  differences: [],
};

const interactiveId = "example/testing/interactive";
const backgroundId = "example/testing/background";
const nodeId = "nod-0123456789";
const sandboxId = "sbx-0123456789";
const workerId = "wrk-0123456789";
const contextId = "ctx-0123456789";
let submitted: JobInput | undefined;
let sessionLogReads = 0;
const developmentCommands: string[] = [];
let developmentActivated = false;

export async function runProgramsBrowser(root: string): Promise<void> {
  const programRoot = `${root}/packages/example/testing/programs/interactive`;
  await Deno.mkdir(programRoot, { recursive: true });
  await Deno.writeTextFile(
    `${programRoot}/program.toml`,
    'schema = 1\ndescription = "Interactive fixture"\nuui = true\n',
  );
  await Deno.writeTextFile(
    `${programRoot}/program.ts`,
    `
    import { callScreen, field, Model, z } from "/p/the8020/uui/mod.ts";
    export default async function(message: string, count: number) {
      await callScreen({ id: "interactive-inputs", title: "Interactive inputs", schema: z.object({ message: field(z.string(), { readOnly: true }), count: field(z.number(), { readOnly: true }) }), model: new Model({ message, count }) });
    }
  `,
  );
  const definitions: ProgramSummary[] = [
    {
      program_id: backgroundId,
      name: "background",
      description: "Background fixture",
      uui: false,
      discoverable: false,
    },
    {
      program_id: interactiveId,
      name: "interactive",
      description: "Interactive fixture",
      uui: true,
      discoverable: true,
    },
  ].map((program) => ({
    ...program,
    package_id: "example/testing",
    commit: "abc123",
    entrypoint: "program.ts",
    entrypoint_url: `file://${programRoot}/program.ts`,
  }));
  const globals = globalThis as unknown as Record<symbol, unknown>;
  const previousInvoke = globals[kernelInvokeSymbol];
  const previousBackend = globals[kernelDatabaseBackendSymbol];
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE example__testing__people (id INTEGER PRIMARY KEY, name TEXT NOT NULL, parentId INTEGER);
    INSERT INTO example__testing__people VALUES (1, 'Avery', NULL), (2, 'Blair', 1);
    CREATE TABLE the8020__users__users (
      username TEXT PRIMARY KEY, passwordHash TEXT NOT NULL, enabled INTEGER NOT NULL,
      authVersion INTEGER NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
      fullName TEXT NOT NULL DEFAULT '');
    CREATE TABLE the8020__users__sessions (
      sessionId TEXT PRIMARY KEY, username TEXT NOT NULL, authVersion INTEGER NOT NULL,
      createdAt TEXT NOT NULL, expiresAt TEXT NOT NULL);
    CREATE TABLE the8020__uui__sessions (
      sessionId TEXT PRIMARY KEY, serviceId TEXT, persistentExecutionId TEXT, nodeId TEXT,
      sandboxId TEXT, workerId TEXT, authenticatedUserId TEXT, authenticatedUser TEXT,
      latestIpAddress TEXT, latestNetworkScope TEXT, state TEXT,
      createdAt TEXT, updatedAt TEXT, lastConnectionAt TEXT, currentScreenId TEXT, terminationFailure TEXT);
    INSERT INTO the8020__uui__sessions VALUES (
      'uis-0123456789', 'example/testing/api', 'persistent-browser', 'nod-0123456789',
      'sbx-runtime001', 'wrk-runtime001', 'user:robot', 'robot', '127.0.0.1', 'loopback', 'CONNECTED',
      '2026-09-01T10:00:00.000Z', '2026-09-01T10:00:00.000Z', '2026-09-01T10:00:00.000Z', 'welcome', NULL);
    WITH RECURSIVE recent(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM recent WHERE n < 205)
    INSERT INTO the8020__uui__sessions (sessionId, authenticatedUser, updatedAt)
    SELECT 'recent-' || n, 'another-user', '2026-09-06T10:00:00.000Z' FROM recent;
    CREATE TABLE the8020__secrets__secrets (name TEXT PRIMARY KEY, value TEXT NOT NULL, updatedAt TEXT NOT NULL);
    INSERT INTO the8020__secrets__secrets VALUES ('github', '', '2026-09-01T10:00:00.000Z');
    INSERT INTO the8020__users__users (username, passwordHash, enabled, authVersion, createdAt, updatedAt) VALUES (
      'robot', '', 1, 1, '2026-09-01T10:00:00.000Z', '2026-09-01T10:00:00.000Z');
  `);
  globals[kernelDatabaseBackendSymbol] = "sqlite";
  globals[kernelInvokeSymbol] = ((operation, input) => {
    if (operation === "worker.invoke") {
      assert(
        input.nodeId === nodeId && input.workerId === "wrk-runtime001" &&
          input.persistentExecutionId === "persistent-browser",
        "session inspection lost exact placement",
      );
      if (input.function === "uui.session.inspect") {
        database.exec(
          "UPDATE the8020__uui__sessions SET updatedAt = '2026-09-02T12:00:00.000Z' WHERE sessionId = 'uis-0123456789'",
        );
        return Promise.resolve({
          ok: true,
          output: {
            state: "CONNECTED",
            current_screen_title: "Example workspace",
          },
        });
      }
      if (input.function === "uui.session.message-log") {
        sessionLogReads++;
        return Promise.resolve({
          ok: true,
          output: { messages: [{ type: "presentation.show" }] },
        });
      }
      throw new Error("Session termination must be cancelled in this fixture");
    }

    if (operation.startsWith("database.transaction.")) {
      const action = operation.split(".").at(-1)!;
      database.exec(action === "begin" ? "BEGIN" : action.toUpperCase());
      return Promise.resolve({ transaction: "browser-transaction" });
    }
    if (operation === "database.execute") {
      if (String(input.statement).includes("the8020__secrets__secrets")) {
        assert(
          !String(input.statement).includes('"value"'),
          "credential lookup read stored values",
        );
      }
      const parameters = (input.parameters as unknown[]).map((value) => {
        if (value !== null && typeof value === "object") {
          const tagged = value as { type: string; value: string | boolean };
          return tagged.type === "boolean"
            ? Number(tagged.value)
            : tagged.value;
        }
        return typeof value === "boolean" ? Number(value) : value;
      }) as Array<string | number | null>;
      const statement = database.prepare(String(input.statement));
      if (input.return_rows) {
        const records = statement.all(...parameters);
        const columns = Object.keys(records[0] ?? {});
        return Promise.resolve({
          columns,
          rows: records.map((record) =>
            columns.map((column) => record[column])
          ),
        });
      }
      const result = statement.run(...parameters);
      return Promise.resolve({
        columns: [],
        rows: [],
        affected_rows: { type: "bigint", value: String(result.changes) },
        insert_id: { type: "bigint", value: String(result.lastInsertRowid) },
      });
    }
    const name = String(
      operation === "admin.execute" ? input.command_id : input.operation,
    );
    if (name === "program.list") {
      return Promise.resolve({
        success: true,
        result: structuredClone(definitions),
      });
    }
    if (name === "node.list") {
      return Promise.resolve({
        success: true,
        result: {
          nodes: [{ node: { id: nodeId, enabled: true } }],
          local_node_id: nodeId,
        },
      });
    }
    if (name === "development.sandbox.reset_source") {
      developmentCommands.push(name);
      assert(
        (input.input as { confirm?: boolean }).confirm === true,
        "development reset lost confirmation",
      );
      return Promise.resolve({ success: true, result: { sandbox: {} } });
    }
    if (name === "development.activate.run") {
      const data = input.input as { message?: string };
      assert(
        data.message === "Browser reviewed changes",
        "activation lost its commit message",
      );
      developmentActivated = true;
      return Promise.resolve({
        success: true,
        result: { activation: { success: true, status: "complete" } },
      });
    }
    const packageResults: Record<string, unknown> = {
      "package.inspect": {
        package: {
          package_id: "example/testing",
          path: "/fixtures/testing",
          valid: true,
          description: "Programs for the browser demonstration",
          programs: definitions.map((program) => ({
            ...program,
            path: `programs/${program.name}`,
            valid: true,
          })),
          files: [{ path: "package.toml", type: "file", size: 100 }],
        },
      },
      "package.repository.inspect": {
        repository: {
          package_id: "example/testing",
          path: "/fixtures/testing",
          activation_ready: true,
          clean: true,
          status: "ready",
          branches: [],
          commits: [],
        },
      },
      "package.index.inspect": {
        package: {
          author: "example",
          repository: "testing",
          package_id: "example/testing",
          source: "https://example.test/testing.git",
          local: false,
          valid: true,
        },
      },
      "package.version.list": {
        package: {
          package_id: "example/testing",
          current_commit: "abc123456789",
          versions: [{
            commit: "abc123456789",
            short_commit: "abc1234",
            authored_at: "2026-09-01T10:00:00Z",
            author: "Developer",
            subject: "Readable browser version",
            tags: ["v1"],
            current: true,
            selected: false,
          }],
        },
      },
      "secret.list": { secrets: [] },
      "development.sandbox.list": {
        sandboxes: [{
          user_id: "robot",
          sandbox_id: "sbx-development01",
          state: "READY",
        }],
      },
      "development.activate.preview": {
        preview: {
          packages: developmentActivated ? [] : [{
            package_id: "example/testing",
            changed_files: 2,
            added_rows: 8,
            removed_rows: 3,
            activation_ready: true,
          }],
        },
      },
      "database.table.list": { tables: [databaseTable] },
      "database.table.inspect": { table: databaseTable },
      "service.list": { services: [runtimeService] },
      "service.inspect": { service: runtimeService },
      "service.refresh": { service: runtimeService },
      "sandbox.inspect": {
        sandbox: {
          spec: {
            sandbox_id: "sbx-runtime001",
            workload_type: "service",
            group_key: "service:example/testing/api",
            lifecycle: { warm: false },
          },
          status: {
            node_id: nodeId,
            created_at: "2026-09-01T10:00:00Z",
            desired_state: "READY",
            observed_state: "READY",
            worker_count: 1,
            resources: { memory_current: 33554432 },
          },
          runtime: {
            revision: 7,
            observed_at: "2026-09-01T10:05:00Z",
            active_requests: 2,
          },
          workers: [runtimeWorker],
        },
        services: [runtimeService],
        reason: "service:example/testing/api",
      },
      "worker.inspect": {
        worker: {
          sandbox_id: "sbx-runtime001",
          workload_type: "service",
          worker: runtimeWorker,
        },
      },
    };
    if (Object.hasOwn(packageResults, name)) {
      return Promise.resolve({
        success: true,
        protocol_version: 2,
        result: structuredClone(packageResults[name]),
      });
    }
    if (name === "logs.query") {
      const query = input.input as LogQuery;
      assert(
        query.node_id === result.nodeId &&
          query.job_id === result.executionId &&
          query.context_id === result.contextId &&
          query.from === result.createdAt && query.limit === 100,
        "job log query lost its execution reference or page bound",
      );
      const page: LogPage = {
        state: "ok",
        records: [{
          time: result.createdAt,
          level: "INFO",
          source: "deno",
          component: "worker",
          node_id: result.nodeId,
          sandbox_id: result.sandboxId,
          worker_id: result.workerId,
          context_id: result.contextId,
          job_id: result.executionId,
          object: `program:${result.programId}`,
          username: result.username,
          message: "Captured browser result",
          segment: "segment-00000000000000000001-all.log",
          offset: 0,
        }],
        more: false,
        scanned_bytes: 256,
      };
      return Promise.resolve({ success: true, result: page });
    }
    throw new Error(`Unexpected browser fixture operation ${name}`);
  }) satisfies KernelInvoke;
  const restoreContext = installContextProvider(() => ({
    authenticated: true,
    type: "service",
    id: "the8020/uui/session",
    username: "robot",
    userId: "user:robot",
    nodeId,
    sandboxId,
    workerId,
    contextId,
  }));
  const { jobStore } = await import("/p/the8020/jobs/src/store.ts");
  const { runProgram } = await import("/p/the8020/jobs/src/admin.ts");
  const { runAdmin } = await import("/p/the8020/admin-core/src/navigation.ts");
  const originalSubmit = jobStore.submit,
    originalInspect = jobStore.runs.inspect;
  let result: JobRun;
  jobStore.submit = (input) => {
    submitted = structuredClone(input);
    const now = new Date().toISOString();
    result = {
      id: "jhr-0123456789",
      scheduleId: "",
      occurrenceId: "occ-0123456789",
      name: input.name,
      programId: input.programId,
      username: input.username,
      targetNode: input.node,
      nodeId,
      state: "succeeded",
      scheduledAt: now,
      createdAt: now,
      startedAt: now,
      finishedAt: now,
      input,
      executionId: "job-0123456789",
      sandboxId,
      workerId,
      contextId,
      parentContextId: "",
      logPosition: "",
      packageCommit: "abc123",
      result: input.arguments,
      failure: "",
      truncated: false,
    };
    return Promise.resolve([result]);
  };
  jobStore.runs.inspect = () => Promise.resolve(result);
  try {
    await runAdmin({ view: "programs" });
    await runProgram(interactiveId, `${root}/packages`);
    const { default: users } = await import(
      "/p/the8020/users/programs/users/program.ts"
    );
    await runAdmin({ view: "service", serviceId });
    const { default: sessions } = await import(
      "./programs/sessions/program.ts"
    );
    await sessions("robot");
    const { default: tables } = await import(
      "/p/the8020/admin-db/programs/database/program.ts"
    );
    await tables();
    const { default: browse } = await import(
      "/p/the8020/admin-db/programs/browse/program.ts"
    );
    await browse(tableId);
    const { default: development } = await import(
      "/p/the8020/dev-core/programs/development-test/program.ts"
    );
    await development();
    await users();
    const accounts = await import("/p/the8020/users/src/admin.ts");
    const { authenticatePassword } = await import("/p/the8020/users/mod.ts");
    assert(
      (await accounts.user("reader")).full_name === "Reader Updated",
      "admin details were not persisted",
    );
    assert(
      (await accounts.user("robot")).full_name === "Robot Updated",
      "own details were not persisted",
    );
    assert(
      (await authenticatePassword("reader", "browser-test-password"))
        ?.username === "reader",
      "admin password was not saved",
    );
    assert(
      (await authenticatePassword("robot", "changed-browser-password"))
        ?.username === "robot",
      "own password was not saved",
    );
    assert(
      await authenticatePassword("robot", "own-browser-password") === undefined,
      "own previous password still works",
    );
    await callScreen({
      id: "user-reference",
      title: "User reference",
      schema: z.object({
        owner: field(username, { label: "Owner", readOnly: true }),
      }),
      model: new Model({ owner: "reader" }),
    });
    await callScreen({
      id: "program-browser-done",
      title: "Program checks complete",
      schema: z.object({}),
      model: new Model({}),
    });
  } finally {
    jobStore.submit = originalSubmit;
    jobStore.runs.inspect = originalInspect;
    restoreContext();
    globals[kernelInvokeSymbol] = previousInvoke;
    globals[kernelDatabaseBackendSymbol] = previousBackend;
    database.close();
  }
}

export async function verifyProgramsBrowser(
  page: BrowserDriver,
): Promise<void> {
  await title(page, "Programs");
  await wait(
    page,
    "document.querySelectorAll('.data-list tbody tr[data-row-index]').length === 2",
    "all programs",
  );
  assert(
    await page.evaluate<boolean>(
      "document.querySelector('.data-list thead')?.textContent.includes('Runs as')",
    ),
    "execution kind column missing",
  );
  await row(page, "Interactive fixture");
  await title(page, "Program interactive");
  assert(
    await page.evaluate<boolean>(
      `!document.querySelector('[data-bind="commit"]')`,
    ),
    "source metadata is visible before Advanced",
  );
  await button(page, "Advanced");
  await title(page, "Advanced · interactive");
  assert(
    await page.evaluate<boolean>(
      "document.querySelector('[data-bind=\"uui\"]').checked",
    ),
    "interactive flag missing",
  );
  assert(
    await page.evaluate<string>(
      "document.querySelector('[data-bind=\"commit\"]').value",
    ) === "abc123",
    "commit missing",
  );
  await button(page, "Back");
  await title(page, "Program interactive");
  await screenshot(page, "program-detail");
  await button(page, "Open package");
  await title(page, "Package example/testing");
  assert(
    await page.evaluate<boolean>(
      `!document.querySelector('[data-bind="branch"]') && !document.querySelector('[data-layout-id="files"]')`,
    ),
    "package main view exposes Git/files",
  );
  await screenshot(page, "package-detail");
  await button(page, "Versions");
  await title(page, "Versions for example/testing");
  await row(page, "Readable browser version");
  await wait(
    page,
    `document.querySelector('[data-bind="selection"]')?.value === 'commit:abc123456789'`,
    "select version from its row",
  );
  await button(page, "Edit Version to install: field help");
  await title(page, "Version to install");
  await searchHelp(page, "v1");
  await row(page, "Tag v1");
  await button(page, "Done");
  await wait(
    page,
    `document.querySelector('[data-bind="selection"]')?.value === 'tag:v1'`,
    "select a tag through help",
  );
  await button(page, "Back");
  await title(page, "Package example/testing");
  await row(page, "Background fixture");
  await title(page, "Program background");
  await button(page, "Back");
  await title(page, "Package example/testing");
  await button(page, "Advanced");
  await title(page, "Advanced · example/testing");
  assert(
    await fieldValue(page, "repositoryStatus") === "ready",
    "advanced Git state is missing",
  );
  await input(page, "secretName", "github");
  await button(page, "Edit Authentication secret: field help");
  await title(page, "Authentication secret");
  await button(page, "Navigate");
  await title(page, "Secret github");
  assert(
    await fieldValue(page, "value") === "",
    "secret screen loaded a stored value",
  );
  await screenshot(page, "secret-detail");
  await button(page, "Back");
  await title(page, "Authentication secret");
  await button(page, "Done");
  await title(page, "Advanced · example/testing");
  await button(page, "Back");
  await title(page, "Package example/testing");
  await button(page, "Back");
  await title(page, "Program interactive");
  await button(page, "Execute");
  await title(page, "Run program");
  assert(
    await page.evaluate<string>(
      "document.querySelector('[data-bind=\"programId\"]').value",
    ) === interactiveId,
    "Execute did not preselect the program",
  );
  assert(
    await page.evaluate<boolean>(
      "document.querySelector('[data-bind=\"node\"]') === null",
    ),
    "interactive form shows job placement controls",
  );
  assert(
    await page.evaluate<boolean>(
      `document.querySelector('[data-bind="programId"]')?.tagName === 'INPUT'`,
    ),
    "program selector still preloads a native select",
  );
  await button(page, "Edit Program: field help");
  await title(page, "Program");
  await searchHelp(page, "background");
  await row(page, "Background fixture");
  await button(page, "Done");
  await wait(
    page,
    "document.querySelector('[data-bind=\"username\"]') !== null",
    "job execution options after selection",
  );
  await input(page, "arguments", '["preserved input"]');
  await input(page, "programId", interactiveId);
  await wait(
    page,
    "document.querySelector('[data-bind=\"node\"]') === null",
    "interactive execution options after selection",
  );
  assert(
    await page.evaluate<string>(
      "document.querySelector('[data-bind=\"arguments\"]').value",
    ) === '["preserved input"]',
    "selection lost custom inputs",
  );
  await button(page, "Back");
  await title(page, "Program interactive");
  await button(page, "Back");
  await title(page, "Programs");
  await row(page, "Background fixture");
  await title(page, "Program background");
  await button(page, "Advanced");
  await title(page, "Advanced · background");
  assert(
    !(await page.evaluate<boolean>(
      "document.querySelector('[data-bind=\"uui\"]').checked",
    )),
    "job incorrectly marked UUI",
  );
  assert(
    !(await page.evaluate<boolean>(
      "document.querySelector('[data-bind=\"discoverable\"]').checked",
    )),
    "hidden metadata missing",
  );
  await button(page, "Back");
  await title(page, "Program background");
  await button(page, "Execute");
  await title(page, "Run program");
  await input(page, "arguments", '{"not":"an array"}');
  await button(page, "Run");
  await wait(
    page,
    "document.body.innerText.includes('Inputs must be a JSON array')",
    "invalid input feedback",
  );
  assert(submitted === undefined, "invalid inputs submitted");
  await input(page, "arguments", '[{"message":"browser job"},42]');
  await button(page, "Advanced");
  await title(page, "Advanced job settings");
  await input(page, "sandboxGroup", "browser-jobs");
  await button(page, "Edit Node: field help");
  await title(page, "Node");
  await searchHelp(page, "Any");
  await row(page, "Any");
  await button(page, "Done");
  await title(page, "Advanced job settings");
  await button(page, "Done");
  await title(page, "Run program");
  await button(page, "Run");
  await title(page, "Run Background fixture");
  const submittedInput = submitted as JobInput | undefined;
  assert(
    submittedInput?.programId === backgroundId &&
      submittedInput.username === "robot" &&
      submittedInput.sandboxGroup === "browser-jobs",
    "job execution options missing",
  );
  assert(
    JSON.stringify(submittedInput.arguments) ===
      '[{"message":"browser job"},42]',
    "job positional inputs missing",
  );
  assert(
    await page.evaluate<boolean>(
      "document.querySelector('[data-bind=\"output\"]').value.includes('browser job')",
    ),
    "captured job result missing",
  );
  await screenshot(page, "job-result");
  await button(page, "Logs");
  await title(page, "Logs · Background fixture");
  assert(
    await page.evaluate<boolean>(
      "document.querySelector('[data-bind=\"logs\"]').value.includes('Captured browser result') && document.querySelector('[data-bind=\"logs\"]').value.includes('user:robot')",
    ),
    "filtered job logs or execution user missing",
  );
  await button(page, "Back");
  await title(page, "Run Background fixture");
  await button(page, "Advanced");
  await title(page, "Advanced · Background fixture");
  assert(
    await fieldValue(page, "sandbox") === sandboxId,
    "run diagnostics lost the sandbox reference",
  );
  await button(page, "Back");
  await title(page, "Run Background fixture");
  await button(page, "Back");
  await title(page, "Program background");
  await button(page, "Back");
  await title(page, "Programs");
  await page.command("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await wait(
    page,
    "document.querySelector('.data-list') !== null && !document.querySelector('.screen')?.inert",
    "mobile list",
  );
  assert(
    await page.evaluate<boolean>(
      "document.documentElement.scrollWidth <= innerWidth",
    ),
    "program list overflows mobile page",
  );
  await button(page, "Back");
  await title(page, "Run program");
  await input(page, "arguments", '["interactive browser",7]');
  await button(page, "Run");
  await title(page, "Interactive inputs");
  assert(
    await page.evaluate<string>(
      "document.querySelector('[data-bind=\"message\"]').value",
    ) === "interactive browser",
    "interactive first input missing",
  );
  assert(
    await page.evaluate<string>(
      "document.querySelector('[data-bind=\"count\"]').value",
    ) === "7",
    "interactive second input missing",
  );
  await button(page, "Back");
  await verifyRuntime(page);
  if (Deno.args.includes("--runtime")) return;
  await verifySessions(page);
  await verifyDatabase(page);
  await verifyDevelopment(page);
  await verifyUsers(page);
  await title(page, "Program checks complete");
}

async function verifyRuntime(page: BrowserDriver): Promise<void> {
  await page.command("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await title(page, "Service api");
  assert(
    await page.evaluate<boolean>(
      `!document.querySelector('[data-bind="minimumWorkers"]') && !document.querySelector('[data-bind="desiredVersion"]')`,
    ),
    "service internals are visible in the overview",
  );
  await screenshot(page, "service-detail");
  await button(page, "Configure");
  await title(page, "Configure api");
  await input(page, "minimumWorkers", "2");
  await input(page, "serviceType", "session");
  await wait(
    page,
    `document.querySelector('[data-bind="sessionKeepAlive"]') !== null`,
    "session settings",
  );
  await input(page, "sessionKeepAlive", "45m");
  await input(page, "targetUtilization", "65.5");
  await openMyAccount(page);
  await button(page, "Edit details");
  await title(page, "Edit details");
  await input(page, "fullName", "Discard this name");
  await button(page, "Back");
  await title(page, "My account");
  assert(await fieldValue(page, "fullName") === "", "cancel saved the name");
  await button(page, "Back");
  await title(page, "Configure api");
  assert(
    await fieldValue(page, "minimumWorkers") === "2" &&
      await fieldValue(page, "sessionKeepAlive") === "45m" &&
      await fieldValue(page, "targetUtilization") === "65.5",
    "My account lost the pending configuration draft",
  );
  await button(page, "Edit Public execution user: field help");
  await title(page, "Public execution user");
  await searchHelp(page, "robot");
  await row(page, "robot");
  await button(page, "Done");
  await title(page, "Configure api");
  assert(
    await fieldValue(page, "minimumWorkers") === "2" &&
      await fieldValue(page, "sessionKeepAlive") === "45m",
    "field help lost the configuration draft",
  );
  await screenshot(page, "service-settings");
  await page.command("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  assert(
    await page.evaluate<boolean>(
      `[...document.querySelectorAll('#app [data-bind]')].filter(input => input.getClientRects().length > 0).every(input => { const rect = input.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth; })`,
    ),
    "all service settings fit the mobile viewport",
  );
  await screenshot(page, "service-settings-mobile");
  await page.command("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  assert(
    await fieldValue(page, "targetUtilization") === "65.5",
    "configuration did not retain its edit",
  );
  assert(
    await page.evaluate<boolean>(
      `document.querySelector('[data-bind="enabled"]')?.disabled === false && ![...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Advanced')`,
    ),
    "Enabled and all configuration must be directly accessible",
  );
  await input(page, "maximumWorkers", "1");
  await button(page, "Save settings");
  await wait(
    page,
    `document.body.innerText.includes('Maximum Workers must be zero or at least Minimum Workers.')`,
    "invalid capacity feedback",
  );
  await button(page, "Back");
  await title(page, "Service api");
  await row(page, "sbx-runtime001");
  await title(page, "Sandbox sbx-runtime001");
  assert(
    await fieldValue(page, "memory") === "32.0 MiB",
    "sandbox resources are not readable",
  );
  await screenshot(page, "sandbox-detail");
  await row(page, "wrk-runtime001");
  await title(page, "Worker wrk-runtime001");
  await button(page, "Open service");
  await title(page, "Service api");
  await button(page, "Back");
  await title(page, "Worker wrk-runtime001");
  await button(page, "Back");
  await title(page, "Sandbox sbx-runtime001");
  await button(page, "Advanced");
  await title(page, "Advanced · sbx-runtime001");
  assert(
    await fieldValue(page, "snapshotRevision") === "7",
    "sandbox technical detail is missing",
  );
  await button(page, "Back");
  await title(page, "Sandbox sbx-runtime001");
  await page.command("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await screenshot(page, "sandbox-mobile");
  await button(page, "Back");
  await title(page, "Service api");
  await button(page, "Back");
}

async function verifySessions(page: BrowserDriver): Promise<void> {
  await page.command("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await title(page, "Sessions for robot");
  await row(page, "uis-0123456789");
  await title(page, "Session for robot");
  assert(sessionLogReads < 1, "session overview loaded diagnostic messages");
  assert(
    await fieldValue(page, "currentScreen") === "Example workspace",
    "session screen title missing",
  );
  await button(page, "Refresh");
  await wait(
    page,
    `document.querySelector('[data-bind="updatedAt"]')?.value === '2026-09-02T12:00:00.000Z'`,
    "exact refresh of a session older than the recent list window",
  );
  await screenshot(page, "session-detail");
  await button(page, "Advanced");
  await title(page, "Advanced · uis-0123456789");
  assert(
    sessionLogReads === 1 &&
      (await fieldValue(page, "messageLog"))?.includes("presentation.show"),
    "session Advanced messages missing",
  );
  await button(page, "View Sandbox: field help");
  await title(page, "Sandbox");
  await button(page, "Navigate");
  await title(page, "Sandbox sbx-runtime001");
  await button(page, "Back");
  await title(page, "Sandbox");
  await button(page, "Close");
  await title(page, "Advanced · uis-0123456789");
  await button(page, "Back");
  await title(page, "Session for robot");
  await button(page, "End session");
  await title(page, "End robot's session?");
  await button(page, "Keep session");
  await title(page, "Session for robot");
  await button(page, "Back");
  await title(page, "Sessions for robot");
  await button(page, "Back");
}

async function verifyDatabase(page: BrowserDriver): Promise<void> {
  await title(page, "Database tables");
  await row(page, "people");
  await title(page, "Table people");
  assert(
    await page.evaluate<boolean>(
      `!document.querySelector('[data-layout-id="checks"]') && !document.querySelector('[data-bind="sourceCommit"]')`,
    ),
    "database overview exposes physical/source diagnostics",
  );
  await screenshot(page, "table-detail");
  await row(page, "parentId");
  await title(page, "Field parentId");
  await button(page, "View Related table: field help");
  await title(page, "Related table");
  await button(page, "Navigate");
  await title(page, "Table people");
  await button(page, "Back");
  await title(page, "Related table");
  await button(page, "Close");
  await title(page, "Field parentId");
  await button(page, "Back");
  await title(page, "Table people");
  await button(page, "Advanced");
  await title(page, "Advanced · people");
  assert(
    await fieldValue(page, "physicalTable") === tableId,
    "physical table detail missing",
  );
  await button(page, "Back");
  await title(page, "Table people");
  await button(page, "SQL");
  await title(page, "SQL executor");
  await button(page, "Edit Table reference: field help");
  await title(page, "Table reference");
  await searchHelp(page, "people");
  await row(page, tableId);
  await button(page, "Done");
  await title(page, "SQL executor");
  await button(page, "New SELECT");
  await wait(
    page,
    `document.querySelector('[data-bind="sql"]')?.value.includes('SELECT * FROM')`,
    "SQL starter",
  );
  await button(page, "Run SQL");
  await wait(
    page,
    `document.querySelector('[data-layout-id="output"]')?.textContent.includes('Avery')`,
    "SQL table lookup result",
  );
  await screenshot(page, "sql-table-help");
  await button(page, "Back");
  await title(page, "Table people");
  await button(page, "Open package");
  await title(page, "Package example/testing");
  await button(page, "Back");
  await title(page, "Table people");
  await button(page, "Back");
  await title(page, "Database tables");
  await button(page, "Back");
  await title(page, "Rows · people");
  await input(page, "where", "name = 'Avery'");
  await button(page, "Run query");
  await wait(
    page,
    `document.querySelectorAll('[data-layout-id="rows"] tbody tr[data-row-index]').length === 1`,
    "filtered table browse",
  );
  await screenshot(page, "table-rows");
  await button(page, "Table details");
  await title(page, "Table people");
  await button(page, "Back");
  await title(page, "Rows · people");
  assert(
    await fieldValue(page, "where") === "name = 'Avery'",
    "row filter was lost after table navigation",
  );
  await button(page, "Back");
}

async function verifyDevelopment(page: BrowserDriver): Promise<void> {
  await title(page, "Development");
  await wait(
    page,
    "document.querySelector('.sandbox-console .xterm') !== null",
    "program-owned terminal module",
  );
  assert(
    await page.evaluate<boolean>(
      "performance.getEntriesByType('resource').some(entry => entry.name.includes('/package-assets/the8020/dev-core/development-terminal-') && entry.name.endsWith('.js'))",
    ),
    "Development did not load its own terminal asset",
  );
  assert(
    await page.evaluate<boolean>(
      `document.querySelector('[data-bind="sandboxId"]')?.value === 'sbx-development01' &&
       document.querySelector('[data-bind="user"]')?.value === 'robot' &&
       ![...document.querySelectorAll('button')].some(e => e.textContent.trim() === 'Advanced') &&
       ['restart', 'reset-source', 'factory-reset'].every(id =>
         document.querySelector('[data-element-id="sandbox-fields"] [data-element-id="' + id + '"]'))`,
    ),
    "development settings and actions must share the group below the terminal",
  );
  await page.evaluate(
    `window.__developmentConsole = document.querySelector('.sandbox-console')`,
  );
  assert(
    await page.evaluate<boolean>(
      "document.querySelector('.screen-description code')?.textContent === 'ssh -p 22 -- robot@' + location.hostname && !document.querySelector('.screen-description a')",
    ),
    "development SSH subtitle must use the authenticated username and browser host",
  );
  await screenshot(page, "development");
  await button(page, "Reset source");
  await title(page, "Reset source?");
  await button(page, "Reset source");
  await wait(
    page,
    `document.body.innerText.includes('Confirm deletion before resetting the sandbox.')`,
    "reset requires confirmation",
  );
  assert(developmentCommands.length < 1, "unconfirmed reset was sent");
  await wait(
    page,
    `(() => { const input = document.querySelector('[data-bind="confirmed"]'); if (!input || input.closest('[inert],[hidden]')) return false; input.click(); return input.checked; })()`,
    "reset confirmation checkbox",
  );
  await button(page, "Reset source");
  await title(page, "Development");
  assert(
    developmentCommands.length === 1,
    "confirmed source reset did not use the existing command",
  );
  await button(page, "Review changes");
  await title(page, "Activate development changes");
  await button(page, "Activate all changes");
  await wait(
    page,
    `document.querySelector('.presentation-page-layer:not([hidden]) [data-bind="status"]')?.value === 'A commit message is required'`,
    "activation message requirement",
  );
  await input(page, "message", "Browser reviewed changes");
  await row(page, "example/testing");
  await title(page, "Package example/testing");
  await button(page, "Back");
  await title(page, "Activate development changes");
  assert(
    await fieldValue(page, "message") === "Browser reviewed changes",
    "package navigation lost the activation draft",
  );
  await screenshot(page, "development-activation");
  await button(page, "Activate all changes");
  await wait(
    page,
    `document.querySelector('.presentation-page-layer:not([hidden]) [data-bind="status"]')?.value === 'No private changes'`,
    "activation refresh",
  );
  assert(developmentActivated, "activation was not submitted");
  await button(page, "Back");
  await title(page, "Development");
  assert(
    await page.evaluate<boolean>(
      `window.__developmentConsole === document.querySelector('.sandbox-console')`,
    ),
    "development navigation replaced the retained console",
  );
  await button(page, "Back");
}

async function verifyUsers(page: BrowserDriver): Promise<void> {
  await title(page, "Users");
  await page.command("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await button(page, "Add user");
  await title(page, "Add user");
  await input(page, "username", "reader");
  await input(page, "fullName", "Reader Example");
  await button(page, "Create user");
  await title(page, "User reader");
  assert(
    await fieldValue(page, "fullName") === "Reader Example",
    "created full name is missing",
  );
  await button(page, "Edit details");
  await title(page, "Edit details");
  await input(page, "fullName", "Reader Updated");
  await button(page, "Save details");
  await title(page, "User reader");
  assert(
    await fieldValue(page, "fullName") === "Reader Updated",
    "edited full name is missing",
  );
  assert(
    await fieldValue(page, "signIn") === "No password",
    "passwordless status is missing",
  );
  assert(
    await page.evaluate<boolean>(
      `!document.querySelector('[data-bind="authVersion"]')`,
    ),
    "technical account state appears in the main screen",
  );
  await button(page, "Set password");
  await title(page, "Password for reader");
  await input(page, "password", "mismatched-password");
  await input(page, "confirmation", "different-password");
  await button(page, "Save password");
  await wait(
    page,
    "document.body.textContent.includes('The passwords do not match.')",
    "password mismatch message",
  );
  assert(
    await fieldValue(page, "password") === "" &&
      await fieldValue(page, "confirmation") === "",
    "failed password values were retained",
  );
  await input(page, "password", "browser-test-password");
  await input(page, "confirmation", "browser-test-password");
  await button(page, "Save password");
  await title(page, "User reader");
  assert(
    await fieldValue(page, "signIn") === "Allowed",
    "setting a password did not enable sign-in",
  );
  await screenshot(page, "user-desktop");
  await openMyAccount(page);
  assert(
    await fieldValue(page, "username") === "robot",
    "My account used the selected or browser user instead of the authenticated user",
  );
  assert(
    await page.evaluate<boolean>(
      "![...document.querySelectorAll('button')].some(b => b.getClientRects().length && /^(Disable user|Enable user|Advanced)$/.test(b.textContent.trim()))",
    ),
    "own account exposes administrative controls",
  );
  await button(page, "Edit details");
  await title(page, "Edit details");
  await input(page, "fullName", "Robot Updated");
  await button(page, "Save details");
  await title(page, "My account");
  assert(
    await fieldValue(page, "fullName") === "Robot Updated",
    "own name was not updated",
  );
  await button(page, "Set password");
  await title(page, "Password for robot");
  assert(
    await fieldValue(page, "password") === "",
    "own password editor was not empty",
  );
  await input(page, "password", "own-browser-password");
  await input(page, "confirmation", "own-browser-password");
  await button(page, "Save password");
  await title(page, "My account");
  await button(page, "Change password");
  await title(page, "Password for robot");
  assert(
    await fieldValue(page, "password") === "" &&
      await page.evaluate<boolean>(
        "![...document.querySelectorAll('dialog[open] button')].some(b => b.textContent.includes('Remove password'))",
      ),
    "own password editor retains a password or offers removal",
  );
  await input(page, "password", "changed-browser-password");
  await input(page, "confirmation", "changed-browser-password");
  await button(page, "Save password");
  await title(page, "My account");
  await screenshot(page, "my-account-desktop");
  await button(page, "Back");
  await title(page, "User reader");
  await button(page, "Open sessions");
  await title(page, "Sessions for reader");
  await button(page, "Back");
  await title(page, "User reader");
  await button(page, "Sign-ins");
  await title(page, "Sign-ins for reader");
  await button(page, "Back");
  await title(page, "User reader");
  await button(page, "Disable user");
  await title(page, "Disable reader?");
  await button(page, "Disable user");
  await title(page, "User reader");
  assert(
    await fieldValue(page, "signIn") === "Disabled",
    "disable did not update the account",
  );
  await button(page, "Enable user");
  await wait(
    page,
    `document.querySelector('[data-bind="signIn"]')?.value === 'Allowed'`,
    "enabled account",
  );
  await button(page, "Advanced");
  await title(page, "Advanced · reader");
  assert(
    await fieldValue(page, "authVersion") === "3",
    "authentication version is missing from Advanced",
  );
  await button(page, "Delete user");
  await title(page, "Delete reader?");
  await button(page, "Cancel");
  await title(page, "Advanced · reader");
  await button(page, "Back");
  await title(page, "User reader");
  await page.command("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await screenshot(page, "user-mobile");
  await openMyAccount(page);
  assert(
    await fieldValue(page, "fullName") === "Robot Updated",
    "own details were lost on reopen",
  );
  await screenshot(page, "my-account-mobile");
  assert(
    await page.evaluate<boolean>(
      "document.documentElement.scrollWidth <= innerWidth",
    ),
    "own account overflows mobile",
  );
  await button(page, "Back");
  await title(page, "User reader");
  assert(
    await page.evaluate<boolean>(
      "document.documentElement.scrollWidth <= innerWidth",
    ),
    "user detail overflows the mobile page",
  );
  await button(page, "Back");
  await title(page, "Users");
  await row(page, "reader");
  await title(page, "User reader");
  await button(page, "Back");
  await title(page, "Users");
  await button(page, "Back");
  await title(page, "User reference");
  await button(page, "View Owner: field help");
  await title(page, "Owner");
  await button(page, "Navigate");
  await title(page, "User reader");
  await button(page, "Back");
  await title(page, "Owner");
  await button(page, "Close");
  await title(page, "User reference");
  await button(page, "Back");
}

async function openMyAccount(page: BrowserDriver): Promise<void> {
  await page.evaluate("document.querySelector('#session-menu-toggle').click()");
  await button(page, "My account");
  await title(page, "My account");
}

async function fieldValue(page: BrowserDriver, bind: string): Promise<string> {
  return await page.evaluate<string>(
    `[...document.querySelectorAll(${
      JSON.stringify(`[data-bind="${bind}"]`)
    })].find(item => !item.closest('[hidden]') && item.getClientRects().length > 0)?.value`,
  );
}

async function screenshot(page: BrowserDriver, name: string): Promise<void> {
  if (!Deno.args.includes("--screenshots")) return;
  const { data } = await page.command<{ data: string }>(
    "Page.captureScreenshot",
    { format: "png" },
  );
  await Deno.writeFile(
    `/tmp/uui-${name}.png`,
    Uint8Array.from(atob(data), (value) => value.charCodeAt(0)),
  );
}

async function title(page: BrowserDriver, value: string) {
  await wait(
    page,
    `[...document.querySelectorAll('.screen')].some(screen => screen.getClientRects().length > 0 && screen.querySelector(':scope > h1.screen-title')?.textContent.trim() === ${
      JSON.stringify(value)
    } && !screen.closest('[inert],[hidden]'))`,
    value,
  );
}
async function button(page: BrowserDriver, label: string) {
  await wait(
    page,
    `(() => { const button = [...document.querySelectorAll('button')].find((item) => item.getClientRects().length > 0 && !item.closest('[inert],[hidden]') && !item.disabled && (item.textContent.trim() === ${
      JSON.stringify(label)
    } || item.getAttribute('aria-label') === ${
      JSON.stringify(label)
    })); if (!button) return false; button.click(); return true; })()`,
    `${label} button`,
  );
}
async function row(page: BrowserDriver, name: string) {
  await wait(
    page,
    `(() => { const row = [...document.querySelectorAll('.data-list tbody tr')].find((item) => !item.closest('[inert],[hidden]') && item.textContent.includes(${
      JSON.stringify(name)
    })); if (!row) return false; row.click(); return true; })()`,
    `${name} row`,
  );
}
async function searchHelp(page: BrowserDriver, value: string) {
  await wait(
    page,
    `(() => { const input = document.querySelector('dialog[open] [aria-label="Search list"]'); if (!input) return false; input.value = ${
      JSON.stringify(value)
    }; input.dispatchEvent(new Event('input', {bubbles: true})); input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true})); return true; })()`,
    "value help search",
  );
}
async function input(page: BrowserDriver, bind: string, value: string) {
  await wait(
    page,
    `(() => { const input = [...document.querySelectorAll(${
      JSON.stringify(`[data-bind="${bind}"]`)
    })].find(item => !item.closest('[inert],[hidden]')); if (!input) return false; input.value = ${
      JSON.stringify(value)
    }; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`,
    `${bind} input`,
  );
  await wait(
    page,
    "!document.querySelector('.screen:not([hidden])')?.inert",
    "input update",
  );
}
async function wait(
  page: BrowserDriver,
  expression: string,
  description: string,
) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await page.evaluate<boolean>(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${description}`);
}
function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
