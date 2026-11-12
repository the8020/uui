import { assertEquals, assertThrows } from "@std/assert";
import { field as semanticField, z } from "/p/the8020/db/fields.ts";
import { type Selection, selectionElement } from "/p/the8020/db/selection.ts";
import { buildControls, buildFieldCatalog, field } from "./fields.ts";
import { valueHelpFor } from "./field_help.ts";
import {
  selectionInputValue,
  selectionLabel,
} from "./services/shell/frontend/selection.ts";

Deno.test("selection opt-in preserves a provider declared on the same field", () => {
  const provider = () => ({
    schema: z.object({ value: z.string() }),
    rows: [{ value: "one" }],
    more: false,
  });
  for (const selection of [false, true]) {
    const schema = field(z.string(), { selection, valueHelp: provider });
    const control = buildControls(
      buildFieldCatalog(z.object({ value: schema })),
    )[0]!;
    assertEquals(valueHelpFor(schema.optional(), control), provider);
  }
});

Deno.test("opt-in selections retain scalar meaning/help and validate binding without changing scalar callers", async () => {
  const source = semanticField(z.number().int().min(1), {
    label: "Order",
    description: "An order number",
    valueHelp: () => ({
      schema: z.object({ id: z.number() }),
      rows: [{ id: 2 }],
      more: false,
    }),
  });
  const selected = field(source, { selection: true });
  const value: Selection<number>[] = selected.parse([{
    sign: "I",
    option: "BT",
    low: 1,
    high: 3,
  }]);
  assertEquals(value[0]!.high, 3);
  assertThrows(() => selected.parse([{ sign: "I", option: "EQ", low: 0 }]));
  const controls = buildControls(
    buildFieldCatalog(
      z.object({
        scalar: field(source, { readOnly: true }),
        selections: selected,
      }),
    ),
  );
  assertEquals(
    controls.map((control) => [control.bind, control.control, control.label]),
    [["scalar", "number", "Order"], ["selections", "selection", "Order"]],
  );
  assertEquals(selectionElement(selected.optional()), source);
  assertEquals(source.parse(2), 2);
  assertThrows(() => source.parse(value));
  const help = valueHelpFor(selected, controls[1]!)!;
  assertEquals(
    (await help({
      query: { search: "", filters: {}, sort: null },
      offset: 0,
      limit: 1,
    })).rows,
    [{ id: 2 }],
  );
  assertEquals(
    buildFieldCatalog(
      z.object({ value: field(source.readonly(), { selection: true }) }),
    )[0]!.readOnly,
    true,
  );
  const slider = field(z.number(), {
    control: "range",
    minimum: 0,
    maximum: 100,
  });
  assertEquals(
    buildControls(
      buildFieldCatalog(
        z.object({ values: field(slider, { selection: true }) }),
      ),
    )[0]!.control,
    "selection",
  );
  assertEquals(
    buildFieldCatalog(z.object({ scalar: slider }))[0]!.control,
    "range",
  );
});

Deno.test("inline selection entry retains semantic primitives and invalid drafts for server validation", () => {
  assertEquals(selectionInputValue("42", "number"), 42);
  assertEquals(selectionInputValue("invalid", "number"), "invalid");
  assertEquals(selectionInputValue("Infinity", "number"), "Infinity");
  assertEquals(selectionInputValue("true", "boolean"), true);
  assertEquals(selectionInputValue("FALSE", "boolean"), false);
  assertEquals(selectionInputValue("invalid", "boolean"), "invalid");
  assertEquals(selectionInputValue("0001.20", undefined), "0001.20");
  assertEquals(selectionInputValue("  a,b  ", undefined), "  a,b  ");
  const controls = buildFieldCatalog(z.object({
    number: field(z.number(), { selection: true }),
    boolean: field(z.boolean(), { selection: true }).optional(),
    text: field(z.string(), { selection: true }),
  }));
  assertEquals(
    Object.fromEntries(
      controls.map((control) => [control.bind, control.selectionType]),
    ),
    { number: "number", boolean: "boolean", text: undefined },
  );
});

Deno.test("selection tokens describe operators and signs without backend codes", () => {
  assertEquals(
    selectionLabel({ sign: "I", option: "EQ", low: 10 }),
    "Include · Equals 10",
  );
  assertEquals(
    selectionLabel({ sign: "E", option: "NE", low: 20 }),
    "Exclude · Does not equal 20",
  );
  assertEquals(
    selectionLabel({ sign: "I", option: "BT", low: 10, high: 30 }),
    "Include · Between 10 … 30",
  );
});
