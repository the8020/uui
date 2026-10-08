import type { StreamPolicy } from "./channel_streams.ts";
export const DOWNLOAD_START_TIMEOUT = 30_000;
export const DOWNLOAD_MAX_TRANSFERS = 32;
export const DOWNLOAD_POLICY: StreamPolicy = Object.freeze({
  chunkBytes: 64 * 1024,
  sourceChunkBytes: 64 * 1024 * 1024,
  activeStreams: DOWNLOAD_MAX_TRANSFERS,
  streamFrames: 4,
  directionFrames: 16,
  aggregateFrames: 32,
  startupTimeout: DOWNLOAD_START_TIMEOUT,
});
export interface DownloadMetadata {
  filename: string;
  contentType: string;
}
// Filenames must not contain path separators or header control bytes.
// deno-lint-ignore no-control-regex
const unsafeFilename = /[\/\\\x00-\x1f\x7f]/;

export function validateDownloadMetadata(value: DownloadMetadata): void {
  if (
    typeof value.filename !== "string" || value.filename.trim() === "" ||
    value.filename.length > 255 || value.filename === "." ||
    value.filename === ".." || unsafeFilename.test(value.filename)
  ) throw new TypeError("Download filename must be a name without a path");
  if (
    typeof value.contentType !== "string" ||
    value.contentType.length > 200 ||
    !/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+(?:;[\x20-\x7e]*)?$/.test(value.contentType)
  ) throw new TypeError("Invalid download content type");
}

export const downloadMetadata = {
  parse(value: unknown): DownloadMetadata {
    if (!value || typeof value !== "object") {
      throw new TypeError(
        "Invalid download metadata",
      );
    }
    const metadata = value as DownloadMetadata;
    validateDownloadMetadata(metadata);
    return { filename: metadata.filename, contentType: metadata.contentType };
  },
};
