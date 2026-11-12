import {
  emptyLayouts,
  type LayoutCatalog,
  parseLayoutCollection,
  parseLayoutCommand,
} from "./list_layout.ts";

export const GLOBAL_LAYOUT_PERMISSION = "the8020.uui.layouts.global.edit";

async function user(): Promise<string> {
  const { currentUser } = await import("/p/the8020/users/mod.ts");
  const username = currentUser()?.username;
  if (!username) throw new Error("Sign in to save list layouts.");
  return username;
}
function key(listKey: string, owner: string): string {
  if (!listKey.length || listKey.length > 1500) {
    throw new TypeError("Invalid list identity");
  }
  return JSON.stringify([listKey, owner]);
}

/** The caller supplies a server-owned list identity; users and ownership never come from the client. */
export async function listLayoutCommand(
  listKey: string,
  input: unknown,
): Promise<LayoutCatalog> {
  const username = await user();
  const { requirePermission, verify } = await import("/p/the8020/auth/mod.ts");
  const { db, transaction } = await import("/p/the8020/db/mod.ts");
  const { default: ListLayouts } = await import("./tables/list_layouts.ts");
  const command = parseLayoutCommand(input);
  key(listKey, username);
  if (command.operation !== "list") {
    if (command.global) {
      await requirePermission(GLOBAL_LAYOUT_PERMISSION, listKey);
    }
    const owner = command.global ? "" : username;
    const id = key(listKey, owner);
    await transaction({}, async (tx) => {
      await tx.insertInto(ListLayouts.table).values({
        id,
        listKey,
        owner,
        layouts: emptyLayouts(),
      })
        .onConflict((c) => c.column("id").doNothing()).execute();
      // Lock this owner/list row before read-modify-write on both supported engines.
      await tx.updateTable(ListLayouts.table).set({ owner }).where(
        "id",
        "=",
        id,
      ).execute();
      const row = await tx.selectFrom(ListLayouts.table).selectAll().where(
        "id",
        "=",
        id,
      ).executeTakeFirstOrThrow();
      const layouts = parseLayoutCollection(row.layouts);
      if (command.operation === "save") {
        if (
          !Object.hasOwn(layouts.variants, command.name) &&
          Object.keys(layouts.variants).length >= 50
        ) {
          throw new RangeError("A list can have at most 50 layouts per owner.");
        }
        layouts.variants[command.name] = command.layout;
      } else if (command.operation === "delete") {
        delete layouts.variants[command.name];
        if (layouts.defaultName === command.name) layouts.defaultName = null;
      } else {
        if (
          command.name !== null &&
          !Object.hasOwn(layouts.variants, command.name)
        ) throw new TypeError("Unknown layout");
        layouts.defaultName = command.name;
      }
      await tx.updateTable(ListLayouts.table).set({ layouts }).where(
        "id",
        "=",
        id,
      ).execute();
    });
  }
  const rows = await db.selectFrom(ListLayouts.table).selectAll()
    .where("id", "in", [key(listKey, username), key(listKey, "")]).limit(2)
    .execute();
  const read = (owner: string) => {
    const value = rows.find((row) => row.owner === owner)?.layouts;
    if (value === undefined) return emptyLayouts();
    try {
      return parseLayoutCollection(value);
    } catch {
      return emptyLayouts();
    }
  };
  return {
    personal: read(username),
    global: read(""),
    canManageGlobal: await verify(username, GLOBAL_LAYOUT_PERMISSION, listKey),
  };
}
