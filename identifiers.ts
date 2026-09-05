/** Resolve authored and implicit identities before building a screen contract. */
export function resolveElementIDs<T extends { id?: string }>(
  items: readonly T[],
  fingerprint: (item: T) => unknown,
  prefix = "element",
  reserved: ReadonlySet<string> = new Set(),
): Array<T & { id: string }> {
  const occupied = new Set(reserved);
  const explicit = new Set<string>();
  for (const item of items) {
    if (item.id === undefined) continue;
    if (
      typeof item.id !== "string" || item.id.length === 0 ||
      item.id.length > 256 || explicit.has(item.id)
    ) {
      throw new TypeError(
        `duplicate or invalid explicit element ID ${item.id}`,
      );
    }
    occupied.add(item.id);
    explicit.add(item.id);
  }
  const occurrences = new Map<string, number>();
  return items.map((item) => {
    if (item.id !== undefined) return { ...item, id: item.id };
    const base = `${prefix}-${identityHash(canonical(fingerprint(item)))}`;
    let ordinal = (occurrences.get(base) ?? 0) + 1;
    let id = `${base}-${ordinal}`;
    while (occupied.has(id)) id = `${base}-${++ordinal}`;
    occurrences.set(base, ordinal);
    occupied.add(id);
    return { ...item, id };
  });
}

/** Reserve authored screen IDs before resolving any of its element kinds. */
export function explicitElementIDs(
  items: readonly { id?: string }[],
): Set<string> {
  const ids = new Set<string>();
  for (const item of items) {
    if (item.id === undefined) continue;
    if (
      typeof item.id !== "string" || item.id.length === 0 ||
      item.id.length > 256 || ids.has(item.id)
    ) {
      throw new TypeError(
        `duplicate or invalid explicit element ID ${item.id}`,
      );
    }
    ids.add(item.id);
  }
  return ids;
}

function canonical(value: unknown): string {
  if (value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${
      Object.entries(value).filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(
          ",",
        )
    }}`;
  }
  return JSON.stringify(value);
}

function identityHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
