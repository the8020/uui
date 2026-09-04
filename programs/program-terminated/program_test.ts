import { assertEquals, assertStringIncludes } from "@std/assert";
import type {
  ScreenEventMessage,
  UUIClientMessage,
  UUIWorkerOutbound,
} from "@packages/the8020/uui/mod.ts";
import { UUI_PROTOCOL_VERSION } from "@packages/the8020/uui/mod.ts";
import {
  bindSession,
  type SessionChannel,
} from "@packages/the8020/uui/internal.ts";
import programTerminated from "./program.ts";

type PresentationShow = Extract<
  UUIWorkerOutbound,
  { type: "presentation.show" }
>;

Deno.test("Program terminated renders, copies its dump, and returns Home", async () => {
  const channel = new TerminatedChannel();
  const unbind = bindSession(channel);
  try {
    const error = new TypeError("program demonstration failed");
    const entrypoint = new URL("program_test.ts", import.meta.url).pathname;
    error.stack =
      `TypeError: program demonstration failed\n    at demo (file://${entrypoint}:20:5)`;
    const running = programTerminated({
      exception: error,
      programId: "the8020/demo/demo-form",
      entrypoint,
      occurredAt: "2026-08-31T00:00:00.000Z",
      homeProgram: "the8020/uui/home",
      terminatedProgram: "the8020/uui/program-terminated",
    });
    const first = await channel.next("presentation.show") as PresentationShow;
    const firstScreen = topSurface(first).screen;
    assertEquals(firstScreen.title, "Program terminated");
    const model = firstScreen.model as Record<string, string>;
    assertEquals(model.exceptionType, "TypeError");
    assertStringIncludes(model.dumpText!, "program demonstration failed");
    assertEquals(firstScreen.header.actions.map((item) => item.id), [
      "home",
      "copy",
      "end",
    ]);

    channel.event(first, "copy");
    const copied = await channel.next("clipboard.write");
    assertStringIncludes(
      (copied as Extract<UUIWorkerOutbound, { type: "clipboard.write" }>).text,
      "program demonstration failed",
    );
    const refreshed = await channel.next(
      "presentation.show",
    ) as PresentationShow;
    assertStringIncludes(
      (topSurface(refreshed).screen.model as Record<string, string>)
        .copyStatus!,
      "Copied ",
    );
    channel.event(refreshed, "home");
    assertEquals(await running, "home");
  } finally {
    unbind();
  }
});

class TerminatedChannel implements SessionChannel {
  readonly sessionId = "uis-testterm";
  readonly #client: UUIClientMessage[] = [];
  readonly #clientWaiters: Array<(message: UUIClientMessage) => void> = [];
  readonly #server: UUIWorkerOutbound[] = [];
  readonly #serverWaiters: Array<(message: UUIWorkerOutbound) => void> = [];
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

  async next(type: UUIWorkerOutbound["type"]): Promise<UUIWorkerOutbound> {
    while (true) {
      const message = this.#server.shift() ?? await new Promise<
        UUIWorkerOutbound
      >((resolve) => this.#serverWaiters.push(resolve));
      if (message.type === type) return message;
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
      eventType: "action",
      changes: [],
    };
    const waiter = this.#clientWaiters.shift();
    if (waiter === undefined) this.#client.push(message);
    else waiter(message);
  }
}

function topSurface(presentation: PresentationShow) {
  return presentation.presentation.surfaces.at(-1)!;
}
