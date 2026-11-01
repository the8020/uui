import { msg } from "/p/the8020/uui/i18n/messages.ts";
import { field, z } from "/p/the8020/db/fields.ts";

export const DEFAULT_ACCENT_COLOR = "#5b5bd6";
export const accentColor = field(z.string().regex(/^#[0-9a-f]{6}$/i), {
  label: msg("preference_fields.system_accent_color"),
  description: msg(
    "preference_fields.choose_the_accent_color_used_throughout_uui",
  ),
});
export const userPreferences = z.object({ accentColor });
export const preferenceOverrides = z.object({
  accentColor: accentColor.nullable(),
});
export type UserPreferences = z.infer<typeof userPreferences>;
