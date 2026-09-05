import {
  decodeDownloadChunk,
  DOWNLOAD_MAX_TRANSFERS,
  DOWNLOAD_START_TIMEOUT,
  DOWNLOAD_TRANSFER_FRAMES,
  DOWNLOAD_WINDOW_FRAMES,
  type DownloadClientCommand,
  type DownloadMetadata,
  type DownloadServerCommand,
  validateDownloadMetadata,
} from "../../../download_protocol.ts";

// Attachment navigation has no DOM completion event. Even after the response
// is consumed, removing its frame can race native download registration.
// Retain a bounded tail of completed frames until connection/page cleanup.
const completedFrames: HTMLIFrameElement[] = [];

interface IncomingDownload extends DownloadMetadata {
  readonly controller: ReadableStreamDefaultController<Uint8Array>;
  readonly abort: AbortController;
  readonly queue: Uint8Array[];
  requested: number;
  consumed: number;
  ready: boolean;
  ended: boolean;
  pull?: () => void;
  cleanup?: () => void;
}

export type OpenDownload = (
  metadata: DownloadMetadata,
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal,
) => Promise<() => void>;

/** Browser-side demand accounting shared by all concurrent downloads. */
export class BrowserDownloads {
  readonly #transfers = new Map<number, IncomingDownload>();
  #outstanding = 0;
  #next = 0;

  constructor(
    readonly send: (command: DownloadClientCommand) => void,
    readonly open: OpenDownload = openBrowserDownload,
  ) {}

  receive(command: DownloadServerCommand): void {
    if (command.type === "download.begin") {
      this.#begin(command);
      return;
    }
    const transfer = this.#transfers.get(command.downloadId);
    if (transfer === undefined) return;
    if (command.type === "download.error") {
      this.#cancel(transfer, new Error(command.message), false);
      return;
    }
    transfer.ended = true;
    this.#outstanding -= transfer.requested;
    transfer.requested = 0;
    this.#deliver(transfer);
    this.#refill();
  }

  bytes(frame: Uint8Array): void {
    const { downloadId, bytes } = decodeDownloadChunk(frame);
    const transfer = this.#transfers.get(downloadId);
    if (transfer === undefined) return; // A cancelled transfer may have bytes in flight.
    if (transfer.ended || transfer.requested === 0) {
      throw new Error("Download bytes arrived without credit");
    }
    transfer.requested--;
    transfer.queue.push(bytes);
    this.#deliver(transfer);
  }

  close(): void {
    for (const transfer of this.#transfers.values()) transfer.ready = false;
    for (const transfer of [...this.#transfers.values()]) {
      this.#cancel(transfer, new Error("UUI connection closed"), false);
    }
    for (const frame of completedFrames.splice(0)) frame.remove();
  }

  #begin(metadata: DownloadMetadata): void {
    validateDownloadMetadata(metadata);
    if (this.#transfers.has(metadata.downloadId)) {
      throw new Error("Duplicate download ID");
    }
    if (this.#transfers.size >= DOWNLOAD_MAX_TRANSFERS) {
      this.send({
        type: "download.cancel",
        downloadId: metadata.downloadId,
        error: "Too many active downloads",
      });
      return;
    }
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
      pull: () => {
        const transfer = this.#transfers.get(metadata.downloadId);
        if (transfer === undefined) return;
        return new Promise<void>((resolve) => {
          transfer.pull = resolve;
          this.#deliver(transfer);
        });
      },
      cancel: () => {
        const transfer = this.#transfers.get(metadata.downloadId);
        if (transfer !== undefined) this.#cancel(transfer);
      },
    }, { highWaterMark: 0 });
    const transfer: IncomingDownload = {
      ...metadata,
      controller,
      abort: new AbortController(),
      queue: [],
      requested: 0,
      consumed: 0,
      ready: false,
      ended: false,
    };
    this.#transfers.set(metadata.downloadId, transfer);
    void this.open(metadata, stream, transfer.abort.signal).then((cleanup) => {
      if (!this.#transfers.has(metadata.downloadId)) {
        cleanup();
        return;
      }
      transfer.cleanup = cleanup;
      transfer.ready = true;
      // Confirm startup even when other transfers hold the whole credit window.
      this.send({
        type: "download.credit",
        downloadId: metadata.downloadId,
        frames: 0,
        consumed: 0,
      });
      this.#refill();
    }, (error: unknown) => {
      this.#cancel(
        transfer,
        error instanceof Error ? error : new Error(String(error)),
      );
    });
  }

  #deliver(transfer: IncomingDownload): void {
    if (transfer.pull === undefined) return;
    const bytes = transfer.queue.shift();
    if (bytes !== undefined) {
      this.#outstanding--;
      transfer.consumed++;
      const resolve = transfer.pull;
      transfer.pull = undefined;
      transfer.controller.enqueue(bytes);
      this.send({
        type: "download.credit",
        downloadId: transfer.downloadId,
        frames: 0,
        consumed: transfer.consumed,
      });
      resolve();
      this.#refill();
    } else if (transfer.ended) {
      transfer.controller.close();
      transfer.pull();
      transfer.pull = undefined;
      this.send({ type: "download.done", downloadId: transfer.downloadId });
      this.#remove(transfer);
    }
  }

  #refill(): void {
    const transfers = [...this.#transfers.values()].filter((item) =>
      item.ready && !item.ended
    );
    const grants = new Map<IncomingDownload, number>();
    let skipped = 0;
    while (
      transfers.length > 0 && skipped < transfers.length &&
      this.#outstanding < DOWNLOAD_WINDOW_FRAMES
    ) {
      const transfer = transfers[this.#next++ % transfers.length]!;
      if (
        transfer.requested + transfer.queue.length >= DOWNLOAD_TRANSFER_FRAMES
      ) {
        skipped++;
        continue;
      }
      skipped = 0;
      transfer.requested++;
      this.#outstanding++;
      grants.set(transfer, (grants.get(transfer) ?? 0) + 1);
    }
    for (const [transfer, frames] of grants) {
      this.send({
        type: "download.credit",
        downloadId: transfer.downloadId,
        frames,
        consumed: transfer.consumed,
      });
    }
  }

  #remove(transfer: IncomingDownload): void {
    this.#transfers.delete(transfer.downloadId);
    this.#outstanding -= transfer.requested + transfer.queue.length;
    transfer.queue.length = 0;
    transfer.requested = 0;
    transfer.cleanup?.();
    this.#refill();
  }

  #cancel(transfer: IncomingDownload, error?: Error, notify = true): void {
    if (!this.#transfers.has(transfer.downloadId)) return;
    transfer.controller.error(
      error ?? new DOMException("Download cancelled", "AbortError"),
    );
    transfer.abort.abort();
    transfer.pull?.();
    transfer.pull = undefined;
    // Release credits on the server before offering them to another transfer.
    if (notify) {
      this.send({
        type: "download.cancel",
        downloadId: transfer.downloadId,
        ...(error ? { error: error.message.slice(0, 1000) } : {}),
      });
    }
    this.#remove(transfer);
  }
}

async function openBrowserDownload(
  metadata: DownloadMetadata,
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): Promise<() => void> {
  if (!globalThis.isSecureContext) {
    throw new Error("Open UUI over HTTPS to download files");
  }
  if (!navigator.serviceWorker) {
    throw new Error("This browser cannot stream downloads");
  }
  const workerURL = new URL("./download-worker.js", location.href);
  const registration = await navigator.serviceWorker.register(workerURL, {
    updateViaCache: "none",
  });
  signal.throwIfAborted();
  const worker = registration.active ?? registration.installing ??
    registration.waiting;
  if (worker === null) throw new Error("Could not start the download worker");
  await new Promise<void>((resolve, reject) => {
    const changed = () => {
      if (worker.state === "activated") finish();
      else if (worker.state === "redundant") {
        finish(new Error("Download worker stopped"));
      }
    };
    const aborted = () =>
      finish(new DOMException("Download cancelled", "AbortError"));
    const finish = (error?: Error) => {
      worker.removeEventListener("statechange", changed);
      signal.removeEventListener("abort", aborted);
      clearTimeout(timer);
      error ? reject(error) : resolve();
    };
    const timer = setTimeout(
      () => finish(new Error("Download worker startup timed out")),
      DOWNLOAD_START_TIMEOUT,
    );
    worker.addEventListener("statechange", changed);
    signal.addEventListener("abort", aborted, { once: true });
    changed();
  });
  signal.throwIfAborted();
  const token = crypto.randomUUID();
  const channel = new MessageChannel();
  const frame = document.createElement("iframe");
  frame.hidden = true;
  let completed = false;
  let cleanupRequested = false;
  let cleaned = false;
  const cleanup = () => {
    cleanupRequested = true;
    if (cleaned || !completed && !signal.aborted) return;
    cleaned = true;
    signal.removeEventListener("abort", cleanup);
    channel.port1.close();
    if (!signal.aborted && frame.isConnected) {
      completedFrames.push(frame);
      if (completedFrames.length > DOWNLOAD_MAX_TRANSFERS) {
        completedFrames.shift()!.remove();
      }
    } else frame.remove();
    worker.postMessage({ type: "download.forget", token });
  };
  try {
    await new Promise<void>((resolve, reject) => {
      const abort = () =>
        finish(new DOMException("Download cancelled", "AbortError"));
      const finish = (error?: Error) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        error ? reject(error) : resolve();
      };
      const timer = setTimeout(
        () => finish(new Error("Download startup timed out")),
        DOWNLOAD_START_TIMEOUT,
      );
      signal.addEventListener("abort", abort, { once: true });
      channel.port1.onmessage = (
        event: MessageEvent<
          { url?: string; error?: string; complete?: boolean }
        >,
      ) => {
        if (event.data.complete) {
          completed = true;
          if (cleanupRequested) cleanup();
          return;
        }
        if (event.data.error !== undefined) {
          finish(new Error(event.data.error));
          return;
        }
        const expected = new URL(`./__downloads/${token}`, workerURL).href;
        if (event.data.url !== expected) {
          finish(new Error("Invalid download destination"));
          return;
        }
        // Navigation is intentional: an anchor's download attribute can bypass
        // service worker interception and issue an unwanted network request.
        frame.src = expected;
        document.body.append(frame);
        finish();
      };
      try {
        worker.postMessage({
          type: "download.register",
          token,
          stream,
          filename: metadata.filename,
          contentType: metadata.contentType,
        }, [stream, channel.port2]);
      } catch {
        finish(new Error("This browser cannot stream downloads"));
      }
    });
    signal.addEventListener("abort", cleanup, { once: true });
    return cleanup;
  } catch (error) {
    completed = true;
    frame.remove();
    cleanup();
    throw error;
  }
}
