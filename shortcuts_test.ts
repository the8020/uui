import { assertEquals, assertRejects } from "@std/assert";
import { fieldMetadata } from "./fields.ts";
import { brandingDatabase } from "./branding_test_support.ts";
import {
  fetchUserPreferences,
  fetchUserShortcuts,
  saveUserPreferences,
} from "./preferences.ts";
import { effectiveShortcuts, shortcutFields } from "./shortcuts.ts";

const programs = [
  { id: "acme/tools/first", description: "First program", shortcut: "ONE" },
  { id: "acme/tools/second", description: "Second program", shortcut: "TWO" },
  { id: "acme/tools/hidden", description: "Hidden program" },
];

Deno.test("shortcuts resolve overrides without falling back for missing targets or choosing collisions", () => {
  const rows = effectiveShortcuts(programs, [
    { shortcut: "one", program: programs[1]!.id },
    { shortcut: "NEW", program: programs[2]!.id },
    { shortcut: "two", program: "acme/tools/missing" },
  ]);
  assertEquals(rows.map(({ shortcut, program }) => ({ shortcut, program })), [
    { shortcut: "NEW", program: programs[2]!.id },
    { shortcut: "ONE", program: programs[1]!.id },
  ]);
  assertEquals(
    effectiveShortcuts([...programs, { ...programs[1]!, shortcut: "ONE" }], [])
      .filter((row) => row.shortcut === "ONE").length,
    2,
  );
});

Deno.test("personal shortcuts persist per user, preserve colors, validate atomically, and clean up", async () => {
  using fixture = await brandingDatabase();
  fixture.user("alice");
  assertEquals(await fetchUserShortcuts(), []);
  const shortcuts = [{ shortcut: "one", program: programs[1]!.id }];
  await saveUserPreferences({ accentColor: "#123456", shortcuts });
  assertEquals(await fetchUserShortcuts(), [{
    ...shortcuts[0]!,
    shortcut: "ONE",
  }]);
  await saveUserPreferences({ accentColor: null });
  assertEquals((await fetchUserPreferences()).accentColor, "#5b5bd6");
  assertEquals((await fetchUserShortcuts()).length, 1);
  fixture.user("bob");
  assertEquals(await fetchUserShortcuts(), []);
  fixture.user("alice");
  for (
    const invalid of [
      [...shortcuts, { ...shortcuts[0]!, shortcut: "ONE" }],
      [{ shortcut: "", program: programs[0]!.id }],
      [{ shortcut: "valid", program: "../invalid" }],
      Array.from(
        { length: 101 },
        (_, i) => ({ shortcut: `S${i}`, program: programs[0]!.id }),
      ),
    ]
  ) {
    await assertRejects(() =>
      saveUserPreferences({ accentColor: "#ff0000", shortcuts: invalid })
    );
  }
  assertEquals((await fetchUserPreferences()).accentColor, "#5b5bd6");
  assertEquals((await fetchUserShortcuts()).length, 1);
  const fields = shortcutFields(() => Promise.resolve(programs));
  const query = {
    query: { search: "ONE", filters: {}, sort: null },
    offset: 0,
    limit: 10,
  };
  const help = await fieldMetadata(fields.shortcut)!.valueHelp!(query);
  assertEquals(help.rows.map((row) => row.program), [programs[1]!.id]);
  const targets = await fieldMetadata(fields.program)!.valueHelp!({
    ...query,
    query: { ...query.query, search: "Hidden" },
  });
  assertEquals(targets.rows.map((row) => row.program), [programs[2]!.id]);
  await saveUserPreferences({ accentColor: null, shortcuts: [] });
  assertEquals(
    fixture.database.prepare(
      "SELECT COUNT(*) AS count FROM the8020__uui__user_preferences WHERE username = 'alice'",
    ).get()?.count,
    0,
  );
  await saveUserPreferences({ accentColor: null, shortcuts });
  const { default: deleted } = await import(
    "./programs/user-deleted/program.ts"
  );
  await deleted({ name: "users.deleted", data: { username: "alice" } });
  assertEquals(await fetchUserShortcuts(), []);
});
