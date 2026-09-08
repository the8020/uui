import {
  type ColumnLength,
  MAX_LIST_PAGE_SIZE,
} from "../../../../../screen_state.ts";

export function listRowCapacity(
  viewport: number,
  chrome: number,
  preceding: number,
  overhead: number,
  rowHeight: number,
  totalItems: number,
  paginationHeight: number,
): number {
  const usable = Math.max(0, viewport - chrome - 24);
  const capacity = (chromeHeight: number): number => {
    // A list further down the page gets a full viewport once scrolled into view.
    const before = preceding + chromeHeight + rowHeight * 3 <= usable
      ? Math.max(0, preceding)
      : 0;
    return Math.max(
      1,
      Math.min(
        MAX_LIST_PAGE_SIZE,
        Math.floor((usable - before - chromeHeight) / Math.max(1, rowHeight)),
      ),
    );
  };
  const withoutPagination = capacity(overhead);
  return totalItems > withoutPagination
    ? capacity(overhead + paginationHeight)
    : withoutPagination;
}

export function listColumnWidths(
  lengths: readonly ColumnLength[],
  available: number,
): number[] {
  const minimum = { compact: 58, short: 110, medium: 164, long: 260 };
  const weight = { compact: 0, short: 1, medium: 2, long: 4 };
  const widths = lengths.map((length) => minimum[length]);
  const extra = Math.max(0, available - widths.reduce((a, b) => a + b, 0));
  const totalWeight = lengths.reduce(
    (total, length) => total + weight[length],
    0,
  );
  return widths.map((width, index) =>
    width +
    extra * (totalWeight === 0
        ? 1 / Math.max(1, widths.length)
        : weight[lengths[index]!] / totalWeight)
  );
}
