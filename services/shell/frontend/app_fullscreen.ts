/** Browser-wide choice, kept until the user turns it off. */
export const APP_FULLSCREEN_KEY = "the8020.app-fullscreen";
/** Root class: programs fill the window below the shell bar. */
export const APP_FULLSCREEN_CLASS = "uui-app-fullscreen";

/**
 * The shell bar's Fullscreen toggle. Like a terminal's content fullscreen it
 * keeps the shell bar and only widens the program area and its dialogs; the
 * browser's own fullscreen is left to the user.
 */
export function installAppFullscreen(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined,
  root: HTMLElement = document.documentElement,
): () => void {
  const apply = (expanded: boolean) => {
    root.classList.toggle(APP_FULLSCREEN_CLASS, expanded);
  };
  let stored = false;
  try {
    stored = storage?.getItem(APP_FULLSCREEN_KEY) === "true";
  } catch { /* Unavailable storage keeps the normal width. */ }
  apply(stored);
  return () => {
    const expanded = !root.classList.contains(APP_FULLSCREEN_CLASS);
    apply(expanded);
    try {
      if (expanded) storage?.setItem(APP_FULLSCREEN_KEY, "true");
      else storage?.removeItem(APP_FULLSCREEN_KEY);
    } catch { /* The choice still applies to this page. */ }
    // Lists and other measured content re-fit the new width.
    dispatchEvent(new Event("resize"));
  };
}
