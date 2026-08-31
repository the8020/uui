import type { LayoutDocument, LayoutNode } from "./layout.ts";
import type {
  ControlDescriptor,
  ScreenListPage,
  ScreenPagination,
} from "./protocol.ts";

export const DEFAULT_SCREEN_LIST_PAGE_SIZE = 25;

interface ListState {
  bind: string;
  page: number;
}

export class ScreenPaginator {
  readonly #pageSize: number;
  readonly #states = new Map<string, ListState>();

  constructor(
    model: unknown,
    controls: readonly ControlDescriptor[],
    layout?: LayoutDocument,
    pageSize = DEFAULT_SCREEN_LIST_PAGE_SIZE,
  ) {
    if (!Number.isSafeInteger(pageSize) || pageSize < 1) {
      throw new TypeError("screen list page size must be a positive integer");
    }
    this.#pageSize = pageSize;
    const bindings = new Set(
      controls.filter((control) => control.control === "list").map((control) =>
        control.bind
      ),
    );
    if (layout !== undefined) collectLayoutLists(layout.root, bindings);
    for (const bind of bindings) {
      if (Array.isArray(getPath(model, bind))) {
        this.#states.set(bind, { bind, page: 1 });
      }
    }
  }

  has(bind: string): boolean {
    return this.#states.has(bind);
  }

  mergeVisiblePage(
    bind: string,
    fullValue: unknown,
    visibleValue: unknown,
  ): unknown {
    const state = this.#states.get(bind);
    if (state === undefined) return visibleValue;
    if (!Array.isArray(fullValue) || !Array.isArray(visibleValue)) {
      throw new TypeError(`paginated binding ${bind} must be a list`);
    }
    if (visibleValue.length > this.#pageSize) {
      throw new TypeError(
        `paginated binding ${bind} exceeds its ${this.#pageSize}-record page`,
      );
    }
    const merged = fullValue;
    const start = (state.page - 1) * this.#pageSize;
    const sentCount = Math.min(
      this.#pageSize,
      Math.max(0, merged.length - start),
    );
    merged.splice(start, sentCount, ...structuredClone(visibleValue));
    return merged;
  }

  validatePageRequest(
    bind: string,
    currentPage: number,
    page: number,
    model: unknown,
  ): void {
    const state = this.#states.get(bind);
    if (state === undefined) {
      throw new TypeError(`unknown paginated list ${bind}`);
    }
    if (state.page !== currentPage) {
      throw new TypeError(`stale current page for paginated list ${bind}`);
    }
    const value = getPath(model, bind);
    if (!Array.isArray(value)) {
      throw new TypeError(`paginated binding ${bind} must be a list`);
    }
    const totalPages = listPageCount(value.length, this.#pageSize);
    if (!Number.isSafeInteger(page) || page < 1 || page > totalPages) {
      throw new TypeError(`page ${page} is outside paginated list ${bind}`);
    }
  }

  selectPage(bind: string, page: number, model: unknown): void {
    const state = this.#states.get(bind);
    const value = getPath(model, bind);
    if (state === undefined || !Array.isArray(value)) {
      throw new TypeError(`unknown paginated list ${bind}`);
    }
    state.page = Math.min(page, listPageCount(value.length, this.#pageSize));
  }

  present(model: unknown): { model: unknown; pagination: ScreenPagination } {
    let presented = model;
    const lists: ScreenListPage[] = [];
    for (const state of this.#states.values()) {
      const full = getPath(model, state.bind);
      if (!Array.isArray(full)) {
        throw new TypeError(`paginated binding ${state.bind} must be a list`);
      }
      const totalPages = listPageCount(full.length, this.#pageSize);
      state.page = Math.min(state.page, totalPages);
      const start = (state.page - 1) * this.#pageSize;
      presented = replacePath(
        presented,
        state.bind,
        full.slice(start, start + this.#pageSize),
      );
      lists.push({
        bind: state.bind,
        page: state.page,
        pageSize: this.#pageSize,
        totalItems: full.length,
        totalPages,
      });
    }
    return { model: structuredClone(presented), pagination: { lists } };
  }
}

function listPageCount(totalItems: number, pageSize: number): number {
  return Math.max(1, Math.ceil(totalItems / pageSize));
}

function collectLayoutLists(node: LayoutNode, bindings: Set<string>): void {
  if (node.type === "list" && node.bind !== undefined) bindings.add(node.bind);
  for (const child of node.children ?? []) collectLayoutLists(child, bindings);
}

function getPath(model: unknown, path: string): unknown {
  let current = model;
  for (const segment of path.split(".")) {
    if (
      current === null || typeof current !== "object" || Array.isArray(current)
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function replacePath(model: unknown, path: string, value: unknown): unknown {
  if (model === null || typeof model !== "object" || Array.isArray(model)) {
    throw new TypeError("screen model must be an object");
  }
  const segments = path.split(".");
  const replace = (current: unknown, index: number): unknown => {
    if (
      current === null || typeof current !== "object" ||
      Array.isArray(current)
    ) {
      throw new TypeError(`unknown binding ${path}`);
    }
    const copy = { ...(current as Record<string, unknown>) };
    const segment = segments[index]!;
    copy[segment] = index === segments.length - 1
      ? value
      : replace(copy[segment], index + 1);
    return copy;
  };
  return replace(model, 0);
}
