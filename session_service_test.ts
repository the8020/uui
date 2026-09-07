import { Model } from "./model.ts";
import { isId } from "@the8020/kernel";
import { assert, assertEquals, assertRejects } from "@std/assert";
import { download, type DownloadHandle } from "./mod.ts";
import {
  type RequestMetadata,
  type WebSocketInboundEvent,
  type WebSocketSession,
  z,
} from "@the8020/http";
import {
  callScreen,
  presentModal,
  presentPage,
  sendMessage,
} from "./session.ts";
import {
  type PresentationShowMessage,
  UUI_PROTOCOL_VERSION,
  type UUIClientMessage,
  type UUIServerMessage,
} from "./protocol.ts";
import type {
  SessionMetadata,
  SessionMetadataStore,
} from "./session_metadata.ts";
import { defineSessionService, workerFunctions } from "./session_service.ts";

const metadata: RequestMetadata = {
  contextId: "request-1",
  serviceId: "the8020/uui/session",
  serviceGeneration: 1,
  canonicalBasePath: "/the8020/uui/session",
  originalUrl: "https://example.test/the8020/uui/session/connect",
  client: { ipAddress: "203.0.113.4", networkScope: "public" },
  persistentExecutionId: "persistent-1",
  persistentKeepAliveMilliseconds: 120_000,
  execution: {
    nodeId: "node-test",

    sandboxId: "sbx-test",
    workerId: "wrk-test",

    persistentExecutionId: "persistent-1",
  },
  user: { userId: "user:admin", username: "admin" },
  auth: {
    authenticated: true,
    realm: "user",
    userId: "user-1",
    username: "admin",
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
      context({ ...metadata, contextId: "request-2" }),
      first,
    );
    assertEquals(accepted.status, 204);
    await until(() => first.sent.length > 0);
    const ready = JSON.parse(String(first.sent[0]));
    assertEquals(ready.type, "session.ready");
    assert(isId(ready.sessionId, "uis"));
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
        contextId: "request-3",
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

Deno.test("session ID registration failure cannot overwrite metadata or retain a Worker slot", async () => {
  let creates = 0, updates = 0, removals = 0, invocations = 0;
  const service = defineSessionService(() => {
    invocations++;
    return Promise.resolve();
  }, {
    metadataStore: {
      create() {
        creates++;
        return Promise.reject(new Error("duplicate session ID"));
      },
      put() {
        updates++;
        return Promise.resolve();
      },
      remove() {
        removals++;
        return Promise.resolve();
      },
    },
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await service.fetch(
      new Request("https://example.test/connect", { method: "POST" }),
      context(metadata),
    );
    assertEquals(response.status, 500);
    assertEquals((await response.json()).error, "session_metadata_failed");
  }
  assertEquals(creates, 2);
  assertEquals([updates, removals, invocations], [0, 0, 0]);
});

Deno.test("intentional termination does not report the interrupted program as failed", async () => {
  const metadataStore = new MemorySessionMetadataStore();
  let sessionId = "";
  let completions = 0;
  const service = defineSessionService(async () => {
    await callScreen({
      id: "interrupted",
      schema: z.object({}),
      model: new Model({}),
      title: "Interrupted screen",
    });
  }, {
    metadataStore,
    completePersistent: () => {
      completions++;
      return Promise.resolve();
    },
  });
  try {
    const response = await service.fetch(
      new Request("https://example.test/connect", { method: "POST" }),
      context({
        ...metadata,
        contextId: "request-intentional-termination",
        persistentExecutionId: "persistent-intentional-termination",
      }),
    );
    assertEquals(response.status, 204);

    const socket = new TestSocket();
    socket.message(connectMessage(0));
    await service.connectWebSocket(
      new Request("https://example.test/connect"),
      context({
        ...metadata,
        contextId: "request-intentional-termination-socket",
        persistentExecutionId: "persistent-intentional-termination",
      }),
      socket,
    );
    await until(() => serverMessages(socket, "session.ready").length === 1);
    sessionId = serverMessages(socket, "session.ready")[0]!.sessionId;

    await workerFunctions["uui.session.terminate"]({ sessionId });
    await Promise.resolve();
    assertEquals(serverMessages(socket, "session.end").length, 1);
    assertEquals(serverMessages(socket, "session.error").length, 0);
    assertEquals(socket.signal.aborted, true);
    assertEquals(completions, 1);
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

Deno.test("initial UUI connection replays its generated screen in sequence", async () => {
  const metadataStore = new MemorySessionMetadataStore();
  const service = defineSessionService(async () => {
    await callScreen({
      id: "initial",
      schema: z.object({}),
      model: new Model({}),
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
      context({ ...metadata, contextId: "request-initial-screen" }),
      socket,
    );
    await until(() => socket.sent.length >= 2);
    const screen = JSON.parse(String(socket.sent[0]));
    const ready = JSON.parse(String(socket.sent[1]));
    assertEquals(screen.type, "presentation.show");
    assertEquals(screen.serverSequence, 1);
    assertEquals(ready.type, "session.ready");
    assertEquals(ready.serverSequence, 2);

    const surface = screen.presentation.surfaces.at(-1);
    socket.message({
      type: "screen.event",
      protocol: UUI_PROTOCOL_VERSION,
      sessionId: screen.sessionId,
      clientSequence: 1,
      surfaceId: surface.surfaceId,
      screenId: surface.screen.id,
      screenRevision: surface.screen.revision,
      instanceId: surface.screen.state.instanceId,
      screenState: {
        version: surface.screen.state.version,
        scroll: surface.screen.state.scroll,
        elements: {},
      },
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
    contextId: "request-async-message-establish",
    persistentExecutionId: "persistent-async-message",
  };
  const service = defineSessionService(async () => {
    const screen = callScreen({
      id: "async-message",
      schema: z.object({}),
      model: new Model({}),
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
      context({ ...asyncMetadata, contextId: "request-async-message-socket" }),
      socket,
    );
    await until(() => socket.sent.length >= 2);
    const initial = socket.sent.map((item) => JSON.parse(String(item)));
    const screen = initial.find((item) => item.type === "presentation.show");
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
    const surface = screen.presentation.surfaces.at(-1);
    socket.message({
      type: "screen.event",
      protocol: UUI_PROTOCOL_VERSION,
      sessionId: ready.sessionId,
      clientSequence: 1,
      surfaceId: surface.surfaceId,
      screenId: surface.screen.id,
      screenRevision: surface.screen.revision,
      instanceId: surface.screen.state.instanceId,
      screenState: {
        version: surface.screen.state.version,
        scroll: surface.screen.state.scroll,
        elements: {},
      },
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

Deno.test("reload and resync retain a stacked presentation and its hidden continuations", async () => {
  const metadataStore = new MemorySessionMetadataStore();
  const stackedMetadata = {
    ...metadata,
    contextId: "request-stacked-establish",
    persistentExecutionId: "persistent-stacked",
  };
  const schema = z.object({ value: z.string() });
  const show = (id: string) =>
    callScreen({ id, title: id, schema, model: new Model({ value: id }) });
  const service = defineSessionService(async () => {
    const pageA = show("page-a");
    await presentModal(async () => {
      const modalB = show("modal-b");
      await presentPage(async () => {
        const pageD = show("page-d");
        await presentModal(() => show("modal-e"));
        await pageD;
      });
      await modalB;
    });
    await pageA;
  }, { metadataStore, completePersistent: () => Promise.resolve() });
  let sessionId = "";
  try {
    assertEquals(
      (await service.fetch(
        new Request("https://example.test/connect", { method: "POST" }),
        context(stackedMetadata),
      )).status,
      204,
    );
    const first = new TestSocket();
    first.message(connectMessage(0));
    await service.connectWebSocket(
      new Request("https://example.test/connect"),
      context({ ...stackedMetadata, contextId: "request-stacked-first" }),
      first,
    );
    await until(() => serverMessages(first, "session.ready").length === 1);
    const ready = serverMessages(first, "session.ready")[0]!;
    sessionId = ready.sessionId;
    let current = serverMessages(first, "presentation.show").at(-1)!;
    assertEquals(presentationIDs(current), ["page-d", "modal-e"]);
    assertEquals(current.presentation.activeSurfaceId, "surface-4");

    first.remoteClose();
    const reloaded = new TestSocket();
    reloaded.message(connectMessage(0));
    await service.connectWebSocket(
      new Request("https://example.test/connect"),
      context({ ...stackedMetadata, contextId: "request-stacked-reload" }),
      reloaded,
    );
    await until(() =>
      serverMessages(reloaded, "presentation.show").length >= 1
    );
    current = serverMessages(reloaded, "presentation.show").at(-1)!;
    assertEquals(presentationIDs(current), ["page-d", "modal-e"]);
    reloaded.message(screenEvent(current, "close-e", 1));
    await until(() => {
      const message = serverMessages(reloaded, "presentation.show").at(-1);
      return message !== undefined &&
        presentationIDs(message).join() === "page-d" &&
        message.presentation.activeSurfaceId === "surface-3";
    });
    current = serverMessages(reloaded, "presentation.show").at(-1)!;

    reloaded.remoteClose();
    const pageReload = new TestSocket();
    pageReload.message(connectMessage(0));
    await service.connectWebSocket(
      new Request("https://example.test/connect"),
      context({ ...stackedMetadata, contextId: "request-page-reload" }),
      pageReload,
    );
    await until(() =>
      serverMessages(pageReload, "presentation.show").length >= 1
    );
    current = serverMessages(pageReload, "presentation.show").at(-1)!;
    assertEquals(presentationIDs(current), ["page-d"]);
    pageReload.message(screenEvent(current, "close-d", 2));
    await until(() => {
      const message = serverMessages(pageReload, "presentation.show").at(-1);
      return message !== undefined &&
        presentationIDs(message).join() === "page-a,modal-b" &&
        message.presentation.activeSurfaceId === "surface-2";
    });
    current = serverMessages(pageReload, "presentation.show").at(-1)!;
    assertEquals(presentationIDs(current), ["page-a", "modal-b"]);

    pageReload.message({
      type: "client.ack",
      protocol: UUI_PROTOCOL_VERSION,
      sessionId,
      clientSequence: 3,
      resync: true,
    });
    await until(() =>
      serverMessages(pageReload, "presentation.show").length >= 3
    );
    const resynced = serverMessages(pageReload, "presentation.show").at(-1)!;
    assertEquals(presentationIDs(resynced), ["page-a", "modal-b"]);
    assertEquals(resynced.presentation.activeSurfaceId, "surface-2");
    assertEquals(
      (workerFunctions["uui.session.inspect"]({ sessionId }) as {
        current_screen_id: string;
      }).current_screen_id,
      "modal-b",
    );
    assertEquals(
      workerFunctions["uui.session.inspect"]({ sessionId })
        .current_screen_title,
      resynced.presentation.surfaces.find((surface) =>
        surface.surfaceId === "surface-2"
      )?.screen.title,
    );

    pageReload.message(screenEvent(resynced, "close-b", 4));
    await until(() => {
      const message = serverMessages(pageReload, "presentation.show").at(-1);
      return message !== undefined &&
        presentationIDs(message).join() === "page-a" &&
        message.presentation.activeSurfaceId === "surface-1";
    });
    current = serverMessages(pageReload, "presentation.show").at(-1)!;
    pageReload.message(screenEvent(current, "done", 5));
    await until(() => pageReload.signal.aborted);
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
    contextId: "request-logout-establish",
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
      context({ ...logoutMetadata, contextId: "request-logout-socket" }),
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
      contextId: "request-heartbeat-establish",
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
      context({ ...heartbeatMetadata, contextId: "request-heartbeat-socket" }),
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

Deno.test("public download starts in the background, uses the session socket, and never replays on reconnect", async () => {
  const metadataStore = new MemorySessionMetadataStore();
  const originalNow = Date.now;
  const now = Date.now();
  let handle: DownloadHandle | undefined;
  let reads = 0;
  let cleaned = false;
  async function* bytes() {
    try {
      while (true) {
        reads++;
        yield new Uint8Array([reads]);
      }
    } finally {
      cleaned = true;
    }
  }
  const service = defineSessionService(async ({ signal }) => {
    try {
      while (!signal.aborted) {
        const event = await callScreen({
          id: "download-test",
          schema: z.object({}),
          model: new Model({}),
          header: { actions: [{ id: "export", label: "Export" }] },
        });
        if (event.action === "export") {
          handle = download({ filename: "table.csv", body: bytes() });
        }
      }
    } catch (error) {
      if (!signal.aborted) throw error;
    }
  }, { metadataStore, completePersistent: () => Promise.resolve() });
  try {
    // Establishing and connecting within one clock tick must still resume once.
    Date.now = () => now;
    await service.fetch(
      new Request("https://example.test/connect", { method: "POST" }),
      context(metadata),
    );
    const socket = new TestSocket();
    socket.message(connectMessage(0));
    await service.connectWebSocket(
      new Request("https://example.test/connect"),
      context(metadata),
      socket,
    );
    await until(() => serverMessages(socket, "presentation.show").length === 1);
    const first = serverMessages(socket, "presentation.show")[0]!;
    socket.message(screenEvent(first, "export", 10));
    await until(() =>
      handle !== undefined &&
      serverMessages(socket, "presentation.show").length > 1 &&
      serverMessages(socket, "presentation.show").at(-1)?.presentation
          .activeSurfaceId !== null
    );
    assertEquals(
      reads,
      0,
      "source must wait for browser demand while the next screen is available",
    );
    const begin = serverMessages(socket, "download.begin")[0]!;
    socket.message({
      type: "download.credit",
      protocol: UUI_PROTOCOL_VERSION,
      clientSequence: 1,
      sessionId: first.sessionId,
      downloadId: begin.downloadId,
      frames: 4,
      consumed: 0,
    });
    await until(() =>
      socket.sent.filter((item) => item instanceof Uint8Array).length === 4
    );
    assertEquals(
      reads,
      4,
      "download controls are independent of screen event sequence deduplication",
    );
    socket.remoteClose();
    await assertRejects(() => handle!.done, DOMException, "connection closed");
    await until(() => cleaned);
    const next = new TestSocket();
    next.message(connectMessage(0));
    await service.connectWebSocket(
      new Request("https://example.test/connect"),
      context(metadata),
      next,
    );
    await until(() => serverMessages(next, "session.resumed").length > 0);
    assertEquals(next.sent.some((item) => item instanceof Uint8Array), false);
    assertEquals(serverMessages(next, "download.begin").length, 0);
    assertEquals(serverMessages(next, "download.end").length, 0);
    assertEquals(serverMessages(next, "download.error").length, 0);
    assert(serverMessages(next, "presentation.show").length > 0);
  } finally {
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

  create(metadata: SessionMetadata): Promise<void> {
    if (this.#records.has(metadata.sessionId)) {
      return Promise.reject(new Error("duplicate session ID"));
    }
    return this.put(metadata);
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

function serverMessages<T extends UUIServerMessage["type"]>(
  socket: TestSocket,
  type: T,
): Array<Extract<UUIServerMessage, { type: T }>> {
  return socket.sent.filter((item) => typeof item === "string").map((item) =>
    JSON.parse(String(item)) as UUIServerMessage
  )
    .filter((item): item is Extract<UUIServerMessage, { type: T }> =>
      item.type === type
    );
}

function presentationIDs(message: PresentationShowMessage): string[] {
  return message.presentation.surfaces.map((surface) => surface.screen.id);
}

function screenEvent(
  presentation: PresentationShowMessage,
  action: string,
  clientSequence: number,
): Extract<UUIClientMessage, { type: "screen.event" }> {
  const surface = presentation.presentation.surfaces.at(-1)!;
  return {
    type: "screen.event",
    protocol: UUI_PROTOCOL_VERSION,
    sessionId: presentation.sessionId,
    clientSequence,
    surfaceId: surface.surfaceId,
    screenId: surface.screen.id,
    screenRevision: surface.screen.revision,
    instanceId: surface.screen.state.instanceId,
    screenState: {
      version: surface.screen.state.version,
      scroll: surface.screen.state.scroll,
      elements: {},
    },
    action,
    eventType: "action",
    changes: [],
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
