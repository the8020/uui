import {
  type ListColumn,
  type ListQuery,
  type ListRequest,
  type ListSelection,
  MAX_LIST_QUERY_LENGTH,
  type ScreenElementState,
  type ScreenListSnapshot,
  type ScreenState,
} from "../../../../../screen_state.ts";
import type { ScreenElement } from "../../../../../protocol.ts";
import { listValueText } from "../../../../../list_values.ts";
import { AnchoredPopover } from "../../popover.ts";
import {
  createOverflowText,
  disposeOverflowText,
  refreshOverflowText,
} from "../../overflow.ts";
import { renderIconText } from "../../icon_text.ts";
import { iconButton, type ListToolCallbacks, ListTools } from "./tools.ts";
import { listColumnWidths, listRowCapacity } from "./list_geometry.ts";
import { getPath, paginationItems } from "../../model.ts";

export interface ListCallbacks extends ListToolCallbacks {
  elements(elements: ScreenElement[]): HTMLElement[];
  request(updates: ListRequest[]): boolean;
  select(selection: ListSelection): void;
}

/** Keeps local query drafts/popovers alive while screen DOM is reconciled. */
export class ListRenderer {
  readonly #controllers = new Map<string, ListController>();
  #instance = "";
  #snapshots = new Map<string, ScreenListSnapshot>();
  #state!: ScreenState;
  #callbacks!: ListCallbacks;
  #prefix = "";
  #frame: number | undefined;

  constructor() {
    globalThis.addEventListener("resize", this.schedule);
    globalThis.visualViewport?.addEventListener("resize", this.schedule);
  }

  begin(
    snapshots: readonly ScreenListSnapshot[],
    state: ScreenState,
    prefix: string,
    callbacks: ListCallbacks,
  ): void {
    const instance = `${state.instanceId}:${state.version}`;
    if (instance !== this.#instance) {
      for (const controller of this.#controllers.values()) controller.dispose();
      this.#controllers.clear();
      this.#instance = instance;
    }
    this.#snapshots = new Map(
      snapshots.map((snapshot) => [snapshot.id, snapshot]),
    );
    this.#state = state;
    this.#callbacks = callbacks;
    this.#prefix = prefix;
    for (const [id, controller] of this.#controllers) {
      if (!this.#snapshots.has(id)) {
        controller.dispose();
        this.#controllers.delete(id);
      }
    }
  }

  render(id: string): HTMLElement {
    const snapshot = this.#snapshots.get(id);
    if (snapshot === undefined) throw new Error(`missing list snapshot ${id}`);
    let controller = this.#controllers.get(id);
    if (controller === undefined) {
      controller = new ListController(this.schedule);
      this.#controllers.set(id, controller);
    }
    const host = controller.render(
      snapshot,
      this.#state.elements[id]!,
      this.#prefix,
      this.#callbacks,
    );
    this.schedule();
    return host;
  }

  capture(): void {
    for (const controller of this.#controllers.values()) controller.capture();
  }

  closeTools(): boolean {
    let closed = false;
    for (const controller of this.#controllers.values()) {
      closed = controller.tools.close() || closed;
    }
    return closed;
  }

  schedule = (): void => {
    if (this.#frame !== undefined) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = undefined;
      // A draft can become due while another interaction owns the transport.
      // Retry on the next presentation/measurement without a polling timer.
      for (const controller of this.#controllers.values()) {
        if (controller.flushDueQuery()) return;
      }
      const updates: ListRequest[] = [];
      for (const controller of this.#controllers.values()) {
        const update = controller.measure();
        if (update !== undefined) updates.push(update);
      }
      if (updates.length > 0) this.#callbacks.request(updates);
    });
  };

  dispose(): void {
    if (this.#frame !== undefined) cancelAnimationFrame(this.#frame);
    globalThis.removeEventListener("resize", this.schedule);
    globalThis.visualViewport?.removeEventListener("resize", this.schedule);
    for (const controller of this.#controllers.values()) controller.dispose();
    this.#controllers.clear();
  }
}

class ListController {
  readonly tools = new ListTools();
  readonly host = document.createElement("div");
  readonly #resize: ResizeObserver;
  #snapshot!: ScreenListSnapshot;
  #state!: ScreenElementState;
  #callbacks!: ListCallbacks;
  #draft!: ListQuery;
  #draftPending = false;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #openColumn: string | undefined;
  #scroll!: HTMLElement;
  #table!: HTMLTableElement;
  #pagination!: HTMLElement;
  #popover: HTMLElement | undefined;
  #popoverController: AnchoredPopover | undefined;
  #anchor: HTMLElement | undefined;
  #measures: Array<
    {
      column: ListColumn;
      button: HTMLElement;
      measure: HTMLElement;
      full: HTMLElement;
      short: HTMLElement;
    }
  > = [];
  #prefix = "";
  #rendering = false;
  #restoreScroll = false;
  #selectionAnchor: number | undefined;
  #drag: AbortController | undefined;
  #filterFocus: { start: number | null; end: number | null } | undefined;

  constructor(readonly schedule: () => void) {
    this.host.className = "data-list-container";
    this.#resize = new ResizeObserver(schedule);
    this.#resize.observe(this.host);
  }

  render(
    snapshot: ScreenListSnapshot,
    state: ScreenElementState,
    prefix: string,
    callbacks: ListCallbacks,
  ): HTMLElement {
    this.capture();
    this.#drag?.abort();
    if (
      this.#snapshot &&
      (JSON.stringify(this.#snapshot.state.query) !==
          JSON.stringify(snapshot.state.query) ||
        this.#snapshot.totalSourceItems !== snapshot.totalSourceItems)
    ) this.#selectionAnchor = undefined;
    if (
      !this.#draftPending ||
      JSON.stringify(snapshot.state.query) === JSON.stringify(this.#draft)
    ) {
      this.#draft = structuredClone(snapshot.state.query);
      this.#draftPending = false;
    }
    this.#snapshot = snapshot;
    this.#state = state;
    this.#prefix = `${prefix}-list-${snapshot.id}`;
    this.#callbacks = callbacks;
    this.#rendering = true;
    const focused = document.activeElement;
    if (
      focused instanceof HTMLInputElement && this.#popover?.contains(focused)
    ) {
      this.#filterFocus = {
        start: focused.selectionStart,
        end: focused.selectionEnd,
      };
    }
    this.#popoverController?.dispose();
    this.#popoverController = undefined;
    this.#popover = undefined;
    disposeOverflowText(this.host);
    this.host.replaceChildren();
    this.host.dataset.listId = snapshot.id;
    this.host.dataset.viewRevision = String(snapshot.revision);
    this.reserveRows(snapshot.state.pageSize);
    this.host.id = this.#prefix;
    this.#measures = [];
    if (snapshot.toolbar?.length) {
      const customToolbar = document.createElement("div");
      customToolbar.className = "uui-elements data-list-custom-toolbar";
      customToolbar.append(...callbacks.elements(snapshot.toolbar));
      this.host.append(customToolbar);
    }
    const toolbar = document.createElement("div");
    toolbar.className = "data-list-toolbar";
    toolbar.id = `${this.#prefix}-toolbar`;
    toolbar.hidden = !state.toolbarOpen;
    const actions = document.createElement("div");
    actions.className = "data-list-tools-actions";
    actions.append(...this.tools.render(snapshot, callbacks));
    if (snapshot.state.query.sort !== null) {
      actions.append(
        iconButton("Clear all sorts", "filter_list_off", () => {
          this.#draft.sort = null;
          this.queueQuery(true);
        }),
      );
    }
    if (snapshot.filtered) {
      actions.append(
        iconButton("Clear all filters", "filter_alt_off", () => {
          this.#draft.search = "";
          this.#draft.filters = {};
          this.queueQuery(true);
        }),
      );
    }
    const search = document.createElement("input");
    search.type = "search";
    search.maxLength = MAX_LIST_QUERY_LENGTH;
    search.id = `${this.#prefix}-search`;
    search.className = "data-list-search";
    search.placeholder = "Search…";
    search.setAttribute("aria-label", "Search list");
    search.value = this.#draft.search;
    search.addEventListener("input", () => {
      this.#draft.search = search.value;
      this.queueQuery();
    });
    search.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        this.flushQuery();
      }
    });
    toolbar.append(actions, search);
    this.host.append(toolbar);
    this.#scroll = document.createElement("div");
    this.#scroll.className = "data-list-scroll";
    this.#restoreScroll = true;
    this.#table = document.createElement("table");
    this.#table.className = "data-list";
    const colgroup = document.createElement("colgroup");
    for (
      let index = 0;
      index < snapshot.columns.length + (snapshot.selection ? 1 : 0);
      index++
    ) {
      colgroup.append(document.createElement("col"));
    }
    this.#table.append(colgroup);
    const head = this.#table.createTHead().insertRow();
    if (snapshot.selection) {
      const cell = document.createElement("th");
      cell.scope = "col";
      cell.className = "data-list-selection";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.id = `${this.#prefix}-select-all`;
      checkbox.checked = snapshot.totalSourceItems > 0 &&
        snapshot.selection.selectedItems === snapshot.totalSourceItems;
      checkbox.indeterminate = snapshot.selection.selectedItems > 0 &&
        !checkbox.checked;
      checkbox.disabled = snapshot.totalSourceItems === 0;
      checkbox.setAttribute(
        "aria-label",
        checkbox.checked ? "Select none" : "Select all",
      );
      cell.title = checkbox.checked ? "Select none" : "Select all";
      cell.addEventListener("click", (event) => {
        if (event.target !== checkbox && !checkbox.disabled) checkbox.click();
      });
      checkbox.addEventListener("change", () => {
        this.#selectionAnchor = undefined;
        callbacks.request([{
          id: snapshot.id,
          revision: snapshot.revision,
          operation: "selection",
          selected: checkbox.checked,
        }]);
        checkbox.checked = snapshot.totalSourceItems > 0 &&
          snapshot.selection!.selectedItems === snapshot.totalSourceItems;
        checkbox.indeterminate = snapshot.selection!.selectedItems > 0 &&
          !checkbox.checked;
      });
      cell.append(checkbox);
      head.append(cell);
    }
    for (const column of snapshot.columns) {
      const cell = document.createElement("th");
      cell.scope = "col";
      cell.dataset.columnId = column.id;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "data-list-column-button";
      button.id = `${this.#prefix}-column-${column.id}`;
      button.setAttribute("aria-haspopup", "dialog");
      const full = document.createElement("span");
      full.className = "data-list-heading";
      renderIconText(full, column.heading);
      button.setAttribute(
        "aria-label",
        full.textContent || column.key || "Value",
      );
      const short = document.createElement("span");
      short.className = "data-list-heading data-list-short-heading";
      short.hidden = true;
      renderIconText(short, column.shortHeading ?? column.heading);
      const measure = document.createElement("span");
      measure.className = "data-list-heading-measure";
      measure.setAttribute("aria-hidden", "true");
      renderIconText(measure, column.heading);
      button.append(full, short);
      const sorting = snapshot.state.query.sort?.column === column.key
        ? snapshot.state.query.sort.direction
        : undefined;
      cell.setAttribute(
        "aria-sort",
        sorting === "asc"
          ? "ascending"
          : sorting === "desc"
          ? "descending"
          : "none",
      );
      if (sorting !== undefined) {
        button.append(this.sortIcon(sorting));
      }
      if (snapshot.state.query.filters[column.key]) {
        const icon = document.createElement("span");
        renderIconText(icon, "[[icon=filter_alt]]", { decorativeIcons: true });
        button.append(icon);
        button.classList.add("has-filter");
      }
      button.addEventListener("click", () => this.openColumn(column, button));
      cell.append(button, measure);
      head.append(cell);
      this.#measures.push({ column, button, measure, full, short });
    }
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "data-list-tools-toggle";
    toggle.id = `${this.#prefix}-tools`;
    toggle.textContent = state.toolbarOpen ? "−" : "+";
    toggle.setAttribute("aria-label", "List tools");
    toggle.setAttribute("aria-expanded", String(state.toolbarOpen));
    toggle.setAttribute("aria-controls", toolbar.id);
    toggle.title = snapshot.state.query.search
      ? `List tools — search: ${snapshot.state.query.search}`
      : "List tools";
    toggle.classList.toggle(
      "has-filter",
      snapshot.state.query.search.trim() !== "",
    );
    toggle.addEventListener("click", () => {
      state.toolbarOpen = !state.toolbarOpen;
      toolbar.hidden = !state.toolbarOpen;
      toggle.textContent = state.toolbarOpen ? "−" : "+";
      toggle.setAttribute("aria-expanded", String(state.toolbarOpen));
      if (state.toolbarOpen) search.focus({ preventScroll: true });
      this.schedule();
    });
    const body = this.#table.createTBody();
    snapshot.rows.forEach((item, index) => {
      const row = body.insertRow();
      row.tabIndex = 0;
      row.dataset.rowIndex = String(index);
      const select = () =>
        callbacks.select({
          id: snapshot.id,
          revision: snapshot.revision,
          index,
        });
      row.addEventListener("click", select);
      row.addEventListener("keydown", (event) => {
        if (
          event.target === row && (event.key === "Enter" || event.key === " ")
        ) {
          event.preventDefault();
          select();
        }
      });
      if (snapshot.selection) this.selectionCell(row, item, index);
      for (const column of snapshot.columns) {
        const cell = row.insertCell();
        const value = listValueText(
          column.key === "" ? item : getPath(item, column.key),
        );
        const overflow = createOverflowText(value, {
          label: "Show complete value",
          className: "data-list-cell-value",
        });
        overflow.querySelector(".overflow-text-content")!.classList.add(
          "data-list-cell-text",
        );
        cell.append(overflow);
      }
    });
    if (snapshot.rows.length === 0) {
      const cell = body.insertRow().insertCell();
      cell.colSpan = snapshot.columns.length + (snapshot.selection ? 1 : 0);
      cell.className = "data-list-empty";
      cell.textContent = snapshot.filtered ? "No matching items" : "No items";
    }
    this.#scroll.append(this.#table);
    const viewport = document.createElement("div");
    viewport.className = "data-list-viewport";
    viewport.append(toggle, this.#scroll);
    this.#pagination = this.pagination();
    this.host.append(viewport, this.#pagination);
    this.#rendering = false;
    return this.host;
  }

  capture(): void {
    const focused = document.activeElement;
    if (
      focused instanceof HTMLInputElement && this.#popover?.contains(focused)
    ) {
      this.#filterFocus = {
        start: focused.selectionStart,
        end: focused.selectionEnd,
      };
    }
    if (
      this.#scroll?.isConnected && this.#scroll.getClientRects().length > 0 &&
      this.#state !== undefined
    ) {
      this.#state.scroll = {
        x: this.#scroll.scrollLeft,
        y: this.#scroll.scrollTop,
      };
    }
  }

  measure(): ListRequest | undefined {
    if (
      !this.host.isConnected || this.host.getClientRects().length === 0 ||
      this.host.closest("[hidden]")
    ) return undefined;
    if (!this.#restoreScroll) this.capture();
    const snapshot = this.#snapshot;
    this.host.dataset.narrow = String(this.host.clientWidth < 600);
    const selectionWidth = snapshot.selection ? 36 : 0;
    const widths = listColumnWidths(
      snapshot.columns.map((column) => column.length),
      // clientWidth rounds up fractional card widths and can create overflow.
      this.#scroll.getBoundingClientRect().width - selectionWidth,
    );
    if (selectionWidth) widths.unshift(selectionWidth);
    const cols = this.#table.querySelectorAll("col");
    widths.forEach((width, index) => cols[index]!.style.width = `${width}px`);
    this.#table.style.width = `${
      widths.reduce((sum, width) => sum + width, 0)
    }px`;
    for (const item of this.#measures) {
      const useShort = item.column.shortHeading !== undefined &&
        item.measure.offsetWidth > item.button.clientWidth - 26;
      item.full.hidden = useShort;
      item.short.hidden = !useShort;
    }
    refreshOverflowText(this.host);
    this.#scroll.scrollLeft = this.#state.scroll.x;
    this.#restoreScroll = false;
    if (
      this.#openColumn !== undefined && !this.#popover?.matches(":popover-open")
    ) {
      const item = this.#measures.find((item) =>
        item.column.key === this.#openColumn
      );
      if (item !== undefined) this.openColumn(item.column, item.button, false);
    }
    if (
      this.#filterFocus !== undefined && this.#popover?.matches(":popover-open")
    ) {
      const input = this.#popover.querySelector("input");
      if (input !== null && input !== undefined) {
        input.focus({ preventScroll: true });
        input.setSelectionRange(this.#filterFocus.start, this.#filterFocus.end);
      }
      this.#filterFocus = undefined;
    }
    if (this.#popover?.matches(":popover-open")) this.positionPopover();
    const rowHeight = Number.parseFloat(
      getComputedStyle(this.host).getPropertyValue("--list-row-height"),
    ) || 36;
    const tableChrome = this.#table.getBoundingClientRect().height -
      (this.#table.tBodies[0]?.getBoundingClientRect().height ?? rowHeight);
    const scrollbar = this.#scroll.offsetHeight - this.#scroll.clientHeight;
    const card = this.host.closest<HTMLElement>(".layout-list") ?? this.host;
    const cardStyle = getComputedStyle(card);
    const cardPadding = Number.parseFloat(cardStyle.paddingTop) +
      Number.parseFloat(cardStyle.paddingBottom) +
      Number.parseFloat(cardStyle.borderTopWidth) +
      Number.parseFloat(cardStyle.borderBottomWidth);
    // Measure footer chrome even when hidden, then decide whether the source
    // needs it. Its own visibility must never change the capacity calculation.
    this.#pagination.hidden = false;
    const paginationHeight = this.#pagination.getBoundingClientRect().height;
    // Reserved blank space is body space, never overhead in the next measurement.
    const overhead = this.host.getBoundingClientRect().height -
      this.#scroll.getBoundingClientRect().height - paginationHeight +
      tableChrome + scrollbar +
      (card === this.host ? 0 : cardPadding);
    this.#pagination.hidden = snapshot.totalPages <= 1 && !snapshot.selection;
    const modal = this.host.closest<HTMLElement>(".presentation-modal-body");
    const viewport = globalThis.visualViewport?.height ?? innerHeight;
    let available = viewport -
      (document.querySelector(".navbar")?.getBoundingClientRect().height ??
        64) -
      24;
    if (modal !== null) {
      const frame = modal.parentElement!;
      const style = getComputedStyle(modal);
      available = Math.min(
        viewport,
        Number.parseFloat(getComputedStyle(frame).maxHeight),
      ) - (frame.querySelector(".uui-dialog-toolbar")
        ?.getBoundingClientRect().height ?? 48) -
        Number.parseFloat(style.paddingTop) -
        Number.parseFloat(style.paddingBottom);
    }
    const pageSize = listRowCapacity(
      available,
      overhead + (snapshot.selection ? paginationHeight : 0),
      rowHeight,
      snapshot.pageSource?.more ? Infinity : snapshot.totalSourceItems,
      snapshot.selection ? 0 : paginationHeight,
    );
    // Use the full source count even when the first view after reload is short
    // or empty. Leave rows at their natural height and reserve space below them.
    this.host.style.setProperty("--list-table-chrome", `${tableChrome}px`);
    this.host.style.setProperty("--list-scrollbar-height", `${scrollbar}px`);
    this.reserveRows(pageSize);
    if (pageSize !== snapshot.state.pageSize || !snapshot.state.measured) {
      return {
        id: snapshot.id,
        revision: snapshot.revision,
        operation: "capacity",
        pageSize,
      };
    }
    return undefined;
  }

  private reserveRows(pageSize: number): void {
    this.host.toggleAttribute(
      "data-pagination",
      !!this.#snapshot.selection || !!this.#snapshot.pageSource?.more ||
        this.#snapshot.totalSourceItems > pageSize,
    );
    this.host.style.setProperty(
      "--list-reserved-rows",
      String(
        this.#snapshot.pageSource?.more
          ? pageSize
          : Math.max(1, Math.min(this.#snapshot.totalSourceItems, pageSize)),
      ),
    );
  }

  private pagination(): HTMLElement {
    const snapshot = this.#snapshot;
    const navigation = document.createElement("nav");
    navigation.className = "data-list-pagination";
    navigation.hidden = snapshot.totalPages <= 1 && !snapshot.selection;
    navigation.setAttribute("aria-label", `Pages for ${snapshot.bind}`);
    const summary = document.createElement("span");
    summary.className = "data-list-page-summary";
    const start = snapshot.rows.length === 0
      ? 0
      : (snapshot.state.page - 1) * snapshot.state.pageSize + 1;
    const end = snapshot.rows.length === 0 ? 0 : Math.min(
      snapshot.totalItems,
      snapshot.state.page * snapshot.state.pageSize,
    );
    summary.textContent = snapshot.pageSource !== undefined &&
        snapshot.pageSource.totalItems === undefined
      ? `${start}–${end}`
      : `${start}–${end} of ${snapshot.totalItems}${
        snapshot.filtered
          ? ` (filtered, total ${snapshot.totalSourceItems})`
          : ""
      }`;
    if (snapshot.selection) {
      summary.textContent =
        `(${snapshot.selection.selectedItems} of ${snapshot.totalSourceItems} selected) · ${summary.textContent}`;
    }
    summary.title = summary.textContent;
    const pages = document.createElement("span");
    pages.className = "data-list-page-numbers";
    if (snapshot.totalPages <= 1) pages.style.visibility = "hidden";
    for (
      const item of paginationItems(snapshot.state.page, snapshot.totalPages)
    ) {
      if (item === "ellipsis") {
        const span = document.createElement("span");
        span.className = "data-list-page-ellipsis";
        span.textContent = "…";
        pages.append(span);
        continue;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = String(item);
      button.setAttribute("aria-label", `Page ${item}`);
      if (item === snapshot.state.page) {
        button.setAttribute("aria-current", "page");
        button.disabled = true;
      }
      button.addEventListener(
        "click",
        () =>
          this.#callbacks.request([{
            id: snapshot.id,
            revision: snapshot.revision,
            operation: "page",
            page: item,
          }]),
      );
      pages.append(button);
    }
    navigation.append(summary, pages);
    return navigation;
  }

  private selectionCell(
    row: HTMLTableRowElement,
    item: unknown,
    index: number,
  ): void {
    const snapshot = this.#snapshot;
    const cell = row.insertCell();
    cell.className = "data-list-selection";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = `${this.#prefix}-select-row-${
      (snapshot.state.page - 1) * snapshot.state.pageSize + index
    }`;
    checkbox.checked = getPath(item, snapshot.selection!.bind) === true;
    checkbox.setAttribute(
      "aria-label",
      `Select row ${
        (snapshot.state.page - 1) * snapshot.state.pageSize + index + 1
      }`,
    );
    cell.append(checkbox);
    const position = (snapshot.state.page - 1) * snapshot.state.pageSize +
      index;
    const range = (extend: boolean, end = position) => ({
      from: extend ? this.#selectionAnchor ?? position : position,
      to: end,
    });
    const commit = (
      selected: boolean,
      selectedRange: { from: number; to: number },
    ) => {
      if (
        this.#callbacks.request([{
          id: snapshot.id,
          revision: snapshot.revision,
          operation: "selection",
          selected,
          range: selectedRange,
        }])
      ) this.#selectionAnchor = selectedRange.from;
    };
    cell.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.detail === 0) {
        commit(
          getPath(item, snapshot.selection!.bind) !== true,
          range(event.shiftKey),
        );
      }
    });
    cell.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || !event.isPrimary) return;
      event.preventDefault();
      checkbox.focus({ preventScroll: true });
      this.#drag?.abort();
      const drag = this.#drag = new AbortController();
      const selected = getPath(item, snapshot.selection!.bind) !== true;
      const selectedRange = range(event.shiftKey);
      const paint = () => {
        for (const visible of this.#table.tBodies[0]!.rows) {
          const rowIndex = Number(visible.dataset.rowIndex);
          const input = visible.querySelector<HTMLInputElement>(
            ".data-list-selection input",
          );
          if (!input) continue;
          const absolute = (snapshot.state.page - 1) * snapshot.state.pageSize +
            rowIndex;
          input.checked =
            absolute >= Math.min(selectedRange.from, selectedRange.to) &&
              absolute <= Math.max(selectedRange.from, selectedRange.to)
              ? selected
              : getPath(snapshot.rows[rowIndex], snapshot.selection!.bind) ===
                true;
        }
      };
      paint();
      const options = { signal: drag.signal };
      globalThis.addEventListener("pointermove", (move) => {
        if (move.pointerId !== event.pointerId) return;
        const target = document.elementFromPoint(move.clientX, move.clientY)
          ?.closest<HTMLTableRowElement>("tr[data-row-index]");
        if (target && this.#table.contains(target)) {
          selectedRange.to =
            (snapshot.state.page - 1) * snapshot.state.pageSize +
            Number(target.dataset.rowIndex);
          paint();
        }
      }, options);
      const cancel = () => {
        drag.abort();
        for (const visible of this.#table.tBodies[0]!.rows) {
          const input = visible.querySelector<HTMLInputElement>(
            ".data-list-selection input",
          );
          if (input) {
            input.checked = getPath(
              snapshot.rows[Number(visible.dataset.rowIndex)],
              snapshot.selection!.bind,
            ) === true;
          }
        }
      };
      globalThis.addEventListener("pointerup", (up) => {
        if (up.pointerId !== event.pointerId) return;
        cancel();
        commit(selected, selectedRange);
      }, options);
      globalThis.addEventListener("pointercancel", cancel, options);
      globalThis.addEventListener("blur", cancel, options);
    });
  }

  private openColumn(
    column: ListColumn,
    anchor: HTMLElement,
    focus = true,
  ): void {
    const filterFocus = focus ? undefined : this.#filterFocus;
    this.closePopover();
    this.#filterFocus = filterFocus;
    this.#openColumn = column.key;
    const popover = this.makePopover(anchor, column.heading);
    const title = document.createElement("strong");
    renderIconText(title, column.heading);
    popover.append(title);
    if (column.description) {
      popover.append(createOverflowText(column.description, {
        label: `${column.heading}: full description`,
        preview: "markdown",
        maxCharacters: 100,
        className: "data-list-column-description",
      }));
    }
    if (this.#snapshot.pageSource?.searchOnly) {
      this.showPopover();
      return;
    }
    const sorts = document.createElement("div");
    sorts.className = "data-list-sorts";
    for (
      const direction of ["asc", "desc"] as const
    ) {
      const option = document.createElement("div");
      option.className = "data-list-sort-option";
      const selected = this.#draft.sort?.column === column.key &&
        this.#draft.sort.direction === direction;
      option.classList.toggle("is-selected", selected);
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Sort";
      button.append(this.sortIcon(direction));
      button.setAttribute(
        "aria-label",
        `Sort ${direction === "asc" ? "ascending" : "descending"}`,
      );
      button.setAttribute("aria-pressed", String(selected));
      button.addEventListener("click", () => {
        this.#draft.sort = { column: column.key, direction };
        this.confirmQuery();
      });
      option.append(button);
      if (selected) {
        option.append(iconButton("Clear sort", "close", () => {
          this.#draft.sort = null;
          this.confirmQuery();
        }));
      }
      sorts.append(option);
    }
    const field = document.createElement("div");
    field.className = "data-list-filter";
    const input = document.createElement("input");
    input.id = `${this.#prefix}-filter-${column.id}`;
    input.setAttribute("aria-label", `Filter ${title.textContent}`);
    input.type = "text";
    input.maxLength = MAX_LIST_QUERY_LENGTH;
    input.placeholder =
      column.semanticType === "number" || column.semanticType === "decimal"
        ? "Filter: e.g. >= 10"
        : column.semanticType === "boolean"
        ? "Filter: true or false"
        : column.semanticType === "date" || column.semanticType === "datetime"
        ? "Filter: YYYY-MM-DD"
        : "Filter: contains…";
    input.value = this.#draft.filters[column.key] ?? "";
    input.addEventListener("input", () => {
      this.#draft.filters[column.key] = input.value;
      clear.hidden = input.value.trim() === "";
      this.queueQuery();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        this.confirmQuery();
      }
    });
    const clear = iconButton("Clear filter", "close", () => {
      delete this.#draft.filters[column.key];
      input.value = "";
      this.confirmQuery();
    });
    clear.hidden = input.value.trim() === "";
    field.append(input, clear);
    popover.append(sorts, field);
    this.showPopover();
    if (focus) input.focus({ preventScroll: true });
  }

  private sortIcon(direction: "asc" | "desc"): HTMLElement {
    const icon = document.createElement("span");
    icon.className = "data-list-sort-icon";
    icon.dataset.direction = direction;
    renderIconText(icon, "[[icon=sort]]", { decorativeIcons: true });
    return icon;
  }

  private confirmQuery(): void {
    const anchor = this.#anchor;
    this.closePopover();
    anchor?.focus({ preventScroll: true });
    this.queueQuery(true);
  }

  private makePopover(anchor: HTMLElement, label: string): HTMLElement {
    const controller = new AnchoredPopover(anchor, label, {
      alignment: "start",
      onClose: () => {
        if (!this.#rendering && this.#popover === controller.element) {
          this.#openColumn = undefined;
        }
      },
    });
    const popover = controller.element;
    popover.classList.add("data-list-popover");
    this.host.append(popover);
    this.#popover = popover;
    this.#popoverController = controller;
    this.#anchor = anchor;
    return popover;
  }

  private showPopover(): void {
    if (this.#popover?.isConnected) {
      this.#popoverController?.show(false);
      refreshOverflowText(this.#popover);
    }
  }
  private positionPopover(): void {
    this.#popoverController?.position();
  }
  private closePopover(): void {
    this.#openColumn = undefined;
    this.#filterFocus = undefined;
    if (this.#popover) disposeOverflowText(this.#popover);
    this.#popoverController?.dispose();
    this.#popoverController = undefined;
    this.#popover = undefined;
  }
  private queueQuery(immediate = false): void {
    this.#draft.filters = Object.fromEntries(
      Object.entries(this.#draft.filters)
        .filter(([, value]) => value.trim() !== "").sort(([a], [b]) =>
          a.localeCompare(b)
        ),
    );
    this.#draftPending = true;
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
    if (immediate) this.flushQuery();
    else this.#timer = setTimeout(this.flushQuery, 250);
  }
  private flushQuery = (): void => {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
    this.flushDueQuery();
  };
  flushDueQuery(): boolean {
    if (
      !this.#draftPending || this.#timer !== undefined ||
      !this.host.isConnected || this.host.closest("[hidden]")
    ) return false;
    return this.#callbacks.request([{
      id: this.#snapshot.id,
      revision: this.#snapshot.revision,
      operation: "query",
      query: structuredClone(this.#draft),
    }]);
  }
  dispose(): void {
    this.#drag?.abort();
    this.tools.close();
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#resize.disconnect();
    this.closePopover();
    disposeOverflowText(this.host);
    this.host.remove();
  }
}
