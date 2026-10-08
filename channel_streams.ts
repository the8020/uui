import type { ChannelFrame } from "./channel.ts";

export type ByteSource = AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>;
/** Shared policy object groups an owner's streams; bounds are in frames of chunkBytes. */
export interface StreamPolicy {
  chunkBytes: number;
  sourceChunkBytes: number;
  activeStreams: number;
  streamFrames: number;
  directionFrames: number;
  aggregateFrames: number;
  startupTimeout?: number;
}
export interface StreamHandle {
  readonly done: Promise<void>;
  cancel(): void;
}
export interface StreamOwner {
  live(): void;
  policy: StreamPolicy;
  receive(
    id: string,
    stream: ReadableStream<Uint8Array>,
    context: { signal: AbortSignal; clientSequence?: number; cancel(): void },
  ): Promise<void>;
}
interface Transfer {
  owner: StreamOwner;
  frame: ChannelFrame;
  policy: StreamPolicy;
  direction: "send" | "receive";
  abort: AbortController;
  completion: ReturnType<typeof Promise.withResolvers<void>>;
  window: number;
  granted: number;
  sent: number;
  consumed: number;
  ordinal: number;
  peerOrdinal: number;
  ended: boolean;
  settled: boolean;
  ready: boolean;
  queue: Uint8Array[];
  controller?: ReadableStreamDefaultController<Uint8Array>;
  pull?: () => void;
  wake?: () => void;
  cleanup?: () => Promise<unknown>;
  timer?: ReturnType<typeof setTimeout>;
}
const text = new TextEncoder();
const decode = new TextDecoder("utf-8", { fatal: true });
/** Binary identities retain namespace, direction and both live generations. */
export function encodeStreamChunk(
  frame: ChannelFrame,
  bytes: Uint8Array,
): Uint8Array<ArrayBuffer> {
  const header = text.encode(JSON.stringify(frame));
  if (!bytes.byteLength || header.byteLength > 4096) {
    throw new TypeError("Invalid stream frame");
  }
  const result = new Uint8Array(4 + header.byteLength + bytes.byteLength);
  new DataView(result.buffer).setUint32(0, header.byteLength);
  result.set(header, 4);
  result.set(bytes, 4 + header.byteLength);
  return result;
}
export function decodeStreamChunk(
  bytes: Uint8Array,
): { frame: ChannelFrame; bytes: Uint8Array } {
  if (bytes.byteLength < 5) throw new TypeError("Invalid stream framing");
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    .getUint32(0);
  if (!length || length > 4096 || length + 4 >= bytes.byteLength) {
    throw new TypeError("Invalid stream framing");
  }
  return {
    frame: JSON.parse(decode.decode(bytes.subarray(4, 4 + length))),
    bytes: bytes.subarray(4 + length),
  };
}
export function validateStreamPolicy(policy: StreamPolicy): void {
  if (
    [
      policy.chunkBytes,
      policy.sourceChunkBytes,
      policy.activeStreams,
      policy.streamFrames,
      policy.directionFrames,
      policy.aggregateFrames,
      ...(policy.startupTimeout === undefined ? [] : [policy.startupTimeout]),
    ].some((n) => !Number.isSafeInteger(n) || n <= 0) ||
    policy.sourceChunkBytes < policy.chunkBytes ||
    policy.streamFrames > policy.directionFrames ||
    policy.directionFrames > policy.aggregateFrames
  ) throw new TypeError("Invalid owner stream policy");
}
function key(frame: ChannelFrame): string {
  return JSON.stringify([
    frame.connection,
    frame.generation,
    frame.namespace,
    frame.requestId,
    frame.id,
  ]);
}
function cancelled(reason = "Channel stream cancelled"): DOMException {
  return new DOMException(reason, "AbortError");
}
/** The sole sender, receiver and consumption-credit implementation for both peers. */
export class ChannelStreams {
  readonly #transfers = new Map<string, Transfer>();
  #next = 0;
  constructor(
    readonly transmit: (frame: ChannelFrame | Uint8Array) => void,
    readonly connected: (frame: ChannelFrame) => boolean,
  ) {}
  #usage(policy: StreamPolicy, direction?: Transfer["direction"]): number {
    let count = 0;
    for (const t of this.#transfers.values()) {
      if (t.policy === policy && (!direction || t.direction === direction)) {
        count += t.granted - t.consumed;
      }
    }
    return count;
  }
  /** Owner-visible reservations, including queued and in-flight frames in both directions. */
  usage(
    policy: StreamPolicy,
  ): { send: number; receive: number; active: number } {
    return {
      send: this.#usage(policy, "send"),
      receive: this.#usage(policy, "receive"),
      active:
        [...this.#transfers.values()].filter((t) => t.policy === policy).length,
    };
  }
  #create(
    owner: StreamOwner,
    frame: ChannelFrame,
    policy: StreamPolicy,
    direction: Transfer["direction"],
  ): Transfer {
    owner.live();
    validateStreamPolicy(policy);
    if (this.usage(policy).active >= policy.activeStreams) {
      throw new Error("Too many active streams");
    }
    const t: Transfer = {
      owner,
      frame,
      policy,
      direction,
      abort: new AbortController(),
      completion: Promise.withResolvers<void>(),
      window: direction === "receive"
        ? Math.min(policy.streamFrames, frame.frames!)
        : policy.streamFrames,
      granted: 0,
      sent: 0,
      consumed: 0,
      ordinal: 0,
      peerOrdinal: 0,
      ended: false,
      settled: false,
      ready: false,
      queue: [],
    };
    void t.completion.promise.catch(() => {});
    this.#transfers.set(key(frame), t);
    return t;
  }
  start(
    owner: StreamOwner,
    frame: ChannelFrame,
    body: ByteSource,
    policy: StreamPolicy,
    signal?: AbortSignal,
  ): StreamHandle {
    signal?.throwIfAborted();
    if (
      !body ||
      !(body instanceof ReadableStream) &&
        typeof body[Symbol.asyncIterator] !== "function"
    ) {
      throw new TypeError(
        "Stream body must be a readable stream or async iterable",
      );
    }
    const t = this.#create(owner, frame, policy, "send");
    const abort = () => this.#fail(t, cancelled());
    signal?.addEventListener("abort", abort, { once: true });
    void t.completion.promise.finally(() =>
      signal?.removeEventListener("abort", abort)
    ).catch(() => {});
    if (policy.startupTimeout) {
      t.timer = setTimeout(
        () => this.#fail(t, new Error("Stream startup timed out")),
        policy.startupTimeout,
      );
    }
    // Initiate the pump here to preserve the producer's trusted async context across credit callbacks.
    void this.#pump(t, body).catch((error) => this.#fail(t, error));
    return { done: t.completion.promise, cancel: abort };
  }
  dispose(owner?: StreamOwner, reason = "Channel detached"): void {
    for (const t of [...this.#transfers.values()]) {
      if (!owner || t.owner === owner) this.#fail(t, cancelled(reason));
    }
  }
  invalidate(): void {
    for (const t of [...this.#transfers.values()]) {
      try {
        t.owner.live();
      } catch {
        this.#fail(t, cancelled("Channel owner unavailable"));
      }
    }
  }
  #send(
    t: Transfer,
    kind: ChannelFrame["kind"],
    extra: Partial<ChannelFrame> = {},
  ): void {
    t.owner.live();
    this.transmit({ ...t.frame, kind, value: undefined, ...extra });
  }
  receive(
    owner: StreamOwner | undefined,
    frame: ChannelFrame,
    bytes?: Uint8Array,
  ): void {
    if (frame.kind === "stream.open") {
      try {
        if (!owner) throw new TypeError("Unknown stream namespace");
        owner.live();
        if (!frame.chunkBytes || frame.chunkBytes > owner.policy.chunkBytes) {
          throw new TypeError("Stream chunk policy mismatch");
        }
        if (this.#transfers.has(key(frame))) {
          throw new TypeError("Duplicate stream");
        }
        const t = this.#create(owner, frame, owner.policy, "receive");
        const stream = new ReadableStream<Uint8Array>({
          start: (controller) => t.controller = controller,
          pull: () =>
            new Promise<void>((resolve) => {
              t.pull = resolve;
              t.ready = true;
              this.#deliver(t);
              this.#refill();
            }),
          cancel: (error) =>
            this.#fail(t, error instanceof Error ? error : cancelled()),
        }, { highWaterMark: 0 });
        let result: Promise<void>;
        try {
          result = owner.receive(frame.id, stream, {
            signal: t.abort.signal,
            clientSequence: frame.clientSequence,
            cancel: () => this.#fail(t, cancelled("Subscriber removed")),
          });
        } catch (error) {
          result = Promise.reject(error);
        }
        // Operation admission and metadata validation precede any source credit.
        this.#send(t, "stream.credit", {
          frames: 0,
          consumed: 0,
          ordinal: ++t.ordinal,
        });
        this.#refill();
        void Promise.resolve(result).then(() => {
          if (t.settled) return;
          if (!t.ended || t.consumed !== t.sent || t.pull !== undefined) {
            throw new Error("Sink completed before consuming EOF");
          }
          this.#send(t, "stream.done");
          this.#remove(t);
          t.completion.resolve();
        }).catch((error) => this.#fail(t, error));
      } catch (error) {
        this.transmit({
          ...frame,
          kind: "stream.cancel",
          value: undefined,
          error: error instanceof Error
            ? error.message.slice(0, 1000)
            : "Stream rejected",
        });
      }
      return;
    }
    const t = this.#transfers.get(key(frame));
    if (!t || t.owner !== owner) return; // Cancelled/stale in-flight frames never acquire a new owner.
    try {
      t.owner.live();
      if (frame.kind === "stream.cancel") {
        this.#fail(
          t,
          frame.error ? new Error(frame.error) : cancelled(),
          false,
        );
      } else if (t.direction === "send") {
        if (frame.kind === "stream.done") {
          if (!t.ended || t.consumed !== t.sent) {
            throw new TypeError("Stream completed before consumption");
          }
          this.#remove(t);
          t.completion.resolve();
        } else if (frame.kind === "stream.credit") {
          const consumed = frame.consumed!;
          const frames = t.ended ? 0 : frame.frames!;
          const delta = consumed - t.consumed;
          if (
            frame.ordinal !== t.peerOrdinal + 1 || delta < 0 ||
            consumed > t.sent ||
            t.granted - consumed + frames > t.window ||
            this.#usage(t.policy, "send") - delta + frames >
              t.policy.directionFrames ||
            this.#usage(t.policy) - delta + frames > t.policy.aggregateFrames
          ) throw new TypeError("Invalid stream credit");
          t.peerOrdinal = frame.ordinal!;
          t.consumed = consumed;
          // After EOF, crossed credit only acknowledges consumption; unused grants were released.
          if (!t.ended) t.granted += frames;
          clearTimeout(t.timer);
          t.wake?.();
          this.#refill();
        } else throw new TypeError("Invalid sender control");
      } else if (frame.kind === "stream.bytes") {
        if (
          !bytes || t.ended || t.sent === t.granted ||
          frame.ordinal !== t.sent + 1 || bytes.byteLength > t.frame.chunkBytes!
        ) throw new TypeError("Invalid or uncredited stream bytes");
        t.sent++;
        t.queue.push(bytes);
        this.#deliver(t);
      } else if (frame.kind === "stream.end") {
        if (t.ended || frame.consumed !== t.sent) {
          throw new TypeError("Invalid stream EOF");
        }
        t.ended = true;
        t.granted = t.sent;
        this.#deliver(t);
        this.#refill();
      } else throw new TypeError("Invalid receiver control");
    } catch (error) {
      this.#fail(t, error);
    }
  }
  #deliver(t: Transfer): void {
    if (t.settled || !t.pull) return;
    const bytes = t.queue.shift();
    const pull = t.pull;
    if (bytes) {
      t.pull = undefined;
      t.ready = false;
      t.consumed++;
      t.controller!.enqueue(bytes);
      this.#send(t, "stream.credit", {
        frames: 0,
        consumed: t.consumed,
        ordinal: ++t.ordinal,
      });
      pull();
      this.#refill();
    } else if (t.ended) {
      t.pull = undefined;
      t.controller!.close();
      pull();
    }
  }
  #refill(): void {
    const transfers = [...this.#transfers.values()].filter((t) =>
      t.direction === "receive" && t.ready && !t.ended
    );
    const grants = new Map<Transfer, number>();
    let skipped = 0;
    while (transfers.length && skipped < transfers.length) {
      const t = transfers[this.#next++ % transfers.length]!;
      if (
        t.granted - t.consumed >= t.window ||
        this.#usage(t.policy, "receive") >= t.policy.directionFrames ||
        this.#usage(t.policy) >= t.policy.aggregateFrames
      ) {
        skipped++;
        continue;
      }
      skipped = 0;
      t.granted++;
      grants.set(t, (grants.get(t) ?? 0) + 1);
    }
    for (const [t, frames] of grants) {
      try {
        this.#send(t, "stream.credit", {
          frames,
          consumed: t.consumed,
          ordinal: ++t.ordinal,
        });
      } catch (error) {
        this.#fail(t, error);
      }
    }
  }
  async #pump(t: Transfer, body: ByteSource): Promise<void> {
    const reader = body instanceof ReadableStream
      ? body.getReader()
      : undefined;
    const iterator = reader
      ? undefined
      : (body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]();
    let cleanup: Promise<unknown> | undefined;
    t.cleanup = () =>
      cleanup ??= Promise.resolve().then(async () => {
        if (reader) await reader.cancel();
        else await iterator?.return?.();
      });
    let exhausted = false;
    try {
      this.transmit(t.frame);
      let chunk: Uint8Array | undefined;
      let offset = 0;
      while (!t.settled) {
        while (t.granted === t.sent && !t.settled) {
          await new Promise<void>((resolve) => t.wake = resolve);
          t.wake = undefined;
        }
        if (t.settled) break;
        t.owner.live();
        if (!chunk || offset === chunk.byteLength) {
          const next = reader ? await reader.read() : await iterator!.next();
          if (t.settled) break;
          t.owner.live();
          if (next.done) {
            exhausted = true;
            t.ended = true;
            t.granted = t.sent;
            this.#send(t, "stream.end", { consumed: t.sent });
            this.#refill();
            return;
          }
          if (
            !(next.value instanceof Uint8Array) ||
            next.value.byteLength > t.policy.sourceChunkBytes
          ) {
            throw new TypeError(
              "Invalid producer chunk or source byte limit exceeded",
            );
          }
          chunk = next.value;
          offset = 0;
          if (!chunk.byteLength) continue;
        }
        const end = Math.min(offset + t.policy.chunkBytes, chunk.byteLength);
        this.transmit(
          encodeStreamChunk({
            ...t.frame,
            kind: "stream.bytes",
            value: undefined,
            ordinal: ++t.sent,
          }, chunk.subarray(offset, end)),
        );
        offset = end;
      }
    } finally {
      try {
        if (!exhausted) await t.cleanup();
      } finally {
        reader?.releaseLock();
        t.cleanup = undefined;
      }
    }
  }
  #remove(t: Transfer): void {
    t.settled = true;
    clearTimeout(t.timer);
    this.#transfers.delete(key(t.frame));
    t.queue.length = 0;
    t.wake?.();
    t.pull?.();
    t.pull = undefined;
    this.#refill();
  }
  #fail(t: Transfer, error: unknown, notify = true): void {
    if (t.settled) return;
    if (notify && this.connected(t.frame)) {
      try {
        this.transmit({
          ...t.frame,
          kind: "stream.cancel",
          value: undefined,
          ...(error instanceof Error && error.name === "AbortError" ? {} : {
            error: (error instanceof Error ? error.message : String(error))
              .slice(0, 1000),
          }),
        });
      } catch { /* disconnected owner */ }
    }
    t.abort.abort();
    t.controller?.error(error);
    void t.cleanup?.().catch(() => {});
    this.#remove(t);
    t.completion.reject(error);
  }
}
