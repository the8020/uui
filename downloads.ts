import {
  DOWNLOAD_CHUNK_BYTES,
  DOWNLOAD_MAX_TRANSFERS,
  DOWNLOAD_START_TIMEOUT,
  DOWNLOAD_TRANSFER_FRAMES,
  DOWNLOAD_WINDOW_FRAMES,
  type DownloadClientCommand,
  type DownloadMetadata,
  type DownloadServerCommand,
  encodeDownloadChunk,
  validateDownloadMetadata,
} from "./download_protocol.ts";

export interface DownloadOptions {
  filename: string;
  contentType?: string;
  /** Owned by the transfer. Use a lazy generator to produce virtual files. */
  body: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>;
}

export interface DownloadHandle {
  /** Browser stream handoff completed; this does not attest to a final disk path. */
  readonly done: Promise<void>;
  cancel(): void;
}

interface Transfer extends DownloadMetadata {
  granted: number;
  sent: number;
  consumed: number;
  ended: boolean;
  settled: boolean;
  wake?: () => void;
  cancelSource?: () => Promise<unknown>;
  startupTimer?: ReturnType<typeof setTimeout>;
  resolve(): void;
  reject(error: Error): void;
}

/** Session-owned producers. Each pump keeps its caller's asynchronous context. */
export class DownloadManager {
  readonly #transfers = new Map<number, Transfer>();
  #sequence = 0;
  #outstanding = 0;

  constructor(
    readonly send: (message: DownloadServerCommand | Uint8Array) => void,
    readonly reportError: (message: string) => void,
  ) {}

  start(options: DownloadOptions): DownloadHandle {
    if (this.#transfers.size >= DOWNLOAD_MAX_TRANSFERS) {
      throw new Error("Too many active downloads");
    }
    const metadata = {
      downloadId: ++this.#sequence,
      filename: options.filename,
      contentType: options.contentType ?? "application/octet-stream",
    };
    validateDownloadMetadata(metadata);
    if (
      options.body === null || typeof options.body !== "object" ||
      !(options.body instanceof ReadableStream) &&
        typeof options.body[Symbol.asyncIterator] !== "function"
    ) {
      throw new TypeError(
        "Download body must be a readable stream or async iterable",
      );
    }
    const completion = Promise.withResolvers<void>();
    const transfer: Transfer = {
      ...metadata,
      granted: 0,
      sent: 0,
      consumed: 0,
      ended: false,
      settled: false,
      resolve: () => completion.resolve(),
      reject: completion.reject,
    };
    this.#transfers.set(transfer.downloadId, transfer);
    // Ignoring a handle is supported: the session owns failure reporting.
    void completion.promise.catch((error: unknown) => {
      if (error instanceof Error && error.name === "AbortError") return;
      try {
        this.reportError(
          `Could not download ${transfer.filename}: ${errorText(error)}`,
        );
      } catch {
        // A terminated session no longer has a message destination.
      }
    });
    transfer.startupTimer = setTimeout(
      () =>
        this.#fail(
          transfer,
          new Error("The browser did not start the download"),
        ),
      DOWNLOAD_START_TIMEOUT,
    );
    // Start in the program's context, never from a credit-message callback.
    void this.#pump(transfer, options.body).catch((error: unknown) =>
      this.#fail(
        transfer,
        error instanceof Error ? error : new Error(String(error)),
      )
    );
    return {
      done: completion.promise,
      cancel: () => this.#fail(transfer, cancelled()),
    };
  }

  receive(command: DownloadClientCommand): void {
    const transfer = this.#transfers.get(command.downloadId);
    // Late acknowledgements for cancelled transfers are harmless.
    if (transfer === undefined) return;
    if (command.type === "download.cancel") {
      this.#fail(
        transfer,
        command.error === undefined ? cancelled() : new Error(command.error),
      );
      return;
    }
    if (command.type === "download.done") {
      if (!transfer.ended || transfer.consumed !== transfer.sent) {
        throw new TypeError(
          "Download completed before its bytes were consumed",
        );
      }
      this.#remove(transfer);
      transfer.resolve();
      return;
    }
    const acknowledged = command.consumed - transfer.consumed;
    const frames = transfer.ended ? 0 : command.frames;
    if (
      !Number.isSafeInteger(command.consumed) || acknowledged < 0 ||
      command.consumed > transfer.sent || !Number.isInteger(command.frames) ||
      command.frames < 0 || command.frames > DOWNLOAD_TRANSFER_FRAMES ||
      transfer.granted - command.consumed + frames > DOWNLOAD_TRANSFER_FRAMES ||
      this.#outstanding - acknowledged + frames > DOWNLOAD_WINDOW_FRAMES
    ) throw new TypeError("Invalid download credit");
    transfer.consumed = command.consumed;
    transfer.granted += frames;
    this.#outstanding += frames - acknowledged;
    clearTimeout(transfer.startupTimer);
    transfer.startupTimer = undefined;
    transfer.wake?.();
  }

  abortAll(reason = "UUI connection closed"): void {
    for (const transfer of [...this.#transfers.values()]) {
      this.#fail(transfer, cancelled(reason));
    }
  }

  async #pump(
    transfer: Transfer,
    body: DownloadOptions["body"],
  ): Promise<void> {
    const reader = body instanceof ReadableStream
      ? body.getReader()
      : undefined;
    const iterator = reader === undefined
      ? (body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]()
      : undefined;
    let cleanup: Promise<unknown> | undefined;
    transfer.cancelSource = () =>
      cleanup ??= Promise.resolve().then(async () => {
        if (reader !== undefined) await reader.cancel();
        else await iterator?.return?.();
      });
    let exhausted = false;
    try {
      this.send({
        type: "download.begin",
        downloadId: transfer.downloadId,
        filename: transfer.filename,
        contentType: transfer.contentType,
      });
      let chunk: Uint8Array | undefined;
      let offset = 0;
      while (!transfer.settled) {
        while (transfer.granted === transfer.sent && !transfer.settled) {
          await new Promise<void>((resolve) => transfer.wake = resolve);
          transfer.wake = undefined;
        }
        if (transfer.settled) break;
        if (chunk === undefined || offset === chunk.byteLength) {
          chunk = undefined;
          const next = reader !== undefined
            ? await reader.read()
            : await iterator!.next();
          if (transfer.settled) break;
          if (next.done) {
            exhausted = true;
            transfer.ended = true;
            this.#outstanding -= transfer.granted - transfer.sent;
            transfer.granted = transfer.sent;
            this.send({
              type: "download.end",
              downloadId: transfer.downloadId,
            });
            return;
          }
          if (!(next.value instanceof Uint8Array)) {
            throw new TypeError(
              "Download producers must yield Uint8Array chunks",
            );
          }
          chunk = next.value;
          offset = 0;
          if (chunk.byteLength === 0) continue;
        }
        const end = Math.min(offset + DOWNLOAD_CHUNK_BYTES, chunk.byteLength);
        transfer.sent++;
        this.send(
          encodeDownloadChunk(transfer.downloadId, chunk.subarray(offset, end)),
        );
        offset = end;
      }
    } finally {
      try {
        if (!exhausted) await transfer.cancelSource();
      } finally {
        reader?.releaseLock();
        transfer.cancelSource = undefined;
      }
    }
  }

  #remove(transfer: Transfer): void {
    transfer.settled = true;
    clearTimeout(transfer.startupTimer);
    this.#outstanding -= transfer.granted - transfer.consumed;
    this.#transfers.delete(transfer.downloadId);
    transfer.wake?.();
  }

  #fail(transfer: Transfer, error: Error): void {
    if (transfer.settled) return;
    this.#remove(transfer);
    // Cancelling a stream can unblock an outstanding read. Async generators
    // execute their finally once any current await has settled.
    void transfer.cancelSource?.().catch(() => {});
    transfer.reject(error);
    try {
      this.send({
        type: "download.error",
        downloadId: transfer.downloadId,
        message: errorText(error),
        cancelled: error.name === "AbortError",
      });
    } catch {
      // The connection may already be gone.
    }
  }
}

function cancelled(message = "Download cancelled"): DOMException {
  return new DOMException(message, "AbortError");
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(
    0,
    1000,
  );
}
