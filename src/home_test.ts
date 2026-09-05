import { assertEquals, assertRejects } from "@std/assert";
import {
  BACK_EVENT,
  ProgramExecutionError,
  UUI_PROTOCOL_VERSION,
} from "/p/the8020/uui/mod.ts";
import type {
  ScreenEventMessage,
  UUIClientMessage,
  UUIWorkerOutbound,
} from "/p/the8020/uui/mod.ts";
import { bindSession, type SessionChannel } from "/p/the8020/uui/internal.ts";
import { runHome } from "../programs/home/program.ts";

type PresentationShow = Extract<
  UUIWorkerOutbound,
  { type: "presentation.show" }
>;

class HomeChannel implements SessionChannel {
  readonly sessionId = "ui-session-home-test";
  readonly sent: UUIWorkerOutbound[] = [];
  #client: UUIClientMessage[] = [];
  #clientWaiters: Array<(message: UUIClientMessage) => void> = [];
  #server: UUIWorkerOutbound[] = [];
  #serverWaiters: Array<(message: UUIWorkerOutbound) => void> = [];
  #clientSequence = 0;

  send(message: UUIWorkerOutbound): void {
    this.sent.push(message);
    const waiter = this.#serverWaiters.shift();
    if (waiter === undefined) this.#server.push(message);
    else waiter(message);
  }

  receive(): Promise<UUIClientMessage> {
    const message = this.#client.shift();
    if (message !== undefined) return Promise.resolve(message);
    return new Promise((resolve) => this.#clientWaiters.push(resolve));
  }

  async screen(): Promise<PresentationShow> {
    while (true) {
      const message = this.#server.shift() ?? await new Promise<
        UUIWorkerOutbound
      >((resolve) => this.#serverWaiters.push(resolve));
      if (
        message.type === "presentation.show" &&
        message.presentation.activeSurfaceId !== null
      ) {
        const surface = topSurface(message);
        const unmeasured = surface.screen.lists.filter((list) =>
          !list.state.measured
        );
        if (unmeasured.length > 0) {
          const input: UUIClientMessage = {
            type: "screen.list",
            protocol: UUI_PROTOCOL_VERSION,
            sessionId: this.sessionId,
            clientSequence: ++this.#clientSequence,
            surfaceId: surface.surfaceId,
            screenId: surface.screen.id,
            screenRevision: surface.screen.revision,
            instanceId: surface.screen.state.instanceId,
            screenState: {
              version: surface.screen.state.version,
              scroll: surface.screen.state.scroll,
              elements: {},
            },
            changes: [],
            updates: unmeasured.map((list) => ({
              id: list.id,
              revision: list.revision,
              operation: "capacity",
              pageSize: 50,
            })),
          };
          const waiter = this.#clientWaiters.shift();
          if (waiter === undefined) this.#client.push(input);
          else waiter(input);
          continue;
        }
        return message;
      }
    }
  }

  event(presentation: PresentationShow, action: string, value?: string): void {
    const surface = topSurface(presentation);
    const message: ScreenEventMessage = {
      type: "screen.event",
      protocol: UUI_PROTOCOL_VERSION,
      clientSequence: ++this.#clientSequence,
      sessionId: this.sessionId,
      surfaceId: surface.surfaceId,
      screenId: surface.screen.id,
      screenRevision: surface.screen.revision,
      instanceId: surface.screen.state.instanceId,
      screenState: {
        version: surface.screen.state.version,
        scroll: surface.screen.state.scroll,
        elements: {},
      },
      action,
      value,
      eventType: action === BACK_EVENT ? BACK_EVENT : "action",
      changes: [],
    };
    const waiter = this.#clientWaiters.shift();
    if (waiter === undefined) this.#client.push(message);
    else waiter(message);
  }
}

Deno.test("Home refresh lists only discoverable UUI programs", async () => {
  const root = await Deno.makeTempDir({ prefix: "the8020-home-test-" });
  const channel = new HomeChannel();
  const unbind = bindSession(channel);
  try {
    await writeProgram(root, "first", "First program");
    await writeProgram(root, "job", "Job program", undefined, "");
    await writeProgram(
      root,
      "explicit-job",
      "Job program",
      undefined,
      "uui = false\n",
    );
    await writeProgram(
      root,
      "hidden",
      "Hidden UUI",
      undefined,
      "uui = true\ndiscoverable = false\n",
    );
    const running = runHome(root);
    const first = await channel.screen();
    assertEquals(programIDs(first), ["example/testing/first"]);
    assertEquals(
      topSurface(first).screen.header.actions.map((action) => action.id),
      [
        "refresh",
        "logout",
      ],
    );

    await writeProgram(root, "second", "Second program");
    channel.event(first, "refresh");
    const refreshed = await channel.screen();
    assertEquals(programIDs(refreshed), [
      "example/testing/first",
      "example/testing/second",
    ]);

    await writeProgram(root, "first", "Now a job", undefined, "uui = false\n");
    channel.event(refreshed, "refresh");
    const reclassified = await channel.screen();
    assertEquals(programIDs(reclassified), ["example/testing/second"]);
    channel.event(reclassified, "select", "example/testing/job");
    const unchanged = await channel.screen();
    assertEquals(programIDs(unchanged), ["example/testing/second"]);
    channel.event(unchanged, "logout");
    await running;
  } finally {
    unbind();
    await Deno.remove(root, { recursive: true });
  }
});

for (const interactive of [false, true]) {
  Deno.test(`Home returns silently after a UUI program ${interactive ? "presents a screen" : "returns immediately"}`, async () => {
    const root = await Deno.makeTempDir({ prefix: "the8020-home-test-" });
    const channel = new HomeChannel();
    const unbind = bindSession(channel);
    try {
      await writeProgram(
        root,
        "selected",
        "Selected program",
        interactive
          ? `import { callScreen, Model, z } from "/p/the8020/uui/mod.ts";
             export default async function() {
               await callScreen({ id: "selected", schema: z.object({}), model: new Model({}) });
             }`
          : "export default async function() { await Promise.resolve(); }",
      );
      const running = runHome(root);
      const home = await channel.screen();
      channel.event(home, "select", "example/testing/selected");
      if (interactive) {
        const selected = await channel.screen();
        assertEquals(topSurface(selected).screen.id, "selected");
        assertEquals(
          channel.sent.filter((message) =>
            message.type === "notification.show"
          ),
          [],
        );
        channel.event(selected, BACK_EVENT);
      }
      const returned = await channel.screen();
      assertEquals(topSurface(returned).screen.id, "home");
      assertEquals(
        channel.sent.filter((message) => message.type === "notification.show"),
        [],
      );
      channel.event(returned, "logout");
      await running;
    } finally {
      unbind();
      await Deno.remove(root, { recursive: true });
    }
  });
}

Deno.test("Home propagates program failures without reporting success", async () => {
  const root = await Deno.makeTempDir({ prefix: "the8020-home-test-" });
  const channel = new HomeChannel();
  const unbind = bindSession(channel);
  try {
    await writeProgram(
      root,
      "failing",
      "Failing program",
      'export default async function() { throw new TypeError("program failed"); }',
    );
    const running = runHome(root);
    const rejected = assertRejects(
      () => running,
      ProgramExecutionError,
      "program failed",
    );
    channel.event(await channel.screen(), "select", "example/testing/failing");
    const error = await rejected;
    assertEquals(error.programId, "example/testing/failing");
    assertEquals(error.exception instanceof TypeError, true);
    assertEquals(
      channel.sent.filter((message) => message.type === "notification.show"),
      [],
    );
  } finally {
    unbind();
    await Deno.remove(root, { recursive: true });
  }
});

function programIDs(presentation: PresentationShow): string[] {
  return (topSurface(presentation).screen.lists.find((list) =>
    list.bind === "programs"
  )!.rows as Array<{ id: string }>)
    .map((program) => program.id);
}

function topSurface(presentation: PresentationShow) {
  return presentation.presentation.surfaces.at(-1)!;
}

async function writeProgram(
  root: string,
  name: string,
  description: string,
  source?: string,
  flags = "uui = true\n",
): Promise<void> {
  const programRoot = `${root}/example/testing/programs/${name}`;
  await Deno.mkdir(programRoot, { recursive: true });
  await Deno.writeTextFile(
    `${programRoot}/program.toml`,
    `schema = 1\ndescription = ${JSON.stringify(description)}\n${flags}`,
  );
  if (source !== undefined) {
    await Deno.writeTextFile(`${programRoot}/program.ts`, source);
  }
}
