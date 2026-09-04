import { MAX_FIELD_ROW_SPAN } from "/p/the8020/uui/protocol.ts";

export type SemanticFieldLength = "short" | "medium" | "long";
export type FieldGridMode = "mobile" | "tablet" | "desktop";

export interface FieldGridItem {
  length: SemanticFieldLength;
  rowSpan: number;
}

export interface FieldGridPosition {
  column: number;
  row: number;
  span: number;
  rowSpan: number;
}

export type ResponsiveFieldGridPosition = Record<
  FieldGridMode,
  FieldGridPosition
>;

interface GridProfile {
  columns: number;
  spans: Record<SemanticFieldLength, number>;
}

interface PackItem {
  index: number;
  minimumSpan: number;
  alignment: number;
  rowSpan: number;
}

interface RowPlacement {
  item: PackItem;
  column: number;
  span: number;
}

const profiles: Record<FieldGridMode, GridProfile> = {
  mobile: {
    columns: 2,
    spans: { short: 1, medium: 2, long: 2 },
  },
  tablet: {
    columns: 4,
    spans: { short: 1, medium: 2, long: 4 },
  },
  desktop: {
    columns: 8,
    spans: { short: 1, medium: 2, long: 4 },
  },
};

export function fieldGridPositions(
  items: readonly FieldGridItem[],
): ResponsiveFieldGridPosition[] {
  const byMode = Object.fromEntries(
    (Object.entries(profiles) as [FieldGridMode, GridProfile][]).map(
      ([mode, profile]) => [mode, pack(items, profile)],
    ),
  ) as Record<FieldGridMode, FieldGridPosition[]>;
  return items.map((_, index) => ({
    mobile: byMode.mobile[index]!,
    tablet: byMode.tablet[index]!,
    desktop: byMode.desktop[index]!,
  }));
}

function pack(
  items: readonly FieldGridItem[],
  profile: GridProfile,
): FieldGridPosition[] {
  const pending = items.map((item, index): PackItem => {
    if (
      !Number.isSafeInteger(item.rowSpan) || item.rowSpan < 1 ||
      item.rowSpan > MAX_FIELD_ROW_SPAN
    ) {
      throw new TypeError(
        `field rowSpan must be an integer from 1 through ${MAX_FIELD_ROW_SPAN}`,
      );
    }
    const span = profile.spans[item.length];
    return {
      index,
      minimumSpan: span,
      alignment: span,
      rowSpan: item.rowSpan,
    };
  });
  const positions = new Array<FieldGridPosition>(items.length);
  const occupied: boolean[][] = [];
  let next = 0;
  let row = 0;

  while (next < pending.length) {
    const placements = planRow(
      pending,
      next,
      row,
      profile.columns,
      occupied,
    );
    if (placements.length === 0) {
      row++;
      continue;
    }
    for (const placement of placements) {
      const { item, column, span } = placement;
      positions[item.index] = {
        column: column + 1,
        row: row + 1,
        span,
        rowSpan: item.rowSpan,
      };
      occupy(occupied, row, column, span, item.rowSpan);
    }
    next += placements.length;
    row++;
  }
  return positions;
}

function planRow(
  items: readonly PackItem[],
  startIndex: number,
  row: number,
  columns: number,
  occupied: readonly boolean[][],
): RowPlacement[] {
  let best: RowPlacement[] = [];

  const search = (index: number, cursor: number, placed: RowPlacement[]) => {
    if (betterPlan(placed, best)) best = [...placed];
    if (index >= items.length) return;
    const item = items[index]!;
    for (const span of allowedSpans(item.minimumSpan, columns)) {
      const column = firstAvailableColumn(
        occupied,
        row,
        cursor,
        columns,
        item,
        span,
      );
      if (column === undefined) continue;
      placed.push({ item, column, span });
      search(index + 1, column + span, placed);
      placed.pop();
    }
  };

  search(startIndex, 0, []);
  return best;
}

function firstAvailableColumn(
  occupied: readonly boolean[][],
  row: number,
  cursor: number,
  columns: number,
  item: PackItem,
  span: number,
): number | undefined {
  for (let column = cursor; column + span <= columns; column++) {
    if (column % item.alignment !== 0) continue;
    if (rectangleIsFree(occupied, row, column, span, item.rowSpan)) {
      return column;
    }
  }
  return undefined;
}

function rectangleIsFree(
  occupied: readonly boolean[][],
  row: number,
  column: number,
  columnSpan: number,
  rowSpan: number,
): boolean {
  for (let targetRow = row; targetRow < row + rowSpan; targetRow++) {
    for (
      let targetColumn = column;
      targetColumn < column + columnSpan;
      targetColumn++
    ) {
      if (occupied[targetRow]?.[targetColumn]) return false;
    }
  }
  return true;
}

function occupy(
  occupied: boolean[][],
  row: number,
  column: number,
  columnSpan: number,
  rowSpan: number,
): void {
  for (let targetRow = row; targetRow < row + rowSpan; targetRow++) {
    const cells = occupied[targetRow] ??= [];
    for (
      let targetColumn = column;
      targetColumn < column + columnSpan;
      targetColumn++
    ) cells[targetColumn] = true;
  }
}

function betterPlan(
  candidate: readonly RowPlacement[],
  current: readonly RowPlacement[],
): boolean {
  if (candidate.length !== current.length) {
    return candidate.length > current.length;
  }
  const candidateCoverage = coverage(candidate);
  const currentCoverage = coverage(current);
  if (candidateCoverage !== currentCoverage) {
    return candidateCoverage > currentCoverage;
  }
  const candidateExpansion = expansionScore(candidate);
  const currentExpansion = expansionScore(current);
  if (candidateExpansion !== currentExpansion) {
    return candidateExpansion < currentExpansion;
  }
  const candidateSpans = candidate.map((item) => item.span);
  const currentSpans = current.map((item) => item.span);
  if (preferLaterExpansion(candidateSpans, currentSpans)) return true;
  if (preferLaterExpansion(currentSpans, candidateSpans)) return false;
  for (let index = 0; index < candidate.length; index++) {
    if (candidate[index]!.column === current[index]!.column) continue;
    return candidate[index]!.column < current[index]!.column;
  }
  return false;
}

function coverage(items: readonly RowPlacement[]): number {
  return items.reduce((total, item) => total + item.span, 0);
}

function expansionScore(items: readonly RowPlacement[]): number {
  return items.reduce((total, placement) => {
    const expansion = placement.span / placement.item.minimumSpan - 1;
    return total + expansion * expansion;
  }, 0);
}

function allowedSpans(minimumSpan: number, columns: number): number[] {
  return [1, 2, 4, 8].filter((span) => span >= minimumSpan && span <= columns);
}

function preferLaterExpansion(candidate: number[], current: number[]): boolean {
  for (let index = candidate.length - 1; index >= 0; index--) {
    if (candidate[index] === current[index]) continue;
    return candidate[index]! > current[index]!;
  }
  return false;
}
