import { captureMessages, Channel } from "../../../../../session.ts";
import type { CustomElementOptions } from "../../../../../protocol.ts";

/** One pending screen's file input. Only the filename belongs in its Model. */
export function fileUpload(options: { maximumBytes: number; accept?: string }) {
  if (!Number.isSafeInteger(options.maximumBytes) || options.maximumBytes < 1) {
    throw new TypeError("Upload maximumBytes must be a positive integer");
  }
  const channel = new Channel();
  let bytes: Uint8Array | undefined;
  let receiving = false;
  channel.subscribe("file", async (_id, source, { signal }) => {
    if (!(source instanceof ReadableStream)) {
      throw new TypeError("Upload requires a byte stream");
    }
    if (receiving) throw new Error("A file is already uploading");
    const output = captureMessages();
    receiving = true;
    bytes = undefined;
    const reader = source.getReader();
    const cancel = () => void reader.cancel().catch(() => {});
    signal.addEventListener("abort", cancel, { once: true });
    let failure = "File upload failed. Select the file again.";
    try {
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        signal.throwIfAborted();
        const { value, done } = await reader.read();
        signal.throwIfAborted();
        if (done) break;
        if (!(value instanceof Uint8Array)) {
          throw new Error("Invalid file data");
        }
        size += value.byteLength;
        if (size > options.maximumBytes) {
          failure = `File must not exceed ${options.maximumBytes} bytes`;
          throw new RangeError(failure);
        }
        chunks.push(value);
      }
      bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
    } catch {
      if (!signal.aborted) {
        output.send(failure, "error");
      }
      await reader.cancel().catch(() => {});
      signal.throwIfAborted();
      throw new Error(failure);
    } finally {
      signal.removeEventListener("abort", cancel);
      reader.releaseLock();
      receiving = false;
    }
  });
  const custom: CustomElementOptions = {
    module: "/the8020/uui/shell/components/file-upload/input.js",
    channel,
    config: { accept: options.accept ?? "" },
  };
  return {
    custom,
    take(): Uint8Array {
      if (bytes === undefined || receiving) {
        throw new Error("Select a file and wait for its upload to finish");
      }
      const result = bytes;
      bytes = undefined;
      return result;
    },
  };
}
