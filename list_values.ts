import type { ListValueType } from "./screen_state.ts";

export function listValueText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

const collator = new Intl.Collator("en", { sensitivity: "base" });

export function compareListValues(
  left: unknown,
  right: unknown,
  type: ListValueType,
): number {
  // Nulls and empty values sort first ascending, last descending.
  const emptyLeft = left === null || left === undefined || left === "";
  const emptyRight = right === null || right === undefined || right === "";
  if (emptyLeft || emptyRight) return Number(emptyRight) - Number(emptyLeft);
  if (type === "number") return compareNumbers(Number(left), Number(right));
  if (type === "decimal") {
    const a = decimalParts(left);
    const b = decimalParts(right);
    return a === undefined || b === undefined
      ? Number(a !== undefined) - Number(b !== undefined)
      : compareDecimals(a, b);
  }
  if (type === "boolean") return Number(left === true) - Number(right === true);
  if (type === "date" || type === "datetime") {
    return compareNumbers(dateNumber(left), dateNumber(right));
  }
  return collator.compare(listValueText(left), listValueText(right));
}

export function matchesListFilter(
  value: unknown,
  filter: string,
  type: ListValueType,
): boolean {
  const text = filter.trim();
  if (text === "") return true;
  const empty = value === null || value === undefined || value === "";
  if (text === "is:empty") return empty;
  if (text === "is:not-empty") return !empty;
  if (text === "is:null") return value === null || value === undefined;
  if (empty) return false;
  if (type === "text" || type === "json") {
    return listValueText(value).toLocaleLowerCase("en").includes(
      text.toLocaleLowerCase("en"),
    );
  }
  if (type === "boolean") {
    const normalized = text.toLowerCase();
    return ["true", "yes", "1"].includes(normalized)
      ? value === true
      : ["false", "no", "0"].includes(normalized)
      ? value === false
      : false;
  }
  const match = /^(<=|>=|!=|=|<|>)?\s*(.+)$/.exec(text)!;
  const operand = match[2]!;
  if (type === "decimal") {
    const left = decimalParts(value);
    const right = decimalParts(operand);
    if (left === undefined || right === undefined) return false;
    return matchesComparison(compareDecimals(left, right), match[1]);
  }
  let left: number;
  let right: number;
  if (type === "number") {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(operand)) {
      return false;
    }
    left = Number(value);
    right = Number(operand);
  } else {
    if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(operand)) return false;
    left = dateNumber(value);
    right = dateNumber(operand);
    if (
      operand.length === 10 &&
      (match[1] === undefined || match[1] === "=" || match[1] === "!=")
    ) {
      left = Math.floor(left / 86_400_000);
      right = Math.floor(right / 86_400_000);
    }
  }
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  return matchesComparison(compareNumbers(left, right), match[1]);
}

function matchesComparison(comparison: number, operator?: string): boolean {
  switch (operator) {
    case "<":
      return comparison < 0;
    case "<=":
      return comparison <= 0;
    case ">":
      return comparison > 0;
    case ">=":
      return comparison >= 0;
    case "!=":
      return comparison !== 0;
    default:
      return comparison === 0;
  }
}

// Query operands may use a different scale from a stored value. Compare their
// exact integers at the same scale without converting either amount to Number.
function decimalParts(
  value: unknown,
): { integer: bigint; scale: number } | undefined {
  if (typeof value !== "string") return;
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (match === null) return;
  const fraction = match[3] ?? "";
  return {
    integer: BigInt(`${match[1]}${match[2]}${fraction}`),
    scale: fraction.length,
  };
}

function compareDecimals(
  left: { integer: bigint; scale: number },
  right: { integer: bigint; scale: number },
): number {
  const scale = Math.max(left.scale, right.scale);
  const a = left.integer * 10n ** BigInt(scale - left.scale);
  const b = right.integer * 10n ** BigInt(scale - right.scale);
  return a === b ? 0 : a < b ? -1 : 1;
}

function dateNumber(value: unknown): number {
  return value instanceof Date ? value.getTime() : Date.parse(String(value));
}

function compareNumbers(left: number, right: number): number {
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    return Number(Number.isFinite(left)) - Number(Number.isFinite(right));
  }
  return left === right ? 0 : left < right ? -1 : 1;
}
