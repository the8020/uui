import { assertEquals } from "@std/assert";
import {
  initialThemeKey,
  sharedThemeKey,
  ThemePreferences,
  type ThemeStorage,
} from "./theme.ts";

class MemoryStorage implements ThemeStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

Deno.test("theme preference uses connection, initial, shared, then operating-system precedence", () => {
  const session = new MemoryStorage();
  const shared = new MemoryStorage();
  shared.setItem(sharedThemeKey, "dark");
  const fromShared = new ThemePreferences(session, shared, "socket", false);
  assertEquals(fromShared.current(), "dark");

  session.setItem("the8020.uui.theme:connection:socket", "light");
  const fromSession = new ThemePreferences(session, shared, "socket", true);
  assertEquals(fromSession.current(), "light");

  const reloadSession = new MemoryStorage();
  reloadSession.setItem(initialThemeKey, "light");
  const fromInitial = new ThemePreferences(
    reloadSession,
    shared,
    "other-socket",
    true,
  );
  assertEquals(fromInitial.current(), "light");

  const empty = new ThemePreferences(
    new MemoryStorage(),
    new MemoryStorage(),
    "new",
    true,
  );
  assertEquals(empty.current(), "dark");
});

Deno.test("theme selection persists per UUI session and seeds future tabs", () => {
  const firstSessionStorage = new MemoryStorage();
  const shared = new MemoryStorage();
  const first = new ThemePreferences(
    firstSessionStorage,
    shared,
    "socket",
    false,
  );
  first.bindSession("session-one");
  first.select("dark");
  assertEquals(
    firstSessionStorage.getItem("the8020.uui.theme:session:session-one"),
    "dark",
  );
  assertEquals(firstSessionStorage.getItem(initialThemeKey), "dark");
  assertEquals(shared.getItem(sharedThemeKey), "dark");

  const reloaded = new ThemePreferences(
    firstSessionStorage,
    shared,
    "socket",
    false,
  );
  assertEquals(reloaded.bindSession("session-one"), "dark");

  const futureTab = new ThemePreferences(
    new MemoryStorage(),
    shared,
    "socket",
    false,
  );
  assertEquals(futureTab.current(), "dark");
});

Deno.test("binding an existing session override does not rewrite the shared default", () => {
  const session = new MemoryStorage();
  const shared = new MemoryStorage();
  session.setItem("the8020.uui.theme:session:session-one", "dark");
  shared.setItem(sharedThemeKey, "light");
  const preferences = new ThemePreferences(session, shared, "socket", false);

  assertEquals(preferences.bindSession("session-one"), "dark");
  assertEquals(shared.getItem(sharedThemeKey), "light");
  preferences.endSession();
  assertEquals(
    session.getItem("the8020.uui.theme:session:session-one"),
    null,
  );
  assertEquals(session.getItem(initialThemeKey), null);
});
