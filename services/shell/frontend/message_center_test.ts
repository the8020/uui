import { assertEquals } from "@std/assert";
import {
  MAX_RENDERED_MESSAGES,
  MAX_RETAINED_MESSAGES,
  MessageCollection,
  type PresentedMessage,
} from "./message_center.ts";

Deno.test("message collection keeps only the last 10 toasts and 100 messages", () => {
  const messages = new MessageCollection();
  for (let sequence = 1; sequence <= 105; sequence++) {
    messages.add(message(sequence));
  }
  assertEquals(messages.visible().length, MAX_RENDERED_MESSAGES);
  assertEquals(messages.visible()[0]?.sequence, 96);
  assertEquals(messages.visible().at(-1)?.sequence, 105);
  assertEquals(messages.history().length, MAX_RETAINED_MESSAGES);
  assertEquals(messages.history()[0]?.sequence, 6);
  assertEquals(messages.history().at(-1)?.sequence, 105);
});

Deno.test("message collection deduplicates, archives toasts, and clears a roundtrip", () => {
  const messages = new MessageCollection();
  assertEquals(messages.add(message(1))?.removedVisibleIDs, []);
  assertEquals(messages.add(message(1)), undefined);
  assertEquals(messages.dismissVisible("session:1"), true);
  assertEquals(messages.visible(), []);
  assertEquals(messages.history().map((item) => item.sequence), [1]);
  messages.add(message(2));
  messages.add(message(3));
  assertEquals(messages.dismissAllVisible(), ["session:2", "session:3"]);
  assertEquals(messages.visible(), []);
  assertEquals(messages.history().map((item) => item.sequence), [1, 2, 3]);
  messages.clear();
  assertEquals(messages.visible(), []);
  assertEquals(messages.history(), []);
});

function message(sequence: number): PresentedMessage {
  return {
    id: `session:${sequence}`,
    sequence,
    kind: "info",
    body: `Message ${sequence}`,
    receivedAt: sequence,
  };
}
