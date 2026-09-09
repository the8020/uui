import { z } from "@the8020/http";
import { getPath } from "./bindings.ts";
import type { LayoutDocument, LayoutNode } from "./layout.ts";
import type {
  ControlDescriptor,
  CustomElementDescriptor,
  PresentationSnapshot,
  ScreenAction,
  ScreenSnapshot,
} from "./protocol.ts";

const id = z.string().min(1).max(256);
export const clientID = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const controlRequest = z.object({
  sessionId: id,
  clientId: clientID,
  operation: z.enum(["claim", "status", "release"]),
  takeover: z.boolean().default(false),
}).strict();
export const screenReference = z.object({
  revision: z.number().int().nonnegative(),
  surfaceId: id,
  screenId: id,
  instanceId: id,
}).strict();
export type ScreenReference = z.infer<typeof screenReference>;

export const agentOperation = z.discriminatedUnion("op", [
  z.object({ op: z.literal("screen") }).strict(),
  z.object({ op: z.literal("set"), id, value: z.unknown() }).strict(),
  z.object({ op: z.literal("click"), id }).strict(),
  z.object({ op: z.literal("enter"), id }).strict(),
  z.object({ op: z.literal("back") }).strict(),
  z.object({
    op: z.literal("value-help"),
    id,
    search: z.string().max(2000).default(""),
    offset: z.number().int().nonnegative().default(0),
    limit: z.number().int().min(1).max(500).default(25),
  }).strict(),
  z.object({
    op: z.literal("list"),
    id,
    search: z.string().max(2000).optional(),
    page: z.number().int().positive().optional(),
    pageSize: z.number().int().min(1).max(500).optional(),
  }).strict(),
  z.object({
    op: z.literal("select"),
    id,
    index: z.number().int().nonnegative(),
  }).strict(),
  z.object({
    op: z.literal("event"),
    action: id,
    id: id.optional(),
    value: z.unknown().optional(),
  }).strict(),
]);
export type AgentOperation = z.infer<typeof agentOperation>;
export const agentRequest = z.object({
  clientId: clientID,
  control: z.number().int().nonnegative(),
  expected: screenReference.optional(),
  force: z.boolean().default(false),
  command: agentOperation,
}).strict();
export type AgentRequest = z.infer<typeof agentRequest>;
export interface AgentResponse {
  sessionId: string;
  expected?: ScreenReference;
  transcript: string;
  result?: unknown;
  error?: string;
  busy?: boolean;
  ended?: boolean;
  messages?: Array<{ level: string; message: string }>;
}

type Element = Record<string, unknown>;
const text = (value: string | undefined) =>
  value?.replace(/\[\[icon=[^\]]*\]\]/g, "").trim();

/** One projection of the actual screen layout, with protocol details kept private. */
export function transcribe(
  presentation: PresentationSnapshot | undefined,
): string {
  if (presentation === undefined) return "state: opening\n";
  const layers = presentation.surfaces;
  const active = layers.at(-1);
  if (active === undefined) return "state: empty\n";
  const content = screenText(active.screen);
  if (active.kind === "modal") content.modal = true;
  if (layers.length > 1) {
    content.behind = layers.slice(0, -1).map((layer) => ({
      title: text(layer.screen.title),
      readonly: true,
    }));
  }
  if (presentation.activeSurfaceId === null) content.state = "working";
  return yaml(content) + "\n";
}

function screenText(screen: ScreenSnapshot): Element {
  const usedActions = new Set<string>();
  const controls = new Map(
    screen.controls.map((control) => [control.id, control]),
  );
  const button = (action: ScreenAction): Element => ({
    button: action.id,
    label: text(action.label),
  });
  const list = (id: string): Element[] => {
    const item = screen.lists.find((list) => list.id === id);
    if (item === undefined) return [];
    return [{
      list: id,
      columns: item.columns.map((column) => ({
        id: column.id,
        label: column.heading,
        description: column.description,
      })),
      rows: item.rows.slice(0, 100).map((row, index) => ({
        index,
        ...Object.fromEntries(
          item.columns.map((column) => [column.id, getPath(row, column.key)]),
        ),
      })),
      page: item.state.page,
      total: item.totalItems,
      ...(item.rows.length > 100
        ? {
          hint:
            "Transcript shows 100 rows; use list --page-size 100 to page through all rows.",
        }
        : {}),
    }];
  };
  const custom = (
    item: CustomElementDescriptor,
    value: unknown,
    readonly = false,
  ): Element[] => {
    if (item.fallback === undefined) {
      return [{ component: item.id, unsupported: true }];
    }
    return [{
      component: item.id,
      elements: [
        ...(item.fallback.inputs ?? []).map((field) => ({
          field: `${item.id}/${field.name}`,
          label: field.label ?? field.name,
          description: field.description,
          value: field.path === "" ? value : getPath(value, field.path),
          ...(readonly ? { readonly: true } : {}),
          ...(field.multiline ? { multiline: true } : {}),
        })),
        ...(item.fallback.outputs ?? []).map((field) => ({
          field: `${item.id}/${field.name}`,
          label: field.label ?? field.name,
          description: field.description,
          value: field.path === "" ? value : getPath(value, field.path),
          readonly: true,
        })),
        ...(item.fallback.actions ?? []).map((action) => ({
          button: `${item.id}/${action.name}`,
          label: text(action.label),
        })),
      ],
    }];
  };
  const field = (control: ControlDescriptor): Element[] => {
    if (control.hidden) return [];
    if (control.control === "list") return list(control.id);
    const value = getPath(screen.model, control.bind);
    if (control.custom) {
      return custom(
        { ...control.custom, id: control.id },
        value,
        control.readOnly,
      );
    }
    return [{
      field: control.id,
      label: text(control.label),
      description: control.description,
      value: control.control === "password" && value ? "••••" : value,
      ...(control.readOnly ? { readonly: true } : {}),
      ...(control.valueHelp ? { "value-help": true } : {}),
      ...(control.enterEvent ? { enter: true } : {}),
    }];
  };
  const actions = (ids: string[]): Element[] =>
    ids.flatMap((id) => {
      const action = screen.actions.find((item) => item.id === id);
      if (!action) return [];
      usedActions.add(id);
      return [button(action)];
    });
  const visit = (node: LayoutNode): Element[] => {
    const elements: Element[] = [];
    if (node.type === "list") elements.push(...list(node.id));
    else if (node.type === "custom") {
      const descriptor = screen.customElements.find((item) =>
        item.id === node.customElement
      );
      if (descriptor) {
        elements.push(...custom(descriptor, descriptor.config, true));
      }
    } else {for (const id of node.controls ?? []) {
        const control = controls.get(id);
        if (control) elements.push(...field(control));
      }}
    elements.push(
      ...actions(
        node.type === "actions"
          ? node.actions ?? screen.actions.map((action) => action.id)
          : node.actions ?? [],
      ),
    );
    elements.push(...(node.children ?? []).flatMap(visit));
    if (node.type === "tabs") {
      return [{
        tabs: node.id,
        selected: screen.state.elements[node.id]?.selectedTab ??
          node.selectedTab,
        elements,
      }];
    }
    return node.title
      ? [{
        [node.type === "section" ? "section" : "group"]: text(node.title),
        elements,
      }]
      : elements;
  };
  let content: Element[];
  if (screen.layout) content = visit((screen.layout as LayoutDocument).root);
  else {
    const groups = new Map<string, Element[]>();
    for (const control of screen.controls) {
      const name = control.group ?? "";
      groups.set(name, [...groups.get(name) ?? [], ...field(control)]);
    }
    content = [...groups].flatMap(([group, elements]) =>
      group ? [{ group, elements }] : elements
    );
  }
  content.push(
    ...screen.actions.filter((action) => !usedActions.has(action.id)).map(
      button,
    ),
  );
  return {
    screenCall: screen.screenCall ?? "unavailable",
    title: text(screen.title),
    description: screen.description,
    header: [
      ...screen.header.controls.flatMap(field),
      ...screen.header.actions.map(button),
    ],
    content,
  };
}

/** JSON scalars keep arbitrary labels and source text valid YAML without a dependency. */
export function yaml(value: unknown, indent = ""): string {
  if (Array.isArray(value) && value.length) {
    return value.map((item) =>
      `${indent}- ${yaml(item, indent + "  ").trimStart()}`
    ).join("\n");
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value).filter(([, item]) =>
      item !== undefined
    );
    if (entries.length) {
      return entries.map(([key, item]) => {
        const nested = item !== null && typeof item === "object" &&
          Object.keys(item).length > 0;
        return `${indent}${/^[\w-]+$/.test(key) ? key : JSON.stringify(key)}:${
          nested
            ? "\n" + yaml(item, indent + "  ")
            : " " + (JSON.stringify(item) ?? "null")
        }`;
      }).join("\n");
    }
  }
  return indent + (JSON.stringify(value) ?? "null");
}
