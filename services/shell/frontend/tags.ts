import type { FieldMultiple } from "/p/the8020/uui/protocol.ts";
import {
  joinMultiple,
  multipleLiteral,
  splitMultiple,
} from "/p/the8020/db/multiple.ts";

/**
 * The values of a field holding several, as the tags control shows and edits
 * them: array elements, or a separated text's values as written.
 */
export function tagEntries(value: unknown, multiple: FieldMultiple): string[] {
  if (multiple.separator === undefined) {
    return Array.isArray(value) ? value.map((item) => String(item)) : [];
  }
  return typeof value === "string"
    ? splitMultiple(value, { separator: multiple.separator })
    : [];
}

/** The model value for edited entries: an array, or the joined text. */
export function tagValue(
  entries: readonly string[],
  multiple: FieldMultiple,
): unknown {
  if (multiple.separator === undefined) return [...entries];
  // No values is no text, which optional fields accept; "" would not parse.
  return entries.length === 0
    ? undefined
    : joinMultiple(entries, { separator: multiple.separator });
}

/** What a tag reads as: the literal, or the written value using grammar. */
export function tagLabel(entry: string, multiple: FieldMultiple): string {
  if (multiple.separator === undefined) return entry;
  return multipleLiteral(entry, {
    separator: multiple.separator,
    escape: multiple.escape,
  }) ?? entry;
}

/**
 * Typed text becomes entries. In separated text it is written in the field's
 * grammar (`7500-7599` stays a range) and may hold several values.
 */
export function typedEntries(text: string, multiple: FieldMultiple): string[] {
  if (multiple.separator === undefined) {
    const value = text.trim();
    return value === "" ? [] : [value];
  }
  return splitMultiple(text, { separator: multiple.separator });
}

/** Add entries once, in order; existing entries keep their place. */
export function addEntries(
  entries: readonly string[],
  added: readonly string[],
): string[] {
  const result = [...entries];
  for (const entry of added) if (!result.includes(entry)) result.push(entry);
  return result;
}

export function renderTags(
  input: HTMLInputElement,
  value: unknown,
  multiple: FieldMultiple,
  readOnly: boolean,
  change: (value: unknown) => void,
): HTMLElement {
  const container = document.createElement("div");
  container.className = "field-tags";
  let entries = tagEntries(value, multiple);
  const placeholder = input.placeholder;
  // Edits redraw at once; the screen confirms them on its next roundtrip.
  const update = (next: string[]) => {
    entries = next;
    change(tagValue(entries, multiple));
    draw();
  };
  const draw = () => {
    for (const tag of container.querySelectorAll(".field-tag")) tag.remove();
    for (const [index, entry] of entries.entries()) {
      input.before(renderTag(entry, index));
    }
    const full = multiple.maximum !== undefined &&
      entries.length >= multiple.maximum;
    input.disabled = !readOnly && full;
    input.placeholder = full ? `At most ${multiple.maximum}` : placeholder;
  };
  const renderTag = (entry: string, index: number) => {
    const tag = document.createElement("span");
    tag.className = "field-tag";
    const label = tagLabel(entry, multiple);
    // Values in the field's grammar (ranges, exclusions) look different.
    if (
      multiple.separator !== undefined &&
      multipleLiteral(entry, {
          separator: multiple.separator,
          escape: multiple.escape,
        }) === undefined
    ) tag.classList.add("is-expression");
    const text = document.createElement("span");
    text.className = "field-tag-text";
    text.textContent = label;
    tag.title = entry;
    tag.append(text);
    if (!readOnly) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "field-tag-remove";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `Remove ${label}`);
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        update(entries.filter((_, item) => item !== index));
        input.focus({ preventScroll: true });
      });
      tag.append(remove);
    }
    return tag;
  };
  input.classList.add("field-tags-input");
  input.readOnly = readOnly;
  const commit = () => {
    const added = typedEntries(input.value, multiple);
    input.value = "";
    if (added.length === 0) return;
    update(
      addEntries(entries, added).slice(
        0,
        multiple.maximum ?? Number.MAX_SAFE_INTEGER,
      ),
    );
  };
  if (!readOnly) {
    input.addEventListener("keydown", (event) => {
      if (event.isComposing) return;
      if (
        event.key === "Enter" ||
        multiple.separator !== undefined && event.key === multiple.separator &&
          !input.value.endsWith("\\")
      ) {
        event.preventDefault();
        event.stopPropagation();
        commit();
      } else if (
        event.key === "Backspace" && input.value === "" && entries.length
      ) {
        event.preventDefault();
        update(entries.slice(0, -1));
      }
    });
    input.addEventListener("blur", commit);
    container.addEventListener("click", (event) => {
      if (event.target === container) input.focus();
    });
  }
  container.append(input);
  draw();
  return container;
}
