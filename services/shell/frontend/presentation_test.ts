import { assertEquals, assertThrows } from "@std/assert";
import { mergeServerModel, PresentationHistory } from "./presentation.ts";

Deno.test("presentation history stacks modals without replacing their prefix", () => {
  const history = new PresentationHistory();
  assertEquals(history.reconcile(["A"], 1), { removed: [] });
  assertEquals(history.reconcile(["A", "B"], 1), { removed: [] });
  assertEquals(history.reconcile(["A", "B", "C"], 1), { removed: [] });
  assertEquals(history.visible(), ["A", "B", "C"]);
  assertEquals(history.reconcile(["A", "B"], 1), { removed: ["C"] });
  assertEquals(history.reconcile(["A"], 1), { removed: ["B"] });
});

Deno.test("presentation history restores the exact obscured page composition", () => {
  const history = new PresentationHistory();
  history.reconcile(["A", "B", "C"], 1);
  assertEquals(history.reconcile(["D"], 2), { removed: [] });
  assertEquals(history.reconcile(["D", "E"], 2), { removed: [] });
  assertEquals(history.reconcile(["A", "B", "C"], 1), {
    removed: ["D", "E"],
  });
  assertEquals(history.visible(), ["A", "B", "C"]);
  assertEquals(history.reconcile(["A", "B"], 1), { removed: ["C"] });
});

Deno.test("presentation history drops skipped hidden frames deterministically", () => {
  const history = new PresentationHistory();
  history.reconcile(["A", "B", "C"], 1);
  history.reconcile(["D", "E"], 2);
  history.reconcile(["F"], 3);
  assertEquals(history.reconcile(["A"], 1), {
    removed: ["F", "D", "E", "B", "C"],
  });
  assertEquals(history.clear(), ["A"]);
  assertEquals(history.visible(), []);
});

Deno.test("presentation history rejects duplicate surface identity", () => {
  const history = new PresentationHistory();
  assertThrows(
    () => history.reconcile(["A", "A"], 1),
    TypeError,
    "duplicate",
  );
});

Deno.test("presentation history recognizes a restored page after reload", () => {
  const history = new PresentationHistory();
  history.reconcile(["D", "E"], 2);
  assertEquals(history.reconcile(["A", "B"], 1), {
    removed: ["D", "E"],
  });
  assertEquals(history.visible(), ["A", "B"]);
});

Deno.test("background redraw applies clean values and preserves dirty inputs", () => {
  const current = {
    contact: { email: "local@example.test", name: "Old name" },
    status: "old",
  };
  assertEquals(
    mergeServerModel(
      {
        contact: { email: "server@example.test", name: "New name" },
        status: "new",
      },
      current,
      ["contact.email"],
    ),
    {
      contact: { email: "local@example.test", name: "New name" },
      status: "new",
    },
  );
});
