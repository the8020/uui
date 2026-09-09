import type {
  CustomElementDeclaration,
  CustomElementDescriptor,
  CustomFallback,
} from "./protocol.ts";
import { resolveElementIDs } from "./identifiers.ts";
import { validBrowserAssetURL } from "./browser_assets.ts";

const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function validateCustomElements(
  value: readonly CustomElementDeclaration[] = [],
  reserved: ReadonlySet<string> = new Set(),
): CustomElementDescriptor[] {
  if (!Array.isArray(value) || value.length > 16) {
    throw new TypeError("custom elements must be an array of at most 16 items");
  }
  const ids = new Set<string>();
  return resolveElementIDs(
    value,
    (item) => ({ module: item.module, styles: item.styles }),
    "custom",
    reserved,
  ).map((item) => {
    const id = isRecord(item) ? item.id : undefined;
    const module = isRecord(item) ? item.module : undefined;
    const styles = isRecord(item) ? item.styles : undefined;
    const config = isRecord(item) ? item.config : undefined;
    if (
      !isRecord(item) || typeof id !== "string" || !identifier.test(id) ||
      !validBrowserAssetURL(module, "module") ||
      styles !== undefined && (!Array.isArray(styles) || styles.length > 8 ||
          !styles.every((value) => validBrowserAssetURL(value, "style"))) ||
      item.preserve !== undefined && typeof item.preserve !== "boolean" ||
      !isRecord(config)
    ) {
      throw new TypeError("invalid custom element descriptor");
    }
    const unknown = Object.keys(item).find((key) =>
      !["id", "module", "styles", "preserve", "config", "fallback"].includes(
        key,
      )
    );
    if (unknown !== undefined) {
      throw new TypeError(
        `custom element ${item.id} contains unsupported property ${unknown}`,
      );
    }
    if (ids.has(id)) {
      throw new TypeError(`duplicate custom element ID ${id}`);
    }
    ids.add(id);
    if (item.fallback !== undefined) validateFallback(item.fallback);
    validateJSON(config, 0, new Set());
    const encoded = JSON.stringify(config);
    if (encoded.length > 32_768) {
      throw new TypeError(
        `custom element ${id} configuration is too large`,
      );
    }
    return {
      id,
      module,
      ...(styles === undefined
        ? {}
        : { styles: [...new Set(styles as string[])] }),
      preserve: item.preserve,
      config: structuredClone(config),
      ...(item.fallback === undefined
        ? {}
        : { fallback: structuredClone(item.fallback) }),
    };
  });
}

function validateFallback(value: unknown): asserts value is CustomFallback {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) =>
      !["inputs", "outputs", "actions"].includes(key)
    )
  ) throw new TypeError("invalid custom fallback");
  const names = new Set<string>();
  for (const kind of ["inputs", "outputs", "actions"]) {
    const entries = value[kind] ?? [];
    if (!Array.isArray(entries) || entries.length > 32) {
      throw new TypeError(
        "custom fallback capabilities must be bounded arrays",
      );
    }
    for (const entry of entries) {
      if (
        !isRecord(entry) || typeof entry.name !== "string" ||
        !identifier.test(entry.name) || names.has(entry.name)
      ) {
        throw new TypeError("custom fallback requires unique capability names");
      }
      names.add(entry.name);
      if (
        entry.label !== undefined && typeof entry.label !== "string" ||
        entry.description !== undefined && typeof entry.description !== "string"
      ) throw new TypeError("fallback labels and descriptions must be text");
      if (kind === "actions") {
        if (
          typeof entry.label !== "string" || typeof entry.event !== "string" ||
          !entry.event || entry.event.length > 256
        ) {
          throw new TypeError("fallback actions require a label and event");
        }
      } else if (
        typeof entry.path !== "string" || entry.path.length > 256 ||
        entry.path.split(".").some((part) =>
          ["__proto__", "constructor", "prototype"].includes(part)
        ) || entry.path !== "" && !/^[\w]+(?:\.[\w]+)*$/.test(entry.path) ||
        entry.multiline !== undefined && typeof entry.multiline !== "boolean"
      ) {
        throw new TypeError("invalid fallback value path");
      }
      validateJSON(entry, 0, new Set());
    }
  }
  if (JSON.stringify(value).length > 16_384) {
    throw new TypeError("custom fallback is too large");
  }
}

export function validateJSON(
  value: unknown,
  depth: number,
  seen: Set<object>,
): void {
  if (depth > 8) {
    throw new TypeError("custom element configuration is too deep");
  }
  if (
    value === null || typeof value === "boolean" ||
    typeof value === "number" && Number.isFinite(value) ||
    typeof value === "string"
  ) return;
  if (typeof value !== "object") {
    throw new TypeError("custom element configuration must be JSON data");
  }
  if (seen.has(value)) {
    throw new TypeError("custom element configuration must not be cyclic");
  }
  seen.add(value);
  if (Array.isArray(value)) {
    if (value.length > 256) {
      throw new TypeError("custom element configuration array is too large");
    }
    for (const item of value) validateJSON(item, depth + 1, seen);
  } else {
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw new TypeError(
        "custom element configuration must use plain objects",
      );
    }
    const entries = Object.entries(value);
    if (entries.length > 128) {
      throw new TypeError("custom element configuration object is too large");
    }
    for (const [, item] of entries) validateJSON(item, depth + 1, seen);
  }
  seen.delete(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
