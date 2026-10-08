import { assertEquals, assertThrows } from "@std/assert";
import type { ListColumn } from "../../../../../screen_state.ts";
import {
  clipboardHTML,
  delimited,
  listMatrix,
  textExport,
  validListDataPage,
} from "./data.ts";

Deno.test("list exports retain displayed columns, exact text and table quoting", () => {
  const columns: ListColumn[] = [
    {
      id: "name",
      key: "nested.name",
      heading: "Name",
      length: "medium",
      semanticType: "text",
    },
    {
      id: "money",
      key: "amount",
      heading: "Amount",
      length: "short",
      semanticType: "decimal",
    },
  ];
  const rows = listMatrix(columns, [{
    nested: { name: 'A\t"B"\n<&>' },
    amount: "9007199254740993.01",
    secret: "hidden",
  }]);
  assertEquals(rows, [['A\t"B"\n<&>', "9007199254740993.01"]]);
  assertEquals(delimited(rows, "\t"), '"A\t""B""\n<&>"\t9007199254740993.01');
  assertEquals(delimited([["=1+1", -2, null]], ","), "'=1+1,-2,");
  assertEquals(JSON.parse(textExport("json", columns, rows)), [{
    "nested.name": 'A\t"B"\n<&>',
    amount: "9007199254740993.01",
  }]);
  assertEquals(
    textExport("yaml", columns, rows),
    '- "nested.name": "A\\t\\"B\\"\\n<&>"\n  "amount": "9007199254740993.01"\n',
  );
  assertEquals(textExport("yaml", columns, []), "[]\n");
  assertEquals(
    textExport("xml", columns, [["<&>", null]]),
    '<?xml version="1.0" encoding="UTF-8"?>\n<rows>\n  <row><cell name="nested.name">&lt;&amp;&gt;</cell><cell name="amount" null="true"></cell></row>\n</rows>\n',
  );
  assertEquals(clipboardHTML([["<script>"]]).includes("<script>"), false);
  assertEquals(
    textExport("csv", columns, []).startsWith("\uFEFFName,Amount"),
    true,
  );
});

Deno.test("list read results match the requested view and range", () => {
  const request = { id: "rows", revision: 2, offset: 10, limit: 1 };
  const page = {
    id: "rows",
    revision: 2,
    offset: 10,
    rows: ["row"],
    more: false,
  };
  assertEquals(validListDataPage(page, request), page);
  for (
    const invalid of [{ ...page, revision: 1 }, { ...page, offset: 0 }, {
      ...page,
      rows: [1, 2],
    }, { ...page, rows: [], more: true }]
  ) {
    assertThrows(() => validListDataPage(invalid, request), TypeError);
  }
});
