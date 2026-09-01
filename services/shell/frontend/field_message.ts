const DEFAULT_EDGE_PADDING = 10;
const DEFAULT_GAP = 6;

export interface FieldMessageAnchorRect {
  top: number;
  bottom: number;
  left: number;
}

export interface FieldMessagePopoverPosition {
  top: number;
  left: number;
}

export function fieldMessageIsOverflowing(
  clientWidth: number,
  scrollWidth: number,
): boolean {
  return Number.isFinite(clientWidth) && Number.isFinite(scrollWidth) &&
    clientWidth > 0 && scrollWidth > clientWidth + 0.5;
}

export function fieldMessagePopoverPosition(
  anchor: FieldMessageAnchorRect,
  popoverWidth: number,
  popoverHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  edgePadding = DEFAULT_EDGE_PADDING,
  gap = DEFAULT_GAP,
): FieldMessagePopoverPosition {
  const padding = Math.max(0, edgePadding);
  const horizontalLimit = Math.max(
    padding,
    viewportWidth - padding - Math.max(0, popoverWidth),
  );
  const verticalLimit = Math.max(
    padding,
    viewportHeight - padding - Math.max(0, popoverHeight),
  );
  const below = anchor.bottom + Math.max(0, gap);
  const above = anchor.top - Math.max(0, gap) - Math.max(0, popoverHeight);

  return {
    left: clamp(anchor.left, padding, horizontalLimit),
    top: below <= verticalLimit
      ? below
      : above >= padding
      ? above
      : clamp(below, padding, verticalLimit),
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(Math.max(value, minimum), maximum);
}
