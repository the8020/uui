import { assertEquals } from "@std/assert";
import {
  type RequestMetadata,
  type WebSocketInboundEvent,
  type WebSocketSession,
  z,
} from "@the8020/http";
import { callScreen, sendMessage } from "./session.ts";
import { UUI_PROTOCOL_VERSION } from "./protocol.ts";
import type {
  SessionMetadata,
  SessionMetadataStore,
} from "./session_metadata.ts";
import { defineSessionService, workerFunctions } from "./session_service.ts";

const metadata: RequestMetadata = {
  requestId: "request-1",
  serviceId: "the8020/uui/session",
  serviceGeneration: 1,
  canonicalBasePath: "/the8020/uui/session",
  originalUrl: "https://example.test/the8020/uui/session/connect",
  client: { ipAddress: "203.0.113.4", networkScope: "public" },
  persistentExecutionId: "persistent-1",
  persistentKeepAliveMilliseconds: 120_000,
  execution: {
    nodeId: "node-test",
    runtimeGroupId: "rgp-test",
    sandboxId: "sbx-test",
    workerId: "wrk-test",
    workerExecutionId: "worker-execution-test",
    persistentExecutionId: "persistent-1",
  },
  auth: {
    authenticated: true,
    realm: "user",
    userId: "user-1",
    username: "Admin",
  },
};

Deno.test("ordinary persistent UUI service owns metadata and exact Worker administration", async () => {
  let activeSocket: TestSocket | undefined;
  const metadataStore = new MemorySessionMetadataStore(() => {
    assertEquals(activeSocket?.signal.aborted, false);
  });
  let finish!: () => void;
  let completions = 0;
  const service = defineSessionService(
    async () => await new Promise<void>((resolve) => finish = resolve),
    {
      metadataStore,
      completePersistent: () => {
        assertEquals(metadataStore.size, 0);
        completions++;
        return Promise.resolve();
      },
    },
  );
  try {
    const response = await service.fetch(
      new Request("https://example.test/connect", { method: "POST" }),
      context(metadata),
    );
    assertEquals(response.status, 204);

    const first = new TestSocket();
    first.message(connectMessage(0));
    const accepted = await service.connectWebSocket(
      new Request("https://example.test/connect"),
      context({ ...metadata, requestId: "request-2" }),
      first,
    );
    assertEquals(accepted.status, 204);
    await until(() => first.sent.length > 0);
    const ready = JSON.parse(String(first.sent[0]));
    assertEquals(ready.type, "session.ready");
    assertEquals(ready.resumeToken, "");

    assertEquals(metadataStore.size, 1);
    const persisted = metadataStore.get(ready.sessionId)!;
    assertEquals(persisted.sessionId, ready.sessionId);
    assertEquals(persisted.persistentExecutionId, "persistent-1");
    assertEquals(persisted.nodeId, "node-test");
    assertEquals(persisted.sandboxId, "sbx-test");
    assertEquals(persisted.workerId, "wrk-test");
    assertEquals(persisted.authenticatedUserId, "user-1");
    assertEquals(persisted.latestIpAddress, "203.0.113.4");
    assertEquals(persisted.latestNetworkScope, "public");

    const inspected = workerFunctions["uui.session.inspect"]({
      sessionId: ready.sessionId,
    }) as Record<string, unknown>;
    assertEquals(inspected.session_id, ready.sessionId);
    assertEquals(inspected.worker_id, "wrk-test");
    const log = workerFunctions["uui.session.message-log"]({
      sessionId: ready.sessionId,
    }) as { messages: unknown[] };
    assertEquals(log.messages.length > 0, true);

    first.remoteClose();
    const second = new TestSocket();
    activeSocket = second;
    second.message(connectMessage(ready.serverSequence));
    await service.connectWebSocket(
      new Request("https://example.test/connect"),
      context({
        ...metadata,
        requestId: "request-3",
        client: { ipAddress: "172.17.0.1", networkScope: "private" },
      }),
      second,
    );
    await until(() => second.sent.length > 0);
    assertEquals(
      JSON.parse(String(second.sent.at(-1))).type,
      "session.resumed",
    );
    await until(() => {
      const latest = metadataStore.get(ready.sessionId);
      return latest?.latestIpAddress === "172.17.0.1" &&
        latest.latestNetworkScope === "private";
    });

    await workerFunctions["uui.session.terminate"]({
      sessionId: ready.sessionId,
    });
    assertEquals(second.signal.aborted, true);
    assertEquals(completions, 1);
    assertEquals(metadataStore.size, 0);
    finish();

    const removedAdminEndpoint = await service.fetch(
      new Request("https://example.test/_admin/sessions"),
      context({ ...metadata, persistentExecutionId: undefined }),
    );
    assertEquals(removedAdminEndpoint.status, 404);
  } finally {
    await metadataStore.clear();
  }
});

Deno.test("initial UUI connection replays its generated screen in sequence", async () => {
  const metadataStore = new MemorySessionMetadataStore();
  const service = defineSessionService(async () => {
    await callScreen({
      id: "initial",
      schema: z.object({}),
      model: {},
      title: "Initial screen",
    });
  }, { metadataStore, completePersistent: () => Promise.resolve() });
  try {
    const response = await service.fetch(
      new Request("https://example.test/connect", { method: "POST" }),
      context(metadata),
    );
    assertEquals(response.status, 204);

    const socket = new TestSocket();
    socket.message(connectMessage(0));
    await service.connectWebSocket(
      new Request("https://example.test/connect"),
      context({ ...metadata, requestId: "request-initial-screen" }),
      socket,
    );
    await until(() => socket.sent.length >= 2);
    const screen = JSON.parse(String(socket.sent[0]));
    const ready = JSON.parse(String(socket.sent[1]));
    assertEquals(screen.type, "screen.show");
    assertEquals(screen.serverSequence, 1);
    assertEquals(ready.type, "session.ready");
    assertEquals(ready.serverSequence, 2);

    socket.message({
      type: "screen.event",
      protocol: UUI_PROTOCOL_VERSION,
      sessionId: screen.sessionId,
      clientSequence: 1,
      screenId: screen.screen.id,
      screenRevision: screen.screen.revision,
      action: "done",
      eventType: "action",
      changes: [],
    });
    await until(() => socket.signal.aborted);
  } finally {
    await metadataStore.clear();
  }
});

Deno.test("a session streams messages while its screen roundtrip is pending", async () => {
  const metadataStore = new MemorySessionMetadataStore();
  let sessionId = "";
  let releaseMessage!: () => void;
  const messageReady = new Promise<void>((resolve) => releaseMessage = resolve);
  const asyncMetadata = {
    ...metadata,
    requestId: "request-async-message-establish",
    persistentExecutionId: "persistent-async-message",
  };
  const service = defineSessionService(async () => {
    const screen = callScreen({
      id: "async-message",
      schema: z.object({}),
      model: {},
      title: "Async message",
    });
    await messageReady;
    sendMessage("Background work reached its checkpoint.", "success");
    await screen;
  }, { metadataStore, completePersistent: () => Promise.resolve() });
  try {
    assertEquals(
      (await service.fetch(
        new Request("https://example.test/connect", { method: "POST" }),
        context(asyncMetadata),
      )).status,
      204,
    );
    const socket = new TestSocket();
    socket.message(connectMessage(0));
    await service.connectWebSocket(
      new Request("https://example.test/connect"),
      context({ ...asyncMetadata, requestId: "request-async-message-socket" }),
      socket,
    );
    await until(() => socket.sent.length >= 2);
    const initial = socket.sent.map((item) => JSON.parse(String(item)));
    const screen = initial.find((item) => item.type === "screen.show");
    const ready = initial.find((item) => item.type === "session.ready");
    sessionId = ready.sessionId;
    releaseMessage();
    await until(() =>
      socket.sent.some((item) =>
        JSON.parse(String(item)).type === "notification.show"
      )
    );
    const notification = socket.sent.map((item) => JSON.parse(String(item)))
      .find((item) => item.type === "notification.show");
    assertEquals(notification, {
      type: "notification.show",
      level: "success",
      message: "Background work reached its checkpoint.",
      protocol: UUI_PROTOCOL_VERSION,
      serverSequence: ready.serverSequence + 1,
      sessionId: ready.sessionId,
    });
    socket.message({
      type: "screen.event",
      protocol: UUI_PROTOCOL_VERSION,
      sessionId: ready.sessionId,
      clientSequence: 1,
      screenId: screen.screen.id,
      screenRevision: screen.screen.revision,
      action: "done",
      eventType: "action",
      changes: [],
    });
    await until(() => socket.signal.aborted);
  } finally {
    if (sessionId !== "") {
      await workerFunctions["uui.session.terminate"]({ sessionId }).catch(
        () => undefined,
      );
    }
    await metadataStore.clear();
  }
});

Deno.test("session logout ends the persistent execution and redirects", async () => {
  const metadataStore = new MemorySessionMetadataStore();
  let completions = 0;
  let handlerAborted = false;
  let sessionId = "";
  const logoutMetadata = {
    ...metadata,
    requestId: "request-logout-establish",
    persistentExecutionId: "persistent-logout",
  };
  const service = defineSessionService(
    async ({ signal }) => {
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => {
          handlerAborted = true;
          resolve();
        }, { once: true });
      });
    },
    {
      metadataStore,
      completePersistent: () => {
        completions++;
        return Promise.resolve();
      },
    },
  );
  try {
    assertEquals(
      (await service.fetch(
        new Request("https://example.test/connect", { method: "POST" }),
        context(logoutMetadata),
      )).status,
      204,
    );
    const socket = new TestSocket();
    socket.message(connectMessage(0));
    await service.connectWebSocket(
      new Request("https://example.test/connect"),
      context({ ...logoutMetadata, requestId: "request-logout-socket" }),
      socket,
    );
    await until(() => socket.sent.length > 0);
    const ready = socket.sent.map((item) => JSON.parse(String(item))).find(
      (item) => item.type === "session.ready",
    );
    sessionId = ready.sessionId;
    socket.message({
      type: "session.logout",
      protocol: UUI_PROTOCOL_VERSION,
      sessionId,
      clientSequence: 1,
    });
    await until(() => socket.signal.aborted && completions === 1);
    const ended = socket.sent.map((item) => JSON.parse(String(item))).find(
      (item) => item.type === "session.end",
    );
    assertEquals(ended.message, "Signing out…");
    assertEquals(ended.redirectUrl, "/the8020/uui/login/logout");
    assertEquals(handlerAborted, true);
    assertEquals(metadataStore.size, 0);
  } finally {
    if (sessionId !== "") {
      await workerFunctions["uui.session.terminate"]({ sessionId }).catch(
        () => undefined,
      );
    }
    await metadataStore.clear();
  }
});

Deno.test("UUI service enforces its one-execution Worker contract", async () => {
  const metadataStore = new MemorySessionMetadataStore();
  let finish!: () => void;
  const service = defineSessionService(
    async () => await new Promise<void>((resolve) => finish = resolve),
    { metadataStore, completePersistent: () => Promise.resolve() },
  );
  try {
    assertEquals(
      (await service.fetch(
        new Request("https://example.test/connect", { method: "POST" }),
        context({ ...metadata, persistentExecutionId: "persistent-slot-a" }),
      )).status,
      204,
    );
    assertEquals(
      (await service.fetch(
        new Request("https://example.test/connect", { method: "POST" }),
        context({ ...metadata, persistentExecutionId: "persistent-slot-b" }),
      )).status,
      503,
    );
    finish();
    await until(() => metadataStore.size === 0);
  } finally {
    await metadataStore.clear();
  }
});

Deno.test("session heartbeat uses package constants and closes timed-out clients", async () => {
  const metadataStore = new MemorySessionMetadataStore();
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const originalNow = Date.now;
  let now = 1_000;
  let heartbeat: (() => void) | undefined;
  let intervalDelay = 0;
  let cleared = false;
  let finish!: () => void;
  globalThis.setInterval = ((callback: TimerHandler, delay?: number) => {
    if (typeof callback !== "function") {
      throw new TypeError("heartbeat callback must be a function");
    }
    heartbeat = callback as () => void;
    intervalDelay = delay ?? 0;
    return 8020;
  }) as typeof setInterval;
  globalThis.clearInterval = ((id?: number) => {
    if (id === 8020) cleared = true;
  }) as typeof clearInterval;
  Date.now = () => now;
  const service = defineSessionService(
    async () => await new Promise<void>((resolve) => finish = resolve),
    { metadataStore, completePersistent: () => Promise.resolve() },
  );
  try {
    const heartbeatMetadata = {
      ...metadata,
      requestId: "request-heartbeat-establish",
      persistentExecutionId: "persistent-heartbeat",
    };
    assertEquals(
      (await service.fetch(
        new Request("https://example.test/connect", { method: "POST" }),
        context(heartbeatMetadata),
      )).status,
      204,
    );
    assertEquals(intervalDelay, 30_000);
    const socket = new TestSocket();
    socket.message(connectMessage(0));
    await service.connectWebSocket(
      new Request("https://example.test/connect"),
      context({ ...heartbeatMetadata, requestId: "request-heartbeat-socket" }),
      socket,
    );
    await until(() => socket.sent.length > 0);
    const ready = socket.sent.map((item) => JSON.parse(String(item))).find(
      (item) => item.type === "session.ready",
    );
    now += 30_000;
    heartbeat!();
    await until(() =>
      socket.sent.some((item) =>
        JSON.parse(String(item)).type === "session.ping"
      )
    );
    now += 30_001;
    heartbeat!();
    await until(() => socket.signal.aborted);
    await workerFunctions["uui.session.terminate"]({
      sessionId: ready.sessionId,
    });
    assertEquals(cleared, true);
    finish();
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
    Date.now = originalNow;
    await metadataStore.clear();
  }
});

class MemorySessionMetadataStore implements SessionMetadataStore {
  readonly #records = new Map<string, SessionMetadata>();

  constructor(readonly beforeRemove?: () => void) {}

  get size(): number {
    return this.#records.size;
  }

  get(sessionId: string): SessionMetadata | undefined {
    const value = this.#records.get(sessionId);
    return value === undefined ? undefined : structuredClone(value);
  }

  put(metadata: SessionMetadata): Promise<void> {
    this.#records.set(metadata.sessionId, structuredClone(metadata));
    return Promise.resolve();
  }

  remove(sessionId: string): Promise<void> {
    this.beforeRemove?.();
    this.#records.delete(sessionId);
    return Promise.resolve();
  }

  async clear(): Promise<void> {
    const ids = [...this.#records.keys()];
    for (const id of ids) {
      try {
        await workerFunctions["uui.session.terminate"]({ sessionId: id });
      } catch {
        // A completed session no longer has a live Worker record.
      }
    }
    this.#records.clear();
  }
}

class TestSocket implements WebSocketSession {
  readonly protocol = "the8020.uui.v1";
  readonly #controller = new AbortController();
  readonly #messages: WebSocketInboundEvent[] = [];
  readonly #waiters: Array<(event: WebSocketInboundEvent) => void> = [];
  readonly sent: Array<string | Uint8Array> = [];

  get signal(): AbortSignal {
    return this.#controller.signal;
  }

  send(data: string | Uint8Array): void {
    this.sent.push(data);
  }

  receive(): Promise<WebSocketInboundEvent> {
    const event = this.#messages.shift();
    if (event !== undefined) return Promise.resolve(event);
    return new Promise((resolve) => this.#waiters.push(resolve));
  }

  close(code = 1000, reason = ""): void {
    this.#close(code, reason);
  }

  message(value: unknown): void {
    this.#push({ type: "message", data: JSON.stringify(value) });
  }

  remoteClose(code = 1000, reason = "test close"): void {
    this.#close(code, reason);
  }

  #close(code: number, reason: string): void {
    if (this.signal.aborted) return;
    this.#controller.abort();
    this.#push({ type: "close", code, reason });
  }

  #push(event: WebSocketInboundEvent): void {
    const waiter = this.#waiters.shift();
    if (waiter === undefined) this.#messages.push(event);
    else waiter(event);
  }
}

function context(meta: RequestMetadata) {
  return { signal: new AbortController().signal, meta };
}

function connectMessage(lastServerSequence: number) {
  return {
    type: "session.connect",
    protocol: UUI_PROTOCOL_VERSION,
    resumeToken: null,
    lastServerSequence,
  };
}

async function until(
  predicate: () => boolean | Promise<boolean>,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("condition was not reached");
}
