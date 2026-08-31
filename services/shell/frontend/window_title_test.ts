import { assertEquals } from "@std/assert";
import { GENERIC_WINDOW_TITLE, windowTitleForHeading } from "./window_title.ts";

Deno.test("window title follows a normalized page heading with a generic fallback", () => {
  assertEquals(
    windowTitleForHeading("Sandbox sbx-ab12cd34"),
    "80|20 Sandbox sbx-ab12cd34",
  );
  assertEquals(
    windowTitleForHeading("  Form\n and   binding  "),
    "80|20 Form and binding",
  );
  assertEquals(windowTitleForHeading(""), GENERIC_WINDOW_TITLE);
  assertEquals(windowTitleForHeading(null), GENERIC_WINDOW_TITLE);
  assertEquals(windowTitleForHeading(undefined), GENERIC_WINDOW_TITLE);
});
