import { assert, assertEquals } from "@std/assert";
import { MATERIAL_ICONS, parseIconText } from "./icon_text.ts";

Deno.test("icon text parses vendored names and safe semantic or hex colors", () => {
  assertEquals(
    parseIconText(
      "Before [[icon=edit color=success]] and [[icon=error color=error]] and [[icon=save color=#3A7]] after",
    ),
    [
      { type: "text", text: "Before " },
      { type: "icon", name: "edit", color: "success" },
      { type: "text", text: " and " },
      { type: "icon", name: "error", color: "error" },
      { type: "text", text: " and " },
      { type: "icon", name: "save", color: "#3A7" },
      { type: "text", text: " after" },
    ],
  );
});

Deno.test("icon text leaves unknown names and unsafe colors visible", () => {
  assertEquals(
    parseIconText(
      "[[icon=not_a_material_icon]] [[icon=edit color=purple]] [[icon=edit color=url(x)]]",
    ),
    [{
      type: "text",
      text:
        "[[icon=not_a_material_icon]] [[icon=edit color=purple]] [[icon=edit color=url(x)]]",
    }],
  );
});

Deno.test("every icon name in the complete font catalogue is usable by programs", () => {
  assert(Object.keys(MATERIAL_ICONS).length > 4000);
  for (const [name, codepoint] of Object.entries(MATERIAL_ICONS)) {
    assert(Number.isInteger(codepoint) && codepoint >= 0xe000);
    assertEquals<unknown>(parseIconText(`[[icon=${name}]]`), [{
      type: "icon",
      name,
    }]);
  }
  for (
    const name of [
      "delete",
      "chevron_right",
      "rocket_launch",
      "10k",
      "6_ft_apart",
    ]
  ) {
    assert(Object.hasOwn(MATERIAL_ICONS, name));
  }
});

Deno.test("icon text supports icon-only and adjacent placeholders", () => {
  assertEquals(parseIconText("[[icon=arrow_back]]"), [
    { type: "icon", name: "arrow_back" },
  ]);
  assertEquals(
    parseIconText(
      "[[icon=light_mode]][[icon=dark_mode]][[icon=menu]][[icon=close]][[icon=logout]][[icon=tab_close]]",
    ),
    [
      { type: "icon", name: "light_mode" },
      { type: "icon", name: "dark_mode" },
      { type: "icon", name: "menu" },
      { type: "icon", name: "close" },
      { type: "icon", name: "logout" },
      { type: "icon", name: "tab_close" },
    ],
  );
});
