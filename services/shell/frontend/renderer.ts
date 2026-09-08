import type {
  ControlDescriptor,
  CustomElementDescriptor,
  ScreenAction,
  ScreenChange,
  ScreenElementState,
  ScreenEventType,
  ScreenSnapshot,
} from "/p/the8020/uui/protocol.ts";
import type { LayoutDocument, LayoutNode } from "/p/the8020/uui/layout.ts";
import { humanize } from "../../../humanize.ts";
import { fieldGridPositions } from "./field_grid.ts";
import { createOverflowText, disposeOverflowText } from "./overflow.ts";
import { createMaterialIcon, renderIconText } from "./icon_text.ts";
import { getPath, setPath } from "./model.ts";
import { renderMarkdown } from "../../../frontend/mod.ts";

export interface RenderCallbacks {
  changed(bind: string, value: unknown, control: ControlDescriptor): void;
  help(control: ControlDescriptor): void;
  action(
    action: string,
    eventType?: ScreenEventType,
    value?: unknown,
  ): void;
  list(id: string): HTMLElement;
  elementState(id: string): ScreenElementState;
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
    const description = element("div", "screen-description");
    renderMarkdown(description, snapshot.description);
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
  if (isLayout(snapshot.layout)) {
    article.append(
      renderLayout(
        snapshot.layout.root,
        controls,
        byBind,
        snapshot.actions,
        model,
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
  const remainingActions = snapshot.actions.filter((action) =>
    !isLayout(snapshot.layout) || !placesAction(snapshot.layout.root, action.id)
  );
  if (remainingActions.length > 0) {
    article.append(renderActions(remainingActions, callbacks));
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
  region.dataset.elementId = node.id;
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
      callbacks.list(node.id),
    );
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
  if (node.type === "actions" || node.actions !== undefined) {
    const selected = node.actions === undefined
      ? actions
      : node.actions.map((id) => actions.find((action) => action.id === id)!)
        .filter((action) => action !== undefined);
    region.append(renderActions(selected, callbacks));
  }
  if (node.type === "tabs" && node.children !== undefined) {
    const tabs = element("div", "tabs");
    const tabList = element("div", "tab-list");
    tabList.setAttribute("role", "tablist");
    const panels = element("div", "tab-panels");
    const state = callbacks.elementState(node.id);
    const selectedTab = state.selectedTab ?? node.selectedTab;
    const selectedIndex = Math.max(
      0,
      node.children.findIndex((child) => child.id === selectedTab),
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
        state.selectedTab = child.id;
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
          callbacks,
          customElements,
          custom,
        ),
      );
    }
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
  button.id = `action-${action.id}`;
  button.dataset.elementId = action.id;
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
  if (items.some((item) => item.control.control === "list")) {
    const result: HTMLElement[] = [];
    let fields: RenderedControl[] = [];
    for (const item of items) {
      if (item.control.control === "list") {
        result.push(...renderImplicitFieldGroups(fields), item.element);
        fields = [];
      } else fields.push(item);
    }
    return [...result, ...renderImplicitFieldGroups(fields)];
  }
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
      title.id = `implicit-group-title-${values[0]!.control.id}`;
      card.setAttribute("aria-labelledby", title.id);
      card.append(title);
    }
    card.append(renderFieldGrid(values));
    result.push(card);
  }
  return result;
}

function renderFieldGrid(items: RenderedControl[]): HTMLElement {
  const fields = element("div", "field-group-fields");
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

function placesAction(node: LayoutNode, id: string): boolean {
  // An explicit actions region retains ownership of the screen's action layout.
  return node.type === "actions" || node.actions?.includes(id) === true ||
    (node.children ?? []).some((child) => placesAction(child, id));
}

export function renderControl(
  control: ControlDescriptor,
  model: Record<string, unknown>,
  callbacks: RenderCallbacks,
): HTMLElement | undefined {
  if (control.hidden) return undefined;
  if (control.control === "list") {
    const card = element("div", "layout-list has-group-title");
    card.dataset.elementId = control.id;
    const title = element("h2", "group-title");
    renderIconText(title, control.label ?? control.bind);
    card.append(title, callbacks.list(control.id));
    return card;
  }
  if (control.control === "radio") {
    return renderRadioControl(control, model, callbacks);
  }
  const wrapper = element("div", "field");
  wrapper.dataset.elementId = control.id;
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
    if (control.semanticType === "decimal") input.inputMode = "decimal";
    if (control.control === "password") input.autocomplete = "new-password";
    if (control.control === "checkbox" || control.control === "switch") {
      input.checked = Boolean(value);
      if (control.control === "switch") input.setAttribute("role", "switch");
    } else if (control.control === "file") {
      input.disabled = true;
    } else {
      if (control.control === "range") {
        // Configure bounds before assigning a value outside the native 0–100 range.
        input.min = String(control.minimum ?? 0);
        input.max = String(control.maximum ?? 100);
        input.step = String(control.step ?? 1);
        input.dataset.valueSuffix = control.valueSuffix ?? "";
      }
      input.value = value == null ? "" : String(value);
    }
  }
  input.id = `control-${control.id}`;
  input.dataset.bind = control.bind;
  if ("placeholder" in input) input.placeholder = control.placeholder ?? "";
  input.required = control.required ?? false;
  if (control.readOnly) {
    if (
      input instanceof HTMLTextAreaElement ||
      input instanceof HTMLInputElement &&
        !["checkbox", "range", "file"].includes(input.type)
    ) input.readOnly = true;
    else input.disabled = true;
  }
  input.addEventListener("input", () => {
    if (control.readOnly) return;
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
  addFieldHelp(wrapper, inputShell, control, callbacks, input.disabled);
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
  group.dataset.elementId = control.id;
  group.dataset.group = control.group ?? "";
  group.dataset.fieldLength = control.length ?? "medium";
  group.dataset.fieldRowSpan = String(control.rowSpan ?? 1);
  group.dataset.controlKind = "radio";
  const legend = document.createElement("legend");
  renderIconText(legend, control.label ?? control.id);
  const inputShell = element("div", "field-input-shell");
  const options = element("div", "field-radio-options");
  inputShell.append(options);
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
    options.append(label);
  }
  addFieldHelp(
    group,
    inputShell,
    control,
    callbacks,
    control.readOnly ?? false,
  );
  group.append(
    legend,
    inputShell,
    renderFieldMessage(control.label ?? control.id, hintFor(control)),
  );
  return group;
}

function addFieldHelp(
  wrapper: HTMLElement,
  shell: HTMLElement,
  control: ControlDescriptor,
  callbacks: RenderCallbacks,
  disabled: boolean,
): void {
  if (control.fieldHelp === false) return;
  wrapper.classList.add("field-has-edit-affordance");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "field-help-button";
  button.tabIndex = -1;
  button.id = `field-help-${control.id}`;
  const label = `${control.readOnly ? "View" : "Edit"} ${
    control.label ?? control.bind
  }`;
  button.setAttribute("aria-label", `${label}: field help`);
  button.setAttribute("aria-keyshortcuts", "F1 F4");
  button.title = `${label} (F1 / F4)`;
  const icon = createMaterialIcon(
    control.readOnly ? "chevron_right" : "edit",
    "muted",
    {
      decorativeIcons: true,
    },
  );
  icon.classList.add("field-edit-icon");
  button.append(icon);
  button.addEventListener("click", () => callbacks.help(control));
  if (disabled) {
    wrapper.tabIndex = 0;
    wrapper.setAttribute("aria-label", control.label ?? control.bind);
    wrapper.setAttribute("aria-readonly", "true");
  }
  shell.append(button);
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

  const overflow = createOverflowText(message.text, {
    label: `Show full message for ${fieldLabel}`,
    preview: "markdown",
  });
  overflow.querySelector(".overflow-text-content")!.classList.add(
    "field-message-text",
  );
  slot.append(overflow);
  return slot;
}

export function disposeFieldMessages(root: ParentNode): void {
  for (const slot of root.querySelectorAll<HTMLElement>(".field-message")) {
    disposeOverflowText(slot);
  }
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
    case "password":
      return "password";
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
