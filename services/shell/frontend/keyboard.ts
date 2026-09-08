const keyActions: Readonly<
  Record<string, "help" | "click" | "back" | "previous" | "next">
> = {
  F1: "help",
  F2: "click",
  F3: "back",
  F4: "help",
  F5: "previous",
  F6: "next",
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
      !element.matches(":disabled") && !element.closest("[inert]") &&
      element.checkVisibility({ visibilityProperty: true })
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

/** Keep bindings here; renderers supply ordinary controls and click actions. */
export function installKeyboardShortcuts(options: {
  roots(): HTMLElement[];
  back(): void;
}): void {
  document.addEventListener("keydown", (event) => {
    if (
      event.defaultPrevented || event.isComposing || event.altKey ||
      event.ctrlKey || event.metaKey || event.shiftKey
    ) return;
    const action = keyActions[event.key];
    if (action === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    if (action === "back") {
      options.back();
      return;
    }
    if (action === "previous" || action === "next") {
      const dialog = activeDialog();
      moveFocus(dialog ? [dialog] : options.roots(), action === "next");
      return;
    }
    const active = document.activeElement;
    if (
      !(active instanceof HTMLElement) ||
      active.closest("[inert]") || active.matches(":disabled") ||
      !active.checkVisibility({ visibilityProperty: true })
    ) return;
    if (action === "help") {
      active.closest(".field")?.querySelector<HTMLButtonElement>(
        ".field-help-button",
      )?.click();
    } else active.click();
  });
}
