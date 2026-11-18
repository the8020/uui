import { assertEquals, assertMatch, assertThrows } from "@std/assert";
import { bindSession, callScreen, commandScreen } from "./session.ts";
import { Model } from "./model.ts";
import { z } from "/p/the8020/db/fields.ts";
import { transcribe } from "./agent.ts";
import type { PresentationSnapshot } from "./protocol.ts";
import { resolveSystemButtons } from "./system_buttons.ts";
import {
  DEFAULT_SYSTEM_BUTTONS,
  SESSION_EXIT_EVENT,
  SESSION_RESTART_EVENT,
  type SystemButtons,
} from "./protocol.ts";

Deno.test("system buttons merge by slot, remove, append and restore defaults", () => {
  const buttons = resolveSystemButtons({
    exit: { id: SESSION_RESTART_EVENT, label: "[[icon=refresh]]" },
    new: null,
    help: { label: "Help" },
  });
  assertEquals(Object.keys(buttons), ["back", "exit", "fullscreen", "help"]);
  assertEquals(buttons.exit, {
    id: SESSION_RESTART_EVENT,
    label: "[[icon=refresh]]",
  });
  assertEquals(buttons.help, { id: "help", label: "Help" });
  assertEquals(resolveSystemButtons({ exit: { label: "Up" } }).exit, {
    id: SESSION_EXIT_EVENT,
    label: "Up",
  });
  assertEquals(resolveSystemButtons(), DEFAULT_SYSTEM_BUTTONS);
  assertEquals(
    resolveSystemButtons({
      back: null,
      exit: null,
      new: null,
      fullscreen: null,
    }),
    {},
  );
});

Deno.test("system buttons reject malformed slots and actions", () => {
  for (
    const invalid of [
      [],
      null,
      { "bad slot": null },
      { help: {} },
      { help: { label: "" } },
      { exit: false },
      { exit: { id: "" } },
      { exit: { kind: "unknown" } },
    ]
  ) {
    assertThrows(
      () => resolveSystemButtons(invalid as unknown as SystemButtons),
      TypeError,
    );
  }
});

Deno.test("system button additions appear in headless screens and dispatch ordinary actions", async () => {
  const shown = Promise.withResolvers<PresentationSnapshot>();
  const unbind = bindSession({
    sessionId: "system-buttons",
    send: (message) => {
      if (
        !(message instanceof Uint8Array) && message.type === "presentation.show"
      ) shown.resolve(message.presentation);
    },
    receive: () => new Promise(() => {}),
  });
  try {
    const pending = callScreen({
      id: "buttons",
      model: new Model({}),
      schema: z.object({}),
      systemButtons: { help: { label: "Help" } },
    });
    void pending.catch(() => {});
    const presentation = await shown.promise;
    assertMatch(transcribe(presentation), /button: "?help"?/);
    await commandScreen({ op: "click", id: "help" }, 1);
    assertEquals((await pending).action, "help");
  } finally {
    unbind();
  }
});
