import { assertEquals } from "@std/assert";
import { listColumnWidths, listRowCapacity } from "./list_geometry.ts";

Deno.test("list capacity only budgets pagination when the source needs it", () => {
  // Exactly ten rows fit without a footer; reserving it would create a page
  // solely to hold that footer and could oscillate on each resize observation.
  assertEquals(listRowCapacity(521, 64, 0, 73, 36, 10, 46), 10);
  assertEquals(listRowCapacity(521, 64, 0, 73, 36, 11, 46), 8);
  assertEquals(listRowCapacity(521, 64, 0, 73, 36, 0, 46), 10);
});

Deno.test("list data columns use the full viewport without a tools column", () => {
  assertEquals(listColumnWidths(["compact", "long"], 500.75), [58, 442.75]);
  assertEquals(listColumnWidths(["compact", "compact"], 300), [150, 150]);
  assertEquals(listColumnWidths(["short"], 320), [320]);
});

Deno.test("list columns retain readable minimum widths in narrow viewports", () => {
  assertEquals(listColumnWidths(["compact", "long"], 200), [58, 260]);
  assertEquals(listColumnWidths(["compact", "long"], 318), [58, 260]);
});
