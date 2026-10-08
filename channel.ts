import {
  type ByteSource,
  ChannelStreams,
  decodeStreamChunk,
  type StreamHandle,
  type StreamOwner,
  type StreamPolicy,
} from "./channel_streams.ts";
export type {
  ByteSource,
  StreamHandle,
  StreamPolicy,
} from "./channel_streams.ts";

/** The application interface, shared by programs and browser components. */
export interface ChannelConnection {
  send(
    id: string,
    data: ByteSource,
    options?: { signal?: AbortSignal; policy?: StreamPolicy },
  ): StreamHandle;
  send(id: string, data: unknown): void;
  subscribe(id: string, handler: ChannelSubscriber): ChannelSubscription;
}
export interface ChannelContext {
  readonly signal: AbortSignal;
  readonly clientSequence?: number;
}
export type ChannelSubscriber = (
  id: string,
  data: unknown,
  context: ChannelContext,
) => void | Promise<void>;
/** Internal attachment identity; never an application catalog or permission. */
export interface ChannelIdentity {
  namespace: string;
  generation: string;
}
export interface AttachedChannel extends ChannelConnection {
  readonly reference: ChannelIdentity;
  readonly signal: AbortSignal;
  capture(connected?: boolean): AttachedChannel;
  /** Internal: register the owner's canonical subscription without copying its handler. */
  bind(subscription: ChannelSubscription): () => void;
  dispose(): void;
}
export interface ChannelFrame extends ChannelIdentity {
  type: "channel.frame";
  connection: string;
  kind:
    | "message"
    | "stream.open"
    | "stream.credit"
    | "stream.bytes"
    | "stream.end"
    | "stream.done"
    | "stream.cancel";
  id: string;
  requestId: string;
  value?: unknown;
  error?: string;
  frames?: number;
  consumed?: number;
  ordinal?: number;
  chunkBytes?: number;
  clientSequence?: number;
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function validName(value: unknown): value is string {
  return typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
}
function validNamespace(value: unknown): value is string {
  // Match the existing explicit element-ID contract; a namespace is not a URL.
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}
export function validChannelFrame(value: unknown): value is ChannelFrame {
  return record(value) && value.type === "channel.frame" &&
    validName(value.connection) && validNamespace(value.namespace) &&
    validName(value.generation) &&
    [
      "message",
      "stream.open",
      "stream.credit",
      "stream.bytes",
      "stream.end",
      "stream.done",
      "stream.cancel",
    ].includes(String(value.kind)) &&
    typeof value.requestId === "string" &&
    /^(client|server)-[1-9][0-9]{0,15}$/.test(value.requestId) &&
    validNamespace(value.id) &&
    [value.frames, value.consumed, value.ordinal, value.chunkBytes].every((n) =>
      n === undefined || Number.isSafeInteger(n) && Number(n) >= 0
    ) &&
    (value.kind !== "stream.open" ||
      Number(value.chunkBytes) > 0 && Number(value.frames) > 0) &&
    (value.kind !== "stream.bytes" || Number(value.ordinal) > 0) &&
    (value.kind !== "stream.credit" ||
      Number(value.ordinal) > 0 && value.frames !== undefined &&
        value.consumed !== undefined) &&
    (value.kind !== "stream.end" || value.consumed !== undefined) &&
    (value.error === undefined ||
      typeof value.error === "string" && value.error.length <= 1000) &&
    !(value.error !== undefined && value.value !== undefined) &&
    Object.keys(value).every((key) =>
      [
        "type",
        "connection",
        "namespace",
        "generation",
        "kind",
        "requestId",
        "id",
        "value",
        "error",
        "protocol",
        "clientSequence",
        "sessionId",
        "serverSequence",
        "frames",
        "consumed",
        "ordinal",
        "chunkBytes",
      ].includes(key)
    );
}

/** JSON validation belongs to transport; application validation belongs to subscribers. */
function json(value: unknown): unknown {
  const encoded = JSON.stringify(value, (_key, item) => {
    if (
      typeof item === "number" && !Number.isFinite(item) ||
      typeof item === "function" || typeof item === "symbol" ||
      item === undefined
    ) throw new TypeError("Channel data must be JSON");
    return item;
  });
  return JSON.parse(encoded);
}
// Only the per-stream transport window is shared. Application quotas remain owner-selected.
export function transportStreamPolicy(): StreamPolicy {
  return {
    chunkBytes: 65536,
    sourceChunkBytes: 67108864,
    streamFrames: 4,
    activeStreams: Number.MAX_SAFE_INTEGER,
    directionFrames: Number.MAX_SAFE_INTEGER,
    aggregateFrames: Number.MAX_SAFE_INTEGER,
  };
}
/** One inspectable subscription, retained across bindings only by its logical owner. */
export class ChannelSubscription {
  readonly #id: string;
  readonly #handler: ChannelSubscriber;
  readonly #running = new Set<AbortController>();
  #active = true;
  #release?: () => void;
  #remove?: () => void;
  constructor(id: string, handler: ChannelSubscriber, remove?: () => void) {
    if (!validNamespace(id)) throw new TypeError("Invalid subscription ID");
    if (typeof handler !== "function") {
      throw new TypeError("Subscriber must be a function");
    }
    this.#id = id;
    this.#handler = handler;
    this.#remove = remove;
  }
  get id(): string {
    return this.#id;
  }
  get handler(): ChannelSubscriber {
    return this.#handler;
  }
  readonly unsubscribe = (): void => {
    if (!this.#active) return;
    this.#active = false;
    this.detach();
    this.#remove?.();
    this.#remove = undefined;
  };
  /** Internal attachment lifecycle, shared by reusable backend and browser owners. */
  attach(endpoint?: AttachedChannel): void {
    this.detach();
    if (this.#active) this.#release = endpoint?.bind(this);
  }
  detach(): void {
    const release = this.#release;
    this.#release = undefined;
    release?.();
    this.abort();
  }
  abort(): void {
    for (const controller of this.#running) controller.abort();
    this.#running.clear();
  }
  matches(id: string): boolean {
    if (!this.#active) return false;
    // Full-ID glob: only '*' is special, including across dots.
    let pattern = 0, offset = 0, star = -1, retry = 0;
    while (offset < id.length) {
      if (this.id[pattern] === "*") {
        star = pattern++;
        retry = offset;
      } else if (this.id[pattern] === id[offset]) {
        pattern++;
        offset++;
      } else if (star >= 0) {
        pattern = star + 1;
        offset = ++retry;
      } else return false;
    }
    while (this.id[pattern] === "*") pattern++;
    return pattern === this.id.length;
  }
  async deliver(
    id: string,
    data: unknown,
    context: ChannelContext,
    invoke: (
      handler: ChannelSubscriber,
      id: string,
      data: unknown,
      context: ChannelContext,
    ) => void | Promise<void>,
    cancel?: () => void,
  ): Promise<void> {
    if (!this.matches(id)) return;
    const controller = new AbortController();
    this.#running.add(controller);
    if (cancel) {
      controller.signal.addEventListener("abort", cancel, { once: true });
    }
    try {
      await invoke(this.handler, id, data, {
        ...context,
        signal: AbortSignal.any([controller.signal, context.signal]),
      });
    } finally {
      if (cancel) controller.signal.removeEventListener("abort", cancel);
      this.#running.delete(controller);
    }
  }
}

/** Logical subscriptions survive reattachment; obsolete physical bindings never do. */
export class ChannelBindings {
  #endpoint?: AttachedChannel;
  readonly #subscribers = new Set<ChannelSubscription>();
  subscribe(id: string, handler: ChannelSubscriber): ChannelSubscription {
    const subscription = new ChannelSubscription(id, handler, () => {
      this.#subscribers.delete(subscription);
    });
    this.#subscribers.add(subscription);
    try {
      subscription.attach(this.#endpoint);
    } catch (error) {
      subscription.unsubscribe();
      throw error;
    }
    return subscription;
  }
  attach(endpoint?: AttachedChannel): void {
    if (this.#endpoint === endpoint) return;
    this.#endpoint = endpoint;
    for (const subscription of this.#subscribers) subscription.attach(endpoint);
  }
  dispose(): void {
    this.attach();
    for (const subscription of this.#subscribers) subscription.unsubscribe();
  }
}
interface Entry {
  identity: ChannelIdentity;
  streams: StreamOwner;
  subscribers: Set<ChannelSubscription>;
  lastInbound: number;
  invoke(
    handler: ChannelSubscriber,
    id: string,
    data: unknown,
    context: ChannelContext,
  ): void | Promise<void>;
  guard(): void;
  dispose(): void;
}
/** One component-neutral router on the existing authenticated UUI socket. */
export class ChannelRouter {
  #connection = "";
  #connectionVersion = 0;
  #connectionLifetime = new AbortController();
  #sequence = 0;
  readonly #entries = new Map<string, Entry>();
  readonly #streams: ChannelStreams;
  constructor(
    readonly side: "client" | "server",
    readonly transmit: (frame: ChannelFrame | Uint8Array) => void,
  ) {
    this.#streams = new ChannelStreams(
      transmit,
      (frame) => !!this.#connection && frame.connection === this.#connection,
    );
  }
  get connectionSignal(): AbortSignal {
    return this.#connectionLifetime.signal;
  }
  get connected(): boolean {
    return !!this.#connection;
  }
  streamUsage(policy: StreamPolicy) {
    return this.#streams.usage(policy);
  }
  connect(connection: string): void {
    if (!validName(connection)) {
      throw new TypeError("Invalid channel connection");
    }
    this.disconnect();
    this.#connection = connection;
    for (const entry of this.#entries.values()) entry.lastInbound = 0;
  }
  disconnect(reason = "UUI connection closed"): void {
    this.#connectionVersion++;
    this.#connectionLifetime.abort();
    this.#connectionLifetime = new AbortController();
    this.#streams.dispose(undefined, reason);
    this.#connection = "";
    for (const entry of this.#entries.values()) this.#abort(entry);
  }
  #abort(entry: Entry): void {
    for (const subscription of entry.subscribers) subscription.abort();
  }
  invalidate(): void {
    this.#streams.invalidate();
    for (const entry of this.#entries.values()) {
      try {
        this.#live(entry);
      } catch {
        this.#abort(entry);
      }
    }
  }
  register(
    namespace: string,
    generation: string,
    guard: () => void,
    signal: AbortSignal,
    policy = transportStreamPolicy(),
    invoke = (
      handler: ChannelSubscriber,
      id: string,
      data: unknown,
      context: ChannelContext,
    ) => handler(id, data, context),
  ): AttachedChannel {
    signal.throwIfAborted();
    const key = `${generation}:${namespace}`;
    if (
      !validNamespace(namespace) || !validName(generation) ||
      this.#entries.has(key)
    ) throw new TypeError("Invalid or duplicate channel attachment");
    const entry: Entry = {
      identity: { namespace, generation },
      lastInbound: 0,
      subscribers: new Set(),
      guard,
      invoke,
      streams: {
        live: () => this.#live(entry),
        policy,
        receive: async (id, stream, context) => {
          const subscriptions = [...entry.subscribers].filter((subscription) =>
            subscription.matches(id)
          );
          // A byte stream has one consumer: never tee or silently duplicate it.
          if (subscriptions.length !== 1) {
            throw new TypeError(
              "Stream delivery requires exactly one matching subscriber",
            );
          }
          await subscriptions[0]!.deliver(
            id,
            stream,
            context,
            invoke,
            context.cancel,
          );
        },
      },
      dispose: () => {
        if (this.#entries.get(key) !== entry) return;
        this.#streams.dispose(entry.streams);
        for (const subscription of entry.subscribers) subscription.detach();
        entry.subscribers.clear();
        this.#entries.delete(key);
        signal.removeEventListener("abort", entry.dispose);
      },
    };
    this.#entries.set(key, entry);
    signal.addEventListener("abort", entry.dispose, { once: true });
    const send = (
      id: string,
      data: unknown,
      options?: { signal?: AbortSignal; policy?: StreamPolicy },
    ): StreamHandle | void => {
      this.#live(entry);
      if (!validNamespace(id)) {
        throw new TypeError("Invalid channel message ID");
      }
      const frame: ChannelFrame = {
        type: "channel.frame",
        ...entry.identity,
        connection: this.#connection,
        kind: "message",
        id,
        requestId: `${this.side}-${++this.#sequence}`,
      };
      if (
        data instanceof ReadableStream ||
        data !== null && typeof data === "object" &&
          Symbol.asyncIterator in data
      ) {
        const streamPolicy = options?.policy ?? policy;
        frame.kind = "stream.open";
        frame.chunkBytes = streamPolicy.chunkBytes;
        frame.frames = streamPolicy.streamFrames;
        return this.#streams.start(
          entry.streams,
          frame,
          data as ByteSource,
          streamPolicy,
          options?.signal,
        );
      }
      frame.value = json(data);
      this.transmit(frame);
    };
    const endpoint: AttachedChannel = {
      reference: entry.identity,
      signal,
      send: send as AttachedChannel["send"],
      subscribe: (id, handler) => {
        const subscription = new ChannelSubscription(id, handler);
        subscription.attach(endpoint);
        return subscription;
      },
      bind: (subscription) => {
        if (this.#entries.get(key) !== entry) {
          throw new DOMException("Channel detached", "AbortError");
        }
        entry.subscribers.add(subscription);
        return () => {
          if (!entry.subscribers.delete(subscription)) return;
          subscription.abort();
        };
      },
      capture: (connected = true) => {
        const connection = this.#connectionVersion;
        const check = () => {
          this.#live(entry, connected);
          if (connection !== this.#connectionVersion) {
            throw new DOMException("Channel connection changed", "AbortError");
          }
        };
        return {
          ...endpoint,
          send: ((...args: Parameters<typeof send>) => {
            check();
            return send(...args);
          }) as AttachedChannel["send"],
          subscribe: (id, handler) => {
            check();
            return endpoint.subscribe(id, handler);
          },
          bind: (subscription) => {
            check();
            return endpoint.bind(subscription);
          },
          capture: () => {
            check();
            return endpoint.capture(connected);
          },
          dispose: () => {
            try {
              check();
              endpoint.dispose();
            } catch { /* stale view */ }
          },
        };
      },
      dispose: entry.dispose,
    };
    return endpoint;
  }
  #live(entry: Entry, connected = true): void {
    if (
      connected && !this.#connection ||
      this.#entries.get(
          `${entry.identity.generation}:${entry.identity.namespace}`,
        ) !== entry
    ) throw new DOMException("Channel unavailable", "AbortError");
    entry.guard();
  }
  receive(frame: ChannelFrame): void {
    if (frame.kind === "stream.bytes") {
      throw new TypeError("Stream bytes require binary framing");
    }
    this.#receive(frame);
  }
  bytes(bytes: Uint8Array): void {
    const decoded = decodeStreamChunk(bytes);
    if (
      !validChannelFrame(decoded.frame) || decoded.frame.kind !== "stream.bytes"
    ) throw new TypeError("Invalid binary channel identity");
    this.#receive(decoded.frame, decoded.bytes);
  }
  #receive(frame: ChannelFrame, bytes?: Uint8Array): void {
    if (
      !validChannelFrame(frame) || frame.connection !== this.#connection ||
      !this.#connection
    ) return;
    const entry = this.#entries.get(`${frame.generation}:${frame.namespace}`);
    if (frame.kind === "message" || frame.kind === "stream.open") {
      const remote = this.side === "server" ? "client" : "server";
      const sequence = Number(frame.requestId.slice(remote.length + 1));
      if (
        !frame.requestId.startsWith(`${remote}-`) ||
        !Number.isSafeInteger(sequence) ||
        entry && sequence <= entry.lastInbound
      ) {
        if (frame.kind === "stream.open") {
          const error = "Duplicate or invalid stream identity";
          this.#streams.receive(entry?.streams, {
            ...frame,
            kind: "stream.cancel",
            value: undefined,
            error,
          });
          this.transmit({
            ...frame,
            kind: "stream.cancel",
            value: undefined,
            error,
          });
        }
        return;
      }
      if (entry) entry.lastInbound = sequence;
    }
    if (frame.kind.startsWith("stream.")) {
      this.#streams.receive(entry?.streams, frame, bytes);
      return;
    }
    if (!entry) return;
    try {
      this.#live(entry);
    } catch {
      return;
    }
    for (const subscription of [...entry.subscribers]) {
      if (
        !entry.subscribers.has(subscription) || !subscription.matches(frame.id)
      ) continue;
      try {
        this.#live(entry);
        void subscription.deliver(frame.id, json(frame.value), {
          signal: this.connectionSignal,
          clientSequence: frame.clientSequence,
        }, entry.invoke).catch(() => {});
      } catch { /* Invalid data or a stale owner cannot reach a subscriber. */ }
    }
  }
}
