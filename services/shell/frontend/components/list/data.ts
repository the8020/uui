import type {
  ListColumn,
  ListDataPage,
  ScreenListDataMessage,
} from "../../../../../protocol.ts";
import { listValueText } from "../../../../../list_values.ts";
import { getPath } from "../../model.ts";

/** One bounded read at a time over the shell's existing interaction channel. */
export class ListDataChannel {
  #pending?: {
    sequence: number;
    resolve(page: ListDataPage): void;
    reject(error: Error): void;
    timer: ReturnType<typeof setTimeout>;
    cleanup(): void;
  };

  constructor(readonly finish: (sequence: number) => void) {}

  request(
    send: () => number | undefined,
    signal?: AbortSignal,
  ): Promise<ListDataPage> {
    signal?.throwIfAborted();
    if (this.#pending) {
      return Promise.reject(new Error("A list read is already running."));
    }
    const sequence = send();
    if (sequence === undefined) {
      return Promise.reject(
        new Error("The list is unavailable. Try again when connected."),
      );
    }
    return new Promise((resolve, reject) => {
      const abort = () =>
        this.fail(new DOMException("List action closed", "AbortError"));
      this.#pending = {
        sequence,
        resolve,
        reject,
        timer: setTimeout(
          () => this.fail("The list read timed out. Try again."),
          30_000,
        ),
        cleanup: () => signal?.removeEventListener("abort", abort),
      };
      signal?.addEventListener("abort", abort, { once: true });
    });
  }

  receive(message: ScreenListDataMessage): void {
    if (message.clientSequence !== this.#pending?.sequence) return;
    const pending = this.#take()!;
    pending.resolve(message.data);
  }

  fail(message: string | Error): boolean {
    const pending = this.#take();
    pending?.reject(
      typeof message === "string" ? new Error(message) : message,
    );
    return pending !== undefined;
  }

  #take() {
    const pending = this.#pending;
    this.#pending = undefined;
    if (pending) {
      clearTimeout(pending.timer);
      pending.cleanup();
      this.finish(pending.sequence);
    }
    return pending;
  }
}

export type Cell = string | number | boolean | null;

export function listMatrix(
  columns: readonly ListColumn[],
  rows: readonly unknown[],
): Cell[][] {
  return rows.map((row) =>
    columns.map((column) => {
      const value = column.key === "" ? row : getPath(row, column.key);
      return value == null
        ? null
        : typeof value === "number" || typeof value === "boolean"
        ? value
        : listValueText(value);
    })
  );
}

export function escapeXML(value: string): string {
  // XML 1.0 excludes these control characters.
  // deno-lint-ignore no-control-regex
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function delimited(rows: readonly Cell[][], separator: string): string {
  return rows.map((row) =>
    row.map((value) => {
      let text = String(value ?? "");
      // Spreadsheet applications otherwise interpret untrusted text as formulas.
      if (typeof value === "string" && /^\s*[=+@-]/u.test(text)) {
        text = "'" + text;
      }
      return text.includes(separator) || /["\r\n]/.test(text)
        ? `"${text.replace(/"/g, '""')}"`
        : text;
    }).join(separator)
  ).join("\r\n");
}

export function clipboardHTML(rows: readonly Cell[][]): string {
  return "<table>" +
    rows.map((row) =>
      "<tr>" + row.map((cell) =>
        `<td${
          typeof cell === "string"
            ? ' style="mso-number-format:\\@;white-space:pre-wrap"'
            : ""
        }>${escapeXML(String(cell ?? ""))}</td>`
      ).join("") + "</tr>"
    ).join("") + "</table>";
}

export const EXPORT_FORMATS = [
  "csv",
  "json",
  "xml",
  "yaml",
  "xlsx",
  "ods",
] as const;
export type ExportFormat = typeof EXPORT_FORMATS[number];

export function textExport(
  format: "csv" | "json" | "xml" | "yaml",
  columns: readonly ListColumn[],
  rows: Cell[][],
): string {
  if (format === "csv") {
    return "\uFEFF" +
      delimited([columns.map((column) => column.heading), ...rows], ",");
  }
  const keys = columns.map((column) => column.key || "value");
  if (format === "json") {
    return JSON.stringify(
      rows.map((row) =>
        Object.fromEntries(keys.map((key, i) => [key, row[i]]))
      ),
      null,
      2,
    );
  }
  if (format === "yaml") {
    return rows.length === 0
      ? "[]\n"
      : rows.map((row) =>
        keys.map((key, i) =>
          `${i === 0 ? "- " : "  "}${JSON.stringify(key)}: ${
            JSON.stringify(row[i])
          }`
        ).join("\n")
      ).join("\n") + "\n";
  }
  return '<?xml version="1.0" encoding="UTF-8"?>\n<rows>\n' +
    rows.map((row) =>
      "  <row>" + keys.map((key, i) =>
        `<cell name="${escapeXML(key)}"${
          row[i] === null ? ' null="true"' : ""
        }>${escapeXML(String(row[i] ?? ""))}</cell>`
      ).join("") + "</row>"
    ).join("\n") + "\n</rows>\n";
}
