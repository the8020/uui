import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  type AttachedChannel,
  ChannelBindings,
  type ChannelFrame,
  ChannelRouter,
  ChannelSubscription,
  transportStreamPolicy,
} from "./channel.ts";
import { encodeStreamChunk } from "./channel_streams.ts";
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
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
  const owners = [new AbortController(), new AbortController()];
  const policy = transportStreamPolicy();
  const s = server.register(
    "component:one",
    "round",
    () => {},
    owners[0]!.signal,
    policy,
  );
  const c = client.register(
    "component:one",
    "round",
    () => {},
    owners[1]!.signal,
    policy,
  );
  return {
    server,
    client,
    s,
    c,
    owners,
    frames,
    policy,
    close() {
      owners.forEach((owner) => owner.abort());
      server.disconnect();
      client.disconnect();
    },
  };
}
Deno.test("subscriptions preserve identity and match full IDs with only literal text and stars on both peers", async () => {
  const p = pair();
  const ids = [
    "exact",
    "exact.extra",
    "dashboard.updates.",
    "dashboard.updates.rows",
    "dashboard.other.rows",
    "a.b.c",
    "abc",
    "a+[b]?",
    "a+b",
    "ab.end",
    "axby.end",
  ];
  const cases: Array<[string, string[]]> = [
    ["exact", ["exact"]],
    ["*", ids],
    ["dashboard.updates.*", ["dashboard.updates.", "dashboard.updates.rows"]],
    ["a*c", ["a.b.c", "abc"]],
    ["a**b*.end", ["ab.end", "axby.end"]],
    ["a+[b]?", ["a+[b]?"]],
  ];
  try {
    for (const [sender, receiver] of [[p.s, p.c], [p.c, p.s]]) {
      const received = cases.map(() => [] as string[]);
      const subscriptions = cases.map(([pattern], index) => {
        const handler = (id: string, data: unknown) => {
          assertEquals(data, { id });
          received[index]!.push(id);
        };
        const subscription = receiver!.subscribe(pattern, handler);
        assertEquals(subscription instanceof ChannelSubscription, true);
        assertEquals(subscription.id, pattern);
        assertEquals(subscription.handler === handler, true);
        assertEquals(Reflect.set(subscription, "id", "changed"), false);
        assertEquals(Reflect.set(subscription, "handler", () => {}), false);
        return subscription;
      });
      for (const id of ids) sender!.send(id, { id });
      await tick();
      assertEquals(received, cases.map(([, expected]) => expected));
      subscriptions.forEach((subscription) => {
        subscription.unsubscribe();
        subscription.unsubscribe();
      });
      for (const id of ids) sender!.send(id, { id });
      await tick();
      assertEquals(received, cases.map(([, expected]) => expected));
    }
    assertThrows(() => p.c.subscribe("", () => {}), TypeError);
    assertThrows(() => p.c.subscribe("*", null as never), TypeError);
  } finally {
    p.close();
  }
});

Deno.test("stream ownership counts matching subscriptions, rejects missing or ambiguous matches and frees reservations", async () => {
  const p = pair();
  try {
    for (const [sender, receiver] of [[p.s, p.c], [p.c, p.s]]) {
      let ignored = 0, pulled = false;
      const unrelated = receiver!.subscribe("unrelated", () => {
        ignored++;
      });
      const received: unknown[] = [];
      const handler = async (id: string, data: unknown) => {
        received.push([id, [
          ...new Uint8Array(
            await new Response(data as ReadableStream).arrayBuffer(),
          ),
        ]]);
      };
      const match = receiver!.subscribe("dashboard.*.bytes", handler);
      await sender!.send(
        "dashboard.updates.bytes",
        ReadableStream.from([new Uint8Array([0, 255])]),
      ).done;
      assertEquals(received, [["dashboard.updates.bytes", [0, 255]]]);
      assertEquals(ignored, 0);
      const source = async function* () {
        pulled = true;
        yield new Uint8Array([1]);
      };
      await assertRejects(
        () => sender!.send("no.match", source()).done,
        Error,
        "exactly one matching",
      );
      const extra = receiver!.subscribe("*", handler);
      await assertRejects(
        () => sender!.send("dashboard.updates.bytes", source()).done,
        Error,
        "exactly one matching",
      );
      assertEquals(pulled, false);
      assertEquals(p.server.streamUsage(p.policy), {
        send: 0,
        receive: 0,
        active: 0,
      });
      assertEquals(p.client.streamUsage(p.policy), {
        send: 0,
        receive: 0,
        active: 0,
      });
      extra.unsubscribe();
      match.unsubscribe();
      unrelated.unsubscribe();
    }
  } finally {
    p.close();
  }
});

Deno.test("shared logical bindings reattach the same object without duplicates and disposal releases all consumption", async () => {
  const p = pair(), bindings = new ChannelBindings();
  const gate = Promise.withResolvers<void>();
  let heldSignal: AbortSignal | undefined;
  let deliveries = 0;
  const handler = async (
    id: string,
    data: unknown,
    { signal }: { signal: AbortSignal },
  ) => {
    deliveries++;
    if (id === "work.hold") {
      heldSignal = signal;
      await (data as ReadableStream).getReader().read();
      await gate.promise;
    } else if (data instanceof ReadableStream) {
      await new Response(data).arrayBuffer();
    }
  };
  const subscription = bindings.subscribe("work.*", handler);
  try {
    for (let round = 0; round < 12; round++) {
      bindings.attach(p.c);
      bindings.attach(p.c);
      await p.s.send(
        "work.bytes",
        ReadableStream.from([new Uint8Array([round])]),
      ).done;
      assertEquals(deliveries, round + 1);
      assertEquals(subscription.handler === handler, true);
      assertEquals(p.server.streamUsage(p.policy).active, 0);
      assertEquals(p.client.streamUsage(p.policy).active, 0);
      bindings.attach();
      await assertRejects(
        () => p.s.send("work.missing", ReadableStream.from([])).done,
        Error,
        "exactly one matching",
      );
    }
    bindings.attach(p.c);
    const held = p.s.send(
      "work.hold",
      (async function* () {
        yield new Uint8Array([1]);
        await gate.promise;
        yield new Uint8Array([2]);
      })(),
    );
    await tick();
    bindings.dispose();
    bindings.dispose();
    await assertRejects(() => held.done, Error);
    assertEquals(heldSignal?.aborted, true);
    assertEquals(p.server.streamUsage(p.policy).active, 0);
    assertEquals(p.client.streamUsage(p.policy).active, 0);
    gate.resolve();
    bindings.attach(p.c);
    p.s.send("work.after-dispose", null);
    await tick();
    assertEquals(deliveries, 13);
    subscription.unsubscribe();
  } finally {
    gate.resolve();
    bindings.dispose();
    p.close();
  }
});
Deno.test("generic IDs/data fan out in both directions; unsubscribe and handler errors preserve healthy delivery", async () => {
  const p = pair();
  try {
    const received: unknown[] = [], reverse: unknown[] = [];
    p.c.subscribe("*", () => {
      throw new Error("owner failure");
    });
    p.c.subscribe("*", () => Promise.reject(new Error("async owner failure")));
    const unsubscribe = p.c.subscribe("*", (id, data) => {
      received.push([id, data]);
    });
    p.s.subscribe("*", (id, data) => {
      reverse.push([id, data]);
    });
    const data = { ordinary: [null, 1, "data"], schema: "unnecessary" };
    p.s.send("ID with spaces / arbitrary event", data);
    p.c.send("reverse", { ok: true });
    data.ordinary.push(5);
    await tick();
    assertEquals(received, [["ID with spaces / arbitrary event", {
      ordinary: [null, 1, "data"],
      schema: "unnecessary",
    }]]);
    assertEquals(reverse, [["reverse", { ok: true }]]);
    unsubscribe.unsubscribe();
    unsubscribe.unsubscribe();
    p.s.send("next", 42);
    await tick();
    assertEquals(received.length, 1);
    for (const bad of [undefined, NaN, () => {}, { undefined }]) {
      assertThrows(() => p.s.send("bad", bad), TypeError);
    }
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    assertThrows(() => p.s.send("bad", cycle), TypeError);
  } finally {
    p.close();
  }
});
Deno.test("subscriber abort, screen and connection generations prevent late output and cross-instance delivery", async () => {
  const p = pair();
  const gate = Promise.withResolvers<void>();
  let signal: AbortSignal | undefined;
  try {
    const siblingOwner = new AbortController();
    const sibling = p.client.register(
      "component:two",
      "round",
      () => {},
      siblingOwner.signal,
    );
    const seen: string[] = [];
    sibling.subscribe("*", (id) => {
      seen.push(id);
    });
    const captured = p.c.capture();
    const stop = p.c.subscribe("*", async (_id, _data, context) => {
      signal = context.signal;
      await gate.promise;
      assertThrows(() => captured.send("late", null), DOMException);
    });
    p.s.send("work", null);
    await tick();
    assertEquals(signal?.aborted, false);
    p.owners[1]!.abort();
    assertEquals(signal?.aborted, true);
    stop.unsubscribe();
    const replacement = p.client.register(
      "component:one",
      "next",
      () => {},
      new AbortController().signal,
    );
    const replacementSeen: unknown[] = [];
    replacement.subscribe("*", (id, data) => {
      replacementSeen.push([id, data]);
    });
    p.s.send("old", null);
    await tick();
    assertEquals(replacementSeen, []);
    assertEquals(seen, []);
    gate.resolve();
    await tick();
    const saved = replacement.capture();
    p.client.connect("new-connection");
    assertThrows(() => saved.send("late", null), DOMException);
    assertThrows(() => saved.subscribe("*", () => {}), DOMException);
    saved.dispose();
    siblingOwner.abort();
  } finally {
    gate.resolve();
    p.close();
  }
});
Deno.test("streams use the same subscription with one consumer, byte-exact EOF, error and cancellation", async () => {
  const p = pair();
  try {
    const seen: unknown[] = [];
    const consume = (channel: AttachedChannel) =>
      channel.subscribe("*", async (id, data) => {
        if (!(data instanceof ReadableStream)) return;
        seen.push([id, [
          ...new Uint8Array(await new Response(data).arrayBuffer()),
        ]]);
      });
    const stop = consume(p.c);
    consume(p.s);
    await Promise.all([
      p.s.send("bytes-down", ReadableStream.from([new Uint8Array([0, 255, 9])]))
        .done,
      p.c.send("bytes-up", ReadableStream.from([new Uint8Array([128, 0, 3])]))
        .done,
    ]);
    assertEquals(seen.sort(), [["bytes-down", [0, 255, 9]], ["bytes-up", [
      128,
      0,
      3,
    ]]]);
    await p.s.send("empty", ReadableStream.from([])).done;
    await assertRejects(
      () =>
        p.s.send(
          "error",
          new ReadableStream({
            start(controller) {
              controller.error(new Error("producer failed"));
            },
          }),
        ).done,
      Error,
      "producer failed",
    );
    stop.unsubscribe();
    let pulled = false;
    const source = async function* () {
      pulled = true;
      yield new Uint8Array([1]);
    };
    await assertRejects(
      () => p.s.send("missing", source()).done,
      Error,
      "exactly one",
    );
    assertEquals(pulled, false);
    const one = consume(p.c), two = consume(p.c);
    await assertRejects(
      () => p.s.send("ambiguous", source()).done,
      Error,
      "exactly one",
    );
    assertEquals(pulled, false);
    two.unsubscribe();
    one.unsubscribe();
    const gate = Promise.withResolvers<void>();
    let remoteSignal: AbortSignal | undefined;
    const unsubscribe = p.c.subscribe("*", async (_id, data, { signal }) => {
      remoteSignal = signal;
      await (data as ReadableStream).getReader().read();
      await gate.promise;
    });
    const handle = p.s.send("cancel", source());
    const outboundGate = Promise.withResolvers<void>();
    const healthyOutbound = p.c.send(
      "independent",
      (async function* () {
        yield new Uint8Array([9]);
        await outboundGate.promise;
        yield new Uint8Array([8]);
      })(),
    );
    const independentCompletion = healthyOutbound.done;
    void independentCompletion.catch(() => {});
    await tick();
    unsubscribe.unsubscribe();
    outboundGate.resolve();
    await independentCompletion;
    await assertRejects(() => handle.done, Error);
    assertEquals(remoteSignal?.aborted, true);
    gate.resolve();
    const fresh = consume(p.c);
    await p.s.send("healthy", ReadableStream.from([new Uint8Array([7])])).done;
    fresh.unsubscribe();
  } finally {
    p.close();
  }
});
Deno.test("binary identity and transport admission reject malformed and stale frames", async () => {
  const p = pair();
  try {
    assertThrows(() => p.server.bytes(new Uint8Array([1, 2])), TypeError);
    const bad = {
      type: "channel.frame",
      kind: "stream.bytes",
      connection: "connection",
      generation: "round",
      namespace: "component:one",
      requestId: "client-1",
      id: "bytes",
      ordinal: 1,
      unknown: true,
    } as unknown as ChannelFrame;
    assertThrows(
      () => p.server.bytes(encodeStreamChunk(bad, new Uint8Array([1]))),
      TypeError,
    );
    const events: unknown[] = [];
    p.s.subscribe("*", (id, data) => {
      events.push([id, data]);
    });
    const frame: ChannelFrame = {
      type: "channel.frame",
      kind: "message",
      connection: "connection",
      generation: "round",
      namespace: "component:one",
      requestId: "client-5",
      id: "test",
      value: { ok: true },
    };
    p.server.receive({ ...frame, connection: "old" });
    p.server.receive({ ...frame, generation: "old" });
    p.server.receive({ ...frame, namespace: "another" });
    p.server.receive(frame);
    p.server.receive(frame);
    await tick();
    assertEquals(events, [["test", { ok: true }]]);
  } finally {
    p.close();
  }
});
