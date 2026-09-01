import { assertEquals } from "@std/assert";
import { parseIconText } from "./icon_text.ts";

Deno.test("icon text parses vendored names and safe semantic or hex colors", () => {
  assertEquals(
    parseIconText(
      "Before [[icon=edit color=success]] and [[icon=save color=#3A7]] after",
    ),
    [
      { type: "text", text: "Before " },
      { type: "icon", name: "edit", color: "success" },
      { type: "text", text: " and " },
      { type: "icon", name: "save", color: "#3A7" },
      { type: "text", text: " after" },
    ],
  );
});

Deno.test("icon text leaves unknown names and unsafe colors visible", () => {
  assertEquals(
    parseIconText(
      "[[icon=delete]] [[icon=edit color=purple]] [[icon=edit color=url(x)]]",
    ),
    [{
      type: "text",
      text:
        "[[icon=delete]] [[icon=edit color=purple]] [[icon=edit color=url(x)]]",
    }],
  );
});

Deno.test("icon text supports icon-only and adjacent placeholders", () => {
  assertEquals(parseIconText("[[icon=arrow_back]]"), [
    { type: "icon", name: "arrow_back" },
  ]);
  assertEquals(
    parseIconText("[[icon=light_mode]][[icon=dark_mode]][[icon=menu]]"),
    [
      { type: "icon", name: "light_mode" },
      { type: "icon", name: "dark_mode" },
      { type: "icon", name: "menu" },
    ],
  );
});
