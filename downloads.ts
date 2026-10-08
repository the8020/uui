import type { AttachedChannel } from "./channel.ts";
import type { ByteSource, StreamHandle } from "./channel_streams.ts";
import {
  DOWNLOAD_POLICY,
  validateDownloadMetadata,
} from "./download_metadata.ts";
export interface DownloadOptions {
  filename: string;
  contentType?: string;
  /** Owned by the stream; generators are pulled only after admitted consumer demand. */
  body: ByteSource;
}
export type DownloadHandle = StreamHandle;
/** Native save is a domain consumer of the shared namespace stream core. */
export function startDownload(
  endpoint: AttachedChannel,
  options: DownloadOptions,
  report: (message: string) => void,
): DownloadHandle {
  const metadata = {
    filename: options.filename,
    contentType: options.contentType ?? "application/octet-stream",
  };
  validateDownloadMetadata(metadata);
  const token = crypto.randomUUID();
  endpoint.send("save", { token, ...metadata });
  const forget = () => {
    try {
      endpoint.send("forget", token);
    } catch { /* old owner */ }
  };
  let handle: StreamHandle;
  try {
    handle = endpoint.send(token, options.body, { policy: DOWNLOAD_POLICY });
  } catch (error) {
    forget();
    throw error;
  }
  void handle.done.finally(forget).catch(() => {});
  void handle.done.catch((error: unknown) => {
    if (error instanceof Error && error.name === "AbortError") return;
    try {
      report(
        `Could not download ${metadata.filename}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } catch { /* ended session */ }
  });
  return handle;
}
