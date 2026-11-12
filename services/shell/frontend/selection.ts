import { t } from "./i18n.ts";
import type { Selection } from "/p/the8020/db/selection.ts";

export const SELECTION_TOKEN_LIMIT = 4;

export function selectionLabel(item: Selection): string {
  const operators = {
    EQ: "=",
    NE: "≠",
    GT: ">",
    GE: "≥",
    LT: "<",
    LE: "≤",
    BT: "",
    CP: "~",
  };
  const value = item.low === null ? "∅" : String(item.low);
  return `${item.sign === "E" ? "− " : ""}${
    item.option === "BT"
      ? `${value} … ${item.high}`
      : `${operators[item.option]} ${value}`
  }`;
}

/** Only the preview is materialized; the ordinary field help owns all criteria. */
export function renderSelection(
  input: HTMLInputElement,
  value: unknown,
  open: () => void,
): HTMLElement {
  const criteria = Array.isArray(value) ? value as Selection[] : [];
  const container = document.createElement("div");
  container.className = "field-tags field-selection";
  for (const item of criteria.slice(0, SELECTION_TOKEN_LIMIT)) {
    const token = document.createElement("button");
    token.type = "button";
    token.className = "field-tag is-expression";
    token.textContent = selectionLabel(item);
    token.title = token.textContent;
    token.addEventListener("click", open);
    container.append(token);
  }
  if (criteria.length > SELECTION_TOKEN_LIMIT) {
    const more = document.createElement("button");
    more.type = "button";
    more.className = "field-tag selection-more";
    more.textContent = t("summary_bar.more_values", {
      count: criteria.length - SELECTION_TOKEN_LIMIT,
    });
    more.addEventListener("click", open);
    container.append(more);
  }
  input.className = "field-tags-input";
  input.readOnly = true;
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      open();
    }
  });
  input.addEventListener("click", open);
  container.append(input);
  return container;
}
