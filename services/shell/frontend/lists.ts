import {
  type ListColumn,
  type ListQuery,
  type ListRequest,
  type ListSelection,
  MAX_LIST_QUERY_LENGTH,
  type ScreenElementState,
  type ScreenListSnapshot,
  type ScreenState,
} from "../../../screen_state.ts";
import { listValueText } from "../../../list_values.ts";
import { fieldMessagePopoverPosition } from "./field_message.ts";
import { renderIconText } from "./icon_text.ts";
import { listColumnWidths, listRowCapacity } from "./list_geometry.ts";
import { getPath, paginationItems } from "./model.ts";

export interface ListCallbacks {
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
  #popover: HTMLElement | undefined;
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
    const previousPopover = this.#popover;
    this.#popover = undefined;
    if (previousPopover?.matches(":popover-open")) {
      previousPopover.hidePopover();
    }
    this.host.replaceChildren();
    this.host.dataset.listId = snapshot.id;
    this.host.dataset.viewRevision = String(snapshot.revision);
    this.host.id = this.#prefix;
    this.#measures = [];
    const toolbar = document.createElement("div");
    toolbar.className = "data-list-toolbar";
    toolbar.hidden = !state.toolbarOpen;
    const actions = document.createElement("div");
    actions.className = "data-list-tools-actions";
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
    search.addEventListener("change", this.flushQuery);
    toolbar.append(actions, search);
    this.host.append(toolbar);
    this.#scroll = document.createElement("div");
    this.#scroll.className = "data-list-scroll";
    this.#restoreScroll = true;
    this.#table = document.createElement("table");
    this.#table.className = "data-list";
    const colgroup = document.createElement("colgroup");
    for (let index = 0; index <= snapshot.columns.length; index++) {
      colgroup.append(document.createElement("col"));
    }
    this.#table.append(colgroup);
    const head = this.#table.createTHead().insertRow();
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
        const icon = document.createElement("span");
        renderIconText(
          icon,
          `[[icon=${sorting === "asc" ? "arrow_upward" : "arrow_downward"}]]`,
          { decorativeIcons: true },
        );
        button.append(icon);
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
    const toolsCell = document.createElement("th");
    toolsCell.className = "data-list-tools-cell";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "data-list-tools-toggle";
    toggle.id = `${this.#prefix}-tools`;
    toggle.textContent = state.toolbarOpen ? "−" : "+";
    toggle.setAttribute("aria-label", "List tools");
    toggle.setAttribute("aria-expanded", String(state.toolbarOpen));
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
    toolsCell.append(toggle);
    head.append(toolsCell);
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
      for (const column of snapshot.columns) {
        const cell = row.insertCell();
        const text = document.createElement("span");
        text.className = "data-list-cell-text";
        const value = listValueText(
          column.key === "" ? item : getPath(item, column.key),
        );
        renderIconText(text, value);
        cell.append(text);
        cell.title = value;
        const reveal = (event: Event) => {
          if (text.scrollWidth <= text.clientWidth + 1) return;
          event.preventDefault();
          event.stopPropagation();
          this.closePopover();
          this.#openColumn = undefined;
          const popover = this.makePopover(cell, "Complete value");
          const content = document.createElement("div");
          content.className = "data-list-complete-value";
          content.textContent = value;
          popover.append(content);
          this.showPopover();
          popover.focus({ preventScroll: true });
        };
        cell.addEventListener("click", reveal);
        cell.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") reveal(event);
        });
      }
      row.insertCell().className = "data-list-tools-cell";
    });
    if (snapshot.rows.length === 0) {
      const cell = body.insertRow().insertCell();
      cell.colSpan = snapshot.columns.length + 1;
      cell.className = "data-list-empty";
      cell.textContent = snapshot.filtered ? "No matching items" : "No items";
    }
    this.#scroll.append(this.#table);
    this.host.append(this.#scroll, this.pagination());
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
    const widths = listColumnWidths(
      snapshot.columns.map((column) => column.length),
      this.host.clientWidth,
    );
    const cols = this.#table.querySelectorAll("col");
    widths.forEach((width, index) => cols[index]!.style.width = `${width}px`);
    cols[widths.length]!.style.width = "38px";
    this.#table.style.width = `${
      widths.reduce((sum, width) => sum + width, 38)
    }px`;
    for (const item of this.#measures) {
      const useShort = item.column.shortHeading !== undefined &&
        item.measure.offsetWidth > item.button.clientWidth - 26;
      item.full.hidden = useShort;
      item.short.hidden = !useShort;
    }
    for (
      const text of this.host.querySelectorAll<HTMLElement>(
        ".data-list-cell-text",
      )
    ) {
      const cell = text.parentElement!;
      const truncated = text.scrollWidth > text.clientWidth + 1;
      if (truncated) {
        cell.tabIndex = 0;
        cell.setAttribute("role", "button");
        cell.setAttribute("aria-label", `Show complete value: ${cell.title}`);
      } else {
        cell.removeAttribute("tabindex");
        cell.removeAttribute("role");
        cell.removeAttribute("aria-label");
      }
    }
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
    const bodyHeight = this.#table.tBodies[0]?.getBoundingClientRect().height ??
      rowHeight;
    const card = this.host.closest<HTMLElement>(".layout-list") ?? this.host;
    const cardStyle = getComputedStyle(card);
    const cardPadding = Number.parseFloat(cardStyle.paddingTop) +
      Number.parseFloat(cardStyle.paddingBottom);
    const overhead = this.host.getBoundingClientRect().height - bodyHeight +
      (card === this.host ? 0 : cardPadding);
    const modal = this.host.closest<HTMLElement>(".presentation-modal-body");
    const viewport = globalThis.visualViewport?.height ?? innerHeight;
    const chrome = modal === null
      ? document.querySelector(".navbar")?.getBoundingClientRect().height ?? 64
      : (modal.parentElement?.querySelector(".uui-dialog-toolbar")
        ?.getBoundingClientRect().height ?? 48) + 32;
    const preceding = modal === null
      ? card.getBoundingClientRect().top + scrollY - chrome
      : card.getBoundingClientRect().top - modal.getBoundingClientRect().top +
        modal.scrollTop;
    const pageSize = listRowCapacity(
      viewport,
      chrome,
      preceding,
      overhead,
      rowHeight,
    );
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

  private pagination(): HTMLElement {
    const snapshot = this.#snapshot;
    const navigation = document.createElement("nav");
    navigation.className = "data-list-pagination";
    navigation.setAttribute("aria-label", `Pages for ${snapshot.bind}`);
    const summary = document.createElement("span");
    summary.className = "data-list-page-summary";
    const start = snapshot.totalItems === 0
      ? 0
      : (snapshot.state.page - 1) * snapshot.state.pageSize + 1;
    const end = Math.min(
      snapshot.totalItems,
      snapshot.state.page * snapshot.state.pageSize,
    );
    summary.textContent = `${start}–${end} of ${snapshot.totalItems}${
      snapshot.filtered ? ` (filtered, total ${snapshot.totalSourceItems})` : ""
    }`;
    summary.title = summary.textContent;
    const pages = document.createElement("span");
    pages.className = "data-list-page-numbers";
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

  private openColumn(
    column: ListColumn,
    anchor: HTMLElement,
    focus = true,
  ): void {
    this.closePopover();
    this.#openColumn = column.key;
    const popover = this.makePopover(anchor, column.heading);
    const title = document.createElement("strong");
    renderIconText(title, column.heading);
    popover.append(title);
    for (
      const [label, direction] of [["[[icon=arrow_upward]] Ascending", "asc"], [
        "[[icon=arrow_downward]] Descending",
        "desc",
      ], ["Clear sort", null]] as const
    ) {
      const button = document.createElement("button");
      button.type = "button";
      renderIconText(button, label);
      button.addEventListener("click", () => {
        this.#draft.sort = direction === null
          ? null
          : { column: column.key, direction };
        this.queueQuery(true);
      });
      popover.append(button);
    }
    const label = document.createElement("label");
    label.textContent = "Filter";
    const input = document.createElement("input");
    input.id = `${this.#prefix}-filter-${column.id}`;
    label.htmlFor = input.id;
    input.type = "text";
    input.maxLength = MAX_LIST_QUERY_LENGTH;
    input.placeholder = column.semanticType === "number"
      ? "e.g. >= 10"
      : column.semanticType === "boolean"
      ? "true or false"
      : column.semanticType === "date" || column.semanticType === "datetime"
      ? "YYYY-MM-DD"
      : "Contains…";
    input.value = this.#draft.filters[column.key] ?? "";
    input.addEventListener("input", () => {
      this.#draft.filters[column.key] = input.value;
      this.queueQuery();
    });
    input.addEventListener("change", this.flushQuery);
    const clear = document.createElement("button");
    clear.type = "button";
    clear.textContent = "Clear filter";
    clear.addEventListener("click", () => {
      delete this.#draft.filters[column.key];
      input.value = "";
      this.queueQuery(true);
    });
    popover.append(label, input, clear);
    this.showPopover();
    if (focus) input.focus({ preventScroll: true });
  }

  private makePopover(anchor: HTMLElement, label: string): HTMLElement {
    const popover = document.createElement("div");
    popover.className = "data-list-popover";
    popover.popover = "auto";
    popover.setAttribute("role", "dialog");
    popover.tabIndex = -1;
    popover.setAttribute("aria-label", label);
    popover.addEventListener("toggle", (event) => {
      if (
        (event as ToggleEvent).newState === "closed" && !this.#rendering &&
        this.#popover === popover
      ) this.#openColumn = undefined;
    });
    popover.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.closePopover();
        this.#openColumn = undefined;
        anchor.focus({ preventScroll: true });
      }
    });
    this.host.append(popover);
    this.#popover = popover;
    this.#anchor = anchor;
    return popover;
  }

  private showPopover(): void {
    if (this.#popover?.isConnected) {
      this.#popover.showPopover();
      this.positionPopover();
    }
  }
  private positionPopover(): void {
    if (this.#popover === undefined || this.#anchor === undefined) return;
    const position = fieldMessagePopoverPosition(
      this.#anchor.getBoundingClientRect(),
      this.#popover.offsetWidth,
      this.#popover.offsetHeight,
      innerWidth,
      innerHeight,
    );
    this.#popover.style.top = `${position.top}px`;
    this.#popover.style.left = `${position.left}px`;
  }
  private closePopover(): void {
    this.#popover?.remove();
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
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#resize.disconnect();
    this.closePopover();
    this.host.remove();
  }
}
