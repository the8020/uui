import { msg } from "/p/the8020/uui/i18n/messages.ts";
import { field, z } from "/p/the8020/db/fields.ts";

export const DEFAULT_SERVER_TITLE = "80|20";
export const serverTitle = field(z.string().trim().min(1).max(120), {
  label: msg("branding_fields.server_title"),
  description: msg("branding_fields.shown_before_the_current_screen_title_in"),
});
