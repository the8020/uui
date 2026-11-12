import { BACK_EVENT, callScreen, field, Model, z } from "../../mod.ts";
import { db, transaction, whereSelection } from "/p/the8020/db/mod.ts";
import { type Selection } from "/p/the8020/db/selection.ts";
import Records, {
  selectionDemoRow as row,
} from "../../tables/selection_demo.ts";
import { msg } from "../../i18n/messages.ts";

const schema = z.object({
  ids: field(row.shape.id, { selection: true, length: "full" }),
  names: field(row.shape.name, { selection: true, length: "full" }),
  regions: field(row.shape.region, { selection: true }),
  amounts: field(row.shape.amount, { selection: true }),
  rows: row.array(),
});

export default async function report(): Promise<void> {
  if (!await Records.select(["id"]).limit(1).executeTakeFirst()) {
    await transaction({}, async (tx) => {
      for (let offset = 0; offset < 6000; offset += 100) {
        await tx.insertInto("the8020__uui__selection_demo").values(
          Array.from({ length: 100 }, (_, index) => {
            const id = offset + index + 1;
            return {
              id,
              name: `Order ${String(id).padStart(4, "0")}`,
              region: (["Europe", "Americas", "Asia"] as const)[(id - 1) % 3]!,
              amount: id * 125,
              active: id % 3 !== 0,
            };
          }),
        ).onConflict((conflict) => conflict.column("id").doNothing()).execute();
      }
    });
  }
  const model = new Model<z.output<typeof schema>>({
    ids: [],
    names: [],
    regions: [],
    amounts: [],
    rows: [],
  });
  const execute = async () => {
    let query = db.selectFrom("the8020__uui__selection_demo as records")
      .selectAll();
    query = whereSelection(query, "records.id", row.shape.id, model.data.ids);
    query = whereSelection(
      query,
      "records.name",
      row.shape.name,
      model.data.names,
    );
    query = whereSelection(
      query,
      "records.region",
      row.shape.region,
      model.data.regions,
    );
    query = whereSelection(
      query,
      "records.amount",
      row.shape.amount,
      model.data.amounts,
    );
    model.data.rows = await query.orderBy("records.id").execute();
  };
  await execute();
  while (true) {
    const event = await callScreen({
      id: "selection-demo",
      title: msg("selection.title"),
      schema,
      model,
      controls: [{ bind: "ids" }, { bind: "names" }, { bind: "regions" }, {
        bind: "amounts",
      }, { bind: "rows", readOnly: true }],
      header: {
        actions: [
          { id: "execute", label: msg("selection.execute"), kind: "primary" },
          { id: "examples", label: msg("selection.examples") },
          { id: "large", label: msg("selection.large") },
          { id: "clear", label: msg("selection.clear") },
        ],
      },
      layout: {
        schema: 1,
        id: "selection-demo",
        root: {
          type: "stack",
          children: [
            {
              type: "field-group",
              controls: ["ids", "names", "regions", "amounts"],
            },
            {
              type: "list",
              id: "results",
              bind: "rows",
              title: msg("layouts.orders"),
            },
          ],
        },
      },
    });
    if (event.action === BACK_EVENT) return;
    if (
      event.action === "clear" || event.action === "examples" ||
      event.action === "large"
    ) {
      model.data.ids = [];
      model.data.names = [];
      model.data.regions = [];
      model.data.amounts = [];
    }
    if (event.action === "examples") {
      model.data.ids = [{ sign: "I", option: "EQ", low: 1 }, {
        sign: "I",
        option: "BT",
        low: 10,
        high: 30,
      }, { sign: "E", option: "EQ", low: 15 }];
      model.data.names = [{ sign: "I", option: "CP", low: "Order 00*" }];
      model.data.amounts = [{ sign: "I", option: "GE", low: 1250 }];
    }
    if (event.action === "large") {
      model.data.ids = Array.from(
        { length: 5000 },
        (_, index): Selection<number> => ({
          sign: "I",
          option: "EQ",
          low: index + 1,
        }),
      );
    }
    await execute();
  }
}
