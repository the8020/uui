import { assertEquals } from "@std/assert";
import {
  fieldMessageIsOverflowing,
  fieldMessagePopoverPosition,
} from "./field_message.ts";

Deno.test("field messages become interactive only when text is truncated", () => {
  assertEquals(fieldMessageIsOverflowing(160, 160), false);
  assertEquals(fieldMessageIsOverflowing(160, 160.4), false);
  assertEquals(fieldMessageIsOverflowing(160, 161), true);
  assertEquals(fieldMessageIsOverflowing(0, 200), false);
});

Deno.test("field message popovers stay beside their hint and inside the viewport", () => {
  assertEquals(
    fieldMessagePopoverPosition(
      { top: 100, bottom: 114, left: 120 },
      240,
      80,
      800,
      600,
    ),
    { top: 120, left: 120 },
  );
  assertEquals(
    fieldMessagePopoverPosition(
      { top: 550, bottom: 564, left: 750 },
      240,
      80,
      800,
      600,
    ),
    { top: 464, left: 550 },
  );
  assertEquals(
    fieldMessagePopoverPosition(
      { top: 5, bottom: 19, left: -20 },
      780,
      590,
      800,
      600,
    ),
    { top: 10, left: 10 },
  );
});
