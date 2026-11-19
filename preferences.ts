import { localizedText as resolveMessage } from "/p/the8020/i18n/mod.ts";
import { msg as messageSymbol } from "/p/the8020/uui/i18n/messages.ts";
import {
  DEFAULT_ACCENT_COLOR,
  preferenceOverrides,
  type UserPreferences as Preferences,
  userPreferences,
} from "./src/preference_fields.ts";
import { personalShortcuts } from "./src/shortcut_fields.ts";
import { validationError } from "/p/the8020/i18n/validation.ts";

/** Personal launch codes have no system-default row. */
export async function fetchUserShortcuts() {
  const username = await currentUsername();
  const { default: UserPreferences } = await import(
    "./tables/user_preferences.ts"
  );
  const row = await UserPreferences.select([UserPreferences.shortcuts]).where(
    UserPreferences.username,
    "=",
    username,
  ).executeTakeFirst();
  return personalShortcuts.parse(row?.shortcuts ?? []);
}

async function currentUsername(): Promise<string> {
  const { currentUser } = await import("/p/the8020/users/mod.ts");
  const user = currentUser();
  if (!user) {
    throw new Error(
      await resolveMessage(messageSymbol("errors.sign_in_to_customize_uui")),
    );
  }
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
  const rows = await UserPreferences.select([
    UserPreferences.username,
    UserPreferences.accentColor,
  ])
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
  await resolveMessage(messageSymbol("shortcuts.duplicate"));
  const overrides = preferenceOverrides.extend({
    shortcuts: personalShortcuts.optional(),
  }).parse(input, { error: validationError });
  const defaults = await fetchUserPreferences("");
  const color = overrides.accentColor?.toLowerCase() ?? null;
  const accentColor = color === defaults.accentColor.toLowerCase()
    ? null
    : color;
  const shortcuts = (overrides.shortcuts ?? await fetchUserShortcuts()).map((
    row,
  ) => ({ ...row, shortcut: row.shortcut.toUpperCase() }));
  if (accentColor === null && shortcuts.length === 0) {
    await UserPreferences.delete().where(
      UserPreferences.username,
      "=",
      username,
    ).execute();
    return;
  }
  const values = {
    accentColor,
    shortcuts: shortcuts.length ? shortcuts : null,
  };
  await db.insertInto(UserPreferences.table).values({ username, ...values })
    .onConflict((conflict) => conflict.column("username").doUpdateSet(values))
    .execute();
}
