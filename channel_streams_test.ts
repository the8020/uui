import { AsyncLocalStorage } from "node:async_hooks";
import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  type ChannelFrame,
  ChannelRouter,
  type StreamPolicy,
} from "./channel.ts";
import { decodeStreamChunk, encodeStreamChunk } from "./channel_streams.ts";
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const policy = (): StreamPolicy => ({
  chunkBytes: 4,
  sourceChunkBytes: 40,
  activeStreams: 8,
  streamFrames: 2,
  directionFrames: 4,
  aggregateFrames: 8,
});
function pair() {
  const frames: Array<ChannelFrame | Uint8Array> = [];
  const server = new ChannelRouter("server", (frame) => {
    frames.push(frame);
    queueMicrotask(() =>
      frame instanceof Uint8Array
        ? client.bytes(frame)
        : client.receive(JSON.parse(JSON.stringify(frame)))
    );
  });
  const client = new ChannelRouter("client", (frame) => {
    frames.push(frame);
    queueMicrotask(() =>
      frame instanceof Uint8Array
        ? server.bytes(frame)
        : server.receive(JSON.parse(JSON.stringify(frame)))
    );
  });
  server.connect("connection");
  client.connect("connection");
  const owner = new AbortController(), ps = policy(), pc = policy();
  const s = server.register("bytes", "round", () => {}, owner.signal, ps);
  const c = client.register("bytes", "round", () => {}, owner.signal, pc);
  return {
    server,
    client,
    frames,
    owner,
    ps,
    pc,
    s,
    c,
    close() {
      owner.abort();
      server.disconnect();
      client.disconnect();
    },
  };
}
Deno.test("both stream directions preserve byte content, lazy demand, empty/partial EOF and trusted producer context", async () => {
  const p = pair();
  const context = new AsyncLocalStorage<string>();
  const contexts: unknown[] = [];
  const readers = new Map<string, ReadableStreamDefaultReader<Uint8Array>>();
  const gates = new Map<
    string,
    ReturnType<typeof Promise.withResolvers<void>>
  >();
  for (const channel of [p.s, p.c]) {
    channel.subscribe("*", async (id, data) => {
      if (!(data instanceof ReadableStream)) return;
      readers.set(id, data.getReader());
      const gate = Promise.withResolvers<void>();
      gates.set(id, gate);
      await gate.promise;
    });
  }
  async function* source() {
    for (let i = 0; i < 3; i++) {
      contexts.push(context.getStore());
      yield new Uint8Array([i, 255, 0, 1, 2]);
    }
  }
  try {
    const down = context.run("producer", () => p.s.send("down", source())),
      up = p.c.send(
        "up",
        ReadableStream.from([new Uint8Array(), new Uint8Array([9, 8, 7])]),
      );
    await tick();
    assertEquals(contexts, []);
    const consume = async (id: string) => {
      const bytes: number[] = [];
      while (true) {
        const value = await readers.get(id)!.read();
        if (value.done) break;
        bytes.push(...value.value);
      }
      gates.get(id)!.resolve();
      return bytes;
    };
    assertEquals(await consume("down"), [
      0,
      255,
      0,
      1,
      2,
      1,
      255,
      0,
      1,
      2,
      2,
      255,
      0,
      1,
      2,
    ]);
    assertEquals(await consume("up"), [9, 8, 7]);
    await Promise.all([down.done, up.done]);
    assertEquals(contexts, ["producer", "producer", "producer"]);
    const empty = p.c.send("empty", ReadableStream.from([]));
    await tick();
    assertEquals(await consume("empty"), []);
    await empty.done;
    assertEquals(p.server.streamUsage(p.ps), {
      send: 0,
      receive: 0,
      active: 0,
    });
  } finally {
    for (const gate of gates.values()) gate.resolve();
    p.close();
  }
});
Deno.test("owner windows bound queued and in-flight frames while ordinary messages and ready siblings progress", async () => {
  const p = pair();
  const gates: ReturnType<typeof Promise.withResolvers<void>>[] = [];
  const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
  const consumed: number[][] = [];
  let messages = 0;
  const sink = async (_id: string, data: unknown) => {
    if (!(data instanceof ReadableStream)) {
      messages++;
      return;
    }
    const reader = data.getReader();
    readers.push(reader);
    const gate = Promise.withResolvers<void>();
    gates.push(gate);
    await gate.promise;
    const bytes: number[] = [];
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes.push(...next.value);
    }
    consumed.push(bytes);
  };
  p.c.subscribe("*", sink);
  p.s.subscribe("*", sink);
  try {
    const handles = [
      p.s.send("slow", ReadableStream.from([new Uint8Array([1, 2, 3, 4, 5])])),
      p.s.send("ready", ReadableStream.from([new Uint8Array([6])])),
      p.c.send("reverse", ReadableStream.from([new Uint8Array([9])])),
    ];
    await tick();
    const first = readers[0]!.read();
    await tick();
    for (const router of [p.server, p.client]) {
      const usage = router.streamUsage(router === p.server ? p.ps : p.pc);
      assert(usage.send <= 4);
      assert(usage.receive <= 4);
      assert(usage.send + usage.receive <= 8);
    }
    p.s.send("ordinary", { data: true });
    await tick();
    assertEquals(messages, 1);
    gates[1]!.resolve();
    gates[2]!.resolve();
    await Promise.all([handles[1]!.done, handles[2]!.done]);
    const firstValue = await first;
    assertEquals([...firstValue.value!], [1, 2, 3, 4]);
    gates[0]!.resolve();
    await handles[0]!.done;
    assertEquals(consumed.sort(), [[5], [6], [9]]);
  } finally {
    gates.forEach((gate) => gate.resolve());
    p.close();
  }
});
Deno.test("sink and source failures, cancellation and owner policy excess remain attributable and leave healthy channels", async () => {
  const p = pair();
  let pulled = false;
  const gate = Promise.withResolvers<void>();
  let signal: AbortSignal | undefined;
  const stop = p.c.subscribe("*", async (id, data, context) => {
    if (!(data instanceof ReadableStream)) return;
    if (id === "reject") throw new Error("sink failed");
    signal = context.signal;
    await data.getReader().read();
    await gate.promise;
  });
  async function* source() {
    pulled = true;
    yield new Uint8Array([1]);
    await gate.promise;
    yield new Uint8Array([2]);
  }
  try {
    await assertRejects(
      () => p.s.send("reject", source()).done,
      Error,
      "sink failed",
    );
    assertEquals(pulled, false);
    const limited = { ...p.ps, activeStreams: 1 };
    const running = p.s.send("hold", source(), { policy: limited });
    await tick();
    assertThrows(
      () => p.s.send("excess", source(), { policy: limited }),
      Error,
      "Too many",
    );
    running.cancel();
    await assertRejects(() => running.done, DOMException);
    await tick();
    assertEquals(signal?.aborted, true);
    stop.unsubscribe();
    p.c.subscribe("*", async (_id, data) => {
      if (data instanceof ReadableStream) {
        await new Response(data).arrayBuffer();
      }
    });
    await assertRejects(
      () =>
        p.s.send("oversize", ReadableStream.from([new Uint8Array(41)])).done,
      TypeError,
    );
    await assertRejects(
      () =>
        p.s.send(
          "failure",
          new ReadableStream({
            start(controller) {
              controller.error(new Error("source failed"));
            },
          }),
        ).done,
      Error,
      "source failed",
    );
    await p.s.send("healthy", ReadableStream.from([new Uint8Array([7])])).done;
  } finally {
    gate.resolve();
    p.close();
  }
});
Deno.test("duplicate and invalid credits, premature EOF and malformed framing reject only their transfer", async () => {
  for (
    const invalid of [{ frames: 3, consumed: 0, ordinal: 1 }, {
      frames: 1,
      consumed: 1,
      ordinal: 1,
    }, { frames: 1, consumed: 0, ordinal: 2 }]
  ) {
    const p = pair();
    const gate = Promise.withResolvers<void>();
    p.c.subscribe("*", async (_id, data) => {
      if (data instanceof ReadableStream) {
        await gate.promise;
        await new Response(data).arrayBuffer();
      }
    });
    try {
      const handle = p.s.send(
        "bytes",
        ReadableStream.from([new Uint8Array([1])]),
      );
      await tick();
      const open = p.frames.find((frame): frame is ChannelFrame =>
        !(frame instanceof Uint8Array) && frame.kind === "stream.open"
      )!;
      p.server.receive({
        ...open,
        kind: "stream.credit",
        value: undefined,
        ...invalid,
      });
      await assertRejects(() => handle.done, Error);
      gate.resolve();
      assertEquals(p.server.streamUsage(p.ps).active, 0);
    } finally {
      gate.resolve();
      p.close();
    }
  }
  assertThrows(
    () => decodeStreamChunk(new Uint8Array([0, 0, 0, 9, 1])),
    TypeError,
  );
  const frame = {
    type: "channel.frame",
    kind: "stream.bytes",
    connection: "connection",
    generation: "round",
    namespace: "bytes",
    requestId: "server-1",
    id: "bytes",
    ordinal: 1,
  } as ChannelFrame;
  const encoded = encodeStreamChunk(frame, new Uint8Array([0, 255]));
  assertEquals([...decodeStreamChunk(encoded).bytes], [0, 255]);
});
Deno.test("unsubscribe and replacement connections cancel independent peers and reject abort-ignoring late output", async () => {
  const p = pair();
  const gate = Promise.withResolvers<void>();
  const readerReady = Promise.withResolvers<void>();
  const sourceContext = new AsyncLocalStorage<string>();
  let cleaned = false;
  let trusted: string | undefined;
  p.c.subscribe("*", async (_id, data) => {
    if (data instanceof ReadableStream) {
      await data.getReader().read();
      readerReady.resolve();
      await gate.promise;
    }
  });
  async function* source() {
    try {
      yield new Uint8Array([1]);
      await gate.promise;
      trusted = sourceContext.getStore();
      yield new Uint8Array([2]);
    } finally {
      cleaned = true;
    }
  }
  try {
    const saved = p.s.capture();
    const handle = sourceContext.run(
      "origin",
      () => saved.send("late", source()),
    );
    await readerReady.promise;
    p.server.connect("replacement");
    p.client.connect("replacement");
    await assertRejects(() => handle.done, DOMException);
    const count = p.frames.length;
    gate.resolve();
    await tick();
    await tick();
    assertEquals(cleaned, true);
    assertEquals(trusted, "origin");
    assertEquals(p.frames.length, count);
    assertThrows(
      () => saved.send("late", ReadableStream.from([])),
      DOMException,
    );
  } finally {
    gate.resolve();
    p.close();
  }
});
