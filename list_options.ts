import { isRecord, type ListOptions } from "./screen_state.ts";

export function validateElementDeclarations(value: unknown): void {
  if (!Array.isArray(value) || value.length > 200) {
    throw new TypeError(
      "elements must be an array of at most 200 UUI elements",
    );
  }
  for (const element of value) {
    if (!isRecord(element)) throw new TypeError("invalid UUI element");
    if (element.type === "separator") {
      if (Object.keys(element).some((key) => !["id", "type"].includes(key))) {
        throw new TypeError("separator accepts only type and id");
      }
    } else if (
      "type" in element ||
      !(typeof element.bind === "string" && element.bind.length > 0 ||
        typeof element.label === "string" && element.label.length > 0)
    ) {
      throw new TypeError(
        "element requires a control binding, action label, or separator type",
      );
    }
  }
}

export function validateListOptions(value: ListOptions): void {
  if (value.toolbar !== undefined) validateElementDeclarations(value.toolbar);
  if (value.selection !== undefined) {
    if (
      typeof value.selection !== "string" ||
      !value.selection.split(".").every((part) =>
        part.length > 0 &&
        !["__proto__", "prototype", "constructor"].includes(part)
      )
    ) {
      throw new TypeError(
        "list selection must be a nonempty boolean field path",
      );
    }
    if (value.pageSource !== undefined) {
      throw new TypeError(
        "list selection requires the complete bound array, not a page source",
      );
    }
  }
  if (
    value.triggerFilterEvents !== undefined &&
    typeof value.triggerFilterEvents !== "boolean"
  ) {
    throw new TypeError("triggerFilterEvents must be boolean");
  }
  if (
    value.key !== undefined &&
    (typeof value.key !== "string" || value.key.length === 0)
  ) {
    throw new TypeError("list key must be a nonempty path");
  }
  if (
    value.display !== undefined &&
    (!Array.isArray(value.display) ||
      !value.display.every((key) => typeof key === "string" && key.length > 0))
  ) {
    throw new TypeError("list display must contain column paths");
  }
  if (
    value.headings !== undefined &&
    (!isRecord(value.headings) ||
      !Object.values(value.headings).every((heading) =>
        typeof heading === "string" && heading.length > 0
      ))
  ) {
    throw new TypeError("list headings must be nonempty strings");
  }
  if (
    value.pageSource !== undefined && (
      !isRecord(value.pageSource) ||
      typeof value.pageSource.more !== "boolean" ||
      (value.pageSource.searchOnly !== undefined &&
        typeof value.pageSource.searchOnly !== "boolean") ||
      [value.pageSource.totalItems, value.pageSource.totalSourceItems].some(
        (count) =>
          count !== undefined &&
          (!Number.isSafeInteger(count) || count < 0),
      ) ||
      Object.keys(value.pageSource).some((key) =>
        !["more", "searchOnly", "totalItems", "totalSourceItems"].includes(key)
      )
    )
  ) throw new TypeError("invalid list page source");
  if (value.columnOptions === undefined) return;
  if (!isRecord(value.columnOptions)) {
    throw new TypeError("invalid list column options");
  }
  for (const option of Object.values(value.columnOptions)) {
    if (
      !isRecord(option) || Object.keys(option).some((key) =>
        !["id", "heading", "shortHeading", "length", "semanticType"].includes(
          key,
        )
      ) ||
      ["id", "heading", "shortHeading"].some((key) =>
        option[key] !== undefined &&
        (typeof option[key] !== "string" || option[key].length === 0)
      ) ||
      option.length !== undefined &&
        !["compact", "short", "medium", "long"].includes(
          String(option.length),
        ) ||
      option.semanticType !== undefined &&
        !["text", "number", "decimal", "boolean", "date", "datetime", "json"]
          .includes(
            String(option.semanticType),
          )
    ) {
      throw new TypeError("invalid list column options");
    }
  }
}
