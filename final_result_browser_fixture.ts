import { assert, assertEquals } from "@std/assert";
import { newId } from "@the8020/kernel";
import { Supervisor } from "../kernel/defaults/config/runtime/deno/supervisor/supervisor.ts";
import uiConfig from "./ui-config.json" with { type: "json" };

interface Browser {
  evaluate<T>(expression: string): Promise<T>;
  command(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

/** Real session owner in a Web Worker, supervisor binding/transport, and built shell. */
export default async function fixture(root: string) {
  const entrypoint = `${root}/final-result-service.ts`;
  await Deno.writeTextFile(
    entrypoint,
    `
import { defineSessionService, workerFunctions } from ${
      JSON.stringify(new URL("./session_service.ts", import.meta.url).href)
    };
import { endSession, sendMessage } from ${
      JSON.stringify(new URL("./session.ts", import.meta.url).href)
    };
import { withTestLocalization } from ${
      JSON.stringify(new URL("./test_localization.ts", import.meta.url).href)
    };
export { workerFunctions };
const service = defineSessionService(async ({ inputs }) => {
  const outcome = inputs?.[0] ?? "success";
  if (outcome === "redirect") {
    endSession("Redirected", "/finished");
    return;
  }
  sendMessage("Original final " + outcome, outcome === "success" ? "success" : "error");
  if (outcome === "failure") throw new Error("Original program failure");
}, {metadataStore: {create: async () => {}, put: async () => {}, remove: async () => {}}});
export default {
  fetch: (request, context) => withTestLocalization(() => service.fetch(request, context)),
  connectWebSocket: (request, context, socket) => withTestLocalization(() => service.connectWebSocket(request, context, socket)),
};
`,
  );
  const user = { userId: "user:finalresult", username: "finalresult" };
  const workerId = "wrk-0000000041";
  const serviceId = "the8020/uui/session";
  let executionId = "pex-0000000041";
  let sessionId = "";
  let baseURL = "";
  const exchanges: string[] = [];
  const supervisor = new Supervisor({
    nodeId: "nod-0000000041",
    sandboxId: "sbx-0000000041",
    workloadType: "service",
    token: "isolated-final-result-test",
    supervisorVersion: "final-result-test",
    kernelCall: (call) => {
      if (
        call.operation === "database.scope.close" ||
        call.operation === "execution.releaseWorker"
      ) return Promise.resolve({});
      throw new Error(`Unexpected kernel call: ${call.operation}`);
    },
  });
  let failNextCompletion = false;
  let completionAttempts = 0;
  const complete = supervisor.completePersistentExecution.bind(supervisor);
  supervisor.completePersistentExecution = (...args) => {
    completionAttempts++;
    if (failNextCompletion) {
      failNextCompletion = false;
      throw new Error("transient terminal release failure");
    }
    complete(...args);
  };
  await supervisor.startWorker({
    metadata: {
      nodeId: "nod-0000000041",
      sandboxId: "sbx-0000000041",
      workerId,
      workloadType: "service",
      ownerId: "the8020/uui",
      workloadId: serviceId,
      user,
      origin: { type: "service", id: serviceId },
      releaseId: "test",
      databaseBackend: "sqlite",
      entrypoint: new URL(`file://${entrypoint}`).href,
      debuggerName: "service:final-result-test",
      service: {
        serviceId,
        generation: 1,
        canonicalBasePath: "/session",
        executionMode: "persistent",
      },
    },
    permissions: { read: [root, new URL("../", import.meta.url).pathname] },
  });
  supervisor.configureService(serviceId, [workerId], 1);

  function transport(
    request: Request,
    existing: boolean,
    principal = user,
    target = workerId,
    binding = executionId,
  ) {
    const websocket = request.headers.get("upgrade") === "websocket";
    const headers = new Headers(request.headers);
    for (
      const [name, value] of Object.entries({
        authorization: "Bearer isolated-final-result-test",
        "the8020-internal-url": "http://service/" +
          (new URL(request.url).pathname.endsWith("command")
            ? "command"
            : "connect"),
        "the8020-internal-method": request.method,
        "the8020-internal-context-id": newId("ctx"),
        "the8020-internal-persistent-execution-id": binding,
        "the8020-internal-persistent-keep-alive-ms": "3600000",
        "the8020-internal-target-worker-id": target,
        "the8020-internal-user-id": principal.userId,
        "the8020-internal-username": principal.username,
        "the8020-internal-authentication": btoa(
          JSON.stringify({ approved: true, principal: principal.userId }),
        ),
      })
    ) headers.set(name, value);
    if (existing) headers.set("the8020-internal-persistent-existing", "true");
    else headers.delete("the8020-internal-persistent-existing");
    if (websocket) {
      return supervisor.handler(request);
    }
    return supervisor.handler(
      new Request(
        `http://runtime/v1/services/${encodeURIComponent(serviceId)}/${
          websocket ? "websocket" : "dispatch"
        }`,
        {
          method: websocket ? "GET" : "POST",
          headers,
          body: request.body,
          signal: request.signal,
        },
      ),
    );
  }
  const invoke = (
    name: string,
    input: unknown,
    principal = user,
    binding = executionId,
  ) =>
    supervisor.invokeWorker(
      workerId,
      name,
      input,
      new AbortController().signal,
      binding,
      principal,
      {
        contextId: newId("ctx"),
      },
    );
  const command = async () => {
    const claim = await invoke("uui.session.control", {
      sessionId,
      clientId: "headless",
      operation: "claim",
      takeover: true,
    });
    assert(claim.ok, JSON.stringify(claim));
    return transport(
      new Request("http://service/command", {
        method: "POST",
        body: JSON.stringify({
          clientId: "headless",
          control: (claim.output as { control: number }).control,
          command: { op: "screen" },
        }),
      }),
      true,
    );
  };
  return {
    run: () => Promise.resolve(),
    async serve(request: Request) {
      const url = new URL(request.url);
      if (url.pathname === "/") {
        baseURL = url.origin;
        if (!url.searchParams.has("run")) {
          return new Response("<body>Preparing transport fixture</body>", {
            headers: { "content-type": "text/html" },
          });
        }
        const html = await Deno.readTextFile(
          new URL("./services/shell/frontend/index.html", import.meta.url),
        );
        return new Response(
          html.replaceAll("__the8020_theme_nonce__", "e2e").replace(
            /\{\s*"__the8020_boot_placeholder__"\s*:\s*true\s*\}/,
            JSON.stringify({
              username: user.username,
              websocketUrl: `ws://${url.host}/v1/services/${
                encodeURIComponent(serviceId)
              }/websocket`,
              protocol: uiConfig.protocolVersion,
            }),
          ),
          { headers: { "content-type": "text/html; charset=utf-8" } },
        );
      }
      if (url.pathname.endsWith("/websocket")) {
        const response = await transport(
          request,
          request.method === "GET" || request.headers.has("the8020-route"),
        );
        exchanges.push(`${request.method} ${response.status}`);
        if (!response.ok && response.status !== 101) {
          console.error(
            "Final-result transport rejected",
            await response.clone().text(),
          );
        }
        if (request.method === "POST" && response.ok) {
          sessionId = response.headers.get("the8020-session")!;
          response.headers.set("the8020-route", "final-result-route");
        }
        return response;
      }
      if (url.pathname === "/control") {
        const result = await invoke(
          "uui.session.control",
          await request.json(),
        );
        assert(result.ok, JSON.stringify(result));
        return Response.json({
          ...result.output as object,
          route: "final-result-route",
        });
      }
    },
    async verify(page: Browser) {
      await page.command("Network.enable");
      await page.command("Network.setExtraHTTPHeaders", {
        headers: {
          authorization: "Bearer isolated-final-result-test",
          "the8020-internal-url": "http://service/connect",
          "the8020-internal-context-id": newId("ctx"),
          "the8020-internal-persistent-execution-id": executionId,
          "the8020-internal-persistent-keep-alive-ms": "3600000",
          "the8020-internal-target-worker-id": workerId,
          "the8020-internal-user-id": user.userId,
          "the8020-internal-username": user.username,
          "the8020-internal-persistent-existing": "true",
          "the8020-internal-authentication": btoa(
            JSON.stringify({ approved: true, principal: user.userId }),
          ),
        },
      });
      await page.command("Page.navigate", { url: `${baseURL}/?run=1` });
      await wait(async () =>
        await page.evaluate<boolean>(
          `document.querySelector('.uui-control-dialog')?.open === true`,
        )
      ).catch((error) => {
        throw new Error(
          `${error}; exchanges=${exchanges}; workers=${
            JSON.stringify(supervisor.workers())
          }`,
        );
      });
      assertEquals(
        await page.evaluate(
          `document.querySelector('#messages-count')?.textContent`,
        ),
        "1",
      );
      await page.evaluate(
        `document.querySelector('#session-menu-toggle').click()`,
      );
      await page.evaluate(`document.querySelector('#messages-open').click()`);
      await wait(async () =>
        await page.evaluate<boolean>(
          `document.querySelector('#message-dialog')?.open === true`,
        )
      );
      assert(
        await page.evaluate<boolean>(
          `document.querySelector('#message-history-list')?.textContent.includes('Original final success')`,
        ),
      );
      assertEquals(supervisor.workers()[0]?.persistent_executions, 1);
      supervisor.configureService(serviceId, [], 1);
      const first = await command();
      assertEquals(first.status, 200);
      const result = await first.json();
      assertEquals(result.ended, true);
      assertEquals(result.messages, [{
        level: "success",
        message: "Original final success",
      }]);
      assertEquals(await (await command()).json(), result);
      for (
        const [principal, target, binding] of [
          [
            { userId: "user:foreign", username: "foreign" },
            workerId,
            executionId,
          ],
          [user, "wrk-0000000042", executionId],
          [user, workerId, "pex-0000000042"],
        ] as const
      ) {
        const denied = await transport(
          new Request("http://service/command", { method: "POST", body: "{}" }),
          true,
          principal,
          target,
          binding,
        );
        assertEquals(denied.status, 409);
        await denied.body?.cancel();
      }
      const denied = await invoke("uui.session.control", {
        sessionId,
        clientId: "foreign",
        operation: "claim",
      }, { userId: "user:foreign", username: "foreign" });
      assertEquals(denied.ok, false);
      await wait(
        () =>
          Promise.resolve(supervisor.workers()[0]?.persistent_executions === 0),
        uiConfig.finalResultRetentionMilliseconds + 5000,
      );
      const expired = await transport(
        new Request("http://service/command", { method: "POST", body: "{}" }),
        true,
      );
      assertEquals(expired.status, 409);
      await expired.body?.cancel();
      supervisor.configureService(serviceId, [workerId], 1);
      for (const outcome of ["denial", "failure"]) {
        executionId = newId("pex");
        const established = await transport(
          new Request("http://service/connect", {
            method: "POST",
            body: JSON.stringify({ inputs: [outcome] }),
          }),
          false,
        );
        assertEquals(established.status, 204);
        sessionId = established.headers.get("the8020-session")!;
        const response = await command();
        assertEquals(response.status, 200);
        const final = await response.json();
        assertEquals(final.ended, true);
        assertEquals(final.messages[0].message, "Original final " + outcome);
        assertEquals(
          final.error,
          outcome === "failure" ? "Original program failure" : undefined,
        );
        assert((await invoke("uui.session.terminate", { sessionId })).ok);
        assertEquals(supervisor.workers()[0]?.persistent_executions, 0);
      }
      executionId = newId("pex");
      failNextCompletion = true;
      completionAttempts = 0;
      const redirected = await transport(
        new Request("http://service/connect", {
          method: "POST",
          body: JSON.stringify({ inputs: ["redirect"] }),
        }),
        false,
      );
      assertEquals(redirected.status, 204);
      await wait(() => {
        const worker = supervisor.workers()[0]!;
        assertEquals(worker.state, "ready", worker.failure);
        return Promise.resolve(worker.persistent_executions === 0);
      });
      assertEquals(completionAttempts, 2);
      console.log(
        "Real Worker/supervisor final-result reads, owner/target rejection, draining continuation, browser history, bounded capacity release and detached redirect release retry passed.",
      );
    },
    async close() {
      await supervisor.stopWorker(workerId, true);
    },
  };
}

async function wait(predicate: () => Promise<boolean>, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Final-result browser condition was not reached");
}
