import { z } from "@the8020/http";
import { fieldMetadata, schemaAtPath, unwrap } from "./fields.ts";
import { humanize } from "./humanize.ts";
import { resolveElementIDs } from "./identifiers.ts";
import type { LayoutDocument, LayoutNode } from "./layout.ts";
import { validateListOptions } from "./list_options.ts";
import {
  compareListValues,
  listValueText,
  matchesListFilter,
} from "./list_values.ts";
import type { ControlDescriptor } from "./protocol.ts";
import {
  initialListState,
  isRecord,
  type ListChange,
  type ListColumn,
  type ListDataPage,
  type ListOptions,
  type ListQuery,
  type ListReadRequest,
  type ListRequest,
  type ListSelection,
  type ListState,
  type ListValueType,
  MAX_LIST_PAGE_SIZE,
  screenElement,
  type ScreenListSnapshot,
  type ScreenState,
  validListQuery,
  validListRead,
} from "./screen_state.ts";

/** Reads the current query without changing the program's displayed page. */
export type ListReader = (request: {
  query: ListQuery;
  offset: number;
  /** At most MAX_LIST_PAGE_SIZE, also suitable for value-help providers. */
  limit: number;
}) =>
  | { rows: unknown[]; more: boolean }
  | Promise<{ rows: unknown[]; more: boolean }>;

interface ListDefinition extends ListOptions {
  id: string;
  bind: string;
  columns: ListColumn[];
}

interface ListView {
  source: unknown[];
  originals: unknown[];
  sourceText: string;
  indices: number[];
  allIndices: number[];
  snapshot: ScreenListSnapshot;
}

export class StaleListView extends Error {}

/** Owns all projections and displayed-to-source mappings for one screen call. */
export class ScreenLists {
  readonly #definitions = new Map<string, ListDefinition>();
  readonly #views = new Map<string, ListView>();
  readonly #screen: ScreenState;
  #sequence = 0;

  constructor(
    schema: z.ZodObject<z.ZodRawShape>,
    controls: readonly ControlDescriptor[],
    layout: LayoutDocument | undefined,
    screen: ScreenState,
    header: readonly ControlDescriptor[] = [],
    readonly readers: Readonly<Record<string, ListReader>> = {},
  ) {
    this.#screen = screen;
    const declared: Array<
      ListOptions & { id: string; bind: string; label?: string }
    > = [];
    const used = new Set<string>();
    const visit = (node: LayoutNode): void => {
      if (node.type === "list" && node.bind) {
        declared.push({ ...node, bind: node.bind });
      }
      for (const reference of node.controls ?? []) used.add(reference);
      for (const child of node.children ?? []) visit(child);
    };
    if (layout !== undefined) visit(layout.root);
    for (const control of [...controls, ...header]) {
      if (control.control !== "list" || control.hidden) continue;
      if (
        layout !== undefined && !header.includes(control) &&
        !used.has(control.id) && !used.has(control.bind)
      ) continue;
      declared.push({
        ...control.list,
        id: control.id,
        bind: control.bind,
        label: control.label,
      });
    }
    for (const declaration of declared) {
      if (this.#definitions.has(declaration.id)) {
        throw new TypeError(`duplicate list ID ${declaration.id}`);
      }
      validateListOptions(declaration);
      const array = schemaAtPath(schema, declaration.bind);
      const raw = array === undefined ? undefined : unwrap(array).schema;
      if (!(raw instanceof z.ZodArray)) {
        throw new TypeError(
          `list binding ${declaration.bind} must have an array schema`,
        );
      }
      const columns = buildColumns(raw.element as z.ZodType, declaration);
      this.#definitions.set(declaration.id, { ...declaration, columns });
      const element = screenElement(this.#screen, declaration.id);
      element.list ??= initialListState();
      // Dynamic schemas can remove columns; retire their filters and sort.
      element.list.query = normalizeQuery(element.list.query, columns, false);
    }
  }

  ids(): string[] {
    return [...this.#definitions.keys()];
  }
  bindings(): Set<string> {
    return new Set([...this.#definitions.values()].map((list) => list.bind));
  }

  present(model: object): ScreenListSnapshot[] {
    const result: ScreenListSnapshot[] = [];
    for (const definition of this.#definitions.values()) {
      const source = getPath(model, definition.bind);
      if (!Array.isArray(source)) {
        throw new TypeError(`list binding ${definition.bind} must be an array`);
      }
      const state = this.state(definition.id);
      const sourceText = JSON.stringify(source);
      const existing = this.#views.get(definition.id);
      if (
        existing !== undefined && currentSource(existing, source, sourceText) &&
        JSON.stringify(existing.snapshot.state) === JSON.stringify(state)
      ) {
        result.push(existing.snapshot);
        continue;
      }
      const search = state.query.search.trim().toLocaleLowerCase("en");
      let indices = source.map((_, index) => index).filter((index) => {
        if (definition.pageSource !== undefined) return true;
        const row = source[index];
        if (
          search &&
          !definition.columns.some((column) =>
            listValueText(columnValue(row, column.key)).toLocaleLowerCase("en")
              .includes(search)
          )
        ) return false;
        return definition.columns.every((column) =>
          matchesListFilter(
            columnValue(row, column.key),
            state.query.filters[column.key] ?? "",
            column.semanticType,
          )
        );
      });
      const offset = (state.page - 1) * state.pageSize;
      const totalItems = definition.pageSource === undefined
        ? indices.length
        : offset + source.length;
      if (
        definition.pageSource !== undefined && source.length > state.pageSize
      ) {
        throw new TypeError("list page source exceeds the requested capacity");
      }
      const sort = state.query.sort;
      if (sort !== null && definition.pageSource === undefined) {
        const column = definition.columns.find((column) =>
          column.key === sort.column
        )!;
        indices.sort((a, b) =>
          (sort.direction === "asc" ? 1 : -1) *
            compareListValues(
              columnValue(source[a], column.key),
              columnValue(source[b], column.key),
              column.semanticType,
            ) || a - b
        );
      }
      const totalPages = definition.pageSource === undefined
        ? Math.max(1, Math.ceil(totalItems / state.pageSize))
        : state.page + (definition.pageSource.more ? 1 : 0);
      state.page = Math.min(Math.max(1, state.page), totalPages);
      const allIndices = indices;
      if (definition.pageSource === undefined) {
        indices = indices.slice(
          (state.page - 1) * state.pageSize,
          state.page * state.pageSize,
        );
      }
      const snapshot: ScreenListSnapshot = {
        id: definition.id,
        bind: definition.bind,
        revision: ++this.#sequence,
        columns: definition.columns,
        rows: structuredClone(indices.map((index) => source[index])),
        state: structuredClone(state),
        totalItems,
        totalSourceItems: definition.pageSource === undefined
          ? source.length
          : totalItems + (definition.pageSource.more ? 1 : 0),
        ...(definition.pageSource === undefined
          ? {}
          : { pageSource: definition.pageSource }),
        totalPages,
        filtered: search.length > 0 ||
          Object.values(state.query.filters).some((value) =>
            value.trim() !== ""
          ),
        triggerFilterEvents: definition.triggerFilterEvents ?? false,
        readable: definition.pageSource === undefined ||
          Object.hasOwn(this.readers, definition.id),
      };
      this.#views.set(definition.id, {
        source,
        originals: [...source],
        sourceText,
        indices,
        allIndices,
        snapshot,
      });
      result.push(snapshot);
    }
    return result;
  }

  async read(request: ListReadRequest, model: object): Promise<ListDataPage> {
    if (!validListRead(request)) throw new TypeError("invalid list read range");
    const view = this.view(request.id, request.revision, model);
    const data: ListDataPage = {
      id: request.id,
      revision: request.revision,
      offset: request.offset,
      rows: [],
      more: false,
    };
    if (view.snapshot.pageSource === undefined) {
      data.rows = view.allIndices.slice(
        request.offset,
        request.offset + request.limit,
      )
        .map((index) => view.source[index]);
      data.totalItems = view.allIndices.length;
      data.more = request.offset + data.rows.length < data.totalItems;
    } else {
      if (!Object.hasOwn(this.readers, request.id)) {
        throw new TypeError(
          "This list source does not provide independent reads.",
        );
      }
      do {
        const limit = Math.min(
          MAX_LIST_PAGE_SIZE,
          request.limit - data.rows.length,
        );
        const page = await this.readers[request.id]!({
          query: structuredClone(view.snapshot.state.query),
          offset: request.offset + data.rows.length,
          limit,
        });
        if (
          !Array.isArray(page.rows) || page.rows.length > limit ||
          typeof page.more !== "boolean" ||
          (page.more && page.rows.length === 0)
        ) {
          throw new TypeError("invalid list reader result");
        }
        data.rows.push(...page.rows);
        data.more = page.more;
      } while (data.more && data.rows.length < request.limit);
      // An empty read beyond the end cannot establish the actual total.
      if (!data.more && (data.rows.length > 0 || request.offset === 0)) {
        data.totalItems = request.offset + data.rows.length;
      }
      this.view(request.id, request.revision, model);
    }
    return structuredClone(data);
  }

  /** Array values travel only in element-specific projections, never as one shared slice. */
  presentModel(model: object): unknown {
    let result: object = model;
    for (const bind of this.bindings()) result = replacePath(result, bind, []);
    return structuredClone(result);
  }

  validateRequests(requests: readonly ListRequest[], model: object): void {
    const ids = new Set<string>();
    for (const request of requests) {
      if (ids.has(request.id)) throw new TypeError("duplicate list update");
      ids.add(request.id);
      const view = this.view(request.id, request.revision, model);
      if (request.operation === "page") {
        if (
          !Number.isSafeInteger(request.page) || request.page < 1 ||
          request.page > view.snapshot.totalPages
        ) throw new TypeError("list page is out of bounds");
      } else if (request.operation === "capacity") {
        if (
          !Number.isSafeInteger(request.pageSize) || request.pageSize < 1 ||
          request.pageSize > MAX_LIST_PAGE_SIZE
        ) throw new TypeError("invalid list capacity");
      } else {
        normalizeQuery(request.query, view.snapshot.columns);
        if (
          view.snapshot.pageSource?.searchOnly &&
          (request.query.sort !== null ||
            Object.keys(request.query.filters).length > 0)
        ) {
          throw new TypeError("this list source supports quick search only");
        }
      }
    }
  }

  update(
    request: ListRequest,
  ): {
    id: string;
    bind: string;
    query: ListQuery;
    change: "search" | "filter" | "sort" | "page" | "capacity";
  } | undefined {
    const definition = this.#definitions.get(request.id)!;
    const state = this.state(request.id);
    if (request.operation === "page") state.page = request.page;
    else if (request.operation === "capacity") {
      const offset = (state.page - 1) * state.pageSize;
      state.pageSize = request.pageSize;
      state.page = Math.floor(offset / state.pageSize) + 1;
      state.measured = true;
    } else {
      const query = normalizeQuery(request.query, definition.columns);
      if (JSON.stringify(query) === JSON.stringify(state.query)) {
        return undefined;
      }
      const change = query.search !== state.query.search
        ? "search"
        : JSON.stringify(query.sort) !== JSON.stringify(state.query.sort)
        ? "sort"
        : "filter";
      state.query = query;
      state.page = 1;
      if (
        definition.triggerFilterEvents || definition.pageSource !== undefined
      ) {
        return {
          id: request.id,
          bind: definition.bind,
          query: structuredClone(query),
          change,
        };
      }
    }
    if (definition.pageSource !== undefined && request.operation !== "query") {
      return {
        id: request.id,
        bind: definition.bind,
        query: structuredClone(state.query),
        change: request.operation,
      };
    }
    return undefined;
  }

  select(
    selection: ListSelection,
    model: object,
  ): { value: unknown; bind: string; controlId: string } {
    const view = this.view(selection.id, selection.revision, model);
    const index = view.indices[selection.index];
    if (!Number.isSafeInteger(selection.index) || index === undefined) {
      throw new TypeError("invalid displayed row index");
    }
    const definition = this.#definitions.get(selection.id)!;
    const row = view.source[index];
    return {
      value: structuredClone(
        definition.key === undefined ? row : getPath(row, definition.key),
      ),
      bind: definition.bind,
      controlId: definition.id,
    };
  }

  applyEdits(
    changes: readonly ListChange[],
    source: object,
    candidate: Record<string, unknown>,
  ): Set<string> {
    const bindings = new Set<string>();
    const edited = new Set<string>();
    for (const change of changes) {
      const view = this.view(change.id, change.revision, source);
      const definition = this.#definitions.get(change.id)!;
      const rows = getPath(candidate, definition.bind);
      if (!Array.isArray(rows)) {
        throw new TypeError("invalid list edit binding");
      }
      for (const edit of change.rows) {
        const original = view.indices[edit.index];
        if (!Number.isSafeInteger(edit.index) || original === undefined) {
          throw new TypeError("invalid list edit index");
        }
        const identity = `${definition.bind}:${original}`;
        if (edited.has(identity)) {
          throw new TypeError("conflicting edits of the same source row");
        }
        edited.add(identity);
        rows[original] = structuredClone(edit.value);
      }
      bindings.add(definition.bind);
    }
    return bindings;
  }

  private state(id: string): ListState {
    const element = screenElement(this.#screen, id);
    return element.list ??= initialListState();
  }

  private view(id: string, revision: number, model: object): ListView {
    const definition = this.#definitions.get(id);
    const view = this.#views.get(id);
    if (definition === undefined || view === undefined) {
      throw new TypeError(`unknown list ${id}`);
    }
    const source = getPath(model, definition.bind);
    if (
      view.snapshot.revision !== revision || !Array.isArray(source) ||
      !currentSource(view, source, JSON.stringify(source))
    ) {
      throw new StaleListView(
        "The list changed. Review its current rows and try again.",
      );
    }
    return view;
  }
}

function currentSource(
  view: ListView,
  source: unknown[],
  text: string,
): boolean {
  return view.source === source && view.sourceText === text &&
    view.originals.length === source.length &&
    view.originals.every((item, index) => item === source[index]);
}

function normalizeQuery(
  query: ListQuery,
  columns: readonly ListColumn[],
  strict = true,
): ListQuery {
  if (!validListQuery(query)) throw new TypeError("invalid list query");
  const keys = new Set(columns.map((column) => column.key));
  if (
    strict &&
    (query.sort !== null && !keys.has(query.sort.column) ||
      Object.keys(query.filters).some((key) => !keys.has(key)))
  ) throw new TypeError("unknown query column");
  return {
    search: query.search,
    filters: Object.fromEntries(
      Object.entries(query.filters).filter(([key, value]) =>
        keys.has(key) && value.trim() !== ""
      ).sort(([a], [b]) => a.localeCompare(b)),
    ),
    sort: query.sort !== null && keys.has(query.sort.column)
      ? { column: query.sort.column, direction: query.sort.direction }
      : null,
  };
}

function buildColumns(
  row: z.ZodType,
  options: ListOptions & { label?: string },
): ListColumn[] {
  const unwrapped = unwrap(row).schema;
  if (
    options.key !== undefined &&
    (!(unwrapped instanceof z.ZodObject) ||
      schemaAtPath(unwrapped, options.key) === undefined)
  ) {
    throw new TypeError(`unknown list selection key ${options.key}`);
  }
  const keys = options.display ??
    (unwrapped instanceof z.ZodObject ? Object.keys(unwrapped.shape) : [""]);
  return resolveElementIDs(
    keys.map((key) => {
      const declared = key === ""
        ? row
        : unwrapped instanceof z.ZodObject
        ? schemaAtPath(unwrapped, key)
        : undefined;
      if (declared === undefined) {
        throw new TypeError(`unknown list column ${key}`);
      }
      const type = unwrap(declared).schema;
      const metadata = fieldMetadata(declared) ?? fieldMetadata(type);
      const semanticType: ListValueType =
        options.columnOptions?.[key]?.semanticType ??
          (metadata?.semanticType === "date" ||
              metadata?.semanticType === "datetime"
            ? metadata.semanticType
            : metadata?.storage?.type === "decimal"
            ? "decimal"
            : type.type === "number" || type.type === "bigint"
            ? "number"
            : type instanceof z.ZodBoolean
            ? "boolean"
            : type instanceof z.ZodDate
            ? "datetime"
            : type instanceof z.ZodObject || type instanceof z.ZodArray
            ? "json"
            : "text");
      return {
        ...options.columnOptions?.[key],
        key,
        semanticType,
        heading: options.columnOptions?.[key]?.heading ??
          options.headings?.[key] ?? metadata?.label ??
          (key === "" ? options.label ?? "Value" : humanize(key)),
        description: metadata?.description,
        length: options.columnOptions?.[key]?.length ?? metadata?.length ??
          (semanticType === "number" || semanticType === "decimal" ||
              semanticType === "boolean"
            ? "compact"
            : semanticType === "date" || semanticType === "datetime"
            ? "short"
            : "medium"),
      };
    }),
    (column) => ({
      key: column.key,
      heading: column.heading,
      semanticType: column.semanticType,
    }),
    "column",
  );
}

function columnValue(row: unknown, key: string): unknown {
  return key === "" ? row : getPath(row, key);
}

function getPath(model: unknown, path: string): unknown {
  let value = model;
  for (const segment of path.split(".")) {
    if (!isRecord(value) || !Object.hasOwn(value, segment)) return undefined;
    value = value[segment];
  }
  return value;
}

function replacePath(model: object, path: string, value: unknown): object {
  const [segment, ...rest] = path.split(".");
  const object = model as Record<string, unknown>;
  return {
    ...object,
    [segment!]: rest.length === 0
      ? value
      : replacePath(object[segment!] as object, rest.join("."), value),
  };
}
