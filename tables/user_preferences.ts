import { t, table, type TableDatabase } from "/p/the8020/db/mod.ts";
import { username } from "/p/the8020/users/types/user.ts";
import { preferenceOverrides } from "../src/preference_fields.ts";
import type { PersonalShortcut } from "../src/shortcut_fields.ts";

const UserPreferences = table("the8020__uui__user_preferences", {
  username: t.from(username).primaryKey(),
  accentColor: t.from(preferenceOverrides.shape.accentColor),
  shortcuts: t.json<PersonalShortcut[]>().nullable(),
});

declare module "/p/the8020/db/types.ts" {
  interface Database extends TableDatabase<typeof UserPreferences> {}
}

export default UserPreferences;
