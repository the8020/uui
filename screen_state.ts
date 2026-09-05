/** Serializable screen state and list contracts, shared with the browser. */
export interface ScrollPosition {
  x: number;
  y: number;
}

export type ListValueType =
  | "text"
  | "number"
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
  key?: string;
  display?: string[];
  headings?: Record<string, string>;
  columnOptions?: Record<string, ListColumnOptions>;
  triggerFilterEvents?: boolean;
}

export interface ListColumn extends ListColumnOptions {
  id: string;
  key: string;
  heading: string;
  length: ColumnLength;
  semanticType: ListValueType;
}

export interface ListQuery {
  search: string;
  filters: Record<string, string>;
  sort: { column: string; direction: "asc" | "desc" } | null;
}

export interface ListState {
  page: number;
  pageSize: number;
  measured: boolean;
  query: ListQuery;
}

export interface ScreenElementState {
  scroll: ScrollPosition;
  toolbarOpen: boolean;
  selectedTab?: string;
  list?: ListState;
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
    { scroll: ScrollPosition; toolbarOpen: boolean; selectedTab?: string }
  >;
}

export interface ScreenListSnapshot {
  id: string;
  bind: string;
  revision: number;
  columns: ListColumn[];
  rows: unknown[];
  state: ListState;
  totalItems: number;
  totalSourceItems: number;
  totalPages: number;
  filtered: boolean;
  triggerFilterEvents: boolean;
}

export type ListRequest =
  | { id: string; revision: number; operation: "page"; page: number }
  | { id: string; revision: number; operation: "capacity"; pageSize: number }
  | { id: string; revision: number; operation: "query"; query: ListQuery };

export interface ListSelection {
  id: string;
  revision: number;
  index: number;
}

export interface ListChange {
  id: string;
  revision: number;
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
      (item.selectedTab === undefined ||
        typeof item.selectedTab === "string" && item.selectedTab.length > 0 &&
          item.selectedTab.length <= 256) &&
      Object.keys(item).every((key) =>
        key === "scroll" || key === "toolbarOpen" || key === "selectedTab"
      )
    ) &&
    Object.keys(value).every((key) =>
      ["version", "scroll", "elements"].includes(key)
    );
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
