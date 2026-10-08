import { assertEquals, assertThrows } from "@std/assert";
import { MessageHistory, parseMessage } from "./messages.ts";

Deno.test("accepted message history validates, bounds and preserves outcomes during an interaction", () => {
  const history = new MessageHistory();
  for (let index = 1; index <= 105; index++) {
    history.add(`Message ${index}`, "info");
  }
  assertEquals(history.snapshot().length, 100);
  assertEquals(history.snapshot()[0]?.sequence, 6);
  const through = history.sequence;
  history.add("Async outcome", "success");
  history.clear(through);
  assertEquals(history.snapshot(), [{
    sequence: 106,
    level: "success",
    message: "Async outcome",
  }]);
  const snapshot = history.snapshot();
  assertThrows(() => history.add(" ", "info"), TypeError);
  assertThrows(() => history.add("x".repeat(20_001), "info"), TypeError);
  assertThrows(() => history.add("bad", "fatal" as never), TypeError);
  assertThrows(
    () => parseMessage({ sequence: 0, message: "bad", level: "info" }),
    TypeError,
  );
  assertEquals(history.snapshot(), snapshot);
});
