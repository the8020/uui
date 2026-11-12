import { t, table, type TableDatabase } from "/p/the8020/db/mod.ts";
import type { LayoutCollection } from "../list_layout.ts";

const ListLayouts = table("the8020__uui__list_layouts", {
  id: t.text().primaryKey(),
  listKey: t.text(),
  owner: t.text(),
  layouts: t.json<LayoutCollection>(),
}, { indexes: [{ columns: ["owner"] }] });

declare module "/p/the8020/db/types.ts" {
  interface Database extends TableDatabase<typeof ListLayouts> {}
}
export default ListLayouts;
