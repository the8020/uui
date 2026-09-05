import { AsyncLocalStorage } from "node:async_hooks";
import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { DownloadManager } from "./downloads.ts";
import {
  decodeDownloadChunk,
  DOWNLOAD_CHUNK_BYTES,
  DOWNLOAD_TRANSFER_FRAMES,
  DOWNLOAD_WINDOW_FRAMES,
  type DownloadClientCommand,
  type DownloadServerCommand,
  encodeDownloadChunk,
} from "./download_protocol.ts";
import { BrowserDownloads } from "./services/shell/frontend/downloads.ts";
import { parseClientMessage, UUI_PROTOCOL_VERSION } from "./protocol.ts";

function harness() {
  const readers = new Map<number, ReadableStreamDefaultReader<Uint8Array>>();
  const commands: DownloadServerCommand[] = [];
  const frames: Uint8Array[] = [];
  const reports: string[] = [];
  const credits: DownloadClientCommand[] = [];
  const server = new DownloadManager((message) => {
    if (message instanceof Uint8Array) {
      frames.push(message);
      browser.bytes(message);
    } else {
      commands.push(message);
      browser.receive(message);
    }
  }, (message) => reports.push(message));
  const browser = new BrowserDownloads((command) => {
    credits.push(command);
    server.receive(command);
  }, (metadata, stream) => {
    readers.set(metadata.downloadId, stream.getReader());
    return Promise.resolve(() => {});
  });
  return { server, browser, readers, commands, frames, reports, credits };
}

async function tick(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

async function readAll(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<number[]> {
  const result: number[] = [];
  while (true) {
    const next = await reader.read();
    if (next.done) return result;
    for (const byte of next.value) result.push(byte);
  }
}

Deno.test("downloads run concurrently with bounded shared buffering and split large producer chunks", async () => {
  const h = harness();
  let batches = 0;
  async function* source(value: number) {
    batches++;
    yield new Uint8Array(DOWNLOAD_CHUNK_BYTES * 8 + 7).fill(value);
  }
  const handles = Array.from(
    { length: 6 },
    (_, index) =>
      h.server.start({ filename: `${index}.bin`, body: source(index) }),
  );
  try {
    await tick();
    assertEquals(h.frames.length, DOWNLOAD_WINDOW_FRAMES);
    assertEquals(
      h.credits.filter((command) =>
        command.type === "download.credit" && command.frames === 0 &&
        command.consumed === 0
      ).length,
      handles.length,
      "ready transfers must acknowledge startup even while the shared window is full",
    );
    assert(batches <= 6);
    const perTransfer = new Map<number, number>();
    for (const frame of h.frames) {
      assert(frame.byteLength <= DOWNLOAD_CHUNK_BYTES + 4);
      const { downloadId } = decodeDownloadChunk(frame);
      perTransfer.set(downloadId, (perTransfer.get(downloadId) ?? 0) + 1);
    }
    assert(
      [...perTransfer.values()].every((count) =>
        count <= DOWNLOAD_TRANSFER_FRAMES
      ),
    );
    await tick();
    assertEquals(
      h.frames.length,
      DOWNLOAD_WINDOW_FRAMES,
      "receiving bytes alone must not return credit",
    );
    const results = await Promise.all([...h.readers.values()].map(readAll));
    await Promise.all(handles.map((handle) => handle.done));
    for (const [index, bytes] of results.entries()) {
      assertEquals(bytes.length, DOWNLOAD_CHUNK_BYTES * 8 + 7);
      assert(bytes.every((byte) => byte === index));
    }
    assertEquals(h.reports, []);
  } finally {
    h.server.abortAll();
    h.browser.close();
  }
});

Deno.test("download producer retains the initiating program's async context across credits", async () => {
  const context = new AsyncLocalStorage<string>();
  const h = harness();
  const observed: Array<string | undefined> = [];
  async function* source() {
    for (let index = 0; index < 10; index++) {
      observed.push(context.getStore());
      yield new Uint8Array([index]);
    }
  }
  const handle = context.run(
    "program-request",
    () => h.server.start({ filename: "context.bin", body: source() }),
  );
  await tick();
  await context.run("socket-request", () => readAll(h.readers.get(1)!));
  await handle.done;
  assertEquals(observed, Array(10).fill("program-request"));
});

Deno.test("cancelling a download cleans up its generator and allows other downloads to finish", async () => {
  const h = harness();
  let cleaned = false;
  async function* source() {
    try {
      while (true) yield new Uint8Array([7]);
    } finally {
      cleaned = true;
    }
  }
  const first = h.server.start({ filename: "cancel.bin", body: source() });
  const second = h.server.start({
    filename: "keep.bin",
    body: ReadableStream.from([new Uint8Array([1, 2, 3])]),
  });
  await tick();
  await h.readers.get(1)!.cancel();
  await assertRejects(() => first.done, DOMException, "cancelled");
  await tick();
  assert(cleaned);
  assertEquals(await readAll(h.readers.get(2)!), [1, 2, 3]);
  await second.done;
  assertEquals(h.reports, []);
});

Deno.test("a failed producer errors the browser stream and reports ignored-handle failures once", async () => {
  const h = harness();
  async function* source() {
    yield new Uint8Array([1]);
    throw new Error("database query failed");
  }
  const handle = h.server.start({ filename: "failed.csv", body: source() });
  await tick();
  await assertRejects(
    () => readAll(h.readers.get(1)!),
    Error,
    "database query failed",
  );
  await assertRejects(() => handle.done, Error, "database query failed");
  assertEquals(h.reports.length, 1);
  assertEquals(
    h.commands.some((command) => command.type === "download.end"),
    false,
  );
});

Deno.test("disconnect cancels pending stream reads and releases the source lock", async () => {
  const h = harness();
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
  }, { highWaterMark: 0 });
  const handle = h.server.start({ filename: "pending.bin", body });
  await tick();
  h.server.abortAll();
  h.browser.close();
  await assertRejects(() => handle.done, DOMException, "connection closed");
  await tick();
  assert(cancelled);
  assertEquals(body.locked, false);
});

Deno.test("download completion waits until the browser consumes every byte and EOF", async () => {
  const h = harness();
  const handle = h.server.start({
    filename: "empty.bin",
    body: ReadableStream.from([]),
  });
  let done = false;
  void handle.done.then(() => done = true);
  await tick();
  assertEquals(done, false);
  assertEquals(await readAll(h.readers.get(1)!), []);
  await handle.done;
  assert(done);
});

Deno.test("downloads stay lazy until browser startup and surface unavailable browser support", async () => {
  let pulled = false;
  let cancelled = false;
  const reports: string[] = [];
  const manager = new DownloadManager(
    () => {},
    (message) => reports.push(message),
  );
  const body = new ReadableStream<Uint8Array>({
    pull() {
      pulled = true;
    },
    cancel() {
      cancelled = true;
    },
  }, { highWaterMark: 0 });
  const handle = manager.start({ filename: "lazy.bin", body });
  await tick();
  assertEquals(pulled, false);
  manager.receive({
    type: "download.cancel",
    downloadId: 1,
    error: "Downloads require HTTPS",
  });
  await assertRejects(() => handle.done, Error, "HTTPS");
  await tick();
  assert(cancelled);
  assertEquals(reports.length, 1);
});

Deno.test("download credit rejects premature acknowledgement and excess outstanding frames", async () => {
  const manager = new DownloadManager(() => {}, () => {});
  const handle = manager.start({
    filename: "credit.bin",
    body: ReadableStream.from([new Uint8Array([1])]),
  });
  try {
    assertThrows(
      () =>
        manager.receive({
          type: "download.credit",
          downloadId: 1,
          frames: 1,
          consumed: 1,
        }),
      TypeError,
    );
    manager.receive({
      type: "download.credit",
      downloadId: 1,
      frames: 4,
      consumed: 0,
    });
    assertThrows(
      () =>
        manager.receive({
          type: "download.credit",
          downloadId: 1,
          frames: 1,
          consumed: 0,
        }),
      TypeError,
    );
    assertThrows(
      () => manager.receive({ type: "download.done", downloadId: 1 }),
      TypeError,
    );
  } finally {
    handle.cancel();
    await assertRejects(() => handle.done, DOMException);
  }
});

Deno.test("download framing preserves arbitrary binary bytes and rejects malformed protocol messages", () => {
  const bytes = new Uint8Array([0, 255, 128, 10]);
  const decoded = decodeDownloadChunk(encodeDownloadChunk(0xffff_ffff, bytes));
  assertEquals(decoded, { downloadId: 0xffff_ffff, bytes });
  assertThrows(() => decodeDownloadChunk(new Uint8Array(4)), TypeError);
  assertThrows(
    () => encodeDownloadChunk(1, new Uint8Array(DOWNLOAD_CHUNK_BYTES + 1)),
    TypeError,
  );
  const base = {
    protocol: UUI_PROTOCOL_VERSION,
    clientSequence: 1,
    sessionId: "session",
    downloadId: 1,
  };
  assertEquals(
    parseClientMessage({
      ...base,
      type: "download.credit",
      frames: 4,
      consumed: 0,
    }).type,
    "download.credit",
  );
  assertThrows(
    () =>
      parseClientMessage({
        ...base,
        type: "download.credit",
        frames: 5,
        consumed: 0,
      }),
    TypeError,
  );
  assertThrows(
    () =>
      parseClientMessage({
        ...base,
        type: "download.cancel",
        error: "x".repeat(1001),
      }),
    TypeError,
  );
  assertThrows(
    () => parseClientMessage({ ...base, type: "download.done", downloadId: 0 }),
    TypeError,
  );
});

Deno.test("download metadata rejects filesystem paths and header injection", () => {
  const manager = new DownloadManager(() => {}, () => {});
  const body = ReadableStream.from([]);
  assertThrows(
    () => manager.start({ filename: "../backup.csv", body }),
    TypeError,
  );
  assertThrows(
    () => manager.start({ filename: "backup\r\n.csv", body }),
    TypeError,
  );
  assertThrows(
    () =>
      manager.start({
        filename: "backup.csv",
        contentType: "text/csv\r\nx: y",
        body,
      }),
    TypeError,
  );
});
