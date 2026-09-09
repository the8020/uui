import { type KeyboardShortcut, shortcutKey } from "../../../protocol.ts";

const enterActions = new WeakMap<HTMLInputElement, () => void>();

export function bindEnterEvent(
  input: HTMLInputElement,
  action: () => void,
): void {
  enterActions.set(input, action);
}

export function bindShortcut(
  element: HTMLElement,
  shortcut?: KeyboardShortcut,
): void {
  if (shortcut === undefined) return;
  element.dataset.shortcut = shortcutKey(shortcut);
  element.setAttribute("aria-keyshortcuts", shortcutKey(shortcut));
}

function available(element: HTMLElement): boolean {
  return element.isConnected && !element.matches(":disabled") &&
    !element.closest('[inert], [hidden], [aria-disabled="true"]') &&
    element.checkVisibility({ visibilityProperty: true });
}

const keyActions: Readonly<
  Record<string, "help" | "click" | "back" | "previous" | "next">
> = {
  F1: "help",
  F2: "click",
  F3: "back",
  F4: "help",
  "Shift+F2": "previous",
  "Shift+F3": "next",
};

/** Native modal focus takes priority over the underlying presentation. */
export function activeDialog(): HTMLDialogElement | undefined {
  return document.activeElement?.closest<HTMLDialogElement>("dialog:modal") ??
    [...document.querySelectorAll<HTMLDialogElement>("dialog:modal")].at(-1);
}

export function focusableControls(roots: ParentNode[]): HTMLElement[] {
  return roots.flatMap((root) =>
    [...root.querySelectorAll<HTMLElement>(
      "input, select, textarea, button, a[href], summary, [tabindex], [contenteditable]",
    )].filter((element) =>
      (element.tabIndex >= 0 ||
        element.isContentEditable && !element.hasAttribute("tabindex")) &&
      available(element)
    )
  );
}

function moveFocus(roots: ParentNode[], forward: boolean): void {
  const controls = focusableControls(roots).filter((element) =>
    !element.closest('[readonly], [aria-readonly="true"]')
  );
  const active = document.activeElement;
  let target = controls[0];
  if (
    active && active !== document.body && active !== document.documentElement
  ) {
    const ordered = forward ? controls : controls.toReversed();
    const position = forward
      ? Node.DOCUMENT_POSITION_FOLLOWING
      : Node.DOCUMENT_POSITION_PRECEDING;
    target = ordered.find((element) =>
      active.compareDocumentPosition(element) & position
    ) ?? ordered[0];
  }
  target?.focus();
}

/** One bubbling listener reads only the current surface; removed DOM owns no listeners. */
export function installKeyboardShortcuts(options: {
  roots(): HTMLElement[];
  back(): boolean;
}): () => void {
  const handle = (event: KeyboardEvent) => {
    if (
      event.defaultPrevented || event.isComposing || event.keyCode === 229 ||
      event.metaKey
    ) return;
    const dialog = activeDialog();
    const roots = dialog ? [dialog] : options.roots();
    const key = shortcutKey({
      key: event.key as KeyboardShortcut["key"],
      control: event.ctrlKey,
      alt: event.altKey,
      shift: event.shiftKey,
    });
    const active = document.activeElement;
    let run: (() => void | boolean) | undefined;
    if (
      key === "Enter" && active instanceof HTMLInputElement &&
      event.target === active && available(active) && !active.readOnly &&
      roots.some((root) => root.contains(active))
    ) {
      run = enterActions.get(active);
    } else if (/^F(?:[5-9]|1[0-2])$/.test(event.key)) {
      for (const root of roots) {
        const element = [
          ...root.querySelectorAll<HTMLElement>("[data-shortcut]"),
        ]
          .find((element) =>
            element.dataset.shortcut === key && available(element)
          );
        if (!element) continue;
        const target = element instanceof HTMLButtonElement
          ? element
          : focusableControls([element])[0];
        if (!target) continue;
        run = () =>
          target instanceof HTMLButtonElement && target === element
            ? target.click()
            : target.focus();
        break;
      }
    } else {
      const action = keyActions[key];
      if (action === "back") run = options.back;
      else if (action === "previous" || action === "next") {
        if (
          focusableControls(roots).some((element) =>
            !element.closest('[readonly], [aria-readonly="true"]')
          )
        ) {
          run = () => {
            moveFocus(roots, action === "next");
          };
        }
      } else if (active instanceof HTMLElement && available(active)) {
        const target = action === "help"
          ? active.closest(".field")?.querySelector<HTMLButtonElement>(
            ".field-help-button",
          )
          : action === "click"
          ? active
          : undefined;
        if (target && available(target)) run = () => target.click();
      }
    }
    if (!run) return;
    if (!event.repeat && run() === false) return;
    event.preventDefault();
    event.stopPropagation();
  };
  document.addEventListener("keydown", handle);
  return () => document.removeEventListener("keydown", handle);
}
