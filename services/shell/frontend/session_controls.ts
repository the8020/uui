/** Keep global controls above native dialogs and inside their interactive scope. */
export function installSessionControls(
  controls: HTMLElement,
  slot: HTMLElement,
): void {
  const dialogs: HTMLDialogElement[] = [];
  const position = () => {
    controls.style.maxWidth = "none";
    slot.style.width = `${controls.getBoundingClientRect().width}px`;
    slot.style.height = `${controls.offsetHeight}px`;
    const bounds = slot.getBoundingClientRect();
    controls.style.maxWidth = `${bounds.width}px`;
    controls.style.left = `${bounds.left}px`;
    controls.style.top = `${bounds.top}px`;
  };
  const synchronize = () => {
    const parent =
      dialogs.findLast((dialog) =>
        dialog.isConnected && dialog.matches(":modal")
      ) ?? slot;
    if (controls.parentElement === parent) return;
    const focus = document.activeElement;
    const restoreFocus = focus instanceof HTMLElement &&
      controls.contains(focus);
    controls.hidePopover();
    parent.append(controls);
    controls.showPopover();
    position();
    if (restoreFocus) focus.focus({ preventScroll: true });
  };
  document.addEventListener("beforetoggle", (event) => {
    const dialog = event.target;
    if (!(dialog instanceof HTMLDialogElement)) return;
    const index = dialogs.indexOf(dialog);
    if (index !== -1) dialogs.splice(index, 1);
    if ((event as ToggleEvent).newState === "open") dialogs.push(dialog);
    queueMicrotask(synchronize);
  }, true);
  controls.showPopover();
  position();
  new ResizeObserver(position).observe(controls);
  addEventListener("resize", position);
}
