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

interface BrowserDriver {
  evaluate<T>(expression: string): Promise<T>;
  command<T = Record<string, unknown>>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T>;
}

const interactiveId = "example/testing/interactive";
const backgroundId = "example/testing/background";
const nodeId = "nod-0123456789";
const sandboxId = "sbx-0123456789";
const workerId = "wrk-0123456789";
const contextId = "ctx-0123456789";
let submitted: JobInput | undefined;

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
  globals[kernelDatabaseBackendSymbol] = "sqlite";
  globals[kernelInvokeSymbol] = ((operation, input) => {
    if (operation === "database.execute") {
      return Promise.resolve({
        columns: ["username", "enabled"],
        rows: [["robot", true]],
      });
    }
    const name = String(input.operation);
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
      "document.querySelector('.data-list thead')?.textContent.includes('UUI')",
    ),
    "UUI column missing",
  );
  await row(page, "interactive");
  await title(page, `Program ${interactiveId}`);
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
  await input(page, "programId", backgroundId);
  await wait(
    page,
    "document.querySelector('[data-bind=\"node\"]') !== null",
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
  await title(page, `Program ${interactiveId}`);
  await button(page, "Back");
  await title(page, "Programs");
  await row(page, "background");
  await title(page, `Program ${backgroundId}`);
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
  await input(page, "sandboxGroup", "browser-jobs");
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
  assert(
    await page.evaluate<boolean>(
      "document.querySelector('[data-bind=\"logs\"]').value.includes('Captured browser result') && document.querySelector('[data-bind=\"logs\"]').value.includes('user:robot')",
    ),
    "filtered job logs or execution user missing",
  );
  await button(page, "Back");
  await title(page, `Program ${backgroundId}`);
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
  await title(page, "Program checks complete");
}

async function title(page: BrowserDriver, value: string) {
  await wait(
    page,
    `[...document.querySelectorAll('.screen')].some(screen => screen.getClientRects().length > 0 && screen.querySelector(':scope > h1.screen-title')?.textContent.trim() === ${
      JSON.stringify(value)
    } && !screen.inert)`,
    value,
  );
}
async function button(page: BrowserDriver, label: string) {
  await page.evaluate(
    `(() => { const button = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === ${
      JSON.stringify(label)
    } || item.getAttribute('aria-label') === ${
      JSON.stringify(label)
    }); if (!button) throw new Error('Missing button'); button.click(); })()`,
  );
}
async function row(page: BrowserDriver, name: string) {
  await page.evaluate(
    `(() => { const row = [...document.querySelectorAll('.data-list tbody tr')].find((item) => item.textContent.includes(${
      JSON.stringify(name)
    })); if (!row) throw new Error('Missing row'); row.click(); })()`,
  );
}
async function input(page: BrowserDriver, bind: string, value: string) {
  await page.evaluate(
    `(() => { const input = document.querySelector(${
      JSON.stringify(`[data-bind="${bind}"]`)
    }); input.value = ${
      JSON.stringify(value)
    }; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); })()`,
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
