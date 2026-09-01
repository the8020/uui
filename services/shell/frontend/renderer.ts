import type {
  ControlDescriptor,
  CustomElementDescriptor,
  LayoutDocument,
  LayoutNode,
  ScreenAction,
  ScreenChange,
  ScreenEventType,
  ScreenListPage,
  ScreenSnapshot,
} from "@packages/the8020/uui/mod.ts";
import { humanize } from "../../../humanize.ts";
import { fieldGridPositions } from "./field_grid.ts";
import {
  fieldMessageIsOverflowing,
  fieldMessagePopoverPosition,
} from "./field_message.ts";
import { createMaterialIcon, renderIconText } from "./icon_text.ts";
import { getPath, paginationItems, setPath } from "./model.ts";

export interface RenderCallbacks {
  changed(bind: string, value: unknown, control: ControlDescriptor): void;
  action(
    action: string,
    eventType?: ScreenEventType,
    value?: unknown,
  ): void;
  page(bind: string, currentPage: number, page: number): void;
}

export function renderScreenHeader(
  snapshot: ScreenSnapshot,
  model: Record<string, unknown>,
  callbacks: RenderCallbacks,
): HTMLElement[] {
  const items: HTMLElement[] = [];
  for (const control of snapshot.header?.controls ?? []) {
    const rendered = renderControl(control, model, callbacks);
    if (rendered === undefined) continue;
    rendered.classList.add("program-header-item", "program-header-control");
    items.push(rendered);
  }
  for (const action of snapshot.header?.actions ?? []) {
    const rendered = renderAction(action, callbacks);
    rendered.classList.add("program-header-item", "program-header-action");
    items.push(rendered);
  }
  return items;
}

export interface CustomElementCallbacks {
  render(descriptor: CustomElementDescriptor): HTMLElement;
}

type FieldMessageKind = "hint" | "error";

interface FieldMessage {
  kind: FieldMessageKind;
  text: string;
}

let fieldMessageSequence = 0;

interface FieldMessageController {
  refresh(): void;
  dispose(): void;
}

const fieldMessageControllers = new WeakMap<
  HTMLElement,
  FieldMessageController
>();
const fieldMessageResizeObserver = typeof ResizeObserver === "undefined"
  ? undefined
  : new ResizeObserver((entries) => {
    for (const entry of entries) {
      if (entry.target instanceof HTMLElement) {
        fieldMessageControllers.get(entry.target)?.refresh();
      }
    }
  });

export function renderScreen(
  root: HTMLElement,
  snapshot: ScreenSnapshot,
  model: Record<string, unknown>,
  callbacks: RenderCallbacks,
  custom: CustomElementCallbacks,
): void {
  disposeFieldMessages(root);
  root.replaceChildren();
  const article = element("article", "screen");
  const heading = element("h1", "screen-title");
  renderIconText(heading, snapshot.title ?? snapshot.id);
  article.append(heading);
  if (snapshot.description) {
    const description = element("p", "screen-description");
    renderIconText(description, snapshot.description);
    article.append(description);
  }
  const controls = new Map(
    snapshot.controls.map((control) => [control.id, control]),
  );
  const customElements = new Map(
    (snapshot.customElements ?? []).map((descriptor) => [
      descriptor.id,
      descriptor,
    ]),
  );
  const byBind = new Map<string, ControlDescriptor[]>();
  for (const control of snapshot.controls) {
    const values = byBind.get(control.bind) ?? [];
    values.push(control);
    byBind.set(control.bind, values);
  }
  const pagination = new Map(
    (snapshot.pagination?.lists ?? []).map((item) => [item.bind, item]),
  );
  if (isLayout(snapshot.layout)) {
    article.append(
      renderLayout(
        snapshot.layout.root,
        controls,
        byBind,
        snapshot.actions,
        model,
        pagination,
        callbacks,
        customElements,
        custom,
      ),
    );
  } else {
    const stack = element("div", "layout-stack");
    const rendered: RenderedControl[] = [];
    for (const control of snapshot.controls) {
      const item = renderControl(control, model, callbacks);
      if (item !== undefined) rendered.push({ control, element: item });
    }
    stack.append(...renderImplicitFieldGroups(rendered));
    article.append(stack);
  }
  if (
    snapshot.actions.length > 0 &&
    (!isLayout(snapshot.layout) ||
      !containsNodeType(snapshot.layout.root, "actions"))
  ) {
    article.append(renderActions(snapshot.actions, callbacks));
  }
  root.append(article);
}

export function changesForBindings(
  model: unknown,
  bindings: Iterable<string>,
): ScreenChange[] {
  return [...new Set(bindings)].map((bind) => ({
    bind,
    value: structuredClone(getPath(model, bind)),
  }));
}

function renderLayout(
  node: LayoutNode,
  controls: Map<string, ControlDescriptor>,
  byBind: Map<string, ControlDescriptor[]>,
  actions: ScreenAction[],
  model: Record<string, unknown>,
  pagination: ReadonlyMap<string, ScreenListPage>,
  callbacks: RenderCallbacks,
  customElements: Map<string, CustomElementDescriptor>,
  custom: CustomElementCallbacks,
  suppressTitle = false,
): HTMLElement {
  const region = element(
    node.type === "section" ? "section" : "div",
    `layout-${node.type}`,
  );
  region.dataset.layoutId = node.id;
  if (node.responsive === "stack") region.dataset.responsive = "stack";
  if (node.primary) region.dataset.regionPriority = "primary";
  if (node.secondary) region.dataset.regionPriority = "secondary";
  if (node.collapsed) region.dataset.collapsed = "true";
  if (node.minimumRegionWidth !== undefined) {
    region.style.setProperty(
      "--minimum-region-width",
      `${node.minimumRegionWidth}px`,
    );
  }
  if (node.ratio !== undefined) {
    region.style.setProperty(
      "--split-ratio",
      node.ratio.map((part) => `${part}fr`).join(" "),
    );
  }
  if (node.columns !== undefined) {
    region.style.setProperty("--grid-columns", String(node.columns));
    region.dataset.gridColumns = String(node.columns);
  }
  if (node.title && !suppressTitle) {
    const title = node.type === "section"
      ? element("h1", "section-title")
      : element("h2", "group-title");
    renderIconText(title, node.title);
    title.id = `layout-title-${node.id}`;
    if (node.type !== "section") {
      region.classList.add("has-group-title");
      region.setAttribute("aria-labelledby", title.id);
      region.setAttribute("role", node.type === "list" ? "region" : "group");
    }
    region.append(title);
  } else if (node.type === "field-group" || node.type === "detail") {
    region.setAttribute("role", "group");
  }
  if (node.type === "list" && node.bind) {
    region.append(
      renderList(node, model, pagination.get(node.bind), callbacks),
    );
  }
  if (node.type === "actions") {
    const selected = node.actions === undefined
      ? actions
      : node.actions.map((id) => actions.find((action) => action.id === id)!)
        .filter((action) => action !== undefined);
    region.append(renderActions(selected, callbacks));
  }
  if (node.type === "custom" && node.customElement !== undefined) {
    const descriptor = customElements.get(node.customElement);
    if (descriptor !== undefined) region.append(custom.render(descriptor));
  }
  const renderedControls: RenderedControl[] = [];
  for (const controlID of node.controls ?? []) {
    const candidates = controls.get(controlID) === undefined
      ? byBind.get(controlID) ?? []
      : [controls.get(controlID)!];
    for (const control of candidates) {
      const rendered = renderControl(control, model, callbacks);
      if (rendered !== undefined) {
        renderedControls.push({ control, element: rendered });
      }
    }
  }
  if (renderedControls.length > 0) {
    if (node.type === "field-group" || node.type === "detail") {
      region.append(renderFieldGrid(renderedControls));
    } else {
      region.append(...renderImplicitFieldGroups(renderedControls));
    }
  }
  if (node.type === "tabs" && node.children !== undefined) {
    const tabs = element("div", "tabs");
    const tabList = element("div", "tab-list");
    tabList.setAttribute("role", "tablist");
    const panels = element("div", "tab-panels");
    const selectedIndex = Math.max(
      0,
      node.children.findIndex((child) => child.id === node.selectedTab),
    );
    node.children.forEach((child, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.role = "tab";
      renderIconText(button, child.title ?? child.id);
      const panel = renderLayout(
        child,
        controls,
        byBind,
        actions,
        model,
        pagination,
        callbacks,
        customElements,
        custom,
        true,
      );
      const tabID = `tab-${node.id}-${child.id}`;
      const panelID = `panel-${node.id}-${child.id}`;
      button.id = tabID;
      button.setAttribute("aria-controls", panelID);
      panel.id = panelID;
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", tabID);
      panel.hidden = index !== selectedIndex;
      button.setAttribute("aria-selected", String(index === selectedIndex));
      button.addEventListener("click", () => {
        for (const item of panels.children) {
          (item as HTMLElement).hidden = item !== panel;
        }
        for (const item of tabList.children) {
          item.setAttribute("aria-selected", String(item === button));
        }
      });
      tabList.append(button);
      panels.append(panel);
    });
    tabs.append(tabList, panels);
    region.append(tabs);
  } else {
    for (const child of node.children ?? []) {
      region.append(
        renderLayout(
          child,
          controls,
          byBind,
          actions,
          model,
          pagination,
          callbacks,
          customElements,
          custom,
        ),
      );
    }
  }
  if (node.type === "grid") {
    synchronizeSiblingFieldRows([
      ...region.querySelectorAll<HTMLElement>(
        ":scope > :is(.layout-field-group, .layout-detail) > .field-group-fields",
      ),
    ]);
  }
  return region;
}

function renderActions(
  actions: ScreenAction[],
  callbacks: RenderCallbacks,
): HTMLElement {
  const container = element("nav", "screen-actions");
  container.setAttribute("aria-label", "Screen actions");
  for (const action of actions) {
    container.append(renderAction(action, callbacks));
  }
  return container;
}

function renderAction(
  action: ScreenAction,
  callbacks: RenderCallbacks,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  renderIconText(button, action.label);
  button.className = `button button-${action.kind ?? "secondary"}`;
  button.addEventListener("click", () => callbacks.action(action.id));
  return button;
}

interface RenderedControl {
  control: ControlDescriptor;
  element: HTMLElement;
}

function renderImplicitFieldGroups(items: RenderedControl[]): HTMLElement[] {
  const grouped = new Map<string, RenderedControl[]>();
  for (const item of items) {
    const name = item.control.group ?? "";
    const values = grouped.get(name) ?? [];
    values.push(item);
    grouped.set(name, values);
  }
  const result: HTMLElement[] = [];
  for (const [name, values] of grouped) {
    const card = element(
      "div",
      name.length === 0
        ? "layout-field-group layout-field-group-implicit"
        : "layout-field-group has-group-title",
    );
    card.setAttribute("role", "group");
    if (name.length > 0) {
      const title = element("h2", "group-title");
      renderIconText(title, humanize(name));
      title.id = `implicit-group-title-${result.length}`;
      card.setAttribute("aria-labelledby", title.id);
      card.append(title);
    }
    card.append(renderFieldGrid(values));
    result.push(card);
  }
  synchronizeSiblingFieldRows(
    result.flatMap((card) => [
      ...card.querySelectorAll<HTMLElement>(":scope > .field-group-fields"),
    ]),
  );
  return result;
}

function renderFieldGrid(items: RenderedControl[]): HTMLElement {
  const fields = element("div", "field-group-fields");
  if (items.some((item) => (item.control.rowSpan ?? 1) > 1)) {
    fields.dataset.hasRowSpan = "true";
    fields.classList.add("field-group-fields-exact-rows");
  }
  const positions = fieldGridPositions(
    items.map((item) => ({
      length: item.control.length ?? "medium",
      rowSpan: item.control.rowSpan ?? 1,
    })),
  );
  items.forEach((item, index) => {
    const position = positions[index]!;
    for (const mode of ["mobile", "tablet", "desktop"] as const) {
      item.element.style.setProperty(
        `--field-grid-${mode}-column`,
        `${position[mode].column} / span ${position[mode].span}`,
      );
      item.element.style.setProperty(
        `--field-grid-${mode}-row`,
        `${position[mode].row} / span ${position[mode].rowSpan}`,
      );
    }
  });
  fields.append(...items.map((item) => item.element));
  return fields;
}

function synchronizeSiblingFieldRows(fields: HTMLElement[]): void {
  if (!fields.some((item) => item.dataset.hasRowSpan === "true")) return;
  for (const item of fields) {
    item.classList.add("field-group-fields-exact-rows");
  }
}

function containsNodeType(node: LayoutNode, type: LayoutNode["type"]): boolean {
  return node.type === type ||
    (node.children ?? []).some((child) => containsNodeType(child, type));
}

function renderList(
  node: LayoutNode,
  model: unknown,
  pagination: ScreenListPage | undefined,
  callbacks: RenderCallbacks,
): HTMLElement {
  const rows = getPath(model, node.bind!) as unknown;
  const container = element("div", "data-list-container");
  const scroll = element("div", "data-list-scroll");
  const table = document.createElement("table");
  table.className = "data-list";
  if (!Array.isArray(rows) || rows.length === 0) {
    const empty = document.createElement("caption");
    renderIconText(empty, "No items");
    table.append(empty);
    scroll.append(table);
    container.append(scroll);
    return container;
  }
  const columns = node.display ??
    Object.keys(rows[0] as Record<string, unknown>);
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const column of columns) {
    const cell = document.createElement("th");
    cell.scope = "col";
    renderIconText(cell, node.headings?.[column] ?? humanize(column));
    headRow.append(cell);
  }
  head.append(headRow);
  const body = document.createElement("tbody");
  for (const item of rows) {
    const row = document.createElement("tr");
    row.tabIndex = 0;
    const value = node.key === undefined ? item : getPath(item, node.key);
    const select = (): void => callbacks.action("select", "select", value);
    row.addEventListener("click", select);
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") select();
    });
    for (const column of columns) {
      const cell = document.createElement("td");
      renderIconText(cell, displayValue(getPath(item, column)));
      row.append(cell);
    }
    body.append(row);
  }
  table.append(head, body);
  scroll.append(table);
  container.append(scroll);
  if (pagination !== undefined && pagination.totalPages > 1) {
    container.append(renderPagination(pagination, callbacks));
  }
  return container;
}

function renderPagination(
  pagination: ScreenListPage,
  callbacks: RenderCallbacks,
): HTMLElement {
  const navigation = element("nav", "data-list-pagination");
  navigation.setAttribute("aria-label", `Pages for ${pagination.bind}`);
  const start = (pagination.page - 1) * pagination.pageSize + 1;
  const end = Math.min(
    pagination.totalItems,
    pagination.page * pagination.pageSize,
  );
  const summary = element("span", "data-list-page-summary");
  renderIconText(summary, `${start}–${end} of ${pagination.totalItems}`);
  navigation.append(summary);
  const pages = element("span", "data-list-page-numbers");
  for (const item of paginationItems(pagination.page, pagination.totalPages)) {
    if (item === "ellipsis") {
      const ellipsis = element("span", "data-list-page-ellipsis");
      renderIconText(ellipsis, "…");
      ellipsis.setAttribute("aria-hidden", "true");
      pages.append(ellipsis);
      continue;
    }
    const button = document.createElement("button");
    button.type = "button";
    renderIconText(button, String(item));
    button.setAttribute("aria-label", `Page ${item}`);
    if (item === pagination.page) {
      button.setAttribute("aria-current", "page");
      button.disabled = true;
    } else {
      button.addEventListener(
        "click",
        () => callbacks.page(pagination.bind, pagination.page, item),
      );
    }
    pages.append(button);
  }
  navigation.append(pages);
  return navigation;
}

export function renderControl(
  control: ControlDescriptor,
  model: Record<string, unknown>,
  callbacks: RenderCallbacks,
): HTMLElement | undefined {
  if (control.hidden) return undefined;
  if (control.control === "radio") {
    return renderRadioControl(control, model, callbacks);
  }
  const wrapper = element("div", "field");
  wrapper.dataset.group = control.group ?? "";
  wrapper.dataset.fieldLength = control.length ?? "medium";
  wrapper.dataset.fieldRowSpan = String(control.rowSpan ?? 1);
  wrapper.dataset.controlKind = control.control ?? "text";
  const label = document.createElement("label");
  label.htmlFor = `control-${control.id}`;
  renderIconText(label, control.label ?? control.id);
  const value = getPath(model, control.bind);
  let input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  if (control.control === "textarea") {
    input = document.createElement("textarea");
    input.value = value == null ? "" : String(value);
  } else if (control.control === "select") {
    input = document.createElement("select");
    for (const option of control.options ?? []) {
      const item = document.createElement("option");
      item.value = String(option.value);
      item.textContent = option.label;
      item.selected = option.value === value;
      input.append(item);
    }
  } else {
    input = document.createElement("input");
    input.type = inputType(control.control);
    if (control.control === "checkbox" || control.control === "switch") {
      input.checked = Boolean(value);
      if (control.control === "switch") input.setAttribute("role", "switch");
    } else if (control.control === "file") {
      input.disabled = true;
    } else {
      input.value = value == null ? "" : String(value);
    }
  }
  input.id = `control-${control.id}`;
  input.dataset.bind = control.bind;
  if (
    control.control === "range" && input instanceof HTMLInputElement
  ) {
    input.min = String(control.minimum ?? 0);
    input.max = String(control.maximum ?? 100);
    input.step = String(control.step ?? 1);
    input.dataset.valueSuffix = control.valueSuffix ?? "";
  }
  if ("placeholder" in input) input.placeholder = control.placeholder ?? "";
  input.required = control.required ?? false;
  input.disabled ||= control.readOnly ?? false;
  input.addEventListener("input", () => {
    const next = inputValue(input, control.control);
    setPath(model, control.bind, next);
    synchronizeBinding(control.bind, next, input);
    if (input instanceof HTMLInputElement && input.type === "range") {
      updateRangeOutput(input);
    }
    callbacks.changed(control.bind, next, control);
  });
  const inputShell = element("div", "field-input-shell");
  inputShell.append(input);
  if (control.control === "range" && input instanceof HTMLInputElement) {
    const output = document.createElement("output");
    output.className = "field-range-value";
    output.setAttribute("for", input.id);
    inputShell.prepend(output);
    updateRangeOutput(input);
  }
  if (control.control === "select") {
    const icon = createMaterialIcon("arrow_drop_down", "muted", {
      decorativeIcons: true,
    });
    icon.classList.add("field-select-icon");
    inputShell.append(icon);
  }
  if (hasEditAffordance(control, input)) {
    wrapper.classList.add("field-has-edit-affordance");
    const icon = createMaterialIcon("edit", "muted", {
      decorativeIcons: true,
    });
    icon.classList.add("field-edit-icon");
    inputShell.append(icon);
  }
  wrapper.append(
    label,
    inputShell,
    renderFieldMessage(control.label ?? control.id, hintFor(control)),
  );
  return wrapper;
}

function renderRadioControl(
  control: ControlDescriptor,
  model: Record<string, unknown>,
  callbacks: RenderCallbacks,
): HTMLElement {
  const group = element("fieldset", "field field-radio");
  group.dataset.group = control.group ?? "";
  group.dataset.fieldLength = control.length ?? "medium";
  group.dataset.fieldRowSpan = String(control.rowSpan ?? 1);
  group.dataset.controlKind = "radio";
  const legend = document.createElement("legend");
  renderIconText(legend, control.label ?? control.id);
  const inputShell = element("div", "field-input-shell field-radio-options");
  const current = getPath(model, control.bind);
  for (const [index, option] of (control.options ?? []).entries()) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = `control-${control.id}`;
    input.id = `control-${control.id}-${index}`;
    input.dataset.bind = control.bind;
    input.value = String(option.value);
    input.checked = option.value === current;
    input.disabled = control.readOnly ?? false;
    input.required = control.required ?? false;
    input.addEventListener("change", () => {
      if (!input.checked) return;
      setPath(model, control.bind, option.value);
      synchronizeBinding(control.bind, option.value, input);
      callbacks.changed(control.bind, option.value, control);
    });
    label.htmlFor = input.id;
    const text = document.createElement("span");
    renderIconText(text, option.label);
    label.append(input, text);
    inputShell.append(label);
  }
  if (!(control.readOnly ?? false)) {
    group.classList.add("field-has-edit-affordance");
    const icon = createMaterialIcon("edit", "muted", {
      decorativeIcons: true,
    });
    icon.classList.add("field-edit-icon");
    inputShell.append(icon);
  }
  group.append(
    legend,
    inputShell,
    renderFieldMessage(control.label ?? control.id, hintFor(control)),
  );
  return group;
}

function hintFor(control: ControlDescriptor): FieldMessage | undefined {
  return control.description
    ? { kind: "hint", text: control.description }
    : undefined;
}

function renderFieldMessage(
  fieldLabel: string,
  message: FieldMessage | undefined,
): HTMLElement {
  const slot = element("div", "field-message");
  slot.dataset.messageKind = message?.kind ?? "none";
  if (message === undefined) {
    slot.classList.add("field-message-empty");
    slot.setAttribute("aria-hidden", "true");
    return slot;
  }

  const text = element("span", "field-message-text");
  renderIconText(text, message.text);

  const popover = element("div", "field-message-popover");
  popover.id = `field-message-popover-${++fieldMessageSequence}`;
  popover.setAttribute("popover", "auto");
  popover.setAttribute("role", "tooltip");
  popover.setAttribute("aria-label", `${fieldLabel} message`);
  renderIconText(popover, message.text);

  slot.append(text, popover);
  const controller = createFieldMessageController(
    slot,
    text,
    popover,
    fieldLabel,
  );
  fieldMessageControllers.set(text, controller);
  queueMicrotask(controller.refresh);
  return slot;
}

export function disposeFieldMessages(root: ParentNode): void {
  for (
    const text of root.querySelectorAll<HTMLElement>(".field-message-text")
  ) {
    fieldMessageControllers.get(text)?.dispose();
    fieldMessageControllers.delete(text);
  }
}

function createFieldMessageController(
  slot: HTMLElement,
  text: HTMLElement,
  popover: HTMLElement,
  fieldLabel: string,
): FieldMessageController {
  let interactive = false;

  const positionPopover = (): void => {
    if (!popover.matches(":popover-open")) return;
    const anchorBounds = text.getBoundingClientRect();
    const popoverBounds = popover.getBoundingClientRect();
    const position = fieldMessagePopoverPosition(
      anchorBounds,
      popoverBounds.width,
      popoverBounds.height,
      innerWidth,
      innerHeight,
    );
    popover.style.left = `${position.left}px`;
    popover.style.top = `${position.top}px`;
  };

  const togglePopover = (): void => {
    if (!interactive) return;
    if (popover.matches(":popover-open")) {
      popover.hidePopover();
      return;
    }
    const anchorBounds = text.getBoundingClientRect();
    popover.style.left = `${anchorBounds.left}px`;
    popover.style.top = `${anchorBounds.bottom + 6}px`;
    popover.showPopover();
    positionPopover();
  };

  const clicked = (): void => togglePopover();
  const keyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    togglePopover();
  };
  const toggled = (): void => {
    if (!interactive) return;
    text.setAttribute(
      "aria-expanded",
      String(popover.matches(":popover-open")),
    );
    positionPopover();
  };

  const setInteractive = (next: boolean): void => {
    if (next === interactive) return;
    interactive = next;
    slot.dataset.messageOverflow = String(next);
    text.classList.toggle("field-message-trigger", next);
    if (next) {
      text.setAttribute("role", "button");
      text.setAttribute("tabindex", "0");
      text.setAttribute("aria-label", `Show full message for ${fieldLabel}`);
      text.setAttribute("aria-expanded", "false");
      text.setAttribute("aria-controls", popover.id);
      text.setAttribute("aria-describedby", popover.id);
      text.addEventListener("click", clicked);
      text.addEventListener("keydown", keyDown);
      return;
    }
    if (popover.matches(":popover-open")) popover.hidePopover();
    text.removeAttribute("role");
    text.removeAttribute("tabindex");
    text.removeAttribute("aria-label");
    text.removeAttribute("aria-expanded");
    text.removeAttribute("aria-controls");
    text.removeAttribute("aria-describedby");
    text.removeEventListener("click", clicked);
    text.removeEventListener("keydown", keyDown);
  };

  const controller: FieldMessageController = {
    refresh() {
      setInteractive(
        fieldMessageIsOverflowing(text.clientWidth, text.scrollWidth),
      );
    },
    dispose() {
      setInteractive(false);
      popover.removeEventListener("toggle", toggled);
      fieldMessageResizeObserver?.unobserve(text);
    },
  };
  popover.addEventListener("toggle", toggled);
  fieldMessageResizeObserver?.observe(text);
  return controller;
}

function synchronizeBinding(
  bind: string,
  value: unknown,
  source: Element,
): void {
  for (
    const candidate of document.querySelectorAll<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >("[data-bind]")
  ) {
    if (candidate === source || candidate.dataset.bind !== bind) continue;
    if (candidate instanceof HTMLInputElement && candidate.type === "radio") {
      candidate.checked = candidate.value === String(value);
    } else if (
      candidate instanceof HTMLInputElement && candidate.type === "checkbox"
    ) {
      candidate.checked = Boolean(value);
    } else candidate.value = value == null ? "" : String(value);
    if (candidate instanceof HTMLInputElement && candidate.type === "range") {
      updateRangeOutput(candidate);
    }
  }
}

function updateRangeOutput(input: HTMLInputElement): void {
  const label = `${input.value}${input.dataset.valueSuffix ?? ""}`;
  const minimum = Number(input.min);
  const maximum = Number(input.max);
  const value = Number(input.value);
  const progress = maximum > minimum
    ? Math.max(
      0,
      Math.min(100, ((value - minimum) / (maximum - minimum)) * 100),
    )
    : 0;
  input.style.setProperty("--range-progress", `${progress}%`);
  input.setAttribute("aria-valuetext", label);
  const output = input.parentElement?.querySelector<HTMLOutputElement>(
    ".field-range-value",
  );
  if (output !== null && output !== undefined) output.value = label;
}

function inputValue(
  input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  kind: ControlDescriptor["control"],
): unknown {
  if (
    input instanceof HTMLInputElement &&
    (kind === "checkbox" || kind === "switch")
  ) return input.checked;
  if (kind === "number" || kind === "range") {
    return input.value === "" ? 0 : Number(input.value);
  }
  return input.value;
}

function inputType(kind: ControlDescriptor["control"]): string {
  switch (kind) {
    case "email":
      return "email";
    case "number":
      return "number";
    case "range":
      return "range";
    case "checkbox":
    case "switch":
      return "checkbox";
    case "date":
      return "date";
    case "datetime":
      return "datetime-local";
    case "file":
      return "file";
    default:
      return "text";
  }
}

function hasEditAffordance(
  control: ControlDescriptor,
  input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
): boolean {
  return !input.disabled && control.control !== "file";
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const value = document.createElement(tag);
  value.className = className;
  return value;
}

function isLayout(value: unknown): value is LayoutDocument {
  return value !== null && typeof value === "object" &&
    (value as { schema?: unknown }).schema === 1 &&
    (value as { root?: unknown }).root !== undefined;
}
