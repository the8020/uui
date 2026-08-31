export type Theme = "light" | "dark";

export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const sharedThemeKey = "the8020.uui.theme";
export const initialThemeKey = "the8020.uui.theme:initial";
const connectionThemePrefix = "the8020.uui.theme:connection:";
const sessionThemePrefix = "the8020.uui.theme:session:";

export class ThemePreferences {
  readonly #session: ThemeStorage;
  readonly #shared: ThemeStorage;
  readonly #connectionKey: string;
  #sessionKey: string | undefined;
  #theme: Theme;

  constructor(
    session: ThemeStorage,
    shared: ThemeStorage,
    scope: string,
    prefersDark: boolean,
  ) {
    this.#session = session;
    this.#shared = shared;
    this.#connectionKey = `${connectionThemePrefix}${scope}`;
    this.#theme = readTheme(session, this.#connectionKey) ??
      readTheme(session, initialThemeKey) ??
      readTheme(shared, sharedThemeKey) ?? (prefersDark ? "dark" : "light");
    writeTheme(this.#session, this.#connectionKey, this.#theme);
    writeTheme(this.#session, initialThemeKey, this.#theme);
  }

  current(): Theme {
    return this.#theme;
  }

  bindSession(sessionID: string): Theme {
    if (sessionID.length === 0) return this.#theme;
    const key = `${sessionThemePrefix}${sessionID}`;
    if (this.#sessionKey === key) return this.#theme;
    this.#sessionKey = key;
    this.#theme = readTheme(this.#session, key) ?? this.#theme;
    writeTheme(this.#session, key, this.#theme);
    writeTheme(this.#session, this.#connectionKey, this.#theme);
    writeTheme(this.#session, initialThemeKey, this.#theme);
    return this.#theme;
  }

  select(theme: Theme): Theme {
    this.#theme = theme;
    writeTheme(this.#session, this.#connectionKey, theme);
    writeTheme(this.#session, initialThemeKey, theme);
    if (this.#sessionKey !== undefined) {
      writeTheme(this.#session, this.#sessionKey, theme);
    }
    writeTheme(this.#shared, sharedThemeKey, theme);
    return theme;
  }

  endSession(): void {
    if (this.#sessionKey !== undefined) {
      removeTheme(this.#session, this.#sessionKey);
      this.#sessionKey = undefined;
    }
    removeTheme(this.#session, this.#connectionKey);
    removeTheme(this.#session, initialThemeKey);
  }
}

function readTheme(storage: ThemeStorage, key: string): Theme | undefined {
  try {
    const value = storage.getItem(key);
    return value === "light" || value === "dark" ? value : undefined;
  } catch {
    return undefined;
  }
}

function writeTheme(storage: ThemeStorage, key: string, theme: Theme): void {
  try {
    storage.setItem(key, theme);
  } catch {
    // A denied storage API must not prevent the shell from rendering.
  }
}

function removeTheme(storage: ThemeStorage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // A denied storage API must not prevent session teardown.
  }
}
