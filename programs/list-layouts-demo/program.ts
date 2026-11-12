import { BACK_EVENT, callScreen, field, Model, z } from "../../mod.ts";
import { msg } from "../../i18n/messages.ts";

const row = z.object({
  selected: z.boolean(),
  id: field(z.number(), { label: msg("layouts.id") }),
  name: field(z.string(), { label: msg("layouts.item") }),
  region: field(z.enum(["Europe", "Americas", "Asia"]), {
    label: msg("layouts.region"),
  }),
  amount: field(z.number(), { label: msg("layouts.amount") }),
  active: field(z.boolean(), { label: msg("layouts.active") }),
});
const schema = z.object({ orders: row.array(), deliveries: row.array() });

export default async function demo(): Promise<void> {
  const rows = (prefix: string) =>
    Array.from({ length: 60 }, (_, i) => ({
      selected: false,
      id: i + 1,
      name: `${prefix} ${i + 1}`,
      region: ["Europe", "Americas", "Asia"][i % 3] as "Europe",
      amount: (i + 1) * 125,
      active: i % 3 !== 0,
    }));
  const model = new Model({
    orders: rows("Order"),
    deliveries: rows("Delivery"),
  });
  while (true) {
    const event = await callScreen({
      id: "list-layouts-demo",
      title: msg("layouts.demo"),
      model,
      schema,
      controls: [{ id: "orders", bind: "orders", readOnly: true }, {
        id: "deliveries",
        bind: "deliveries",
        readOnly: true,
      }],
      layout: {
        schema: 1,
        id: "list-layouts-demo",
        root: {
          type: "stack",
          children: [
            {
              type: "list",
              id: "order-list",
              title: msg("layouts.orders"),
              bind: "orders",
              selection: "selected",
              toolbar: [{ id: "refresh", label: msg("program.refresh") }],
            },
            {
              type: "list",
              id: "delivery-list",
              title: msg("layouts.deliveries"),
              bind: "deliveries",
              selection: "selected",
            },
          ],
        },
      },
    });
    if (event.action === BACK_EVENT) return;
    if (event.action === "refresh") {
      model.data.orders = model.data.orders.map((row) => ({ ...row }));
      model.data.deliveries = model.data.deliveries.map((row) => ({ ...row }));
    }
  }
}
