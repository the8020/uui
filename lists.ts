import type { Model } from "./model.ts";
import { setPath } from "./bindings.ts";
import { fieldSchemas, z } from "/p/the8020/db/fields.ts";
import type { ValueHelpPage, ValueHelpRequest } from "/p/the8020/db/fields.ts";
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
import {
  type ControlDescriptor,
  type ListUpdateRequest,
  parseListUpdate,
  type ScreenElement,
} from "./protocol.ts";
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
  validListRequests,
} from "./screen_state.ts";

export interface ListTransactionContext {
  clientSequence?: number;
  afterReply?(complete: () => void): void;
}

export interface ListSourcePage {
  rows: unknown[];
  more: boolean;
  totalItems?: number;
  totalSourceItems?: number;
  /** Value-help sources may return their fixed schema; a changed contract is rejected. */
  schema?: z.ZodObject;
}
/** Programs choose the source; the list owns bounded paging and result state. */
export type ListSource = (request: {
  signal: AbortSignal;
  query: ListQuery;
  offset: number;
  limit: number;
}) => ListSourcePage | Promise<ListSourcePage>;
interface SourceEntry {
  read: ListSource;
  lifetime: AbortController;
  searchOnly?: boolean;
  result: ListSourcePage;
}
const listSources = new WeakMap<Model<object>, Map<string, SourceEntry>>();

/** Replace/dispose a retained provider, cancelling its outstanding work. */
export function setListSource(
  model: Model<object>,
  id: string,
  source: ListSource,
  options: { searchOnly?: boolean } = {},
): () => void {
  if (
    typeof source !== "function" || !id.length ||
    options.searchOnly !== undefined && typeof options.searchOnly !== "boolean"
  ) throw new TypeError("Invalid list source");
  let sources = listSources.get(model);
  if (!sources) listSources.set(model, sources = new Map());
  sources.get(id)?.lifetime.abort();
  const entry: SourceEntry = {
    read: source,
    lifetime: new AbortController(),
    result: { rows: [], more: false },
    ...options,
  };
  sources.set(id, entry);
  return () => {
    entry.lifetime.abort();
    if (sources.get(id) === entry) sources.delete(id);
  };
}

interface ListDefinition extends ListOptions {
  id: string;
  bind: string;
  columns: ListColumn[];
  rowSchema: z.ZodType;
  readOnly: boolean;
}

interface ListView {
  provider?: SourceEntry;
  version: number;
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
    readonly model?: Model<object>,
  ) {
    this.#screen = screen;
    const declared: Array<
      ListOptions & {
        id: string;
        bind: string;
        label?: string;
        readOnly?: boolean;
      }
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
        readOnly: control.readOnly,
      });
    }
    for (const declaration of declared) {
      if (this.#definitions.has(declaration.id)) {
        throw new TypeError(`duplicate list ID ${declaration.id}`);
      }
      validateListOptions(declaration);
      if (declaration.selection && this.source(declaration.id)) {
        throw new TypeError("list selection requires the complete bound array");
      }
      const array = schemaAtPath(schema, declaration.bind);
      const raw = array === undefined ? undefined : unwrap(array).schema;
      if (!(raw instanceof z.ZodArray)) {
        throw new TypeError(
          `list binding ${declaration.bind} must have an array schema`,
        );
      }
      const columns = buildColumns(raw.element as z.ZodType, declaration);
      this.#definitions.set(declaration.id, {
        ...declaration,
        columns,
        rowSchema: raw.element as z.ZodType,
        readOnly: declaration.readOnly === true ||
          ([...controls, ...header].find((control) =>
              control.id === declaration.id
            ) ??
              [...controls, ...header].find((control) =>
                control.bind === declaration.bind
              ))?.readOnly === true ||
          fieldSchemas(array!).some((item) =>
            item instanceof z.ZodReadonly ||
            fieldMetadata(item)?.readOnly === true
          ),
      });
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
      const provider = this.source(definition.id);
      const source = provider?.result?.rows ?? getPath(model, definition.bind);
      if (!Array.isArray(source)) {
        throw new TypeError(`list binding ${definition.bind} must be an array`);
      }
      const state = this.state(definition.id);
      const sourceText = JSON.stringify(source);
      const existing = this.#views.get(definition.id);
      if (definition.selection && provider) {
        throw new TypeError("list selection requires the complete bound array");
      }
      if (
        existing !== undefined && currentSource(existing, source, sourceText) &&
        existing.provider === provider &&
        existing.version === this.#screen.version &&
        JSON.stringify(existing.snapshot.state) === JSON.stringify(state)
      ) {
        result.push(existing.snapshot);
        continue;
      }
      const page: ListSourcePage = provider?.result ??
        { rows: source, more: false };
      const search = state.query.search.trim().toLocaleLowerCase("en");
      let indices = provider === undefined
        ? projectRows(source, definition.columns, state.query)
        : source.map((_, index) => index);
      const offset = (state.page - 1) * state.pageSize;
      const totalItems = provider === undefined
        ? indices.length
        : page.totalItems ?? offset + source.length;
      if (
        provider !== undefined && source.length > state.pageSize
      ) {
        throw new TypeError("list page source exceeds the requested capacity");
      }
      const totalPages = provider === undefined ||
          page.totalItems !== undefined
        ? Math.max(1, Math.ceil(totalItems / state.pageSize))
        : state.page + (page.more ? 1 : 0);
      state.page = Math.min(Math.max(1, state.page), totalPages);
      const allIndices = indices;
      if (provider === undefined) {
        indices = indices.slice(
          (state.page - 1) * state.pageSize,
          state.page * state.pageSize,
        );
      }
      const filtered = search.length > 0 ||
        Object.values(state.query.filters).some((value) => value.trim() !== "");
      if (provider !== undefined) {
        const observed = offset + source.length +
          (page.more ? 1 : 0);
        state.sourceItems = page.totalSourceItems ??
          (!filtered && page.totalItems !== undefined
            ? totalItems
            : Math.max(state.sourceItems ?? 0, observed));
      }
      const snapshot: ScreenListSnapshot = {
        ...(definition.toolbar === undefined
          ? {}
          : { toolbar: definition.toolbar as ScreenElement[] }),
        id: definition.id,
        bind: definition.bind,
        revision: ++this.#sequence,
        columns: definition.columns,
        rows: structuredClone(indices.map((index) => source[index])),
        state: structuredClone(state),
        totalItems,
        totalSourceItems: provider === undefined
          ? source.length
          : state.sourceItems!,
        ...(provider === undefined ? {} : {
          source: {
            more: page.more,
            totalItems: page.totalItems,
            searchOnly: provider!.searchOnly,
          },
        }),
        totalPages,
        filtered,
        triggerFilterEvents: definition.triggerFilterEvents ?? false,
        ...(definition.selection === undefined ? {} : {
          selection: {
            bind: definition.selection,
            selectedItems: source.filter((row) =>
              getPath(row, definition.selection!) === true
            ).length,
          },
        }),
        readable: true,
      };
      this.#views.set(definition.id, {
        provider,
        version: this.#screen.version,
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

  async readMessage(
    id: string,
    value: unknown,
    model: object,
    refresh: () => void,
    signal: AbortSignal,
  ): Promise<ListDataPage> {
    if (
      !validListRead(value) || value.id !== id ||
      Object.keys(value).some((key) =>
        !["id", "revision", "offset", "limit"].includes(key)
      )
    ) throw new TypeError("Invalid list read");
    try {
      return await this.read(value, model, signal);
    } catch (error) {
      if (error instanceof StaleListView) refresh();
      throw error;
    }
  }
  updateMessage(
    id: string,
    value: unknown,
    signal: AbortSignal,
    context: ListTransactionContext,
    transact: (
      request: ListUpdateRequest,
      signal: AbortSignal,
      context: ListTransactionContext,
    ) => Promise<unknown>,
  ): Promise<unknown> {
    const request = parseListUpdate(value);
    if (request.updates[0]!.id !== id) {
      throw new TypeError("List update namespace mismatch");
    }
    return transact(request, signal, context);
  }

  providerIDs(): string[] {
    return this.ids().filter((id) => this.source(id) !== undefined);
  }

  /** Stage every list-owned result before changing page state or source totals. */
  async prepareUpdates(
    requests: readonly ListRequest[],
    model: object,
    signal: AbortSignal,
  ) {
    this.validateRequests(requests, model);
    signal = AbortSignal.any([signal, this.model?.resetSignal ?? signal]);
    const version = this.#screen.version;
    const states = new Map<string, ListState>();
    const results = new Map<
      string,
      { source: SourceEntry; page: ListSourcePage }
    >();
    const events = [] as NonNullable<ReturnType<ScreenLists["update"]>>[];
    for (const request of requests) {
      const state = states.get(request.id) ??
        structuredClone(this.state(request.id));
      states.set(request.id, state);
      const event = this.update(request, state);
      if (event) events.push(event);
    }
    for (const [id, state] of states) {
      const source = this.source(id);
      if (!source) continue;
      let page = await this.readPage(id, source, {
        signal: AbortSignal.any([signal, source.lifetime.signal]),
        query: structuredClone(state.query),
        offset: (state.page - 1) * state.pageSize,
        limit: state.pageSize,
      });
      if (
        page.totalItems !== undefined &&
        state.page > Math.max(1, Math.ceil(page.totalItems / state.pageSize))
      ) {
        state.page = Math.max(1, Math.ceil(page.totalItems / state.pageSize));
        page = await this.readPage(id, source, {
          signal: AbortSignal.any([signal, source.lifetime.signal]),
          query: structuredClone(state.query),
          offset: (state.page - 1) * state.pageSize,
          limit: state.pageSize,
        });
      }
      results.set(id, { source, page });
    }
    const check = () => {
      signal.throwIfAborted();
      if (this.#screen.version !== version) {
        throw new StaleListView("Screen was reset");
      }
      for (const request of requests) {
        this.view(request.id, request.revision, model);
      }
      for (const [id, result] of results) {
        result.source.lifetime.signal.throwIfAborted();
        if (this.source(id) !== result.source) {
          throw new StaleListView("List source was replaced");
        }
      }
    };
    check();
    return {
      events,
      commit: () => {
        check();
        for (const [id, state] of states) Object.assign(this.state(id), state);
        for (const [id, result] of results) {
          result.source.result = result.page;
          this.#views.delete(id);
        }
      },
    };
  }

  private source(id: string): SourceEntry | undefined {
    return listSources.get(this.model!)?.get(id);
  }

  private async readPage(
    id: string,
    source: SourceEntry,
    request: Parameters<ListSource>[0],
  ): Promise<ListSourcePage> {
    request.signal.throwIfAborted();
    const aborted = Promise.withResolvers<never>();
    const abort = () => aborted.reject(request.signal.reason);
    request.signal.addEventListener("abort", abort, { once: true });
    let page: ListSourcePage;
    try {
      page = await Promise.race([source.read(request), aborted.promise]);
    } finally {
      request.signal.removeEventListener("abort", abort);
    }
    request.signal.throwIfAborted();
    if (
      !isRecord(page) || !Array.isArray(page.rows) ||
      page.rows.length > request.limit ||
      typeof page.more !== "boolean" || page.more && page.rows.length === 0 ||
      [page.totalItems, page.totalSourceItems].some((n) =>
        n !== undefined && (!Number.isSafeInteger(n) || Number(n) < 0)
      ) ||
      page.totalItems !== undefined &&
        (page.rows.length > 0 &&
            page.totalItems < request.offset + page.rows.length ||
          page.more && page.totalItems <= request.offset + page.rows.length) ||
      page.totalSourceItems !== undefined && page.totalItems !== undefined &&
        page.totalSourceItems < page.totalItems ||
      page.totalSourceItems !== undefined && page.rows.length > 0 &&
        page.totalSourceItems < request.offset + page.rows.length ||
      !page.more && page.totalItems !== undefined &&
        (page.rows.length > 0 || request.offset === 0) &&
        page.totalItems > request.offset + page.rows.length
    ) {
      throw new TypeError("invalid list provider result or total");
    }
    const schema = this.#definitions.get(id)!.rowSchema;
    if (
      page.schema !== undefined && (!(page.schema instanceof z.ZodObject) ||
        JSON.stringify(buildColumns(page.schema, {})) !==
          JSON.stringify(buildColumns(schema, {})))
    ) {
      throw new TypeError(
        "List provider schema changed; rebuild the screen contract",
      );
    }
    return {
      ...page,
      rows: schema.array().parse(page.rows),
      ...(page.totalItems === undefined && !page.more &&
          (page.rows.length > 0 || request.offset === 0)
        ? { totalItems: request.offset + page.rows.length }
        : {}),
    };
  }

  async read(
    request: ListReadRequest,
    model: object,
    signal = new AbortController().signal,
  ): Promise<ListDataPage> {
    signal = AbortSignal.any([signal, this.model?.resetSignal ?? signal]);
    signal.throwIfAborted();
    if (!validListRead(request)) throw new TypeError("invalid list read range");
    const view = this.view(request.id, request.revision, model);
    const data: ListDataPage = {
      id: request.id,
      revision: request.revision,
      offset: request.offset,
      rows: [],
      more: false,
    };
    if (view.snapshot.source === undefined) {
      data.rows = view.allIndices.slice(
        request.offset,
        request.offset + request.limit,
      )
        .map((index) => view.source[index]);
      data.totalItems = view.allIndices.length;
      data.more = request.offset + data.rows.length < data.totalItems;
    } else {
      const source = listSources.get(this.model!)?.get(request.id);
      if (!source) {
        throw new TypeError(
          "This list source does not provide independent reads.",
        );
      }
      signal = AbortSignal.any([signal, source.lifetime.signal]);
      do {
        const limit = Math.min(
          MAX_LIST_PAGE_SIZE,
          request.limit - data.rows.length,
        );
        signal.throwIfAborted();
        const page = await this.readPage(request.id, source, {
          signal,
          query: structuredClone(view.snapshot.state.query),
          offset: request.offset + data.rows.length,
          limit,
        });
        if (page.totalItems !== undefined) data.totalItems = page.totalItems;
        data.rows.push(...page.rows);
        data.more = page.more;
      } while (data.more && data.rows.length < request.limit);
      // An empty read beyond the end cannot establish the actual total.
      if (
        data.totalItems === undefined && !data.more &&
        (data.rows.length > 0 || request.offset === 0)
      ) {
        data.totalItems = request.offset + data.rows.length;
      }
      this.view(request.id, request.revision, model);
    }
    signal.throwIfAborted();
    this.view(request.id, request.revision, model);
    return structuredClone(data);
  }

  /** Array values travel only in element-specific projections, never as one shared slice. */
  presentModel(model: object): unknown {
    let result: object = model;
    for (const bind of this.bindings()) result = replacePath(result, bind, []);
    return structuredClone(result);
  }

  validateRequests(requests: readonly ListRequest[], model: object): void {
    if (!validListRequests(requests)) {
      throw new TypeError("invalid list updates");
    }
    const ids = new Set<string>();
    for (const request of requests) {
      const key = `${request.id}:${request.operation}`;
      if (ids.has(key)) throw new TypeError("duplicate list update");
      ids.add(key);
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
      } else if (request.operation === "selection") {
        if (
          this.#definitions.get(request.id)!.selection === undefined ||
          typeof request.selected !== "boolean" ||
          request.range !== undefined &&
            [request.range.from, request.range.to].some((index) =>
              !Number.isSafeInteger(index) || index < 0 ||
              index >= view.allIndices.length
            )
        ) {
          throw new TypeError("invalid list selection range or binding");
        }
      } else if (request.operation === "query") {
        normalizeQuery(request.query, view.snapshot.columns);
        if (
          view.snapshot.source?.searchOnly &&
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
    state = this.state(request.id),
  ): {
    id: string;
    bind: string;
    query: ListQuery;
    change: "search" | "filter" | "sort";
  } | undefined {
    const definition = this.#definitions.get(request.id)!;
    if (request.operation === "selection" || request.operation === "refresh") {
      return undefined;
    }
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
        definition.triggerFilterEvents
      ) {
        return {
          id: request.id,
          bind: definition.bind,
          query: structuredClone(query),
          change,
        };
      }
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

  applySelection(
    requests: readonly ListRequest[],
    source: object,
    candidate: Record<string, unknown>,
  ): Set<string> {
    const changed = new Set<string>();
    for (const request of requests) {
      if (request.operation !== "selection") continue;
      const view = this.view(request.id, request.revision, source);
      const definition = this.#definitions.get(request.id)!;
      const rows = getPath(candidate, definition.bind) as unknown[];
      const indices = request.range === undefined
        ? view.source.map((_, index) => index)
        : view.allIndices.slice(
          Math.min(request.range.from, request.range.to),
          Math.max(request.range.from, request.range.to) + 1,
        );
      for (const index of indices) {
        setPath(rows[index], definition.selection!, request.selected);
      }
      changed.add(definition.bind);
    }
    return changed;
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
      if (view.provider && change.rows.length > 0) {
        throw new TypeError("List providers do not support row edits");
      }
      if (definition.readOnly) throw new TypeError("This list is read-only");
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
        validateRowEdit(
          definition.rowSchema,
          view.source[original],
          edit.value,
        );
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
    const source = this.source(id)?.result?.rows ??
      getPath(model, definition.bind);
    if (
      view.snapshot.revision !== revision ||
      view.version !== this.#screen.version ||
      view.provider !== this.source(id) || !Array.isArray(source) ||
      !currentSource(view, source, JSON.stringify(source))
    ) {
      throw new StaleListView(
        "The list changed. Review its current rows and try again.",
      );
    }
    return view;
  }
}

function validateRowEdit(
  schema: z.ZodType,
  before: unknown,
  after: unknown,
): void {
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  if (
    fieldSchemas(schema).some((item) =>
      item instanceof z.ZodReadonly || fieldMetadata(item)?.readOnly
    )
  ) {
    throw new TypeError("This row field is read-only");
  }
  const raw = unwrap(schema).schema;
  if (raw instanceof z.ZodObject) {
    for (const [key, child] of Object.entries(raw.shape)) {
      validateRowEdit(
        child as z.ZodType,
        isRecord(before) ? before[key] : undefined,
        isRecord(after) ? after[key] : undefined,
      );
    }
  } else if (
    raw instanceof z.ZodArray && Array.isArray(before) && Array.isArray(after)
  ) {
    after.forEach((value, index) =>
      validateRowEdit(raw.element as z.ZodType, before[index], value)
    );
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
  if (options.selection !== undefined) {
    const selected = unwrapped instanceof z.ZodObject
      ? schemaAtPath(unwrapped, options.selection)
      : undefined;
    if (
      selected === undefined ||
      !(unwrap(selected).schema instanceof z.ZodBoolean) ||
      fieldSchemas(selected).some((item) =>
        item instanceof z.ZodReadonly || fieldMetadata(item)?.readOnly
      )
    ) {
      throw new TypeError(
        "list selection must bind an editable boolean row field",
      );
    }
  }
  const keys = (options.display ??
    (unwrapped instanceof z.ZodObject ? Object.keys(unwrapped.shape) : [""]))
    .filter((key) => key !== options.selection);
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

function projectRows(
  source: readonly unknown[],
  columns: readonly ListColumn[],
  query: ListQuery,
): number[] {
  const search = query.search.trim().toLocaleLowerCase("en");
  const indices = source.map((_, index) => index).filter((index) => {
    const row = source[index];
    if (
      search &&
      !columns.some((column) =>
        listValueText(columnValue(row, column.key)).toLocaleLowerCase("en")
          .includes(search)
      )
    ) return false;
    return columns.every((column) =>
      matchesListFilter(
        columnValue(row, column.key),
        query.filters[column.key] ?? "",
        column.semanticType,
      )
    );
  });
  const sort = query.sort;
  if (sort !== null) {
    const column = columns.find((column) => column.key === sort.column)!;
    indices.sort((a, b) =>
      (sort.direction === "asc" ? 1 : -1) *
        compareListValues(
          columnValue(source[a], column.key),
          columnValue(source[b], column.key),
          column.semanticType,
        ) || a - b
    );
  }
  return indices;
}

/** Apply the ordinary list query before paging an already available snapshot. */
export function queryValueHelp(
  schema: z.ZodObject,
  rows: Record<string, unknown>[],
  request: ValueHelpRequest,
): ValueHelpPage {
  const columns = buildColumns(schema, {});
  const query = normalizeQuery(request.query, columns);
  const indices = projectRows(rows, columns, query);
  return {
    schema,
    rows: indices.slice(request.offset, request.offset + request.limit).map((
      index,
    ) => rows[index]!),
    more: request.offset + request.limit < indices.length,
    totalItems: indices.length,
    totalSourceItems: rows.length,
  };
}
