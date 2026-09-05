import { resolveElementIDs } from "./identifiers.ts";
import type { ListOptions } from "./screen_state.ts";
import { validateListOptions } from "./list_options.ts";
import type { ControlDescriptor } from "./protocol.ts";
export type LayoutNodeType =
  | "stack"
  | "split"
  | "grid"
  | "section"
  | "field-group"
  | "tabs"
  | "list"
  | "detail"
  | "actions"
  | "custom";

export interface LayoutNode extends ListOptions {
  id: string;
  type: LayoutNodeType;
  title?: string;
  bind?: string;
  key?: string;
  display?: string[];
  headings?: Record<string, string>;
  controls?: string[];
  actions?: string[];
  children?: LayoutNode[];
  ratio?: number[];
  columns?: number;
  minimumRegionWidth?: number;
  responsive?: "stack";
  primary?: boolean;
  secondary?: boolean;
  collapsed?: boolean;
  selectedTab?: string;
  customElement?: string;
}

export interface LayoutDocument {
  schema: 1;
  id: string;
  root: LayoutNode;
}
export type LayoutNodeDeclaration = Omit<LayoutNode, "id" | "children"> & {
  id?: string;
  children?: LayoutNodeDeclaration[];
};
export type LayoutDeclaration = Omit<LayoutDocument, "root"> & {
  root: LayoutNodeDeclaration;
};

export interface LayoutOverride {
  baseLayoutId: string;
  hiddenControls?: string[];
  controlOrder?: string[];
  regionOrder?: string[];
  splitRatio?: number[];
  collapsedSections?: string[];
  selectedTab?: string;
}

const nodeTypes = new Set<LayoutNodeType>([
  "stack",
  "split",
  "grid",
  "section",
  "field-group",
  "tabs",
  "list",
  "detail",
  "actions",
  "custom",
]);
const layoutKeys = new Set(["schema", "id", "root"]);
const nodeKeys = new Set([
  "id",
  "type",
  "title",
  "bind",
  "key",
  "display",
  "headings",
  "columnOptions",
  "triggerFilterEvents",
  "controls",
  "actions",
  "children",
  "ratio",
  "columns",
  "minimumRegionWidth",
  "responsive",
  "primary",
  "secondary",
  "collapsed",
  "selectedTab",
  "customElement",
]);

export function validateLayout(
  value: unknown,
  controls: ReadonlySet<string> = new Set(),
  actions: ReadonlySet<string> = new Set(),
  customElements: ReadonlySet<string> = new Set(),
  reserved: ReadonlySet<string> = new Set(),
): LayoutDocument {
  if (!isRecord(value) || value.schema !== 1 || typeof value.id !== "string") {
    throw new TypeError("layout must have schema 1 and an ID");
  }
  rejectUnknownKeys(value, layoutKeys, "layout");
  const normalized = structuredClone(value);
  const nodes: Array<Record<string, unknown> & { id?: string }> = [];
  const collect = (node: unknown): void => {
    if (!isRecord(node)) throw new TypeError("invalid layout node");
    nodes.push(node);
    if (Array.isArray(node.children)) node.children.forEach(collect);
  };
  collect(normalized.root);
  const resolved = resolveElementIDs(
    nodes,
    (node) => ({
      type: node.type,
      bind: node.bind,
      title: node.title,
      key: node.key,
      controls: node.controls,
      actions: node.actions,
      customElement: node.customElement,
    }),
    "region",
    reserved,
  );
  nodes.forEach((node, index) => node.id = resolved[index]!.id);
  const ids = new Set<string>();
  validateNode(normalized.root, ids, controls, actions, customElements);
  return normalized as unknown as LayoutDocument;
}

/** Resolve binding shorthand once, and give each placement one declared identity. */
export function resolveLayoutReferences(
  layout: LayoutDocument,
  controls: readonly ControlDescriptor[],
): void {
  const byID = new Map(controls.map((control) => [control.id, control]));
  const used = new Set<string>();
  const place = (id: string): string => {
    if (used.has(id)) {
      throw new TypeError(
        `element ${id} is placed more than once; declare separate elements for repeated bindings`,
      );
    }
    used.add(id);
    return id;
  };
  visit(layout.root, (node) => {
    node.controls = node.controls?.flatMap((reference) => {
      const candidates = byID.has(reference)
        ? [byID.get(reference)!]
        : controls.filter((control) => control.bind === reference);
      if (candidates.length === 0) {
        throw new TypeError(`unknown control ${reference}`);
      }
      return candidates.map((control) => place(control.id));
    });
    node.actions?.forEach(place);
    if (node.customElement !== undefined) place(node.customElement);
  });
}

export function applyLayoutOverride(
  layout: LayoutDocument,
  override: LayoutOverride,
): LayoutDocument {
  if (override.baseLayoutId !== layout.id) {
    throw new TypeError("layout override base does not match layout");
  }
  const result = structuredClone(layout);
  const hidden = new Set(override.hiddenControls ?? []);
  const collapsed = new Set(override.collapsedSections ?? []);
  visit(result.root, (node) => {
    if (node.controls !== undefined) {
      node.controls = order(
        node.controls.filter((id) => !hidden.has(id)),
        override.controlOrder,
      );
    }
    if (collapsed.has(node.id)) node.collapsed = true;
    if (node.type === "split" && override.splitRatio !== undefined) {
      node.ratio = [...override.splitRatio];
    }
    if (node.type === "tabs" && override.selectedTab !== undefined) {
      node.selectedTab = override.selectedTab;
    }
    if (node.children !== undefined) {
      node.children = orderNodes(node.children, override.regionOrder);
    }
  });
  return result;
}

function validateNode(
  value: unknown,
  ids: Set<string>,
  controls: ReadonlySet<string>,
  actions: ReadonlySet<string>,
  customElements: ReadonlySet<string>,
): asserts value is LayoutNode {
  if (
    !isRecord(value) || typeof value.id !== "string" || value.id.length === 0 ||
    typeof value.type !== "string" ||
    !nodeTypes.has(value.type as LayoutNodeType)
  ) throw new TypeError("invalid layout node");
  rejectUnknownKeys(value, nodeKeys, `layout node ${value.id}`);
  if (value.type === "list") validateListOptions(value);
  if (ids.has(value.id)) {
    throw new TypeError(`duplicate layout node ID ${value.id}`);
  }
  ids.add(value.id);
  if (value.controls !== undefined) {
    if (
      !Array.isArray(value.controls) ||
      !value.controls.every((id) => typeof id === "string")
    ) {
      throw new TypeError(`layout node ${value.id} has invalid controls`);
    }
    for (const id of value.controls) {
      if (controls.size > 0 && !controls.has(id)) {
        throw new TypeError(`unknown control ID ${id}`);
      }
    }
  }
  for (const name of ["display", "actions"] as const) {
    const list = value[name];
    if (
      list !== undefined &&
      (!Array.isArray(list) ||
        !list.every((item) => typeof item === "string" && item.length > 0))
    ) throw new TypeError(`layout node ${value.id} has invalid ${name}`);
  }
  if (
    value.headings !== undefined &&
    (!isRecord(value.headings) ||
      !Object.entries(value.headings).every(([column, heading]) =>
        column.length > 0 && typeof heading === "string" && heading.length > 0
      ))
  ) throw new TypeError(`layout node ${value.id} has invalid headings`);
  const declaredActions = value.actions as string[] | undefined;
  for (const id of declaredActions ?? []) {
    if (actions.size > 0 && !actions.has(id)) {
      throw new TypeError(`unknown action ID ${id}`);
    }
  }
  for (
    const name of [
      "title",
      "bind",
      "key",
      "selectedTab",
      "customElement",
    ] as const
  ) {
    const item = value[name];
    if (item !== undefined && (typeof item !== "string" || item.length === 0)) {
      throw new TypeError(`layout node ${value.id} has invalid ${name}`);
    }
  }
  if (value.type === "list" && typeof value.bind !== "string") {
    throw new TypeError(`list node ${value.id} requires a binding`);
  }
  if (value.type === "field-group" && value.children !== undefined) {
    throw new TypeError(
      `field group ${value.id} cannot contain layout regions`,
    );
  }
  if (value.type === "custom") {
    if (typeof value.customElement !== "string") {
      throw new TypeError(
        `custom node ${value.id} requires a custom element ID`,
      );
    }
    if (customElements.size > 0 && !customElements.has(value.customElement)) {
      throw new TypeError(`unknown custom element ID ${value.customElement}`);
    }
  } else if (value.customElement !== undefined) {
    throw new TypeError(
      `non-custom layout node ${value.id} declares a custom element`,
    );
  }
  if (value.ratio !== undefined) {
    if (
      !Array.isArray(value.ratio) || value.ratio.length < 2 ||
      value.ratio.some((part) => typeof part !== "number" || part <= 0)
    ) {
      throw new TypeError(`layout node ${value.id} has invalid split ratio`);
    }
  }
  if (
    value.columns !== undefined &&
    (!Number.isSafeInteger(value.columns) || Number(value.columns) < 1)
  ) {
    throw new TypeError(`layout node ${value.id} has invalid columns`);
  }
  if (
    value.minimumRegionWidth !== undefined &&
    (typeof value.minimumRegionWidth !== "number" ||
      !Number.isFinite(value.minimumRegionWidth) ||
      value.minimumRegionWidth <= 0)
  ) {
    throw new TypeError(
      `layout node ${value.id} has invalid minimum region width`,
    );
  }
  for (const name of ["primary", "secondary", "collapsed"] as const) {
    if (value[name] !== undefined && typeof value[name] !== "boolean") {
      throw new TypeError(`layout node ${value.id} has invalid ${name}`);
    }
  }
  if (value.responsive !== undefined && value.responsive !== "stack") {
    throw new TypeError(`layout node ${value.id} has invalid responsive hint`);
  }
  if (value.children !== undefined) {
    if (!Array.isArray(value.children)) {
      throw new TypeError(`layout node ${value.id} has invalid children`);
    }
    for (const child of value.children) {
      validateNode(child, ids, controls, actions, customElements);
    }
    if (
      value.type === "tabs" && value.selectedTab !== undefined &&
      !value.children.some((child) => child.id === value.selectedTab)
    ) throw new TypeError(`layout node ${value.id} selects an unknown tab`);
  }
}

function visit(node: LayoutNode, action: (node: LayoutNode) => void): void {
  action(node);
  for (const child of node.children ?? []) visit(child, action);
}

function order(values: string[], preferred: string[] | undefined): string[] {
  if (preferred === undefined) return values;
  const index = new Map(preferred.map((item, position) => [item, position]));
  return [...values].sort((left, right) =>
    (index.get(left) ?? Number.MAX_SAFE_INTEGER) -
    (index.get(right) ?? Number.MAX_SAFE_INTEGER)
  );
}

function orderNodes(
  values: LayoutNode[],
  preferred: string[] | undefined,
): LayoutNode[] {
  if (preferred === undefined) return values;
  const ids = order(values.map((item) => item.id), preferred);
  const byID = new Map(values.map((item) => [item.id, item]));
  return ids.map((id) => byID.get(id)!);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  owner: string,
): void {
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown !== undefined) {
    throw new TypeError(`${owner} contains unsupported property ${unknown}`);
  }
}
