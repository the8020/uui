import type {
  CustomElementDeclaration,
  CustomElementDescriptor,
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
      !["id", "module", "styles", "preserve", "config"].includes(key)
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
    };
  });
}

function validateJSON(
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
