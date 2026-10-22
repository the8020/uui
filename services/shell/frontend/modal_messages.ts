/**
 * Modal dialogs render in the browser's top layer above the whole page, so
 * toasts in the page header would sit behind them. While a modal dialog is
 * open, the toast stack moves into the most recently opened one and returns
 * to its place when the last one closes.
 */
export function followModalDialogs(
  stack: HTMLElement,
  root: HTMLElement = document.body,
): () => void {
  const home = stack.parentElement!;
  const anchor = document.createComment("message toast stack");
  home.insertBefore(anchor, stack);
  // Opening order decides which modal is on top; the DOM order does not.
  const opened = new Map<HTMLDialogElement, number>();
  let sequence = 0;
  const place = () => {
    for (const dialog of root.querySelectorAll("dialog")) {
      const modal = dialog.open && dialog.matches(":modal");
      if (modal && !opened.has(dialog)) opened.set(dialog, ++sequence);
      if (!modal) opened.delete(dialog);
    }
    for (const dialog of opened.keys()) {
      if (!dialog.isConnected) opened.delete(dialog);
    }
    let top: HTMLDialogElement | undefined;
    for (const [dialog, order] of opened) {
      if (top === undefined || order > opened.get(top)!) top = dialog;
    }
    const target = top ?? home;
    if (stack.parentElement === target) return;
    // Keep keyboard focus on a toast control that moves with the stack.
    const focused = stack.contains(document.activeElement)
      ? document.activeElement as HTMLElement
      : undefined;
    if (top === undefined) anchor.after(stack);
    else top.append(stack);
    stack.classList.toggle("message-toast-stack-modal", top !== undefined);
    focused?.focus({ preventScroll: true });
  };
  const observer = new MutationObserver(place);
  observer.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["open"],
  });
  place();
  return () => {
    observer.disconnect();
    anchor.after(stack);
    stack.classList.remove("message-toast-stack-modal");
    anchor.remove();
  };
}
