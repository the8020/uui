/** Serializable screen state and list contracts, shared with the browser. */
import type { ScreenElement, ScreenElementDeclaration } from "./protocol.ts";
import type { ListQuery } from "/p/the8020/db/fields.ts";
import { validateJSON } from "./custom_elements.ts";
export type { ListQuery } from "/p/the8020/db/fields.ts";
export interface ScrollPosition {
  x: number;
  y: number;
}

export type ListValueType =
  | "text"
  | "number"
  | "decimal"
  | "boolean"
  | "date"
  | "datetime"
  | "json";
export type ColumnLength = "compact" | "short" | "medium" | "long";

export interface ListColumnOptions {
  id?: string;
  heading?: string;
  shortHeading?: string;
  length?: ColumnLength;
  semanticType?: ListValueType;
}

export interface ListOptions {
  /** Ordinary UUI elements displayed above the list, independent of List tools. */
  toolbar?: ScreenElementDeclaration[];
  key?: string;
  /** Boolean path relative to each row; enables whole-table checkbox selection. */
  selection?: string;
  display?: string[];
  headings?: Record<string, string>;
  columnOptions?: Record<string, ListColumnOptions>;
  triggerFilterEvents?: boolean;
}

export interface ListColumn extends ListColumnOptions {
  id: string;
  key: string;
  heading: string;
  description?: string;
  length: ColumnLength;
  semanticType: ListValueType;
}

export interface ListState {
  page: number;
  pageSize: number;
  measured: boolean;
  query: ListQuery;
  /** Server-owned unfiltered size (or observed lower bound) for page-source geometry. */
  sourceItems?: number;
}

export interface ScreenElementState {
  scroll: ScrollPosition;
  toolbarOpen: boolean;
  selectedTab?: string;
  list?: ListState;
  /** Component-owned metadata; at most 32,768 JSON characters per element. */
  data?: Record<string, unknown>;
}

export interface ScreenState {
  instanceId: string;
  version: number;
  scroll: ScrollPosition;
  elements: Record<string, ScreenElementState>;
}

/** Only browser-owned presentation state can be supplied by the browser. */
export interface ScreenStateUpdate {
  version: number;
  scroll: ScrollPosition;
  elements: Record<
    string,
    Pick<ScreenElementState, "scroll" | "toolbarOpen" | "selectedTab" | "data">
  >;
}

export interface ScreenListSnapshot {
  /** Internal component routing, assigned by callScreen. */
  channelNamespace?: string;
  toolbar?: ScreenElement[];
  id: string;
  bind: string;
  columns: ListColumn[];
  rows: unknown[];
  state: ListState;
  totalItems: number;
  totalSourceItems: number;
  totalPages: number;
  filtered: boolean;
  triggerFilterEvents: boolean;
  /** Retained providers support independent reads as well as visible browsing. */
  readable?: boolean;
  selection?: { bind: string; selectedItems: number };
  source?: { more: boolean; searchOnly?: boolean; totalItems?: number };
}

export interface ListReadRequest {
  id: string;
  offset: number;
  limit: number;
}

export interface ListDataPage {
  id: string;
  offset: number;
  rows: unknown[];
  totalItems?: number;
  more: boolean;
}

export const MAX_LIST_READ_SIZE = 1000;

export function validListRead(value: unknown): value is ListReadRequest {
  return isRecord(value) && typeof value.id === "string" &&
    value.id.length > 0 &&
    Number.isSafeInteger(value.offset) && Number(value.offset) >= 0 &&
    Number.isSafeInteger(value.limit) && Number(value.limit) > 0 &&
    Number(value.limit) <= MAX_LIST_READ_SIZE &&
    Number.isSafeInteger(Number(value.offset) + Number(value.limit));
}

export type ListRequest =
  | { id: string; operation: "page"; page: number }
  | { id: string; operation: "capacity"; pageSize: number }
  | { id: string; operation: "query"; query: ListQuery }
  | { id: string; operation: "refresh" }
  | {
    id: string;
    operation: "selection";
    selected: boolean;
    /** Inclusive positions in the complete filtered/sorted view; omit for all source rows. */
    range?: { from: number; to: number };
  };

export function validListRequests(value: unknown): value is ListRequest[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 200 &&
    value.every((item) => {
      if (
        !isRecord(item) || typeof item.id !== "string" || !item.id.length
      ) return false;
      const positive = (n: unknown) => Number.isSafeInteger(n) && Number(n) > 0;
      const keys = ["id", "operation"];
      let valid = false;
      if (item.operation === "page") {
        keys.push("page");
        valid = positive(item.page);
      } else if (item.operation === "capacity") {
        keys.push("pageSize");
        valid = positive(item.pageSize) &&
          Number(item.pageSize) <= MAX_LIST_PAGE_SIZE;
      } else if (item.operation === "query") {
        keys.push("query");
        valid = validListQuery(item.query);
      } else if (item.operation === "refresh") valid = true;
      else if (item.operation === "selection") {
        keys.push("selected", "range");
        valid = typeof item.selected === "boolean" &&
          (item.range === undefined ||
            isRecord(item.range) &&
              [item.range.from, item.range.to].every((n) =>
                Number.isSafeInteger(n) && Number(n) >= 0
              ) &&
              Object.keys(item.range).every((key) =>
                ["from", "to"].includes(key)
              ));
      }
      return valid && Object.keys(item).every((key) => keys.includes(key));
    });
}

export interface ListSelection {
  id: string;
  index: number;
}

export interface ListChange {
  id: string;
  rows: Array<{ index: number; value: unknown }>;
}

export function emptyListQuery(): ListQuery {
  return { search: "", filters: {}, sort: null };
}

export function initialElementState(): ScreenElementState {
  return { scroll: { x: 0, y: 0 }, toolbarOpen: false };
}

/** IDs are dictionary keys, including names inherited by ordinary JS objects. */
export function screenElement(
  screen: ScreenState,
  id: string,
): ScreenElementState {
  if (!Object.hasOwn(screen.elements, id)) {
    Object.defineProperty(screen.elements, id, {
      value: initialElementState(),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return screen.elements[id]!;
}

export function initialListState(): ListState {
  // The browser measures the real capacity after laying out the first row.
  return { page: 1, pageSize: 1, measured: false, query: emptyListQuery() };
}

export const MAX_LIST_PAGE_SIZE = 500;
export const MAX_LIST_QUERY_LENGTH = 2000;

export function validScroll(value: unknown): value is ScrollPosition {
  return isRecord(value) &&
    [value.x, value.y].every((coordinate) =>
      typeof coordinate === "number" && Number.isFinite(coordinate) &&
      coordinate >= 0 && coordinate <= 100_000_000
    );
}

export function validScreenStateUpdate(
  value: unknown,
): value is ScreenStateUpdate {
  return isRecord(value) && Number.isSafeInteger(value.version) &&
    Number(value.version) >= 0 &&
    validScroll(value.scroll) && isRecord(value.elements) &&
    Object.keys(value.elements).length <= 2000 &&
    Object.values(value.elements).every((item) =>
      isRecord(item) && validScroll(item.scroll) &&
      typeof item.toolbarOpen === "boolean" &&
      (item.data === undefined || validElementData(item.data)) &&
      (item.selectedTab === undefined ||
        typeof item.selectedTab === "string" && item.selectedTab.length > 0 &&
          item.selectedTab.length <= 256) &&
      Object.keys(item).every((key) =>
        ["scroll", "toolbarOpen", "selectedTab", "data"].includes(key)
      )
    ) &&
    Object.keys(value).every((key) =>
      ["version", "scroll", "elements"].includes(key)
    );
}

function validElementData(value: unknown): boolean {
  if (!isRecord(value)) return false;
  try {
    validateJSON(value, 0, new Set());
    return JSON.stringify(value).length <= 32_768;
  } catch {
    return false;
  }
}

export function validListQuery(value: unknown): value is ListQuery {
  const text = (item: unknown): item is string =>
    typeof item === "string" && item.length <= MAX_LIST_QUERY_LENGTH;
  return isRecord(value) && text(value.search) && isRecord(value.filters) &&
    Object.keys(value.filters).length <= 200 &&
    Object.values(value.filters).every(text) &&
    (value.sort === null ||
      isRecord(value.sort) && typeof value.sort.column === "string" &&
        (value.sort.direction === "asc" || value.sort.direction === "desc")) &&
    Object.keys(value).every((key) =>
      ["search", "filters", "sort"].includes(key)
    );
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
