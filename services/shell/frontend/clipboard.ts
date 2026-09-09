/** Shared clipboard write, including browsers without secure-context Clipboard API. */
export async function writeClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const focus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    (focus?.closest("dialog[open]") ?? document.body).append(textarea);
    textarea.select();
    try {
      if (!document.execCommand("copy")) {
        throw new Error("The browser did not allow copying.");
      }
    } finally {
      textarea.remove();
      focus?.focus({ preventScroll: true });
    }
  }
}
