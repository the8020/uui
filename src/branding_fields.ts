import { field, z } from "/p/the8020/db/fields.ts";

export const DEFAULT_SERVER_TITLE = "80|20";
export const serverTitle = field(z.string().trim().min(1).max(120), {
  label: "Server title",
  description: "Shown before the current screen title in the browser tab.",
});
