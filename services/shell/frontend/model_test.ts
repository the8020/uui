import { assertEquals, assertThrows } from "@std/assert";
import {
  DirtyBindings,
  getPath,
  paginationItems,
  reconnectDelay,
  setPath,
  shouldAcceptServerMessage,
  shouldReconnectWebSocket,
  shouldRenderMessage,
  synchronizeClientSequence,
} from "./model.ts";

Deno.test("frontend model binding and reconnect decisions are deterministic", () => {
  const model = { selected: { email: "old@example.com" } };
  assertEquals(getPath(model, "selected.email"), "old@example.com");
  setPath(model, "selected.email", "new@example.com");
  assertEquals(model.selected.email, "new@example.com");
  assertThrows(() => setPath(model, "missing.value", "x"), TypeError);
  assertEquals(shouldRenderMessage("session.resumed"), false);
  assertEquals(shouldRenderMessage("screen.show"), true);
  assertEquals(reconnectDelay(0, 250, 10_000), 250);
  assertEquals(reconnectDelay(10, 250, 10_000), 10_000);
  assertEquals(shouldReconnectWebSocket(false, 1006), true);
  assertEquals(shouldReconnectWebSocket(false, 1000), false);
  assertEquals(shouldReconnectWebSocket(true, 1006), false);
  assertEquals(synchronizeClientSequence(0, 18), 18);
  assertEquals(synchronizeClientSequence(20, 18), 20);
  assertEquals(shouldAcceptServerMessage("screen.show", 5, 4), true);
  assertEquals(shouldAcceptServerMessage("screen.show", 4, 4), false);
  assertEquals(shouldAcceptServerMessage("session.end", 0, 42), true);
});

Deno.test("pagination keeps page-number controls bounded and contextual", () => {
  assertEquals(paginationItems(1, 1), [1]);
  assertEquals(paginationItems(4, 7), [1, 2, 3, 4, 5, 6, 7]);
  assertEquals(paginationItems(1, 20), [1, 2, 3, 4, 5, "ellipsis", 20]);
  assertEquals(paginationItems(10, 20), [
    1,
    "ellipsis",
    9,
    10,
    11,
    "ellipsis",
    20,
  ]);
  assertEquals(paginationItems(20, 20), [
    1,
    "ellipsis",
    16,
    17,
    18,
    19,
    20,
  ]);
});

Deno.test("acknowledgements clear only edits included in the acknowledged event", () => {
  const dirty = new DirtyBindings();
  dirty.mark("email");
  const submitted = dirty.capture();
  dirty.mark("email");
  dirty.mark("biography");

  dirty.acknowledge(submitted);
  assertEquals(dirty.bindings(), ["email", "biography"]);

  dirty.acknowledge(dirty.capture());
  assertEquals(dirty.bindings(), []);
});
