import { assertEquals } from "@std/assert";
import { compareListValues, matchesListFilter } from "./list_values.ts";

Deno.test("column semantics distinguish numbers, text, booleans, dates, and empty values", () => {
  assertEquals(compareListValues(9, 10, "number"), -1);
  assertEquals(compareListValues("9", "10", "text"), 1);
  assertEquals(compareListValues("ALPHA", "alpha", "text"), 0);
  assertEquals(compareListValues(null, "", "text"), 0);
  assertEquals(compareListValues(null, 0, "number"), -1);
  assertEquals(compareListValues(false, true, "boolean"), -1);
  assertEquals(compareListValues("2026-09-01", "2026-09-02", "date"), -1);
  for (const value of [null, undefined, ""]) {
    assertEquals(matchesListFilter(value, "is:empty", "text"), true);
  }
  assertEquals(matchesListFilter("", "is:null", "text"), false);
  assertEquals(matchesListFilter(0, "is:not-empty", "number"), true);
  assertEquals(
    matchesListFilter("Created 2026-09-05", ">2026-09-01", "text"),
    false,
  );
  assertEquals(matchesListFilter("Alpha beta", "BETA", "text"), true);
  for (const operand of ["= 10", ">=10", "<11", "!=9"]) {
    assertEquals(matchesListFilter(10, operand, "number"), true);
  }
  for (const operand of ["10abc", "Infinity", "0xA"]) {
    assertEquals(matchesListFilter(10, operand, "number"), false);
  }
  assertEquals(matchesListFilter(true, "yes", "boolean"), true);
  assertEquals(matchesListFilter(false, "0", "boolean"), true);
  assertEquals(matchesListFilter(false, "maybe", "boolean"), false);
  assertEquals(
    matchesListFilter(
      new Date("2026-09-05T17:12:00Z"),
      "2026-09-05",
      "datetime",
    ),
    true,
  );
  assertEquals(
    matchesListFilter("2026-09-05T23:00:00Z", "<2026-09-06", "datetime"),
    true,
  );
  assertEquals(matchesListFilter("2026-09-05", "tomorrow", "date"), false);
});

Deno.test("decimal lists sort and filter exact amounts beyond floating-point precision", () => {
  assertEquals(compareListValues("9.00", "10.00", "decimal"), -1);
  assertEquals(compareListValues("-9.00", "-10.00", "decimal"), 1);
  assertEquals(
    compareListValues("90071992547409.91", "90071992547409.92", "decimal"),
    -1,
  );
  assertEquals(compareListValues("0.1", "0.10", "decimal"), 0);
  assertEquals(compareListValues(null, "0.00", "decimal"), -1);
  assertEquals(
    matchesListFilter("90071992547409.92", ">90071992547409.91", "decimal"),
    true,
  );
  assertEquals(
    matchesListFilter("90071992547409.91", "=90071992547409.92", "decimal"),
    false,
  );
  assertEquals(matchesListFilter("10.00", "=10", "decimal"), true);
  assertEquals(matchesListFilter("-0.25", "<-0.2", "decimal"), true);
  assertEquals(matchesListFilter("0.00", "is:not-empty", "decimal"), true);
  for (const value of ["1e2", "NaN", "Infinity", "1abc"]) {
    assertEquals(matchesListFilter("10.00", value, "decimal"), false);
  }
});
