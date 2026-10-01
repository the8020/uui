import {
  DEFAULT_ACCENT_COLOR,
  preferenceOverrides,
  type UserPreferences as Preferences,
  userPreferences,
} from "./src/preference_fields.ts";

async function currentUsername(): Promise<string> {
  const { currentUser } = await import("/p/the8020/users/mod.ts");
  const user = currentUser();
  if (!user) throw new Error("Sign in to customize UUI.");
  return user.username;
}

/** Resolve each nullable preference: personal override, system default, built-in. */
export async function fetchUserPreferences(
  username?: string,
): Promise<Preferences> {
  username ??= await currentUsername();
  const { default: UserPreferences } = await import(
    "./tables/user_preferences.ts"
  );
  const rows = await UserPreferences.selectAll()
    .where(
      UserPreferences.username,
      "in",
      username === "" ? [""] : ["", username],
    )
    .limit(2).execute();
  const defaults = rows.find((row) => row.username === "");
  const personal = rows.find((row) => row.username === username);
  return userPreferences.parse({
    accentColor: personal?.accentColor ?? defaults?.accentColor ??
      DEFAULT_ACCENT_COLOR,
  });
}

/** Save only the current user's overrides; null restores inheritance. */
export async function saveUserPreferences(input: unknown): Promise<void> {
  const username = await currentUsername();
  const { db } = await import("/p/the8020/db/mod.ts");
  const { default: UserPreferences } = await import(
    "./tables/user_preferences.ts"
  );
  const overrides = preferenceOverrides.parse(input);
  const defaults = await fetchUserPreferences("");
  const accentColor = overrides.accentColor?.toLowerCase() ?? null;
  if (
    accentColor === null || accentColor === defaults.accentColor.toLowerCase()
  ) {
    await UserPreferences.delete().where(
      UserPreferences.username,
      "=",
      username,
    ).execute();
    return;
  }
  await db.insertInto(UserPreferences.table).values({ username, accentColor })
    .onConflict((conflict) =>
      conflict.column("username").doUpdateSet({ accentColor })
    )
    .execute();
}
