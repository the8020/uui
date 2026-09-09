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
