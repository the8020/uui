import {
  defineService,
  HTTPError,
  type PlatformService,
  type RequestMetadata,
  type WebSocketSession,
} from "@the8020/http";
import { kernel } from "@the8020/kernel";
import uiConfig from "./ui-config.json" with { type: "json" };
import {
  invokeProgram,
  ProgramExecutionError,
  type TerminatedProgramInput,
} from "./programs.ts";
import {
  parseClientMessage,
  type PresentationShowMessage,
  UUI_PROTOCOL_VERSION,
  type UUIClientMessage,
  type UUIServerMessage,
  type UUIWorkerOutbound,
} from "./protocol.ts";
import { bindSession } from "./session.ts";
import type {
  SessionMetadata,
  SessionMetadataStore,
} from "./session_metadata.ts";

export interface UUISessionContext {
  readonly sessionId: string;
  readonly auth: RequestMetadata["auth"];
  readonly signal: AbortSignal;
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
  executionId: string;
  serviceId: string;
  placement: RequestMetadata["execution"];
  client: RequestMetadata["client"];
  sessionId: string;
  auth: RequestMetadata["auth"];
  config: SessionConfiguration;
  input: AsyncQueue<UUIClientMessage>;
  controller: AbortController;
  unbind: () => void;
  socket?: WebSocketSession;
  serverSequence: number;
  lastClientSequence: number;
  replay: ReplayItem[];
  replayBytes: number;
  currentPresentation?: PresentationShowMessage;
  lastPongAt: number;
  heartbeatTimer?: ReturnType<typeof setInterval>;
  disconnectTimer?: ReturnType<typeof setTimeout>;
  createdAt: number;
  lastConnectionAt: number;
  messageLog: SessionLogEntry[];
  metadataWrites: Promise<void>;
  metadataStore: SessionMetadataStore;
  completePersistent: () => Promise<void>;
  ended: boolean;
  terminationFailure?: string;
}

class AsyncQueue<T> {
  #items: T[] = [];
  #waiters: Array<(value: T) => void> = [];

  push(value: T): void {
    const waiter = this.#waiters.shift();
    if (waiter === undefined) this.#items.push(value);
    else waiter(value);
  }

  async shift(): Promise<T> {
    const value = this.#items.shift();
    if (value !== undefined) return value;
    return await new Promise<T>((resolve) => this.#waiters.push(resolve));
  }
}

const sessions = new Map<string, SessionRecord>();
let databaseMetadataStore: Promise<SessionMetadataStore> | undefined;

export interface SessionServiceOptions {
  metadataStore?: SessionMetadataStore;
  completePersistent?: () => Promise<void>;
}

export function defineSessionService(
  handler: (context: UUISessionContext) => Promise<void> = runConfiguredSession,
  options: SessionServiceOptions = {},
): PlatformService {
  if (typeof handler !== "function") {
    throw new TypeError("session handler must be a function");
  }
  const service = defineService();
  service.post(
    "/connect",
    { summary: "Establish a persistent UUI execution" },
    ({ meta }) => establish(meta, handler, options),
  );
  service.websocket("/connect", async ({ meta, socket }) => {
    await connect(meta, socket);
  });
  return service;
}

async function establish(
  meta: RequestMetadata,
  handler: (context: UUISessionContext) => Promise<void>,
  options: SessionServiceOptions,
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
    return new Response(null, { status: 204 });
  }
  if (sessions.size > 0) {
    throw new HTTPError(503, { error: "worker_execution_slot_occupied" });
  }

  const sessionId = randomSessionID();
  const metadataStore = options.metadataStore ?? await defaultMetadataStore();
  const input = new AsyncQueue<UUIClientMessage>();
  const controller = new AbortController();
  const record = {} as SessionRecord;
  const unbind = bindSession({
    sessionId,
    send: (message) => workerMessage(record, message),
    receive: () => input.shift(),
  });
  const now = Date.now();
  Object.assign(
    record,
    {
      executionId,
      serviceId: meta.serviceId,
      placement: structuredClone(meta.execution),
      client: structuredClone(meta.client),
      sessionId,
      auth: structuredClone(meta.auth),
      config: sessionConfiguration(),
      input,
      controller,
      unbind,
      serverSequence: 0,
      lastClientSequence: 0,
      replay: [],
      replayBytes: 0,
      lastPongAt: now,
      createdAt: now,
      lastConnectionAt: now,
      messageLog: [],
      metadataWrites: Promise.resolve(),
      metadataStore,
      completePersistent: options.completePersistent ??
        (() => kernel.execution.completePersistent()),
      ended: false,
    } satisfies Partial<SessionRecord>,
  );
  sessions.set(executionId, record);
  log(record, "lifecycle", "created");
  try {
    await writeMetadata(record);
  } catch (error) {
    sessions.delete(executionId);
    record.unbind();
    throw new HTTPError(500, {
      error: "session_metadata_failed",
      message: errorMessage(error),
    });
  }
  startHeartbeat(record);
  void handler({
    sessionId,
    auth: record.auth,
    signal: controller.signal,
  }).then(
    () => {
      if (!record.ended) void end(record, "session handler returned");
    },
    (error: unknown) => {
      if (record.ended) return;
      emit(record, {
        type: "session.error",
        code: "program_failed",
        message: errorMessage(error),
      });
      void end(record, "session handler failed");
    },
  );
  return new Response(null, { status: 204 });
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
  record.socket?.close(1000, "replaced by reconnected client");
  if (record.disconnectTimer !== undefined) {
    clearTimeout(record.disconnectTimer);
  }
  record.disconnectTimer = undefined;
  const resumed = record.lastConnectionAt !== record.createdAt;
  record.socket = socket;
  record.client = structuredClone(meta.client);
  record.lastConnectionAt = Date.now();
  record.lastPongAt = record.lastConnectionAt;
  log(record, "lifecycle", resumed ? "resumed" : "connected");
  updateMetadata(record);
  if (resumed) replay(record, message.lastServerSequence);
  else {
    for (const item of record.replay) socket.send(item.encoded);
    send(record, {
      type: "session.ready",
      protocol: UUI_PROTOCOL_VERSION,
      serverSequence: ++record.serverSequence,
      sessionId: record.sessionId,
      resumeToken: "",
      resumed: false,
    }, false);
  }

  try {
    while (!socket.signal.aborted) {
      const event = await socket.receive();
      if (event.type === "close") break;
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
  if (message.clientSequence <= record.lastClientSequence) {
    emit(record, {
      type: "server.ack",
      clientSequence: message.clientSequence,
    });
    return;
  }
  if (message.type === "session.logout") {
    record.lastClientSequence = message.clientSequence;
    void end(record, "Signing out…", uiConfig.logoutUrl);
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

function workerMessage(record: SessionRecord, value: UUIWorkerOutbound): void {
  if (record.executionId === undefined || !sessions.has(record.executionId)) {
    return;
  }
  if (value.type === "session.end") {
    void end(record, value.message ?? "session ended", value.redirectUrl);
    return;
  }
  if (
    value.type === "server.ack" &&
    value.clientSequence > record.lastClientSequence
  ) record.lastClientSequence = value.clientSequence;
  emit(record, value, value.type !== "clipboard.write");
}

function emit(
  record: SessionRecord,
  value:
    | UUIWorkerOutbound
    | { type: "session.resumed"; resumed: true; lastClientSequence: number }
    | { type: "session.resync_required"; code: string; message: string }
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
    ) record.replayBytes -= record.replay.shift()!.bytes;
  }
  log(record, "server", message.type, message.serverSequence, bytes);
  if (record.socket !== undefined && !record.socket.signal.aborted) {
    record.socket.send(encoded);
  }
}

function replay(record: SessionRecord, lastSequence: number): void {
  if (lastSequence === 0) {
    emit(record, {
      type: "session.resumed",
      resumed: true,
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
    lastSequence < record.serverSequence &&
    (missed.length === 0 || missed[0]!.sequence > lastSequence + 1)
  ) {
    emit(record, {
      type: "session.resync_required",
      code: "replay_exhausted",
      message: "missed messages are no longer available",
    }, false);
    return;
  }
  for (const item of missed) record.socket?.send(item.encoded);
  emit(record, {
    type: "session.resumed",
    resumed: true,
    lastClientSequence: record.lastClientSequence,
  }, false);
}

function disconnected(record: SessionRecord): void {
  if (record.socket === undefined) return;
  record.socket = undefined;
  log(record, "lifecycle", "disconnected");
  updateMetadata(record);
  if (record.disconnectTimer !== undefined) {
    clearTimeout(record.disconnectTimer);
  }
  record.disconnectTimer = setTimeout(
    () => void end(record, "disconnect grace expired"),
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
): Promise<void> {
  if (!sessions.delete(record.executionId)) return;
  record.ended = true;
  if (record.heartbeatTimer !== undefined) clearInterval(record.heartbeatTimer);
  if (record.disconnectTimer !== undefined) {
    clearTimeout(record.disconnectTimer);
  }
  emit(record, { type: "session.end", message: reason, redirectUrl }, false);
  record.controller.abort(new DOMException(reason, "AbortError"));
  record.unbind();
  log(record, "lifecycle", "ended");
  await record.metadataWrites.catch(() => undefined);
  try {
    await removeMetadata(record);
    // Completing the persistent route may immediately stop this Worker. Remove
    // package-owned metadata first so successful completion cannot leave a
    // live-looking session row behind.
    await record.completePersistent();
  } catch (error) {
    record.terminationFailure = errorMessage(error);
    try {
      await writeMetadata(record);
    } catch {
      // The bounded Worker log is the final fallback when package state is lost.
    }
    console.error(
      "UUI persistent execution completion failed",
      errorMessage(error),
    );
  }
  record.socket?.close(1000, reason.slice(0, 120));
  record.socket = undefined;
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
    runtime_group_id: record.placement.runtimeGroupId,
    sandbox_id: record.placement.sandboxId,
    worker_id: record.placement.workerId,
    state: record.socket === undefined ? "DISCONNECTED" : "CONNECTED",
    current_screen_id: currentScreenID(record),
    server_sequence: record.serverSequence,
    last_client_sequence: record.lastClientSequence,
    created_at: new Date(record.createdAt).toISOString(),
    last_connection_at: new Date(record.lastConnectionAt).toISOString(),
  };
}

function currentScreenID(record: SessionRecord): string | undefined {
  const presentation = record.currentPresentation?.presentation;
  if (presentation?.activeSurfaceId === null || presentation === undefined) {
    return undefined;
  }
  return presentation.surfaces.find((surface) =>
    surface.surfaceId === presentation.activeSurfaceId
  )?.screen.id;
}

function updateMetadata(record: SessionRecord): void {
  if (record.ended) return;
  record.metadataWrites = record.metadataWrites.then(() =>
    writeMetadata(record)
  ).catch((error) => {
    console.error("UUI session metadata update failed", error);
  });
}

async function writeMetadata(record: SessionRecord): Promise<void> {
  const metadata: SessionMetadata = {
    sessionId: record.sessionId,
    serviceId: record.serviceId,
    persistentExecutionId: record.executionId,
    nodeId: record.placement.nodeId,
    runtimeGroupId: record.placement.runtimeGroupId,
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
    currentScreenId: currentScreenID(record) ?? null,
    terminationFailure: record.terminationFailure ?? null,
  };
  await record.metadataStore.put(metadata);
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
  "uui.session.inspect": (input: unknown): Record<string, unknown> =>
    sessionRecordStatus(sessionByInput(input)),
  "uui.session.message-log": (input: unknown): Record<string, unknown> => ({
    messages: structuredClone(sessionByInput(input).messageLog),
  }),
  "uui.session.terminate": async (
    input: unknown,
  ): Promise<Record<string, unknown>> => {
    await end(sessionByInput(input), "terminated through session management");
    return { terminated: true };
  },
});

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

function randomSessionID(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let suffix = "";
  const bytes = new Uint8Array(32);
  while (suffix.length < 8) {
    crypto.getRandomValues(bytes);
    for (const value of bytes) {
      if (value >= 252) continue;
      suffix += alphabet[value % alphabet.length];
      if (suffix.length === 8) break;
    }
  }
  return `uis-${suffix}`;
}

async function runConfiguredSession(context: UUISessionContext): Promise<void> {
  const programs = {
    home: uiConfig.homeProgram,
    terminated: uiConfig.terminatedProgram,
  };
  while (!context.signal.aborted) {
    try {
      await invokeProgram(programs.home);
      return;
    } catch (error) {
      if (context.signal.aborted) return;
      const failure = terminationInput(error, programs.home, programs);
      const action = await invokeProgram(programs.terminated, failure);
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
