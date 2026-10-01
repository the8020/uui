import { z } from "/p/the8020/db/fields.ts";
import { username } from "/p/the8020/users/types/user.ts";
import UserPreferences from "../../tables/user_preferences.ts";

const deletedUser = z.object({
  name: z.literal("users.deleted"),
  data: z.object({ username: username.min(1) }),
});

export default async function run(event: unknown): Promise<void> {
  const user = deletedUser.parse(event).data.username;
  await UserPreferences.delete().where(UserPreferences.username, "=", user)
    .execute();
}
