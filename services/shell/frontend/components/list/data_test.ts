import { assertEquals, assertRejects } from "@std/assert";
import type { ListColumn } from "../../../../../screen_state.ts";
import {
  clipboardHTML,
  delimited,
  ListDataChannel,
  listMatrix,
  textExport,
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

Deno.test("list data channel correlates responses and rejects on disconnect", async () => {
  const completed: number[] = [];
  const channel = new ListDataChannel((sequence) => completed.push(sequence));
  const pending = channel.request(() => 7);
  const data = { id: "list", revision: 1, offset: 0, rows: [1], more: false };
  channel.receive({
    type: "screen.list.data",
    protocol: 8,
    serverSequence: 2,
    surfaceId: "surface",
    clientSequence: 6,
    data,
  });
  assertEquals(completed, []);
  channel.receive({
    type: "screen.list.data",
    protocol: 8,
    serverSequence: 3,
    surfaceId: "surface",
    clientSequence: 7,
    data,
  });
  assertEquals(await pending, data);
  const failed = channel.request(() => 8);
  channel.fail("Disconnected");
  await assertRejects(() => failed, Error, "Disconnected");
  assertEquals(completed, [7, 8]);
  const controller = new AbortController();
  const cancelled = channel.request(() => 9, controller.signal);
  controller.abort();
  await assertRejects(() => cancelled, DOMException, "List action closed");
  assertEquals(completed, [7, 8, 9]);
});
