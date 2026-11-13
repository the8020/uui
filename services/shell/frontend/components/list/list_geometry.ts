import {
  type ColumnLength,
  MAX_LIST_PAGE_SIZE,
} from "../../../../../screen_state.ts";

export function listRowCapacity(
  available: number,
  overhead: number,
  rowHeight: number,
  totalItems: number,
  paginationHeight: number,
): number {
  const capacity = (chromeHeight: number): number =>
    Math.max(
      1,
      Math.min(
        MAX_LIST_PAGE_SIZE,
        Math.floor((available - chromeHeight) / Math.max(1, rowHeight)),
      ),
    );
  const withoutPagination = capacity(overhead);
  return totalItems > withoutPagination
    ? capacity(overhead + paginationHeight)
    : withoutPagination;
}

/**
 * Column widths from semantic lengths, filling the available width. Columns
 * with a user-dragged width keep it; the others share the remaining space and
 * never shrink below their minimum, so the table may scroll horizontally.
 */
export function listColumnWidths(
  lengths: readonly ColumnLength[],
  available: number,
  fixed: readonly (number | undefined)[] = [],
): number[] {
  const minimum = { compact: 58, short: 110, medium: 164, long: 260 };
  const weight = { compact: 0, short: 1, medium: 2, long: 4 };
  const free = lengths.map((_, index) => fixed[index] === undefined);
  const widths = lengths.map((length, index) =>
    fixed[index] ?? minimum[length]
  );
  const extra = Math.max(0, available - widths.reduce((a, b) => a + b, 0));
  const flexible = lengths.filter((_, index) => free[index]);
  const totalWeight = flexible.reduce(
    (total, length) => total + weight[length],
    0,
  );
  return widths.map((width, index) =>
    !free[index] ? width : width +
      extra * (totalWeight === 0
          ? 1 / Math.max(1, flexible.length)
          : weight[lengths[index]!] / totalWeight)
  );
}
