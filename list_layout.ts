import { isRecord, type ListQuery, validListQuery } from "./screen_state.ts";

export type ListLayout = {
  columns: string[];
  query: Pick<ListQuery, keyof ListQuery>;
};
export type LayoutCollection = {
  variants: Record<string, ListLayout>;
  defaultName: string | null;
};
export interface LayoutCatalog {
  personal: LayoutCollection;
  global: LayoutCollection;
  canManageGlobal: boolean;
}
export type LayoutCommand =
  | { operation: "list" }
  | { operation: "save"; global: boolean; name: string; layout: ListLayout }
  | { operation: "delete"; global: boolean; name: string }
  | { operation: "default"; global: boolean; name: string | null };

export function validListLayout(value: unknown): value is ListLayout {
  return isRecord(value) && Object.keys(value).length === 2 &&
    Array.isArray(value.columns) && value.columns.length > 0 &&
    value.columns.length <= 200 &&
    value.columns.every((key) =>
      typeof key === "string" && key.length <= 512 &&
      !key.split(".").some((part) =>
        ["__proto__", "prototype", "constructor"].includes(part)
      )
    ) && new Set(value.columns).size === value.columns.length &&
    validListQuery(value.query) &&
    Object.keys(value.query.filters).every((key) => key.length <= 512) &&
    (value.query.sort === null || value.query.sort.column.length <= 512) &&
    JSON.stringify(value).length <= 8192;
}

export function parseLayoutCommand(value: unknown): LayoutCommand {
  if (!isRecord(value)) throw new TypeError("Invalid layout command");
  if (value.operation === "list" && Object.keys(value).length === 1) {
    return value as LayoutCommand;
  }
  const keys = ["operation", "global", "name"];
  if (value.operation === "save") keys.push("layout");
  if (
    !keys.includes("layout") &&
      !["delete", "default"].includes(String(value.operation)) ||
    typeof value.global !== "boolean" ||
    !(value.operation === "default" && value.name === null ||
      typeof value.name === "string" && value.name.trim() === value.name &&
        value.name.length > 0 && value.name.length <= 80 &&
        !["__proto__", "prototype", "constructor"].includes(value.name)) ||
    value.operation === "save" && !validListLayout(value.layout) ||
    Object.keys(value).some((key) => !keys.includes(key))
  ) {
    throw new TypeError("Invalid layout command");
  }
  return value as unknown as LayoutCommand;
}

export function parseLayoutCollection(value: unknown): LayoutCollection {
  if (
    !isRecord(value) || !isRecord(value.variants) ||
    Object.keys(value.variants).length > 50 ||
    !(value.defaultName === null || typeof value.defaultName === "string") ||
    Object.entries(value.variants).some(([name, layout]) => {
      try {
        parseLayoutCommand({ operation: "save", global: false, name, layout });
        return false;
      } catch {
        return true;
      }
    }) ||
    value.defaultName !== null &&
      !Object.hasOwn(value.variants, value.defaultName)
  ) {
    throw new TypeError("Invalid stored layouts");
  }
  return value as unknown as LayoutCollection;
}

export function emptyLayouts(): LayoutCollection {
  return { variants: {}, defaultName: null };
}
