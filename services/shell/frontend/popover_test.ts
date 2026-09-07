import { assertEquals } from "@std/assert";
import { popoverPosition } from "./popover.ts";

Deno.test("overflow popovers expand below and left of their right-edge button", () => {
  assertEquals(
    popoverPosition(
      { top: 100, bottom: 135, left: 480, right: 500 },
      240,
      80,
      800,
      600,
    ),
    { top: 141, left: 260 },
  );
  assertEquals(
    popoverPosition(
      { top: 100, bottom: 135, left: 120, right: 140 },
      240,
      80,
      800,
      600,
      "start",
    ),
    { top: 141, left: 120 },
  );
});

Deno.test("popovers flip above near the bottom and stay inside narrow viewports", () => {
  assertEquals(
    popoverPosition(
      { top: 550, bottom: 564, left: 750, right: 770 },
      240,
      80,
      800,
      600,
    ),
    { top: 464, left: 530 },
  );
  assertEquals(
    popoverPosition(
      { top: 5, bottom: 19, left: 12, right: 30 },
      370,
      580,
      390,
      600,
    ),
    { top: 10, left: 10 },
  );
});
