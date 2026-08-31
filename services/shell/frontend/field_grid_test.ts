import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  type FieldGridItem,
  type FieldGridMode,
  fieldGridPositions,
  type SemanticFieldLength,
} from "./field_grid.ts";

function fields(
  lengths: readonly SemanticFieldLength[],
  rowSpans: Readonly<Record<number, number>> = {},
): FieldGridItem[] {
  return lengths.map((length, index) => ({
    length,
    rowSpan: rowSpans[index] ?? 1,
  }));
}

Deno.test("field grid snaps long fields to half boundaries", () => {
  const positions = fieldGridPositions(fields([
    "long",
    "short",
    "short",
    "long",
    "long",
    "medium",
    "short",
    "long",
    "short",
    "short",
    "short",
  ])).map((position) => position.desktop);

  assertEquals(positions[7], {
    column: 5,
    row: 3,
    span: 4,
    rowSpan: 1,
  });
  assertEquals(
    [positions[0], positions[3], positions[4], positions[7]].map((item) =>
      item?.column
    ),
    [1, 1, 5, 5],
  );
  assertEquals(positions[5], {
    column: 1,
    row: 3,
    span: 2,
    rowSpan: 1,
  });
  assertEquals(positions[6], {
    column: 3,
    row: 3,
    span: 2,
    rowSpan: 1,
  });
});

Deno.test("incomplete rows expand in canonical grid units", () => {
  const positions = fieldGridPositions(fields([
    "short",
    "short",
    "short",
    "short",
    "short",
    "short",
    "long",
  ])).map((position) => position.desktop);

  assertEquals(
    positions.slice(0, 6).map(({ column, row, span }) => ({
      column,
      row,
      span,
    })),
    [
      { column: 1, row: 1, span: 1 },
      { column: 2, row: 1, span: 1 },
      { column: 3, row: 1, span: 1 },
      { column: 4, row: 1, span: 1 },
      { column: 5, row: 1, span: 2 },
      { column: 7, row: 1, span: 2 },
    ],
  );
  assertEquals(positions[6], {
    column: 1,
    row: 2,
    span: 8,
    rowSpan: 1,
  });
});

Deno.test("field grid preserves semantic proportions at each breakpoint", () => {
  const positions = fieldGridPositions(fields(["short", "medium", "long"]));
  assertEquals(positions[0], {
    mobile: { column: 1, row: 1, span: 2, rowSpan: 1 },
    tablet: { column: 1, row: 1, span: 2, rowSpan: 1 },
    desktop: { column: 1, row: 1, span: 2, rowSpan: 1 },
  });
  assertEquals(positions[1], {
    mobile: { column: 1, row: 2, span: 2, rowSpan: 1 },
    tablet: { column: 3, row: 1, span: 2, rowSpan: 1 },
    desktop: { column: 3, row: 1, span: 2, rowSpan: 1 },
  });
  assertEquals(positions[2], {
    mobile: { column: 1, row: 3, span: 2, rowSpan: 1 },
    tablet: { column: 1, row: 2, span: 4, rowSpan: 1 },
    desktop: { column: 5, row: 1, span: 4, rowSpan: 1 },
  });
});

Deno.test("row-spanning fields reserve cells below without reordering", () => {
  const positions = fieldGridPositions(fields(
    ["medium", "medium", "long", "long", "short"],
    { 0: 2 },
  )).map((position) => position.desktop);

  assertEquals(positions, [
    { column: 1, row: 1, span: 2, rowSpan: 2 },
    { column: 3, row: 1, span: 2, rowSpan: 1 },
    { column: 5, row: 1, span: 4, rowSpan: 1 },
    { column: 5, row: 2, span: 4, rowSpan: 1 },
    { column: 1, row: 3, span: 8, rowSpan: 1 },
  ]);
});

Deno.test("row spans reflow independently at responsive breakpoints", () => {
  const positions = fieldGridPositions(fields(
    ["long", "short", "short", "long"],
    { 0: 2 },
  ));

  assertEquals(positions[0], {
    mobile: { column: 1, row: 1, span: 2, rowSpan: 2 },
    tablet: { column: 1, row: 1, span: 4, rowSpan: 2 },
    desktop: { column: 1, row: 1, span: 4, rowSpan: 2 },
  });
  assertEquals(positions[3], {
    mobile: { column: 1, row: 4, span: 2, rowSpan: 1 },
    tablet: { column: 1, row: 4, span: 4, rowSpan: 1 },
    desktop: { column: 5, row: 2, span: 4, rowSpan: 1 },
  });
});

Deno.test("field grid rejects unbounded row spans", () => {
  assertThrows(
    () => fieldGridPositions([{ length: "long", rowSpan: 9 }]),
    TypeError,
    "rowSpan",
  );
});

Deno.test("responsive row-span plans preserve order, boundaries, and occupancy", () => {
  const modes: FieldGridMode[] = ["mobile", "tablet", "desktop"];
  const columns = { mobile: 2, tablet: 4, desktop: 8 };
  const minimumSpans = {
    mobile: { short: 1, medium: 2, long: 2 },
    tablet: { short: 1, medium: 2, long: 4 },
    desktop: { short: 1, medium: 2, long: 4 },
  } as const;
  const lengths: SemanticFieldLength[] = ["short", "medium", "long"];

  for (let seed = 0; seed < 64; seed++) {
    const items = Array.from({ length: 12 }, (_, index): FieldGridItem => ({
      length: lengths[(seed * 5 + index * 7) % lengths.length]!,
      rowSpan: (seed + index * 2) % 4 + 1,
    }));
    const positions = fieldGridPositions(items);
    for (const mode of modes) {
      const occupied = new Set<string>();
      let priorRow = 0;
      let priorColumn = 0;
      positions.forEach((responsive, index) => {
        const position = responsive[mode];
        const minimumSpan = minimumSpans[mode][items[index]!.length];
        assert(
          position.row > priorRow ||
            position.row === priorRow && position.column >= priorColumn,
          `${mode} reordered field ${index}`,
        );
        assertEquals((position.column - 1) % minimumSpan, 0);
        assert(position.column + position.span - 1 <= columns[mode]);
        for (
          let row = position.row;
          row < position.row + position.rowSpan;
          row++
        ) {
          for (
            let column = position.column;
            column < position.column + position.span;
            column++
          ) {
            const cell = `${row}:${column}`;
            assert(!occupied.has(cell), `${mode} overlapped ${cell}`);
            occupied.add(cell);
          }
        }
        priorRow = position.row;
        priorColumn = position.column;
      });
    }
  }
});
