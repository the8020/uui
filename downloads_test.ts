import { assertEquals, assertThrows } from "@std/assert";
import { download, ScreenChannel } from "./session.ts";
import { startDownload } from "./downloads.ts";
import { validateDownloadMetadata } from "./download_metadata.ts";
Deno.test("download start requires a live explicit attachment before touching its source", () => {
  const channel = new ScreenChannel();
  assertThrows(() => channel.downloads, DOMException, "live");
  let pulled = false;
  const body = {
    async *[Symbol.asyncIterator]() {
      pulled = true;
      yield new Uint8Array();
    },
  };
  assertThrows(
    () => download({ filename: "file", body }, channel.downloads),
    DOMException,
  );
  assertEquals(pulled, false);
});
Deno.test("native download metadata rejects paths and header injection", () => {
  for (const filename of ["../backup.csv", "backup\r\n.csv", ".", ""]) {
    assertThrows(
      () => validateDownloadMetadata({ filename, contentType: "text/csv" }),
      TypeError,
    );
  }
  assertThrows(
    () =>
      validateDownloadMetadata({
        filename: "file.csv",
        contentType: "text/csv\r\nx: y",
      }),
    TypeError,
  );
});

import {
  bindSession,
  callScreen,
  commandScreen,
  connectChannels,
  disconnectChannels,
  presentPage,
} from "./session.ts";
import { Model } from "./model.ts";
import { z } from "/p/the8020/db/fields.ts";
import { ChannelRouter, type StreamPolicy } from "./channel.ts";
import {
  UUI_PROTOCOL_VERSION,
  type UUIClientMessage,
  type UUIWorkerOutbound,
} from "./protocol.ts";
import { assertRejects } from "@std/assert";
import { AsyncLocalStorage } from "node:async_hooks";
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

Deno.test("screen owners cancel both stream directions and late handlers across every existing cleanup boundary", async () => {
  for (
    const action of [
      "settlement",
      "reset",
      "dispose",
      "exit",
      "failure",
      "cover",
      "disconnect",
      "takeover",
      "unbind",
    ]
  ) {
    const queue: Array<UUIClientMessage | Uint8Array> = [];
    let waiter: ((message: UUIClientMessage | Uint8Array) => void) | undefined;
    const sent: Array<UUIWorkerOutbound | Uint8Array> = [];
    const client = new ChannelRouter("client", (frame) => {
      const value = frame instanceof Uint8Array ? frame : {
        ...frame,
        sessionId: "stream-screen",
        protocol: UUI_PROTOCOL_VERSION,
        clientSequence: 0,
      } as UUIClientMessage;
      if (waiter) {
        const resolve = waiter;
        waiter = undefined;
        resolve(value);
      } else queue.push(value);
    });
    const unbind = bindSession({
      sessionId: "stream-screen",
      send(frame) {
        sent.push(frame);
        queueMicrotask(() => {
          if (frame instanceof Uint8Array) client.bytes(frame);
          else if (frame.type === "channel.frame") client.receive(frame);
        });
      },
      receive() {
        return queue.length
          ? Promise.resolve(queue.shift()!)
          : new Promise((resolve) => waiter = resolve);
      },
    });
    connectChannels("connection");
    client.connect("connection");
    const channel = new ScreenChannel(), model = new Model({});
    const policy: StreamPolicy = {
      chunkBytes: 4,
      sourceChunkBytes: 8,
      activeStreams: 4,
      streamFrames: 2,
      directionFrames: 4,
      aggregateFrames: 8,
    };
    const gate = Promise.withResolvers<void>();
    const context = new AsyncLocalStorage<string>();
    const contexts: Array<string | undefined> = [];
    let incomingSignal: AbortSignal | undefined,
      sinkSignal: AbortSignal | undefined,
      cleaned = false,
      lateStart = "";
    channel.subscribe("*", async (id, data, { signal }) => {
      if (id !== "bytes" || !(data instanceof ReadableStream)) return;
      contexts.push(context.getStore());
      incomingSignal = signal;
      await data.getReader().read();
      await gate.promise;
      contexts.push(context.getStore());
      try {
        download(
          { filename: "late", body: ReadableStream.from([]) },
          channel.downloads,
        );
        lateStart = "started";
      } catch (error) {
        lateStart = (error as Error).name;
      }
    });
    const options = {
      channel,
      model,
      id: "streams",
      schema: z.object({}),
      header: { actions: [{ id: "next", label: "Next" }] },
    };
    let pending = context.run("initiating-call", () => callScreen(options));
    void pending.catch(() => {});
    const lifetime = new AbortController();
    const serverEndpoint = channel.capture();
    const generation = serverEndpoint.reference.generation;
    const screen = (sent.find((item) =>
      !(item instanceof Uint8Array) && item.type === "presentation.show"
    ) as Extract<UUIWorkerOutbound, { type: "presentation.show" }>).presentation
      .surfaces.at(-1)!.screen;
    const incoming = client.register(
      screen.programNamespace!,
      generation,
      () => {},
      lifetime.signal,
      policy,
    );
    const saving = client.register(
      screen.downloadNamespace!,
      generation,
      () => {},
      lifetime.signal,
    );
    saving.subscribe("*", async (_id, data, { signal }) => {
      if (!(data instanceof ReadableStream)) {
        return;
      }
      sinkSignal = signal;
      await data.getReader().read();
      await gate.promise;
    });
    const source = async function* () {
      try {
        yield new Uint8Array([1]);
        await gate.promise;
        yield new Uint8Array([2]);
      } finally {
        cleaned = true;
      }
    };
    const saved = channel.downloads;
    const outgoing = download({ filename: "owned.bin", body: source() }, saved);
    const upload = incoming.send("bytes", source(), { policy });
    const childChannel = new ScreenChannel();
    let child: Promise<unknown> | undefined;
    try {
      await tick();
      await tick();
      assertEquals(incomingSignal?.aborted, false);
      assertEquals(sinkSignal?.aborted, false);
      if (action === "settlement") {
        await commandScreen({ op: "click", id: "next" }, 1);
        await pending;
        pending = callScreen(options);
      } else if (action === "reset") {
        model.resetScreen();
        channel.redraw();
      } else if (action === "dispose") {
        serverEndpoint.dispose();
        saved.dispose();
      } else if (action === "exit") {
        channel.exit();
        await pending;
        pending = callScreen(options);
      } else if (action === "failure") {
        channel.fail(new Error("Failed"));
        await assertRejects(
          () =>
            pending,
          Error,
          "Failed",
        );
        pending = callScreen(options);
      } else if (action === "cover") {
        child = presentPage(() =>
          callScreen({
            id: "child",
            model: new Model({}),
            schema: z.object({}),
            channel: childChannel,
          })
        );
      } else if (action === "disconnect") {
        disconnectChannels();
      } else if (action === "takeover") {
        connectChannels("replacement");
        client.connect("replacement");
      } else unbind();
      await assertRejects(() =>
        outgoing.done, DOMException);
      await assertRejects(() => upload.done, Error);
      await tick();
      assertEquals(incomingSignal?.aborted, true, action);
      assertEquals(sinkSignal?.aborted, true, action);
      assertThrows(
        () => saved.send("save", ReadableStream.from([]), { policy }),
        Error,
      );
      const count = sent.length;
      gate.resolve();
      await tick();
      await tick();
      assertEquals(cleaned, true, action);
      assertEquals(lateStart, "AbortError", action);
      assertEquals(contexts, ["initiating-call", "initiating-call"], action);
      assertEquals(
        sent.length,
        count,
        `${action}: old work emits no bytes or control into new ownership`,
      );
      assertEquals(
        lifetime.signal.aborted,
        false,
        "peer lifetime is independent",
      );
    } finally {
      gate.resolve();
      childChannel.exit();
      await child;
      channel.exit();
      await pending.catch(() => {});
      client.disconnect();
      unbind();
    }
  }
});

Deno.test("native save releases staged metadata after synchronous admission or locked-source failure", async () => {
  const server = new ChannelRouter(
    "server",
    (frame) =>
      queueMicrotask(() =>
        frame instanceof Uint8Array
          ? client.bytes(frame)
          : client.receive(frame)
      ),
  );
  const client = new ChannelRouter(
    "client",
    (frame) =>
      queueMicrotask(() =>
        frame instanceof Uint8Array
          ? server.bytes(frame)
          : server.receive(frame)
      ),
  );
  server.connect("download-metadata");
  client.connect("download-metadata");
  const owner = new AbortController();
  const outgoing = server.register(
    "downloads",
    "round",
    () => {},
    owner.signal,
  );
  const incoming = client.register(
    "downloads",
    "round",
    () => {},
    owner.signal,
  );
  const metadata = new Set<string>();
  incoming.subscribe("*", (id, data) => {
    if (id === "save") metadata.add((data as { token: string }).token);
    if (id === "forget") metadata.delete(String(data));
  });
  const locked = ReadableStream.from([new Uint8Array([1])]);
  const reader = locked.getReader();
  try {
    const handle = startDownload(
      outgoing,
      { filename: "locked", body: locked },
      () => {},
    );
    await assertRejects(() => handle.done, TypeError);
    await tick();
    assertEquals(metadata.size, 0);
    assertThrows(
      () =>
        startDownload(outgoing, {
          filename: "invalid",
          body: undefined as unknown as ReadableStream<Uint8Array>,
        }, () => {}),
      TypeError,
    );
    await tick();
    assertEquals(metadata.size, 0);
  } finally {
    reader.releaseLock();
    owner.abort();
    server.disconnect();
    client.disconnect();
  }
});
