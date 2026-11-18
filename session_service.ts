import { technicalGuard } from "./technical_guard.ts";
import { browserLocalization } from "./localization.ts";
import {
  currentLocalization,
  type Localization,
  withLocalization,
} from "/p/the8020/i18n/mod.ts";
import {
  defineService,
  HTTPError,
  type PlatformService,
  type RequestMetadata,
  type WebSocketSession,
  z,
} from "/p/the8020/services/http.ts";
import { decodeStreamChunk } from "./channel_streams.ts";
import { MessageHistory } from "./messages.ts";
import { context } from "@the8020/context";
import { kernel, newId } from "@the8020/kernel";
import { AsyncLocalStorage } from "node:async_hooks";
import uiConfig from "./ui-config.json" with { type: "json" };
import {
  invokeProgram,
  ProgramExecutionError,
  type TerminatedProgramInput,
} from "./programs.ts";
import {
  type BrowserContext,
  MAX_UUI_MESSAGE_BODY_LENGTH,
  parseBrowserContext,
  parseClientMessage,
  type PresentationShowMessage,
  UUI_PROTOCOL_VERSION,
  type UUIClientMessage,
  type UUIServerMessage,
  type UUIWorkerOutbound,
} from "./protocol.ts";
import {
  bindSession,
  commandScreen,
  connectChannels,
  disconnectChannels,
  runInSession,
} from "./session.ts";
import {
  agentRequest,
  type AgentResponse,
  controlRequest,
  transcribe,
} from "./agent.ts";
import type {
  SessionMetadata,
  SessionMetadataStore,
} from "./session_metadata.ts";

export interface UUISessionContext {
  readonly sessionId: string;
  readonly auth: RequestMetadata["auth"];
  readonly signal: AbortSignal;
  readonly program?: string;
  readonly inputs?: unknown[];
}

interface ReplayItem {
  sequence: number;
  encoded: string;
  bytes: number;
}

interface SessionConfiguration {
  disconnectGraceMilliseconds: number;
  replayMessages: number;
  replayBytes: number;
  maxMessageSize: number;
  heartbeatIntervalMilliseconds: number;
  heartbeatTimeoutMilliseconds: number;
}

interface SessionLogEntry {
  at: string;
  direction: "client" | "server" | "lifecycle";
  type: string;
  sequence?: number;
  bytes?: number;
}

interface SessionRecord {
  handler: (context: UUISessionContext) => Promise<void>;
  localization: Localization;
  languageBundle: import("/p/the8020/i18n/messages.ts").Bundle;
  executionId: string;
  serviceId: string;
  placement: RequestMetadata["execution"];
  client: RequestMetadata["client"];
  browser?: BrowserContext;
  sessionId: string;
  auth: RequestMetadata["auth"];
  config: SessionConfiguration;
  input: AsyncQueue<UUIClientMessage | Uint8Array>;
  controller: AbortController;
  unbind: () => void;
  socket?: WebSocketSession;
  clients: Array<{ id: string; seen: number }>;
  control: number;
  commanding: boolean;
  commandError?: string;
  messages: MessageHistory;
  hasConnected: boolean;
  serverSequence: number;
  presentationRevision: number;
  lastClientSequence: number;
  replay: ReplayItem[];
  replayBytes: number;
  replayFloor: number;
  currentPresentation?: PresentationShowMessage;
  lastPongAt: number;
  heartbeatTimer?: ReturnType<typeof setInterval>;
  disconnectTimer?: ReturnType<typeof setTimeout>;
  createdAt: number;
  lastConnectionAt: number;
  messageLog: SessionLogEntry[];
  metadataWrites: Promise<void>;
  metadataStore: SessionMetadataStore;
  runInSession: ReturnType<typeof AsyncLocalStorage.snapshot>;
  completePersistent: () => Promise<void>;
  retireWorker: () => Promise<void>;
  restartRequested?: boolean;
  ended: boolean;
  endMessage?: { type: "session.end"; message: string; redirectUrl?: string };
  finalError?: string;
  finalizationTimer?: ReturnType<typeof setTimeout>;
  metadataFinalized?: boolean;
  completion?: Promise<void>;
  terminationFailure?: string;
}

class AsyncQueue<T> {
  #items: T[] = [];
  #waiters: Array<{ resolve(value: T): void; reject(error: unknown): void }> =
    [];
  #closed = false;

  push(value: T): void {
    if (this.#closed) return;
    const waiter = this.#waiters.shift();
    if (waiter === undefined) this.#items.push(value);
    else waiter.resolve(value);
  }

  async shift(): Promise<T> {
    if (this.#closed) {
      throw new DOMException("Session input closed", "AbortError");
    }
    const value = this.#items.shift();
    if (value !== undefined) return value;
    return await new Promise<T>((resolve, reject) =>
      this.#waiters.push({ resolve, reject })
    );
  }

  close(): void {
    this.#closed = true;
    this.#items.length = 0;
    for (const waiter of this.#waiters.splice(0)) {
      waiter.reject(new DOMException("Session input closed", "AbortError"));
    }
  }
}

const sessions = new Map<string, SessionRecord>();
let databaseMetadataStore: Promise<SessionMetadataStore> | undefined;

export interface SessionServiceOptions {
  metadataStore?: SessionMetadataStore;
  completePersistent?: () => Promise<void>;
  retireWorker?: () => Promise<void>;
}

export function defineSessionService(
  handler: (context: UUISessionContext) => Promise<void> = runConfiguredSession,
  options: SessionServiceOptions = {},
): PlatformService {
  if (typeof handler !== "function") {
    throw new TypeError("session handler must be a function");
  }
  const service = defineService();
  service.use(technicalGuard());
  service.post(
    "/connect",
    { summary: "Establish a persistent UUI execution" },
    async ({ meta, request }) => {
      let browser: BrowserContext | undefined;
      let program: string | undefined;
      let inputs: unknown[] | undefined;
      const body = await request.text();
      if (body !== "") {
        try {
          const value = JSON.parse(body);
          if (value.origin !== undefined) browser = parseBrowserContext(value);
          else {
            const start = z.object({
              browser: z.unknown().optional(),
              program: z.string().min(1).max(256).optional(),
              inputs: z.array(z.unknown()).max(32).optional(),
            }).strict().parse(value);
            if (start.browser !== undefined) {
              browser = parseBrowserContext(start.browser);
            }
            program = start.program;
            inputs = start.inputs;
          }
        } catch {
          throw new HTTPError(400, { error: "invalid_browser_context" });
        }
      }
      return withLocalization(
        await browserLocalization(request),
        () => establish(meta, handler, options, browser, program, inputs),
      );
    },
  );
  service.websocket("/connect", async ({ meta, socket }) => {
    await connect(meta, socket);
  });
  service.post(
    "/command",
    { summary: "Operate the current UUI screen" },
    async ({ meta, request }) => {
      const record = sessions.get(meta.persistentExecutionId ?? "");
      if (record === undefined) {
        throw new HTTPError(404, {
          error: "uui_session_not_found",
        });
      }
      if (
        !meta.auth.authenticated || meta.auth.userId !== record.auth.userId
      ) throw new HTTPError(403, { error: "session_owner_mismatch" });
      const parsed = agentRequest.safeParse(await request.json());
      if (!parsed.success) {
        return Response.json(agentResponse(record, "Invalid screen command"), {
          status: 400,
        });
      }
      const command = parsed.data;
      if (
        record.socket !== undefined || record.commanding ||
        record.clients.at(-1)?.id !== command.clientId ||
        record.control !== command.control
      ) {
        return Response.json(
          agentResponse(record, "Session control changed; attach again."),
          { status: 409 },
        );
      }
      record.commanding = true;
      record.commandError = undefined;
      if (record.disconnectTimer !== undefined) {
        clearTimeout(
          record.disconnectTimer,
        );
      }
      record.disconnectTimer = undefined;
      try {
        const current = agentResponse(record);
        if (record.ended) return Response.json(current);
        if (command.command.op !== "screen") {
          const expected = command.expected;
          if (
            expected === undefined || current.expected === undefined ||
            expected.surfaceId !== current.expected.surfaceId ||
            expected.screenId !== current.expected.screenId ||
            expected.instanceId !== current.expected.instanceId ||
            !command.force && expected.revision !== current.expected.revision
          ) {
            return Response.json(
              agentResponse(
                record,
                "The screen changed. Review the refreshed transcript; use --force to act despite refreshes of this same screen.",
              ),
              { status: 409 },
            );
          }
        }
        const result = command.command.op === "screen"
          ? undefined
          : await withLocalization(record.localization, () =>
            commandScreen(command.command, record.lastClientSequence + 1));
        // A program may still be working after accepting its event. Wait for its
        // next interactive screen, never for a quiet period between redraws.
        const deadline = Date.now() + 2000;
        while (
          !record.ended &&
          record.currentPresentation?.presentation.activeSurfaceId == null &&
          Date.now() < deadline
        ) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        return Response.json({
          ...agentResponse(record, record.commandError),
          ...(result === undefined ? {} : { result }),
        });
      } catch (error) {
        return Response.json(agentResponse(record, errorMessage(error)), {
          status: 400,
        });
      } finally {
        record.commanding = false;
        releaseClient(record, command.clientId);
        startDisconnectTimer(record);
      }
    },
  );
  return service;
}

async function establish(
  meta: RequestMetadata,
  handler: (context: UUISessionContext) => Promise<void>,
  options: SessionServiceOptions,
  browser?: BrowserContext,
  program?: string,
  inputs?: unknown[],
): Promise<Response> {
  if (!meta.auth.authenticated || meta.auth.userId === undefined) {
    throw new HTTPError(401, { error: "authentication_required" });
  }
  const executionId = meta.persistentExecutionId ?? "";
  if (executionId.length === 0) {
    throw new HTTPError(400, { error: "persistent_execution_required" });
  }
  const existing = sessions.get(executionId);
  if (existing !== undefined) {
    if (existing.auth.userId !== meta.auth.userId) {
      throw new HTTPError(403, { error: "session_owner_mismatch" });
    }
    if (browser !== undefined) existing.browser = browser;
    return new Response(null, {
      status: 204,
      headers: { "the8020-session": existing.sessionId },
    });
  }
  if (sessions.size > 0) {
    throw new HTTPError(503, { error: "worker_execution_slot_occupied" });
  }

  const sessionId = newId("uis");
  const metadataStore = options.metadataStore ?? await defaultMetadataStore();
  const input = new AsyncQueue<UUIClientMessage | Uint8Array>();
  const controller = new AbortController();
  const record = {} as SessionRecord;
  await currentLocalization()?.bundle("the8020/uui");
  await currentLocalization()?.bundle("the8020/i18n");
  const messages = new MessageHistory();
  const now = Date.now();
  Object.assign(
    record,
    {
      handler,
      localization: currentLocalization()!,
      languageBundle: await currentLocalization()!.bundle("the8020/uui"),
      executionId,
      serviceId: meta.serviceId,
      placement: structuredClone(meta.execution),
      client: structuredClone(meta.client),
      browser,
      sessionId,
      auth: structuredClone(meta.auth),
      config: sessionConfiguration(),
      input,
      controller,
      hasConnected: false,
      clients: [],
      control: 0,
      commanding: false,
      messages,
      serverSequence: 0,
      presentationRevision: 0,
      lastClientSequence: 0,
      replay: [],
      replayBytes: 0,
      replayFloor: 0,
      lastPongAt: now,
      createdAt: now,
      lastConnectionAt: now,
      messageLog: [],
      metadataWrites: Promise.resolve(),
      metadataStore,
      runInSession: AsyncLocalStorage.snapshot(),
      completePersistent: options.completePersistent ??
        (() => kernel.execution.completePersistent()),
      retireWorker: options.retireWorker ??
        (async () => {
          await kernel.admin.execute("worker.kill", {
            worker_id: record.placement.workerId,
          });
        }),
      ended: false,
    } satisfies Partial<SessionRecord>,
  );
  bindProgram(record);
  sessions.set(executionId, record);
  log(record, "lifecycle", "created");
  try {
    await writeMetadata(record, true);
  } catch (error) {
    sessions.delete(executionId);
    record.unbind();
    throw new HTTPError(500, {
      error: "session_metadata_failed",
      message: errorMessage(error),
    });
  }
  startHeartbeat(record);
  startDisconnectTimer(record);
  startProgram(record, program, inputs);
  return new Response(null, {
    status: 204,
    headers: { "the8020-session": sessionId },
  });
}

function bindProgram(record: SessionRecord): void {
  const { controller, input } = record;
  record.unbind = bindSession({
    sessionId: record.sessionId,
    messageHistory: record.messages,
    startedAt: new Date(record.createdAt).toISOString(),
    get connectionState() {
      return record.socket === undefined ? "DISCONNECTED" : "CONNECTED";
    },
    get browser() {
      return record.browser;
    },
    send: (message) => {
      if (!controller.signal.aborted) workerMessage(record, message);
    },
    receive: () => input.shift(),
  });
}

function startProgram(
  record: SessionRecord,
  program?: string,
  inputs?: unknown[],
): void {
  const { controller } = record;
  void Promise.resolve().then(() => {
    if (controller.signal.aborted) return;
    return runInSession(() =>
      record.handler({
        sessionId: record.sessionId,
        auth: record.auth,
        signal: controller.signal,
        program,
        inputs,
      })
    );
  }).then(
    () => {
      if (!record.ended && !controller.signal.aborted) {
        void end(record, "session handler returned").catch(() => undefined);
      }
    },
    (error: unknown) => {
      if (record.ended || controller.signal.aborted) return;
      record.finalError =
        errorMessage(error).trim().slice(0, MAX_UUI_MESSAGE_BODY_LENGTH) ||
        "Program failed";
      record.messages.add(record.finalError, "error");
      emit(record, {
        type: "session.error",
        code: "program_failed",
        message: record.finalError,
      });
      void end(record, "session handler failed").catch(() => undefined);
    },
  );
}

function exitProgram(record: SessionRecord): void {
  if (record.ended) return;
  record.runInSession(() => {
    record.controller.abort(new DOMException("Session exited", "AbortError"));
    record.unbind();
    record.input.close();
    record.controller = new AbortController();
    record.input = new AsyncQueue();
    record.messages = new MessageHistory();
    record.currentPresentation = undefined;
    record.commandError = undefined;
    record.replay.length = 0;
    record.replayBytes = 0;
    record.replayFloor = record.serverSequence;
    bindProgram(record);
    const connection = crypto.randomUUID();
    if (record.socket) connectChannels(connection);
    emit(record, { type: "session.reset", connection });
    updateMetadata(record);
    log(record, "lifecycle", "restarted in place");
    startProgram(record);
  });
}

function restartSession(record: SessionRecord): void {
  record.restartRequested = true;
  void end(record, "Session restarted", uiConfig.postLoginUrl).catch(() =>
    undefined
  );
}

async function connect(
  meta: RequestMetadata,
  socket: WebSocketSession,
): Promise<void> {
  if (!meta.auth.authenticated || meta.auth.userId === undefined) {
    socket.close(1008, "authentication required");
    return;
  }
  const executionId = meta.persistentExecutionId ?? "";
  const record = sessions.get(executionId);
  if (record === undefined || record.auth.userId !== meta.auth.userId) {
    socket.close(1008, "persistent session unavailable");
    return;
  }
  const first = await socket.receive();
  if (first.type !== "message") return;
  let message: UUIClientMessage;
  try {
    message = parseClientMessage(
      JSON.parse(textMessage(first.data, record.config.maxMessageSize)),
    );
  } catch (error) {
    socket.close(
      error instanceof OversizedMessageError ? 1009 : 1003,
      "invalid UUI message",
    );
    return;
  }
  if (message.type !== "session.connect") {
    socket.close(1003, "first UUI message must be session.connect");
    return;
  }
  // Direct protocol clients may create their first connection without a claim.
  // Once control has been claimed, every connection needs its current ticket.
  const clientId = message.clientId ?? "direct";
  if (record.clients.length === 0 && message.control === undefined) {
    record.clients.push({ id: clientId, seen: Date.now() });
    record.control++;
  } else if (
    record.commanding || record.clients.at(-1)?.id !== clientId ||
    record.control !== message.control
  ) {
    socket.close(4001, "Session control changed");
    return;
  }
  if (record.socket !== undefined) {
    disconnectChannels("UUI connection replaced");
    record.socket.close(1000, "replaced by reconnected client");
  }
  if (record.disconnectTimer !== undefined) {
    clearTimeout(record.disconnectTimer);
  }
  record.disconnectTimer = undefined;
  // Headless commands already consumed client sequences before the first socket.
  const resumed = record.hasConnected || record.lastClientSequence > 0;
  record.hasConnected = true;
  record.socket = socket;
  record.client = structuredClone(meta.client);
  if (message.browser !== undefined) record.browser = message.browser;
  record.lastConnectionAt = Date.now();
  record.lastPongAt = record.lastConnectionAt;
  log(record, "lifecycle", resumed ? "resumed" : "connected");
  updateMetadata(record);
  const connection = crypto.randomUUID();
  if (!record.ended) connectChannels(connection);
  if (resumed) {
    replay(
      record,
      message.control === undefined ? message.lastServerSequence : 0,
      connection,
    );
  } else {
    for (const item of record.replay) socket.send(item.encoded);
    send(record, {
      type: "session.ready",
      protocol: UUI_PROTOCOL_VERSION,
      serverSequence: ++record.serverSequence,
      sessionId: record.sessionId,
      resumeToken: "",
      localization: record.languageBundle,
      resumed: false,
      connection,
    }, false);
  }

  if (record.ended) {
    emitEnd(record);
    socket.close(1000, "session ended");
    disconnected(record);
    return;
  }

  try {
    while (!socket.signal.aborted) {
      const event = await socket.receive();
      if (event.type === "close") break;
      if (event.data instanceof Uint8Array) {
        if (event.data.byteLength > record.config.maxMessageSize) {
          throw new OversizedMessageError();
        }
        const decoded = decodeStreamChunk(event.data);
        const identity = parseClientMessage({
          ...decoded.frame,
          protocol: UUI_PROTOCOL_VERSION,
        }, true);
        if (
          identity.type !== "channel.frame" ||
          identity.kind !== "stream.bytes" ||
          identity.sessionId !== record.sessionId
        ) throw new TypeError("Invalid binary channel identity");
        if (record.socket === socket) record.input.push(event.data);
        continue;
      }
      const encoded = textMessage(event.data, record.config.maxMessageSize);
      const client = parseClientMessage(JSON.parse(encoded));
      clientMessage(
        record,
        socket,
        client,
        new TextEncoder().encode(encoded).byteLength,
      );
    }
  } catch (error) {
    emit(record, {
      type: "session.error",
      code: "malformed_message",
      message: errorMessage(error),
    });
    socket.close(
      error instanceof OversizedMessageError ? 1009 : 1003,
      "invalid UUI message",
    );
  } finally {
    if (record.socket === socket) disconnected(record);
  }
}

function clientMessage(
  record: SessionRecord,
  socket: WebSocketSession,
  message: UUIClientMessage,
  bytes: number,
): void {
  if (record.socket !== socket || message.type === "session.connect") return;
  log(
    record,
    "client",
    message.type,
    "clientSequence" in message ? message.clientSequence : undefined,
    bytes,
  );
  if (message.type === "session.pong") {
    record.lastPongAt = Date.now();
    return;
  }
  if (message.type === "channel.frame") {
    if (message.sessionId !== record.sessionId) {
      throw new TypeError("channel session mismatch");
    }
    record.input.push(message);
    return;
  }
  if (message.clientSequence <= record.lastClientSequence) {
    emit(record, {
      type: "server.ack",
      clientSequence: message.clientSequence,
    });
    return;
  }
  if (message.type === "session.logout") {
    record.lastClientSequence = message.clientSequence;
    void end(record, "Signing out…", uiConfig.logoutUrl).catch(() => undefined);
    return;
  }
  if (message.type === "session.exit") {
    record.lastClientSequence = message.clientSequence;
    exitProgram(record);
    return;
  }
  if (message.type === "session.restart") {
    record.lastClientSequence = message.clientSequence;
    restartSession(record);
    return;
  }
  if (message.type === "client.ack" && message.resync === true) {
    record.lastClientSequence = message.clientSequence;
    if (record.currentPresentation !== undefined) {
      emit(record, {
        type: "presentation.show",
        presentation: structuredClone(
          record.currentPresentation.presentation,
        ),
      });
    }
    emit(record, {
      type: "server.ack",
      clientSequence: message.clientSequence,
    });
    return;
  }
  record.input.push(message);
}

function workerMessage(
  record: SessionRecord,
  value: UUIWorkerOutbound | Uint8Array,
): void {
  if (
    value instanceof Uint8Array ||
    value.type === "channel.frame"
  ) {
    const socket = record.socket;
    if (record.ended || socket === undefined || socket.signal.aborted) {
      throw new Error("Transient data requires a connected UUI session");
    }
    if (value instanceof Uint8Array) socket.send(value);
    else emit(record, value, false);
    return;
  }
  if (record.ended || !sessions.has(record.executionId)) {
    return;
  }
  if (value.type === "session.exit") {
    exitProgram(record);
    return;
  }
  if (value.type === "session.restart") {
    restartSession(record);
    return;
  }
  if (value.type === "session.end") {
    void end(record, value.message ?? "session ended", value.redirectUrl).catch(
      () => undefined,
    );
    return;
  }
  if (value.type === "session.error" && record.commanding) {
    record.commandError = value.message ?? value.code;
  }
  if (value.type === "presentation.show") record.presentationRevision++;
  if (
    value.type === "server.ack" &&
    value.clientSequence > record.lastClientSequence
  ) record.lastClientSequence = value.clientSequence;
  emit(
    record,
    value,
    value.type !== "clipboard.write" && value.type !== "session.open",
  );
}

function emit(
  record: SessionRecord,
  value:
    | UUIWorkerOutbound
    | {
      type: "session.resumed";
      localization?: import("/p/the8020/i18n/messages.ts").Bundle;
      resumed: true;
      lastClientSequence: number;
      connection: string;
    }
    | {
      type: "session.resync_required";
      code: string;
      message: string;
      connection: string;
    }
    | { type: "session.ping" },
  retain = true,
): void {
  const message = {
    ...value,
    protocol: UUI_PROTOCOL_VERSION,
    serverSequence: ++record.serverSequence,
    sessionId: record.sessionId,
  } as UUIServerMessage;
  if (message.type === "presentation.show") {
    message.presentation.messages = record.messages.snapshot();
    record.currentPresentation = structuredClone(message);
    updateMetadata(record);
  }
  send(record, message, retain);
}

function send(
  record: SessionRecord,
  message: UUIServerMessage,
  retain: boolean,
): void {
  const encoded = JSON.stringify(message);
  const bytes = new TextEncoder().encode(encoded).byteLength;
  if (retain) {
    record.replay.push({ sequence: message.serverSequence, encoded, bytes });
    record.replayBytes += bytes;
    while (
      record.replay.length > record.config.replayMessages ||
      record.replayBytes > record.config.replayBytes
    ) {
      const removed = record.replay.shift()!;
      record.replayBytes -= removed.bytes;
      record.replayFloor = removed.sequence;
    }
  }
  log(record, "server", message.type, message.serverSequence, bytes);
  if (record.socket !== undefined && !record.socket.signal.aborted) {
    record.socket.send(encoded);
  }
}

function replay(
  record: SessionRecord,
  lastSequence: number,
  connection: string,
): void {
  if (lastSequence === 0) {
    emit(record, {
      type: "session.resumed",
      localization: record.languageBundle,
      resumed: true,
      connection,
      lastClientSequence: record.lastClientSequence,
    }, false);
    if (record.currentPresentation !== undefined) {
      emit(record, {
        type: "presentation.show",
        presentation: structuredClone(
          record.currentPresentation.presentation,
        ),
      });
    }
    return;
  }
  const missed = record.replay.filter((item) => item.sequence > lastSequence);
  if (
    lastSequence < record.replayFloor
  ) {
    emit(record, {
      type: "session.resync_required",
      code: "replay_exhausted",
      connection,
      message: "missed messages are no longer available",
    }, false);
    return;
  }
  for (const item of missed) record.socket?.send(item.encoded);
  emit(record, {
    type: "session.resumed",
    resumed: true,
    connection,
    lastClientSequence: record.lastClientSequence,
  }, false);
}

function disconnected(record: SessionRecord): void {
  if (record.socket === undefined) return;
  record.socket = undefined;
  const client = record.clients.at(-1);
  if (client !== undefined) releaseClient(record, client.id);
  disconnectChannels("UUI connection closed");
  log(record, "lifecycle", "disconnected");
  updateMetadata(record);
  startDisconnectTimer(record);
}

function startDisconnectTimer(record: SessionRecord): void {
  if (record.ended) return;
  if (record.disconnectTimer !== undefined) {
    clearTimeout(record.disconnectTimer);
  }
  record.disconnectTimer = setTimeout(
    () =>
      void record.runInSession(() =>
        end(record, "disconnect grace expired", undefined, false).catch(() =>
          undefined
        )
      ),
    record.config.disconnectGraceMilliseconds,
  );
}

function startHeartbeat(record: SessionRecord): void {
  record.heartbeatTimer = setInterval(() => {
    const socket = record.socket;
    if (socket === undefined) return;
    if (
      Date.now() - record.lastPongAt >
        record.config.heartbeatTimeoutMilliseconds
    ) {
      socket.close(1001, "heartbeat timeout");
      disconnected(record);
      return;
    }
    emit(record, { type: "session.ping" });
  }, record.config.heartbeatIntervalMilliseconds);
}

async function end(
  record: SessionRecord,
  reason: string,
  redirectUrl?: string,
  retainResult = redirectUrl === undefined,
): Promise<void> {
  if (record.ended) {
    if (!retainResult) await finalize(record);
    return;
  }
  record.ended = true;
  if (record.heartbeatTimer !== undefined) clearInterval(record.heartbeatTimer);
  if (record.disconnectTimer !== undefined) {
    clearTimeout(record.disconnectTimer);
  }
  record.endMessage = { type: "session.end", message: reason, redirectUrl };
  emitEnd(record);
  record.controller.abort(new DOMException(reason, "AbortError"));
  record.unbind();
  record.input.close();
  log(record, "lifecycle", "ended");
  if (!retainResult) return await finalize(record);
  updateMetadata(record, true);
  record.finalizationTimer = setTimeout(
    () =>
      void record.runInSession(() => finalize(record).catch(() => undefined)),
    uiConfig.finalResultRetentionMilliseconds,
  );
  record.socket?.close(1000, reason.slice(0, 120));
  disconnected(record);
}

function emitEnd(record: SessionRecord): void {
  emit(record, {
    ...record.endMessage!,
    messages: record.messages.snapshot(),
  }, false);
}

async function finalize(record: SessionRecord): Promise<void> {
  if (record.completion !== undefined) return await record.completion;
  if (record.finalizationTimer !== undefined) {
    clearTimeout(record.finalizationTimer);
  }
  record.completion = (async () => {
    if (!record.metadataFinalized) {
      await record.metadataWrites;
      try {
        await removeMetadata(record);
      } catch (error) {
        console.error(
          "UUI session metadata removal failed",
          errorMessage(error),
        );
      }
      record.metadataFinalized = true;
    }
    // Completion is exact and idempotent; a metadata failure must not retain capacity.
    if (record.restartRequested) await record.retireWorker();
    else await record.completePersistent();
    sessions.delete(record.executionId);
  })();
  try {
    await record.completion;
  } catch (error) {
    record.terminationFailure = errorMessage(error);
    console.error(
      "UUI persistent execution completion failed",
      record.terminationFailure,
    );
    record.completion = undefined;
    // Retry only terminal binding release, never the program or a client action.
    record.finalizationTimer = setTimeout(
      () =>
        void record.runInSession(() => finalize(record).catch(() => undefined)),
      1000,
    );
    throw error;
  } finally {
    record.socket?.close(1000, "session ended");
    disconnected(record);
  }
}

function sessionByID(sessionId: string): SessionRecord {
  const record = [...sessions.values()].find((item) =>
    item.sessionId === sessionId
  );
  if (record === undefined) {
    throw new HTTPError(404, { error: "uui_session_not_found" });
  }
  return record;
}

function sessionRecordStatus(record: SessionRecord): Record<string, unknown> {
  return {
    session_id: record.sessionId,
    persistent_execution_id: record.executionId,
    authenticated_user: record.auth.username ?? "",
    authenticated_user_id: record.auth.userId ?? "",
    service_id: record.serviceId,
    node_id: record.placement.nodeId,

    sandbox_id: record.placement.sandboxId,
    worker_id: record.placement.workerId,
    state: record.ended
      ? "ENDED"
      : record.socket === undefined
      ? "DISCONNECTED"
      : "CONNECTED",
    current_screen_id: currentScreen(record)?.id,
    current_screen_title: currentScreen(record)?.title,
    server_sequence: record.serverSequence,
    last_client_sequence: record.lastClientSequence,
    created_at: new Date(record.createdAt).toISOString(),
    last_connection_at: new Date(record.lastConnectionAt).toISOString(),
  };
}

function currentScreen(record: SessionRecord) {
  const presentation = record.currentPresentation?.presentation;
  if (presentation?.activeSurfaceId === null || presentation === undefined) {
    return undefined;
  }
  return presentation.surfaces.find((surface) =>
    surface.surfaceId === presentation.activeSurfaceId
  )?.screen;
}

function updateMetadata(record: SessionRecord, terminal = false): void {
  if (record.ended && !terminal) return;
  record.metadataWrites = record.metadataWrites.then(() =>
    record.runInSession(() => writeMetadata(record))
  ).catch((error) => {
    console.error("UUI session metadata update failed", error);
  });
}

async function writeMetadata(
  record: SessionRecord,
  create = false,
): Promise<void> {
  const metadata: SessionMetadata = {
    sessionId: record.sessionId,
    serviceId: record.serviceId,
    persistentExecutionId: record.executionId,
    nodeId: record.placement.nodeId,

    sandboxId: record.placement.sandboxId,
    workerId: record.placement.workerId,
    authenticatedUserId: record.auth.userId ?? "",
    authenticatedUser: record.auth.username ?? "",
    latestIpAddress: record.client.ipAddress,
    latestNetworkScope: record.client.networkScope,
    state: record.ended
      ? record.terminationFailure === undefined ? "ENDED" : "STALE"
      : record.socket === undefined
      ? "DISCONNECTED"
      : "CONNECTED",
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(),
    lastConnectionAt: new Date(record.lastConnectionAt),
    currentScreenId: currentScreen(record)?.id ?? null,
    terminationFailure: record.terminationFailure ?? null,
  };
  if (create) await record.metadataStore.create(metadata);
  else await record.metadataStore.put(metadata);
}

async function removeMetadata(record: SessionRecord): Promise<void> {
  await record.metadataStore.remove(record.sessionId);
}

function defaultMetadataStore(): Promise<SessionMetadataStore> {
  databaseMetadataStore ??= import("./session_metadata_database.ts").then(
    ({ sessionMetadataStore }) => sessionMetadataStore,
  );
  return databaseMetadataStore;
}

export const workerFunctions = Object.freeze({
  "uui.session.control": (input: unknown) =>
    controlSession(input, context.userId),
  "uui.session.inspect": (input: unknown): Record<string, unknown> =>
    sessionRecordStatus(sessionByInput(input)),
  "uui.session.message-log": (input: unknown): Record<string, unknown> => ({
    messages: structuredClone(sessionByInput(input).messageLog),
  }),
  "uui.session.terminate": async (
    input: unknown,
  ): Promise<Record<string, unknown>> => {
    await end(
      sessionByInput(input),
      "terminated through session management",
      undefined,
      false,
    );
    return { terminated: true };
  },
});

/** Called through the ordinary, authenticated Worker control-function path. */
export function controlSession(input: unknown, userId: string) {
  const request = controlRequest.parse(input);
  const record = sessionByID(request.sessionId);
  if (record.auth.userId !== userId) {
    throw new HTTPError(403, { error: "session_owner_mismatch" });
  }
  const now = Date.now();
  record.clients = record.clients.filter((client, index, all) =>
    client.seen > now - 120_000 || index === all.length - 1
  );
  const existing = record.clients.find((client) =>
    client.id === request.clientId
  );
  if (existing) existing.seen = now;
  if (request.operation === "release") {
    if (record.commanding) {
      throw new HTTPError(409, { error: "screen_command_in_progress" });
    }
    if (record.clients.at(-1)?.id === request.clientId) detachSocket(record);
    releaseClient(record, request.clientId);
  } else if (
    request.operation === "claim" &&
    (request.takeover || record.clients.length === 0 ||
      record.clients.at(-1)?.id === request.clientId)
  ) {
    if (record.commanding) {
      throw new HTTPError(409, { error: "screen_command_in_progress" });
    }
    if (record.clients.at(-1)?.id !== request.clientId) {
      detachSocket(record);
      record.clients = record.clients.filter((client) =>
        client.id !== request.clientId
      );
      record.clients.push({ id: request.clientId, seen: now });
      record.clients = record.clients.slice(-16);
      record.control++;
    }
  }
  return {
    active: record.clients.at(-1)?.id === request.clientId,
    control: record.control,
  };
}

function detachSocket(record: SessionRecord): void {
  const socket = record.socket;
  record.socket = undefined;
  disconnectChannels("UUI connection replaced");
  socket?.close(4001, "This session is connected in another window");
  if (record.disconnectTimer === undefined) startDisconnectTimer(record);
  updateMetadata(record);
}

function releaseClient(record: SessionRecord, clientId: string): void {
  if (record.clients.at(-1)?.id === clientId) record.control++;
  record.clients = record.clients.filter((client) => client.id !== clientId);
}

function agentResponse(
  record: SessionRecord,
  error = record.finalError,
): AgentResponse {
  const presentation = record.currentPresentation;
  const surface = presentation?.presentation.surfaces.at(-1);
  return {
    sessionId: record.sessionId,
    ...(surface === undefined ? {} : {
      expected: {
        revision: record.presentationRevision,
        surfaceId: surface.surfaceId,
        screenId: surface.screen.id,
        instanceId: surface.screen.state.instanceId,
      },
    }),
    transcript: transcribe(presentation?.presentation),
    ...(error === undefined ? {} : { error }),
    ...(record.ended
      ? { ended: true }
      : presentation?.presentation.activeSurfaceId == null
      ? { busy: true }
      : {}),
    ...(record.messages.snapshot().length
      ? {
        messages: record.messages.snapshot().slice(-10).map((
          { level, message },
        ) => ({ level, message })),
      }
      : {}),
  };
}

function sessionByInput(input: unknown): SessionRecord {
  if (
    input === null || typeof input !== "object" ||
    typeof (input as { sessionId?: unknown }).sessionId !== "string"
  ) throw new TypeError("sessionId is required");
  return sessionByID((input as { sessionId: string }).sessionId);
}

function sessionConfiguration(): SessionConfiguration {
  const result = {
    disconnectGraceMilliseconds: uiConfig.disconnectGraceMilliseconds,
    replayMessages: uiConfig.replayMessageLimit,
    replayBytes: uiConfig.replayByteLimit,
    maxMessageSize: uiConfig.maximumMessageBytes,
    heartbeatIntervalMilliseconds: uiConfig.heartbeatIntervalMilliseconds,
    heartbeatTimeoutMilliseconds: uiConfig.heartbeatTimeoutMilliseconds,
  };
  if (
    result.heartbeatTimeoutMilliseconds <
      result.heartbeatIntervalMilliseconds
  ) throw new HTTPError(500, { error: "invalid_uui_configuration" });
  return result;
}

function textMessage(value: string | Uint8Array, maximum: number): string {
  const bytes = typeof value === "string"
    ? new TextEncoder().encode(value)
    : value;
  if (bytes.byteLength > maximum) throw new OversizedMessageError();
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

class OversizedMessageError extends Error {}

async function runConfiguredSession(context: UUISessionContext): Promise<void> {
  const programs = {
    home: context.program ?? uiConfig.homeProgram,
    terminated: uiConfig.terminatedProgram,
  };
  while (!context.signal.aborted) {
    try {
      await invokeProgram(programs.home, context.inputs);
      return;
    } catch (error) {
      if (context.signal.aborted) return;
      const failure = terminationInput(error, programs.home, programs);
      const action = await invokeProgram(programs.terminated, [failure]);
      if (action !== "home") return;
    }
  }
}

function terminationInput(
  error: unknown,
  fallbackProgram: string,
  programs: { home: string; terminated: string },
): TerminatedProgramInput {
  if (error instanceof ProgramExecutionError) {
    return {
      exception: error.exception,
      programId: error.programId,
      entrypoint: error.entrypoint,
      occurredAt: new Date().toISOString(),
      homeProgram: programs.home,
      terminatedProgram: programs.terminated,
    };
  }
  return {
    exception: error,
    programId: fallbackProgram,
    entrypoint: "",
    occurredAt: new Date().toISOString(),
    homeProgram: programs.home,
    terminatedProgram: programs.terminated,
  };
}

function log(
  record: SessionRecord,
  direction: SessionLogEntry["direction"],
  type: string,
  sequence?: number,
  bytes?: number,
): void {
  record.messageLog.push({
    at: new Date().toISOString(),
    direction,
    type,
    sequence,
    bytes,
  });
  if (record.messageLog.length > 1_000) record.messageLog.shift();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "UUI session failed";
}
