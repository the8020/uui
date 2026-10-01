import { field, z } from "/p/the8020/db/fields.ts";

export const DEFAULT_ACCENT_COLOR = "#5b5bd6";
export const accentColor = field(z.string().regex(/^#[0-9a-f]{6}$/i), {
  label: "System accent color",
  description:
    "Choose the accent color used throughout UUI in light and dark mode.",
});
export const userPreferences = z.object({ accentColor });
export const preferenceOverrides = z.object({
  accentColor: accentColor.nullable(),
});
export type UserPreferences = z.infer<typeof userPreferences>;
