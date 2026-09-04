import { assertEquals } from "@std/assert";
import { BACK_EVENT, UUI_PROTOCOL_VERSION } from "@packages/the8020/uui/mod.ts";
import type {
  ScreenEventMessage,
  UUIClientMessage,
  UUIWorkerOutbound,
} from "@packages/the8020/uui/mod.ts";
import {
  bindSession,
  type SessionChannel,
} from "@packages/the8020/uui/internal.ts";
import { runHome } from "../programs/home/program.ts";

type PresentationShow = Extract<
  UUIWorkerOutbound,
  { type: "presentation.show" }
>;

class HomeChannel implements SessionChannel {
  readonly sessionId = "ui-session-home-test";
  #client: UUIClientMessage[] = [];
  #clientWaiters: Array<(message: UUIClientMessage) => void> = [];
  #server: UUIWorkerOutbound[] = [];
  #serverWaiters: Array<(message: UUIWorkerOutbound) => void> = [];
  #clientSequence = 0;

  send(message: UUIWorkerOutbound): void {
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
      ) return message;
    }
  }

  event(presentation: PresentationShow, action: string): void {
    const surface = topSurface(presentation);
    const message: ScreenEventMessage = {
      type: "screen.event",
      protocol: UUI_PROTOCOL_VERSION,
      clientSequence: ++this.#clientSequence,
      sessionId: this.sessionId,
      surfaceId: surface.surfaceId,
      screenId: surface.screen.id,
      screenRevision: surface.screen.revision,
      action,
      eventType: action === BACK_EVENT ? BACK_EVENT : "action",
      changes: [],
    };
    const waiter = this.#clientWaiters.shift();
    if (waiter === undefined) this.#client.push(message);
    else waiter(message);
  }
}

Deno.test("Home rescans package programs when refreshed", async () => {
  const root = await Deno.makeTempDir({ prefix: "the8020-home-test-" });
  const channel = new HomeChannel();
  const unbind = bindSession(channel);
  try {
    await writeProgram(root, "first", "First program");
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

    channel.event(refreshed, "logout");
    await running;
  } finally {
    unbind();
    await Deno.remove(root, { recursive: true });
  }
});

function programIDs(presentation: PresentationShow): string[] {
  return (topSurface(presentation).screen.model as {
    programs: Array<{ id: string }>;
  }).programs
    .map((program) => program.id);
}

function topSurface(presentation: PresentationShow) {
  return presentation.presentation.surfaces.at(-1)!;
}

async function writeProgram(
  root: string,
  name: string,
  description: string,
): Promise<void> {
  const programRoot = `${root}/example/testing/programs/${name}`;
  await Deno.mkdir(programRoot, { recursive: true });
  await Deno.writeTextFile(
    `${programRoot}/program.toml`,
    `schema = 1\ndescription = ${JSON.stringify(description)}\n`,
  );
}
