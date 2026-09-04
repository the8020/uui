export function getPath(model: unknown, path: string): unknown {
  let current = model;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function setPath(model: unknown, path: string, value: unknown): void {
  if (model === null || typeof model !== "object") {
    throw new TypeError("screen model must be an object");
  }
  const segments = path.split(".");
  let current = model as Record<string, unknown>;
  for (const segment of segments.slice(0, -1)) {
    const next = current[segment];
    if (next === null || typeof next !== "object") {
      throw new TypeError(`unknown binding ${path}`);
    }
    current = next as Record<string, unknown>;
  }
  current[segments.at(-1)!] = value;
}

export function shouldRenderMessage(type: string): boolean {
  return type === "screen.show" || type === "screen.patch" ||
    type === "screen.close";
}

export function shouldAcceptServerMessage(
  type: string,
  sequence: number,
  lastSequence: number,
): boolean {
  return sequence > lastSequence ||
    (sequence === 0 && (type === "session.end" || type === "session.error"));
}

export function synchronizeClientSequence(
  current: number,
  processed: number | undefined,
): number {
  return processed === undefined ? current : Math.max(current, processed);
}

export function reconnectDelay(
  attempt: number,
  initial: number,
  maximum: number,
): number {
  return Math.min(maximum, initial * 2 ** Math.max(0, attempt));
}

export function shouldReconnectWebSocket(
  sessionEnded: boolean,
  closeCode: number,
): boolean {
  return !sessionEnded && closeCode !== 1000;
}

export type PaginationItem = number | "ellipsis";

export function paginationItems(
  currentPage: number,
  totalPages: number,
): PaginationItem[] {
  if (totalPages <= 0) return [];
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }
  if (currentPage <= 4) return [1, 2, 3, 4, 5, "ellipsis", totalPages];
  if (currentPage >= totalPages - 3) {
    return [
      1,
      "ellipsis",
      totalPages - 4,
      totalPages - 3,
      totalPages - 2,
      totalPages - 1,
      totalPages,
    ];
  }
  return [
    1,
    "ellipsis",
    currentPage - 1,
    currentPage,
    currentPage + 1,
    "ellipsis",
    totalPages,
  ];
}

export class DirtyBindings {
  #sequence = 0;
  #versions = new Map<string, number>();

  mark(bind: string): void {
    this.#versions.set(bind, ++this.#sequence);
  }

  bindings(): string[] {
    return [...this.#versions.keys()];
  }

  capture(): ReadonlyMap<string, number> {
    return new Map(this.#versions);
  }

  acknowledge(snapshot: ReadonlyMap<string, number>): void {
    for (const [bind, version] of snapshot) {
      if (this.#versions.get(bind) === version) this.#versions.delete(bind);
    }
  }

  clear(): void {
    this.#versions.clear();
  }
}
