export interface PopoverAnchorRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Prefer below the anchor, then above, with a ten-pixel viewport gutter. */
export function popoverPosition(
  anchor: PopoverAnchorRect,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
  alignment: "start" | "end" = "end",
): { top: number; left: number } {
  const padding = 10;
  const gap = 6;
  const right = Math.max(padding, viewportWidth - padding - width);
  const bottom = Math.max(padding, viewportHeight - padding - height);
  const below = anchor.bottom + gap;
  const above = anchor.top - gap - height;
  return {
    left: Math.min(
      Math.max(
        alignment === "end" ? anchor.right - width : anchor.left,
        padding,
      ),
      right,
    ),
    top: below <= bottom
      ? below
      : above >= padding
      ? above
      : Math.min(Math.max(below, padding), bottom),
  };
}

/** Native light dismissal, nested popovers, scrolling, positioning and focus. */
export class AnchoredPopover {
  readonly element = document.createElement("div");
  #tracking = false;

  constructor(
    readonly anchor: HTMLElement,
    label: string,
    readonly options: {
      alignment?: "start" | "end";
      bounds?: () => PopoverAnchorRect;
      onClose?: () => void;
    } = {},
  ) {
    this.element.className = "uui-popover";
    this.element.popover = "auto";
    this.element.tabIndex = -1;
    this.element.setAttribute("role", "dialog");
    this.element.setAttribute("aria-label", label);
    this.element.addEventListener("beforetoggle", (event) => {
      const open = (event as ToggleEvent).newState === "open";
      this.anchor.setAttribute("aria-expanded", String(open));
      this.track(open);
      if (!open) this.options.onClose?.();
    });
    this.element.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      this.hide();
      this.anchor.focus({ preventScroll: true });
    });
  }

  show(focus = true): void {
    this.element.showPopover();
    this.position();
    if (focus) this.element.focus({ preventScroll: true });
  }

  hide(): void {
    if (this.element.matches(":popover-open")) this.element.hidePopover();
  }

  position = (): void => {
    if (!this.element.matches(":popover-open")) return;
    const position = popoverPosition(
      this.options.bounds?.() ?? this.anchor.getBoundingClientRect(),
      this.element.offsetWidth,
      this.element.offsetHeight,
      innerWidth,
      innerHeight,
      this.options.alignment,
    );
    this.element.style.left = `${position.left}px`;
    this.element.style.top = `${position.top}px`;
  };

  private track(active: boolean): void {
    if (this.#tracking === active) return;
    this.#tracking = active;
    if (active) {
      globalThis.addEventListener("resize", this.position);
      document.addEventListener("scroll", this.position, true);
      globalThis.visualViewport?.addEventListener("resize", this.position);
    } else {
      globalThis.removeEventListener("resize", this.position);
      document.removeEventListener("scroll", this.position, true);
      globalThis.visualViewport?.removeEventListener("resize", this.position);
    }
  }

  dispose(): void {
    this.hide();
    this.track(false);
    this.element.remove();
  }
}
