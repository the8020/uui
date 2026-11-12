import { t } from "./i18n.ts";
import type { Selection } from "/p/the8020/db/selection.ts";
import type { ControlDescriptor } from "/p/the8020/uui/protocol.ts";
import {
  selectionOperators,
  selectionSigns,
} from "../../../selection_labels.ts";

export const SELECTION_TOKEN_LIMIT = 4;

export function selectionLabel(item: Selection): string {
  const value = item.low === null ? "∅" : String(item.low);
  return `${item.option === "BT" ? `${value} … ${item.high}` : value} · ${
    t(selectionOperators[item.option].key)
  }${item.sign === "E" ? ` · ${t(selectionSigns.E.key)}` : ""}`;
}

/** Same primitive values as ordinary inputs; the original schema validates them. */
export function selectionInputValue(
  text: string,
  type: ControlDescriptor["selectionType"],
): unknown {
  if (type === "number") {
    return Number.isFinite(Number(text)) ? Number(text) : text;
  }
  if (type === "boolean") {
    if (text.toLowerCase() === "true") return true;
    if (text.toLowerCase() === "false") return false;
  }
  return text;
}

/** Only the preview is materialized; explicit help owns the complete editor. */
export function renderSelection(
  input: HTMLInputElement,
  value: unknown,
  control: ControlDescriptor,
  change: (value: Selection[]) => void,
  open: () => void,
): HTMLElement {
  let criteria = Array.isArray(value) ? value as Selection[] : [];
  const container = document.createElement("div");
  container.className = "field-tags field-selection";
  const tokens = document.createElement("div");
  tokens.className = "selection-tokens";
  const update = (next: Selection[]) => {
    criteria = next;
    change(next);
    draw();
  };
  const draw = () => {
    container.querySelectorAll(".field-tag").forEach((token) => token.remove());
    criteria.slice(0, SELECTION_TOKEN_LIMIT).forEach((item, index) => {
      const token = document.createElement("span");
      token.className = "field-tag is-expression";
      const text = document.createElement("span");
      text.className = "field-tag-text";
      text.textContent = selectionLabel(item);
      token.title = text.textContent;
      token.append(text);
      if (!control.readOnly) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "field-tag-remove";
        remove.textContent = "×";
        remove.setAttribute(
          "aria-label",
          t("selection.removeValue", { value: text.textContent }),
        );
        remove.addEventListener("click", () => {
          update(criteria.filter((_, position) => position !== index));
          input.focus({ preventScroll: true });
        });
        token.append(remove);
      }
      tokens.append(token);
    });
    if (criteria.length > SELECTION_TOKEN_LIMIT) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "field-tag selection-more";
      more.tabIndex = -1;
      more.textContent = t("summary_bar.more_values", {
        count: criteria.length - SELECTION_TOKEN_LIMIT,
      });
      more.addEventListener("click", open);
      input.before(more);
    }
  };
  input.className = "field-tags-input";
  input.readOnly = control.readOnly ?? false;
  if (control.selectionType === "number") input.inputMode = "decimal";
  const commit = () => {
    if (input.value.trim() === "") return;
    const low = selectionInputValue(input.value, control.selectionType);
    input.value = "";
    update([...criteria, { sign: "I", option: "EQ", low }]);
  };
  if (!control.readOnly) {
    input.addEventListener("keydown", (event) => {
      if (event.isComposing) return;
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        commit();
      } else if (
        event.key === "Backspace" && input.value === "" && criteria.length
      ) {
        event.preventDefault();
        update(criteria.slice(0, -1));
      }
    });
    input.addEventListener("blur", commit);
  }
  container.addEventListener("click", (event) => {
    if (event.target === container) input.focus();
  });
  container.append(tokens, input);
  draw();
  return container;
}
