import { t, table, type TableDatabase } from "/p/the8020/db/mod.ts";
import { serverTitle } from "../src/branding_fields.ts";

const Branding = table("the8020__uui__branding", {
  id: t.integer().primaryKey(),
  title: t.from(serverTitle),
  revision: t.text(),
  favicon: t.bytes().nullable(),
  social: t.bytes().nullable(),
});

declare module "/p/the8020/db/types.ts" {
  interface Database extends TableDatabase<typeof Branding> {}
}

export default Branding;
