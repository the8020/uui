import { isRecord, type ListOptions } from "./screen_state.ts";

export function validateListOptions(value: ListOptions): void {
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
        !["text", "number", "boolean", "date", "datetime", "json"].includes(
          String(option.semanticType),
        )
    ) {
      throw new TypeError("invalid list column options");
    }
  }
}
