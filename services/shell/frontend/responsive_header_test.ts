import { assertEquals } from "@std/assert";
import {
  fittingHeaderItemCount,
  horizontalPopoverShift,
} from "./responsive_header.ts";

Deno.test("responsive header keeps a stable prefix and overflows the remainder", () => {
  assertEquals(fittingHeaderItemCount([], 500, 32, 8), 0);
  assertEquals(fittingHeaderItemCount([100, 120, 80], 316, 32, 8), 3);
  assertEquals(fittingHeaderItemCount([100, 120, 80], 260, 32, 8), 1);
  assertEquals(fittingHeaderItemCount([300, 80], 240, 32, 8), 0);
  assertEquals(fittingHeaderItemCount([100, 100], 0, 32, 8), 0);
});

Deno.test("responsive header removes items from the right as width shrinks", () => {
  const widths = [70, 80, 90];
  assertEquals(fittingHeaderItemCount(widths, 260, 34, 8), 3);
  assertEquals(fittingHeaderItemCount(widths, 250, 34, 8), 2);
  assertEquals(fittingHeaderItemCount(widths, 190, 34, 8), 1);
  assertEquals(fittingHeaderItemCount(widths, 80, 34, 8), 0);
});

Deno.test("header popover keeps a viewport edge gutter", () => {
  assertEquals(horizontalPopoverShift(-4, 192, 390, 10), 14);
  assertEquals(horizontalPopoverShift(10, 192, 390, 10), 0);
  assertEquals(horizontalPopoverShift(100, 192, 390, 10), 0);
  assertEquals(horizontalPopoverShift(250, 192, 390, 10), -62);
  assertEquals(horizontalPopoverShift(0, 370, 390, 10), 10);
});
