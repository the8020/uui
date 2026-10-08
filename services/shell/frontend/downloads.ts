import {
  DOWNLOAD_MAX_TRANSFERS,
  DOWNLOAD_START_TIMEOUT,
  type DownloadMetadata,
  downloadMetadata,
} from "../../../download_metadata.ts";
import type { AttachedChannel } from "../../../channel.ts";
// Attachment navigation has no DOM completion event; keep only a bounded completed tail.
const completedFrames: HTMLIFrameElement[] = [];
export function closeNativeDownloads(): void {
  for (const frame of completedFrames.splice(0)) frame.remove();
}
export function attachNativeDownloads(endpoint: AttachedChannel): void {
  const metadata = new Map<string, DownloadMetadata>();
  endpoint.subscribe("*", async (id, data, { signal }) => {
    if (id === "forget") {
      if (typeof data === "string") metadata.delete(data);
      return;
    }
    if (id === "save") {
      if (
        !data || typeof data !== "object" || !("token" in data) ||
        typeof data.token !== "string" || data.token.length > 128 ||
        metadata.has(data.token) || metadata.size >= DOWNLOAD_MAX_TRANSFERS ||
        JSON.stringify(data).length > 2048
      ) throw new TypeError("Invalid download metadata");
      metadata.set(data.token, downloadMetadata.parse(data));
      return;
    }
    if (!(data instanceof ReadableStream)) return;
    const description = metadata.get(id);
    metadata.delete(id);
    if (!description) throw new TypeError("Unknown download transfer");
    const handoff = await openBrowserDownload(description, data, signal);
    try {
      await handoff.done;
    } finally {
      handoff.cleanup();
    }
  });
}

export async function openBrowserDownload(
  metadata: DownloadMetadata,
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): Promise<{ cleanup(): void; done: Promise<void> }> {
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
  const handoff = Promise.withResolvers<void>();
  void handoff.promise.catch(() => {});
  let completed = false;
  let cleanupRequested = false;
  let cleaned = false;
  const cleanup = () => {
    if (signal.aborted && !completed) {
      handoff.reject(new DOMException("Download cancelled", "AbortError"));
    }
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
          {
            url?: string;
            error?: string;
            complete?: boolean;
            cancelled?: boolean;
          }
        >,
      ) => {
        if (event.data.complete) {
          completed = true;
          if (event.data.error) handoff.reject(new Error(event.data.error));
          else if (event.data.cancelled) {
            handoff.reject(
              new DOMException("Download cancelled", "AbortError"),
            );
          } else handoff.resolve();
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
    return { cleanup, done: handoff.promise };
  } catch (error) {
    completed = true;
    handoff.reject(error);
    frame.remove();
    cleanup();
    throw error;
  }
}
