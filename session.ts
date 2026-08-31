import { z } from "@the8020/http";
import { buildControls, buildFieldCatalog, schemaAtPath } from "./fields.ts";
import { validateCustomElements } from "./custom_elements.ts";
import { validateLayout } from "./layout.ts";
import { ScreenPaginator } from "./pagination.ts";
import type {
  ControlDescriptor,
  CustomElementDescriptor,
  ScreenAction,
  ScreenChange,
  ScreenHeader,
  ScreenSnapshot,
  UUIClientMessage,
  UUIWorkerOutbound,
} from "./protocol.ts";
import { BACK_EVENT } from "./protocol.ts";

export interface ScreenEvent {
  action: string;
  controlId?: string;
  bind?: string;
  eventType: "action" | "change" | "select" | typeof BACK_EVENT | "exit";
  value?: unknown;
  clientSequence: number;
}

export interface CallScreenOptions<T extends z.ZodRawShape> {
  id: string;
  schema: z.ZodObject<T>;
  model: z.infer<z.ZodObject<T>>;
  layout?: unknown;
  controls?: ControlDescriptor[];
  actions?: ScreenAction[];
  header?: {
    controls?: ControlDescriptor[];
    actions?: ScreenAction[];
  };
  title?: string;
  description?: string;
  customElements?: CustomElementDescriptor[];
}

export interface SessionChannel {
  readonly sessionId: string;
  send(message: UUIWorkerOutbound): void;
  receive(): Promise<UUIClientMessage>;
}

let channel: SessionChannel | undefined;
let pending = false;
let revision = 0;
let lastClientSequence = 0;

export function bindSession(value: SessionChannel): () => void {
  if (channel !== undefined) {
    throw new Error("UUI session channel is already bound");
  }
  channel = value;
  pending = false;
  revision = 0;
  lastClientSequence = 0;
  return () => {
    if (channel === value) channel = undefined;
    pending = false;
  };
}

export async function callScreen<T extends z.ZodRawShape>(
  options: CallScreenOptions<T>,
): Promise<ScreenEvent> {
  const bound = channel;
  if (bound === undefined) {
    throw new Error("callScreen() requires a bound UUI session Worker");
  }
  if (pending) {
    throw new Error("only one callScreen() may be pending in a session Worker");
  }
  if (options.id.length === 0) throw new TypeError("screen ID is required");
  const initial = options.schema.safeParse(options.model);
  if (!initial.success) throw initial.error;
  const fields = buildFieldCatalog(options.schema);
  const headerControls = options.header?.controls === undefined ||
      options.header.controls.length === 0
    ? []
    : buildControls(fields, options.header.controls);
  const headerControlIDs = new Set(headerControls.map((item) => item.id));
  const controls = buildControls(fields, options.controls).filter((item) =>
    !headerControlIDs.has(item.id)
  );
  const actions = structuredClone(options.actions ?? []);
  const headerActions = structuredClone(options.header?.actions ?? []);
  const customElements = validateCustomElements(options.customElements);
  const actionIDs = new Set<string>();
  for (const action of [...actions, ...headerActions]) {
    if (
      action.id.length === 0 || action.label.length === 0 ||
      actionIDs.has(action.id) || action.id === BACK_EVENT
    ) {
      throw new TypeError(
        `duplicate, empty, unlabeled, or reserved action ${action.id}`,
      );
    }
    actionIDs.add(action.id);
  }
  const header: ScreenHeader = {
    controls: headerControls,
    actions: headerActions,
  };
  const layout = options.layout === undefined ? undefined : validateLayout(
    options.layout,
    new Set(controls.map((item) => item.id)),
    new Set(actions.map((item) => item.id)),
    new Set(customElements.map((item) => item.id)),
  );
  const screenRevision = ++revision;
  const paginator = new ScreenPaginator(
    options.model,
    [...controls, ...headerControls],
    layout,
  );
  const snapshot = (): ScreenSnapshot => {
    const presented = paginator.present(options.model);
    return {
      id: options.id,
      revision: screenRevision,
      title: options.title,
      description: options.description,
      fields,
      controls,
      model: presented.model,
      pagination: presented.pagination,
      layout,
      actions,
      header,
      customElements,
    };
  };
  pending = true;
  bound.send({ type: "screen.show", screen: snapshot() });
  try {
    while (true) {
      const message = await bound.receive();
      if (message.type !== "screen.event" && message.type !== "screen.page") {
        continue;
      }
      if (message.sessionId !== bound.sessionId) {
        bound.send({
          type: "session.error",
          code: "session_mismatch",
          message: "session identity mismatch",
        });
        continue;
      }
      if (message.clientSequence <= lastClientSequence) {
        bound.send({
          type: "server.ack",
          clientSequence: message.clientSequence,
        });
        continue;
      }
      if (
        message.screenId !== options.id ||
        message.screenRevision !== screenRevision
      ) {
        bound.send({
          type: "session.error",
          code: "screen_revision_mismatch",
          message: "screen identity or revision mismatch",
        });
        continue;
      }
      if (message.type === "screen.page") {
        try {
          if (!message.changes.some((change) => change.bind === message.bind)) {
            throw new TypeError(
              `page request for ${message.bind} must include its visible records`,
            );
          }
          paginator.validatePageRequest(
            message.bind,
            message.currentPage,
            message.page,
            options.model,
          );
          applyChanges(
            options.schema,
            options.model,
            message.changes,
            paginator,
          );
          paginator.selectPage(message.bind, message.page, options.model);
        } catch (error) {
          bound.send({
            type: "session.error",
            code: "pagination_failed",
            message: error instanceof Error
              ? error.message
              : "screen page request is invalid",
          });
          continue;
        }
        lastClientSequence = message.clientSequence;
        bound.send({ type: "screen.show", screen: snapshot() });
        bound.send({
          type: "server.ack",
          clientSequence: message.clientSequence,
        });
        continue;
      }
      try {
        applyChanges(
          options.schema,
          options.model,
          message.changes,
          paginator,
        );
      } catch (error) {
        bound.send({
          type: "session.error",
          code: "validation_failed",
          message: error instanceof Error
            ? error.message
            : "screen changes are invalid",
        });
        continue;
      }
      lastClientSequence = message.clientSequence;
      bound.send({
        type: "server.ack",
        clientSequence: message.clientSequence,
      });
      return {
        action: message.action,
        controlId: message.controlId,
        bind: message.bind,
        eventType: message.eventType ?? "action",
        value: message.value,
        clientSequence: message.clientSequence,
      };
    }
  } finally {
    pending = false;
  }
}

export function showNotification(
  message: string,
  level: "info" | "success" | "warning" | "error" = "info",
): void {
  if (channel === undefined) {
    throw new Error("UUI session channel is not bound");
  }
  channel.send({ type: "notification.show", level, message });
}

export function copyText(text: string): void {
  if (channel === undefined) {
    throw new Error("UUI session channel is not bound");
  }
  if (typeof text !== "string" || text.length > 1_000_000) {
    throw new TypeError("clipboard text must not exceed 1,000,000 characters");
  }
  channel.send({ type: "clipboard.write", text });
}

export function endSession(message?: string, redirectUrl?: string): void {
  if (channel === undefined) {
    throw new Error("UUI session channel is not bound");
  }
  channel.send({ type: "session.end", message, redirectUrl });
}

export function currentSessionId(): string {
  if (channel === undefined) {
    throw new Error("UUI session channel is not bound");
  }
  return channel.sessionId;
}

function applyChanges<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
  model: z.infer<z.ZodObject<T>>,
  changes: readonly ScreenChange[],
  paginator: ScreenPaginator,
): void {
  const candidate = structuredClone(model) as Record<string, unknown>;
  for (const change of changes) {
    const target = schemaAtPath(schema, change.bind);
    if (target === undefined) {
      throw new TypeError(`unknown binding ${change.bind}`);
    }
    if (paginator.has(change.bind)) {
      setPath(
        candidate,
        change.bind,
        paginator.mergeVisiblePage(
          change.bind,
          getPath(candidate, change.bind),
          change.value,
        ),
      );
      continue;
    }
    const parsed = target.safeParse(change.value);
    if (!parsed.success) throw parsed.error;
    setPath(candidate, change.bind, parsed.data);
  }
  const parsed = schema.parse(candidate) as Record<string, unknown>;
  for (const change of changes) {
    setPath(
      model as Record<string, unknown>,
      change.bind,
      getPath(parsed, change.bind),
    );
  }
}

function setPath(
  target: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const parts = path.split(".");
  let current = target;
  for (const part of parts.slice(0, -1)) {
    const next = current[part];
    if (next === null || typeof next !== "object" || Array.isArray(next)) {
      throw new TypeError(`binding ${path} does not resolve to an object`);
    }
    current = next as Record<string, unknown>;
  }
  current[parts.at(-1)!] = value;
}

function getPath(target: Record<string, unknown>, path: string): unknown {
  let current: unknown = target;
  for (const part of path.split(".")) {
    if (
      current === null || typeof current !== "object" || Array.isArray(current)
    ) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
