const POPOVER_EDGE_PADDING = 10;

export function fittingHeaderItemCount(
  itemWidths: readonly number[],
  availableWidth: number,
  overflowToggleWidth: number,
  gap: number,
): number {
  if (itemWidths.length === 0 || availableWidth <= 0) return 0;
  const allItemsWidth = itemWidths.reduce((total, width) => total + width, 0) +
    gap * Math.max(0, itemWidths.length - 1);
  if (allItemsWidth <= availableWidth) return itemWidths.length;
  const visibleWidth = Math.max(
    0,
    availableWidth - overflowToggleWidth - gap,
  );
  let used = 0;
  let visible = 0;
  for (const width of itemWidths) {
    const next = used + (visible === 0 ? 0 : gap) + width;
    if (next > visibleWidth) break;
    used = next;
    visible++;
  }
  return visible;
}

export function horizontalPopoverShift(
  left: number,
  width: number,
  viewportWidth: number,
  edgePadding: number,
): number {
  if (
    !Number.isFinite(left) || !Number.isFinite(width) ||
    !Number.isFinite(viewportWidth) || !Number.isFinite(edgePadding) ||
    width < 0 || viewportWidth <= 0
  ) return 0;
  const padding = Math.min(Math.max(0, edgePadding), viewportWidth / 2);
  const minimumLeft = padding;
  const maximumLeft = Math.max(
    minimumLeft,
    viewportWidth - padding - width,
  );
  return Math.min(Math.max(left, minimumLeft), maximumLeft) - left;
}

export class ResponsiveProgramHeader {
  readonly #root: HTMLElement;
  readonly #visible: HTMLElement;
  readonly #overflow: HTMLDetailsElement;
  readonly #overflowItems: HTMLElement;
  readonly #resizeObserver: ResizeObserver;
  #items: HTMLElement[] = [];
  #animationFrame = 0;
  #overflowPositionFrame = 0;

  constructor(
    root: HTMLElement,
    visible: HTMLElement,
    overflow: HTMLDetailsElement,
    overflowItems: HTMLElement,
  ) {
    this.#root = root;
    this.#visible = visible;
    this.#overflow = overflow;
    this.#overflowItems = overflowItems;
    this.#resizeObserver = new ResizeObserver(() => this.#scheduleFit());
    this.#resizeObserver.observe(root);
    this.#overflow.addEventListener("toggle", this.#overflowToggled);
    document.addEventListener("pointerdown", this.#closeOutside);
    document.addEventListener("keydown", this.#closeOnEscape);
  }

  render(items: HTMLElement[]): void {
    this.#items = items;
    this.#overflow.open = false;
    this.#overflowItems.style.removeProperty(
      "--program-header-overflow-inline-shift",
    );
    this.#overflow.hidden = true;
    this.#overflowItems.replaceChildren();
    this.#visible.replaceChildren(...items);
    this.#root.hidden = items.length === 0;
    if (items.length > 0) this.#scheduleFit();
  }

  clear(): void {
    this.render([]);
  }

  dispose(): void {
    this.#resizeObserver.disconnect();
    cancelAnimationFrame(this.#animationFrame);
    cancelAnimationFrame(this.#overflowPositionFrame);
    this.#overflow.removeEventListener("toggle", this.#overflowToggled);
    document.removeEventListener("pointerdown", this.#closeOutside);
    document.removeEventListener("keydown", this.#closeOnEscape);
  }

  readonly #closeOutside = (event: PointerEvent): void => {
    if (
      this.#overflow.open && event.target instanceof Node &&
      !this.#overflow.contains(event.target)
    ) this.#overflow.open = false;
  };

  readonly #closeOnEscape = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || !this.#overflow.open) return;
    this.#overflow.open = false;
    this.#overflow.querySelector("summary")?.focus();
  };

  readonly #overflowToggled = (): void => {
    cancelAnimationFrame(this.#overflowPositionFrame);
    this.#overflowItems.style.removeProperty(
      "--program-header-overflow-inline-shift",
    );
    if (!this.#overflow.open) return;
    this.#overflowPositionFrame = requestAnimationFrame(() => {
      this.#overflowPositionFrame = 0;
      const bounds = this.#overflowItems.getBoundingClientRect();
      const shift = horizontalPopoverShift(
        bounds.left,
        bounds.width,
        innerWidth,
        POPOVER_EDGE_PADDING,
      );
      this.#overflowItems.style.setProperty(
        "--program-header-overflow-inline-shift",
        `${shift}px`,
      );
    });
  };

  #scheduleFit(): void {
    cancelAnimationFrame(this.#animationFrame);
    this.#animationFrame = requestAnimationFrame(() => this.#fit());
  }

  #fit(): void {
    this.#animationFrame = 0;
    if (this.#items.length === 0 || this.#root.clientWidth <= 0) return;
    const wasOpen = this.#overflow.open;
    this.#overflow.open = false;
    this.#overflowItems.style.removeProperty(
      "--program-header-overflow-inline-shift",
    );
    this.#overflow.hidden = true;
    this.#overflowItems.replaceChildren();
    this.#visible.replaceChildren(...this.#items);
    const widths = this.#items.map((item) =>
      item.getBoundingClientRect().width
    );
    const gap = Number.parseFloat(getComputedStyle(this.#visible).columnGap) ||
      0;
    const allItemsWidth = widths.reduce((total, width) => total + width, 0) +
      gap * Math.max(0, widths.length - 1);
    if (allItemsWidth <= this.#root.clientWidth) return;
    this.#overflow.hidden = false;
    const visibleCount = fittingHeaderItemCount(
      widths,
      this.#root.clientWidth,
      this.#overflow.getBoundingClientRect().width,
      gap,
    );
    this.#visible.replaceChildren(...this.#items.slice(0, visibleCount));
    this.#overflowItems.replaceChildren(...this.#items.slice(visibleCount));
    this.#overflow.open = wasOpen;
  }
}
