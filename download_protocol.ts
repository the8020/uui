/** Shared, browser-safe download framing and resource bounds. */
export const DOWNLOAD_CHUNK_BYTES = 64 * 1024;
export const DOWNLOAD_WINDOW_FRAMES = 16;
export const DOWNLOAD_TRANSFER_FRAMES = 4;
export const DOWNLOAD_MAX_TRANSFERS = 32;
export const DOWNLOAD_START_TIMEOUT = 30_000;

export type DownloadMetadata = {
  downloadId: number;
  filename: string;
  contentType: string;
};

export type DownloadServerCommand =
  | ({ type: "download.begin" } & DownloadMetadata)
  | { type: "download.end"; downloadId: number }
  | {
    type: "download.error";
    downloadId: number;
    message: string;
    cancelled: boolean;
  };

export type DownloadClientCommand =
  | {
    type: "download.credit";
    downloadId: number;
    frames: number;
    consumed: number;
  }
  | { type: "download.done"; downloadId: number }
  | { type: "download.cancel"; downloadId: number; error?: string };

export function validDownloadID(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0 &&
    Number(value) <= 0xffff_ffff;
}

// Filenames must not contain path separators or header control bytes.
// deno-lint-ignore no-control-regex
const unsafeFilename = /[\/\\\x00-\x1f\x7f]/;

export function validateDownloadMetadata(value: DownloadMetadata): void {
  if (!validDownloadID(value.downloadId)) {
    throw new TypeError("Invalid download ID");
  }
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

export function encodeDownloadChunk(
  downloadId: number,
  bytes: Uint8Array,
): Uint8Array {
  if (
    !validDownloadID(downloadId) || bytes.byteLength === 0 ||
    bytes.byteLength > DOWNLOAD_CHUNK_BYTES
  ) throw new TypeError("Invalid download chunk");
  const frame = new Uint8Array(4 + bytes.byteLength);
  new DataView(frame.buffer).setUint32(0, downloadId);
  frame.set(bytes, 4);
  return frame;
}

export function decodeDownloadChunk(frame: Uint8Array): {
  downloadId: number;
  bytes: Uint8Array;
} {
  if (frame.byteLength <= 4 || frame.byteLength > DOWNLOAD_CHUNK_BYTES + 4) {
    throw new TypeError("Invalid download frame size");
  }
  const downloadId = new DataView(
    frame.buffer,
    frame.byteOffset,
    frame.byteLength,
  ).getUint32(0);
  if (!validDownloadID(downloadId)) throw new TypeError("Invalid download ID");
  return { downloadId, bytes: frame.subarray(4) };
}
