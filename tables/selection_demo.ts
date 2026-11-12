import {
  columns,
  field,
  t,
  table,
  type TableDatabase,
  z,
} from "/p/the8020/db/mod.ts";
import { msg } from "../i18n/messages.ts";
import type { ValueHelpPage } from "/p/the8020/db/fields.ts";

const name = field(z.string(), { label: msg("layouts.item") });
const region = field(z.enum(["Europe", "Americas", "Asia"]), {
  label: msg("layouts.region"),
});
export const selectionDemoRow = z.object({
  id: field(z.number().int(), { label: msg("layouts.id") }),
  name: field(name, {
    valueHelp: async (request): Promise<ValueHelpPage> => {
      const { lookupPage } = await import("/p/the8020/db/lookup.ts");
      return lookupPage(
        z.object({ name, region }),
        Records.select(["name", "region"]),
        request,
      );
    },
  }),
  region,
  amount: field(z.number(), { label: msg("layouts.amount") }),
  active: field(z.boolean(), { label: msg("layouts.active") }),
});
const Records = table("the8020__uui__selection_demo", {
  ...columns(selectionDemoRow),
  id: t.from(selectionDemoRow.shape.id).primaryKey(),
});
declare module "/p/the8020/db/types.ts" {
  interface Database extends TableDatabase<typeof Records> {}
}
export default Records;
