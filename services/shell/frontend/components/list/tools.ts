import {
  type ListDataPage,
  type ListReadRequest,
  MAX_LIST_READ_SIZE,
  type ScreenListSnapshot,
} from "../../../../../screen_state.ts";
import { type MaterialIconName, renderIconText } from "../../icon_text.ts";
import {
  type Cell,
  clipboardHTML,
  delimited,
  EXPORT_FORMATS,
  type ExportFormat,
  listMatrix,
  textExport,
} from "./data.ts";

export interface ListToolCallbacks {
  read(request: ListReadRequest, signal?: AbortSignal): Promise<ListDataPage>;
}

export function iconButton(
  label: string,
  icon: MaterialIconName,
  action: () => void,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "data-list-icon-button";
  button.setAttribute("aria-label", label);
  button.title = label;
  renderIconText(button, `[[icon=${icon}]]`, { decorativeIcons: true });
  button.addEventListener("click", action);
  return button;
}

/** Toolbar, dialogs and their optional dependencies stay inside the list component. */
export class ListTools {
  #dialog?: HTMLDialogElement;
  #lifetime?: AbortController;
  #busy = false;
  #snapshot!: ScreenListSnapshot;
  #callbacks!: ListToolCallbacks;
  #buttons: HTMLButtonElement[] = [];
  readonly #feedback = document.createElement("output");
  #feedbackTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    this.#feedback.className = "data-list-tool-feedback";
    this.#feedback.hidden = true;
    this.#feedback.setAttribute("role", "status");
  }

  render(
    snapshot: ScreenListSnapshot,
    callbacks: ListToolCallbacks,
  ): HTMLElement[] {
    if (this.#snapshot && snapshot.revision !== this.#snapshot.revision) {
      this.close();
    }
    this.#snapshot = snapshot;
    this.#callbacks = callbacks;
    const readable = snapshot.pageSource === undefined || snapshot.readable;
    this.#buttons = [
      iconButton(
        "Display in table processor",
        "table_view",
        () => this.viewer(),
      ),
      iconButton("Export", "download", () => this.exportDialog()),
      iconButton("Copy page", "content_copy", () => this.copy(false)),
      iconButton("Copy all", "copy_all", () => this.copy(true)),
    ];
    if (!readable) {
      for (const i of [0, 1, 3]) {
        this.#buttons[i]!.disabled = true;
        this.#buttons[i]!.title +=
          ": this source only supplies its current page";
      }
    }
    return [...this.#buttons, this.#feedback];
  }

  close(): boolean {
    clearTimeout(this.#feedbackTimer);
    this.#feedback.hidden = true;
    this.#lifetime?.abort();
    const dialog = this.#dialog;
    if (!dialog) return false;
    dialog.close();
    return true;
  }

  private notify(message: string): void {
    this.#feedback.textContent = message;
    this.#feedback.hidden = false;
    clearTimeout(this.#feedbackTimer);
    this.#feedbackTimer = setTimeout(() => this.#feedback.hidden = true, 5000);
  }

  private dialog(title: string, className: string) {
    this.close();
    const lifetime = this.#lifetime = new AbortController();
    const dialog = this.#dialog = document.createElement("dialog");
    dialog.className = `uui-dialog data-list-dialog ${className}`;
    dialog.setAttribute("aria-label", title);
    const frame = document.createElement("div");
    frame.className = "uui-dialog-frame";
    const toolbar = document.createElement("div");
    toolbar.className = "uui-dialog-toolbar";
    const heading = document.createElement("h2");
    heading.className = "uui-dialog-title";
    heading.textContent = title;
    const close = iconButton("Close", "close", () => dialog.close());
    close.classList.add("uui-dialog-close");
    toolbar.append(heading, close);
    const body = document.createElement("div");
    body.className = "uui-dialog-body";
    const status = document.createElement("p");
    status.className = "data-list-status";
    status.setAttribute("role", "status");
    status.hidden = true;
    frame.append(toolbar, body, status);
    dialog.append(frame);
    const focus = document.activeElement;
    dialog.addEventListener("close", () => {
      lifetime.abort();
      dialog.remove();
      if (this.#dialog === dialog) this.#dialog = undefined;
      if (focus instanceof HTMLElement && focus.isConnected) {
        focus.focus({ preventScroll: true });
      }
    }, { once: true });
    document.body.append(dialog);
    dialog.showModal();
    return { dialog, body, toolbar, status, signal: lifetime.signal };
  }

  private async run(
    action: () => Promise<void>,
    status?: HTMLElement,
  ): Promise<void> {
    if (this.#busy) return;
    this.#busy = true;
    const disabled = this.#buttons.map((button) => button.disabled);
    this.#buttons.forEach((button) => button.disabled = true);
    const signal = this.#lifetime?.signal;
    let abort = () => {};
    try {
      await new Promise<void>((resolve, reject) => {
        abort = () => reject(signal?.reason);
        signal?.addEventListener("abort", abort, { once: true });
        action().then(resolve, reject);
      });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        const text = error instanceof Error
          ? error.message
          : "Could not complete the list action.";
        if (status?.isConnected) {
          status.textContent = text;
          status.hidden = false;
        } else this.notify(text);
      }
    } finally {
      signal?.removeEventListener("abort", abort);
      this.#busy = false;
      this.#buttons.forEach((button, i) =>
        button.disabled = disabled[i] ?? false
      );
    }
  }

  private read(
    snapshot: ScreenListSnapshot,
    offset: number,
    limit: number,
    signal?: AbortSignal,
  ): Promise<ListDataPage> {
    return this.#callbacks.read({
      id: snapshot.id,
      revision: snapshot.revision,
      offset,
      limit,
    }, signal);
  }

  private async rows(
    snapshot: ScreenListSnapshot,
    first = 1,
    last?: number,
    signal?: AbortSignal,
  ): Promise<Cell[][]> {
    // ponytail: browser memory holds the result; stream exports when real sizes require it.
    const rows: Cell[][] = [];
    let offset = first - 1;
    while (last === undefined || offset < last) {
      signal?.throwIfAborted();
      const page = await this.read(
        snapshot,
        offset,
        Math.min(
          MAX_LIST_READ_SIZE,
          last === undefined ? MAX_LIST_READ_SIZE : last - offset,
        ),
        signal,
      );
      signal?.throwIfAborted();
      rows.push(...listMatrix(snapshot.columns, page.rows));
      offset += page.rows.length;
      if (!page.more) break;
      if (page.rows.length === 0) {
        throw new Error("The list returned an empty page before its end.");
      }
    }
    return rows;
  }

  private copy(all: boolean): void {
    if (this.#busy) return;
    const snapshot = this.#snapshot;
    this.#lifetime = new AbortController();
    const signal = this.#lifetime.signal;
    void this.run(async () => {
      const rows = all
        ? this.rows(snapshot, 1, undefined, signal)
        : Promise.resolve(listMatrix(snapshot.columns, snapshot.rows));
      const matrix = rows.then((
        rows,
      ) => [snapshot.columns.map((column) => column.heading), ...rows]);
      // Start the clipboard write during the click, before asynchronous page reads.
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": matrix.then((rows) =>
              new Blob([delimited(rows, "\t")], { type: "text/plain" })
            ),
            "text/html": matrix.then((rows) =>
              new Blob([clipboardHTML(rows)], { type: "text/html" })
            ),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(delimited(await matrix, "\t"));
      }
      signal.throwIfAborted();
      this.notify(`Copied ${(await rows).length} rows.`);
    });
  }

  private viewer(): void {
    if (this.#busy) return;
    const snapshot = this.#snapshot;
    const { dialog, body, toolbar, status, signal } = this.dialog(
      "Table processor",
      "data-list-processor",
    );
    const controls = document.createElement("div");
    controls.className = "data-list-processor-controls";
    const size = document.createElement("select");
    for (const count of [100, 250, 500, 1000]) {
      size.add(new Option(String(count), String(count)));
    }
    size.value = "1000";
    const sizeLabel = document.createElement("label");
    sizeLabel.append("Rows per page ", size);
    const page = document.createElement("input");
    page.type = "number";
    page.min = "1";
    page.step = "1";
    page.value = "1";
    page.setAttribute("aria-label", "Page");
    const pages = document.createElement("span");
    const prev = iconButton(
      "Previous page",
      "keyboard_double_arrow_left",
      () => load(current - 1),
    );
    const next = iconButton(
      "Next page",
      "keyboard_double_arrow_right",
      () => load(current + 1),
    );
    const navigation = document.createElement("nav");
    navigation.className = "data-list-processor-pages";
    navigation.setAttribute("aria-label", "Table processor pages");
    navigation.append(prev, page, pages, next);
    controls.append(sizeLabel, navigation);
    toolbar.insertBefore(controls, toolbar.lastChild);
    const grid = document.createElement("div");
    grid.className = "data-list-grid";
    grid.setAttribute("aria-label", "List data, read only");
    body.append(grid);
    let current = 1;
    let total = snapshot.pageSource ? undefined : snapshot.totalItems;
    let table: {
      destroy(): void;
      replaceData(rows: Record<string, Cell>[]): Promise<void>;
      on(event: string, action: () => void): void;
      getRanges(): Array<{ getCells(): Array<Array<{ getValue(): Cell }>> }>;
    } | undefined;
    signal.addEventListener("abort", () => table?.destroy(), { once: true });
    const load = (requested: number) => {
      if (!Number.isSafeInteger(requested) || requested < 1 || this.#busy) {
        return;
      }
      void this.run(async () => {
        controls.inert = true;
        status.hidden = false;
        status.textContent = "Loading…";
        try {
          const limit = Number(size.value);
          const data = await this.read(
            snapshot,
            (requested - 1) * limit,
            limit,
            signal,
          );
          signal.throwIfAborted();
          if (requested > 1 && data.rows.length === 0) {
            page.value = String(current);
            throw new Error("This page is unavailable.");
          }
          total = data.totalItems ?? total;
          current = requested;
          page.value = String(current);
          const count = total === undefined
            ? undefined
            : Math.max(1, Math.ceil(total / limit));
          pages.textContent = `/ ${count ?? "…"}`;
          if (count === undefined) page.removeAttribute("max");
          else page.max = String(count);
          prev.disabled = current <= 1;
          next.disabled = !data.more;
          const values = listMatrix(snapshot.columns, data.rows).map((row) =>
            Object.fromEntries(row.map((cell, i) => [`c${i}`, cell]))
          );
          if (table) await table.replaceData(values);
          else {
            const css = document.createElement("link");
            css.rel = "stylesheet";
            css.href = "components/list/vendor/tabulator-6.3.1.css";
            const styleReady = new Promise<void>((resolve, reject) => {
              css.onload = () => resolve();
              css.onerror = () =>
                reject(new Error("Could not load the table stylesheet."));
            });
            document.head.append(css);
            signal.addEventListener("abort", () => css.remove(), {
              once: true,
            });
            const url = new URL(
              "components/list/vendor/tabulator-6.3.1.js",
              document.baseURI,
            ).href;
            const [module] = await Promise.all([import(url), styleReady]);
            signal.throwIfAborted();
            table = new module.TabulatorFull(grid, {
              height: "100%",
              layout: "fitDataStretch",
              data: values,
              selectableRange: 1,
              selectableRangeColumns: true,
              selectableRangeRows: true,
              selectableRangeClearCells: false,
              clipboard: "copy",
              clipboardCopyRowRange: "range",
              clipboardCopyStyled: false,
              clipboardCopyConfig: { columnHeaders: false, rowHeaders: false },
              // Tabulator's plain TSV does not quote tabs/newlines; keep all
              // clipboard paths on the component's spreadsheet serializer.
              clipboardCopyFormatter: (type: string) => {
                const cells = table!.getRanges()[0]?.getCells().map((row) =>
                  row.map((cell) =>
                    cell.getValue()
                  )
                ) ?? [];
                return type === "html"
                  ? clipboardHTML(cells)
                  : delimited(cells, "\t");
              },
              rowHeader: {
                formatter: "rownum",
                width: 54,
                headerSort: false,
                frozen: true,
                resizable: false,
              },
              columnDefaults: {
                headerSort: false,
                editor: false,
                formatter: "plaintext",
                width: 180,
              },
              columns: snapshot.columns.map((column, i) => ({
                title: column.heading,
                titleFormatter: "plaintext",
                field: `c${i}`,
              })),
              placeholder: "No items",
            });
            await new Promise<void>((resolve) =>
              table!.on("tableBuilt", resolve)
            );
          }
          signal.throwIfAborted();
          grid.dataset.rowCount = String(data.rows.length);
          status.hidden = true;
        } finally {
          controls.inert = false;
        }
      }, status);
    };
    size.addEventListener("change", () => load(1));
    page.addEventListener("change", () => {
      if (page.reportValidity()) load(page.valueAsNumber);
    });
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && event.target === page) {
        event.preventDefault();
        page.blur();
      }
    });
    load(1);
  }

  private exportDialog(): void {
    if (this.#busy) return;
    const snapshot = this.#snapshot;
    const { body, status, signal } = this.dialog(
      "Export list",
      "data-list-export",
    );
    const form = document.createElement("form");
    const format = document.createElement("select");
    for (const value of EXPORT_FORMATS) {
      format.add(new Option(value.toUpperCase(), value));
    }
    const first = document.createElement("input");
    const last = document.createElement("input");
    const total = snapshot.pageSource ? undefined : snapshot.totalItems;
    for (const input of [first, last]) {
      input.type = "number";
      input.min = "1";
      input.step = "1";
      if (total) input.max = String(total);
    }
    first.value = "1";
    first.required = true;
    if (total !== undefined) last.value = String(Math.max(1, total));
    last.placeholder = "Last row";
    for (
      const [text, input] of [["Format", format], ["First row", first], [
        "Last row",
        last,
      ]] as const
    ) {
      const label = document.createElement("label");
      label.append(text, input);
      form.append(label);
    }
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.textContent = "Export";
    submit.className = "button primary";
    form.append(submit);
    body.append(form);
    last.addEventListener("input", () => last.setCustomValidity(""));
    first.addEventListener("input", () => last.setCustomValidity(""));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (last.value && last.valueAsNumber < first.valueAsNumber) {
        last.setCustomValidity("Last row must be at or after first row.");
        last.reportValidity();
        return;
      }
      void this.run(async () => {
        submit.disabled = true;
        status.textContent = "Exporting…";
        status.hidden = false;
        try {
          const selected = format.value as ExportFormat;
          const rows = await this.rows(
            snapshot,
            first.valueAsNumber,
            last.value ? last.valueAsNumber : undefined,
            signal,
          );
          let blob: Blob;
          if (selected === "xlsx" || selected === "ods") {
            const url = new URL(
              "components/list/vendor/xlsx-0.20.3.mjs",
              document.baseURI,
            ).href;
            const xlsx = await import(url);
            signal.throwIfAborted();
            const workbook = xlsx.utils.book_new();
            xlsx.utils.book_append_sheet(
              workbook,
              xlsx.utils.aoa_to_sheet([
                snapshot.columns.map((column) => column.heading),
                ...rows,
              ]),
              "List",
            );
            blob = new Blob([
              xlsx.write(workbook, {
                bookType: selected,
                type: "array",
                compression: true,
              }),
            ], {
              type: selected === "xlsx"
                ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                : "application/vnd.oasis.opendocument.spreadsheet",
            });
          } else {
            const mime = {
              csv: "text/csv",
              json: "application/json",
              xml: "application/xml",
              yaml: "application/yaml",
            }[selected];
            blob = new Blob([textExport(selected, snapshot.columns, rows)], {
              type: `${mime};charset=utf-8`,
            });
          }
          signal.throwIfAborted();
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = `${
            snapshot.bind.replace(/[^a-zA-Z0-9_-]/g, "_") || "list"
          }.${selected}`;
          document.body.append(link);
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          status.textContent = `Exported ${rows.length} rows.`;
        } finally {
          submit.disabled = false;
        }
      }, status);
    });
  }
}
