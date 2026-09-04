import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "@the8020/http";
import { buildControls, buildFieldCatalog, schemaAtPath } from "./fields.ts";
import { validateCustomElements } from "./custom_elements.ts";
import { validateLayout } from "./layout.ts";
import { ScreenPaginator } from "./pagination.ts";
import type {
  ControlDescriptor,
  CustomElementDescriptor,
  PresentationSnapshot,
  PresentationSurfaceKind,
  ScreenAction,
  ScreenChange,
  ScreenEventMessage,
  ScreenHeader,
  ScreenPageMessage,
  ScreenSnapshot,
  UUIClientMessage,
  UUIWorkerOutbound,
} from "./protocol.ts";
import {
  BACK_EVENT,
  MAX_UUI_MESSAGE_BODY_LENGTH,
  UUI_MESSAGE_KINDS,
  type UUIMessageKind,
} from "./protocol.ts";

interface ScreenEventBase {
  action: string;
  controlId?: string;
  bind?: string;
  eventType: "action" | "change" | "select" | typeof BACK_EVENT | "exit";
  value?: unknown;
}

export interface ClientScreenEvent extends ScreenEventBase {
  clientSequence: number;
}

export interface ChannelScreenExit extends ScreenEventBase {
  eventType: "exit";
  origin: "channel";
}

export type ScreenEvent = ClientScreenEvent | ChannelScreenExit;

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
  channel?: ScreenChannel;
}

export interface SessionChannel {
  readonly sessionId: string;
  send(message: UUIWorkerOutbound): void;
  receive(): Promise<UUIClientMessage>;
}

interface PresentationSurface {
  readonly id: string;
  readonly kind: PresentationSurfaceKind;
  readonly state: BoundSession;
  snapshot?: ScreenSnapshot;
  pending?: ActiveScreenCall;
  closing: boolean;
  active: boolean;
  removed: Promise<void>;
  remove(): void;
}

interface ActiveScreenCall {
  readonly surface: PresentationSurface;
  readonly screenId: string;
  readonly revision: number;
  readonly snapshot: () => ScreenSnapshot;
  readonly receive: (message: ScreenEventMessage | ScreenPageMessage) => void;
  readonly resolve: (event: ScreenEvent) => void;
  readonly reject: (error: unknown) => void;
  detachChannel?: () => void;
  redrawQueued: boolean;
  settled: boolean;
}

interface BoundSession {
  readonly channel: SessionChannel;
  readonly root: PresentationSurface;
  readonly surfaces: PresentationSurface[];
  surfaceSequence: number;
  revision: number;
  lastClientSequence: number;
  active: boolean;
}

interface ScreenChannelAttachment {
  redraw(): void;
  exit(action?: string): void;
  fail(error: unknown): void;
}

const attachScreenChannel = Symbol("attachScreenChannel");

/** Controls redraw or completion of the one pending callScreen it is attached to. */
export class ScreenChannel {
  #attachment: ScreenChannelAttachment | undefined;

  redraw(): void {
    this.#attachment?.redraw();
  }

  exit(action = "exit"): void {
    this.#attachment?.exit(action);
  }

  fail(error: unknown): void {
    this.#attachment?.fail(error);
  }

  [attachScreenChannel](attachment: ScreenChannelAttachment): () => void {
    if (this.#attachment !== undefined) {
      throw new Error(
        "ScreenChannel may attach to only one pending callScreen()",
      );
    }
    this.#attachment = attachment;
    return () => {
      if (this.#attachment === attachment) this.#attachment = undefined;
    };
  }
}

const surfaceContext = new AsyncLocalStorage<PresentationSurface>();
let boundSession: BoundSession | undefined;

export function bindSession(value: SessionChannel): () => void {
  if (boundSession !== undefined) {
    throw new Error("UUI session channel is already bound");
  }
  const state = {} as BoundSession;
  const root = createSurface(state, "page", 1);
  Object.assign(
    state,
    {
      channel: value,
      root,
      surfaces: [root],
      surfaceSequence: 1,
      revision: 0,
      lastClientSequence: 0,
      active: true,
    } satisfies Partial<BoundSession>,
  );
  boundSession = state;
  void dispatchClientMessages(state);
  return () => {
    if (boundSession !== state) return;
    state.active = false;
    boundSession = undefined;
    const reason = new DOMException("UUI session ended", "AbortError");
    for (const surface of state.surfaces) {
      surface.active = false;
      if (surface.pending !== undefined) {
        settleCall(state, surface.pending, { error: reason }, false);
      }
    }
  };
}

/** Runs an ordinary program/function in a new modal presentation surface. */
export function presentModal<T>(
  run: () => T | Promise<T>,
): Promise<Awaited<T>> {
  return present("modal", run);
}

/** Runs an ordinary program/function in a new full-page presentation surface. */
export function presentPage<T>(
  run: () => T | Promise<T>,
): Promise<Awaited<T>> {
  return present("page", run);
}

export async function callScreen<T extends z.ZodRawShape>(
  options: CallScreenOptions<T>,
): Promise<ScreenEvent> {
  const state = requireBoundSession();
  const surface = currentSurface(state);
  if (surface.pending !== undefined) {
    throw new Error(
      "only one callScreen() may be pending in a presentation surface",
    );
  }
  if (!surface.active || surface.closing) {
    throw new Error("presentation surface is closed");
  }
  if (!state.active) {
    throw new Error("callScreen() requires a bound UUI session Worker");
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
  const screenRevision = ++state.revision;
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
  let resolveResult!: (event: ScreenEvent) => void;
  let rejectResult!: (error: unknown) => void;
  const result = new Promise<ScreenEvent>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  const call: ActiveScreenCall = {
    surface,
    screenId: options.id,
    revision: screenRevision,
    snapshot,
    receive: (message) =>
      receiveScreenMessage(
        state,
        call,
        options.schema,
        options.model,
        paginator,
        message,
      ),
    resolve: resolveResult,
    reject: rejectResult,
    redrawQueued: false,
    settled: false,
  };
  surface.pending = call;
  try {
    if (options.channel !== undefined) {
      call.detachChannel = options.channel[attachScreenChannel]({
        redraw: () =>
          scheduleRedraw(state, call, options.schema, options.model),
        exit: (action) => {
          if (typeof action !== "string" || action.length === 0) {
            settleCall(
              state,
              call,
              { error: new TypeError("screen exit action is required") },
            );
            return;
          }
          settleCall(state, call, {
            event: { action, eventType: "exit", origin: "channel" },
          });
        },
        fail: (error) => settleCall(state, call, { error }),
      });
    }
    surface.snapshot = snapshot();
    publishPresentation(state);
    return await result;
  } finally {
    if (surface.pending === call) surface.pending = undefined;
    call.detachChannel?.();
    call.detachChannel = undefined;
  }
}

async function present<T>(
  kind: PresentationSurfaceKind,
  run: () => T | Promise<T>,
): Promise<Awaited<T>> {
  if (typeof run !== "function") {
    throw new TypeError("presentation callback must be a function");
  }
  const state = requireBoundSession();
  currentSurface(state);
  if (kind === "modal") {
    const base = state.surfaces.findLast((surface) => surface.kind === "page");
    if (base?.snapshot === undefined) {
      throw new Error("presentModal() requires a presented page surface");
    }
  }
  const surface = createSurface(state, kind, ++state.surfaceSequence);
  state.surfaces.push(surface);
  publishPresentation(state);
  try {
    return await surfaceContext.run(surface, run);
  } finally {
    await closeSurface(state, surface);
  }
}

function createSurface(
  state: BoundSession,
  kind: PresentationSurfaceKind,
  sequence: number,
): PresentationSurface {
  let remove!: () => void;
  const removed = new Promise<void>((resolve) => {
    remove = resolve;
  });
  return {
    id: `surface-${sequence}`,
    kind,
    state,
    closing: false,
    active: true,
    removed,
    remove,
  };
}

async function closeSurface(
  state: BoundSession,
  surface: PresentationSurface,
): Promise<void> {
  if (!surface.active) return;
  surface.closing = true;
  if (surface.pending !== undefined) {
    settleCall(state, surface.pending, {
      error: new DOMException("presentation surface closed", "AbortError"),
    }, false);
  }
  let changed = false;
  while (state.surfaces.length > 1) {
    const top = state.surfaces.at(-1)!;
    if (!top.closing) break;
    state.surfaces.pop();
    top.active = false;
    top.remove();
    changed = true;
  }
  if (changed) publishPresentation(state);
  await surface.removed;
}

function requireBoundSession(): BoundSession {
  if (boundSession === undefined || !boundSession.active) {
    throw new Error("UUI session channel is not bound");
  }
  return boundSession;
}

function currentSurface(state: BoundSession): PresentationSurface {
  const stored = surfaceContext.getStore();
  if (stored === undefined) return state.root;
  if (
    stored.state !== state || !stored.active || stored.closing ||
    !state.surfaces.includes(stored)
  ) {
    throw new Error("presentation surface is closed");
  }
  return stored;
}

async function dispatchClientMessages(state: BoundSession): Promise<void> {
  try {
    while (state.active && boundSession === state) {
      const message = await state.channel.receive();
      if (!state.active || boundSession !== state) return;
      if (message.type === "screen.event" || message.type === "screen.page") {
        routeScreenMessage(state, message);
      }
    }
  } catch (error) {
    if (!state.active || boundSession !== state) return;
    for (const surface of state.surfaces) {
      if (surface.pending !== undefined) {
        settleCall(state, surface.pending, { error }, false);
      }
    }
  }
}

function routeScreenMessage(
  state: BoundSession,
  message: ScreenEventMessage | ScreenPageMessage,
): void {
  if (message.sessionId !== state.channel.sessionId) {
    state.channel.send({
      type: "session.error",
      code: "session_mismatch",
      message: "session identity mismatch",
    });
    return;
  }
  if (message.clientSequence <= state.lastClientSequence) {
    state.channel.send({
      type: "server.ack",
      clientSequence: message.clientSequence,
    });
    return;
  }
  const top = state.surfaces.at(-1);
  const call = top?.pending;
  if (
    top === undefined || call === undefined || top.snapshot === undefined ||
    message.surfaceId !== top.id || message.screenId !== call.screenId ||
    message.screenRevision !== call.revision
  ) {
    state.channel.send({
      type: "session.error",
      code: "screen_revision_mismatch",
      message: "presentation surface, screen identity, or revision mismatch",
    });
    return;
  }
  call.receive(message);
}

function receiveScreenMessage<T extends z.ZodRawShape>(
  state: BoundSession,
  call: ActiveScreenCall,
  schema: z.ZodObject<T>,
  model: z.infer<z.ZodObject<T>>,
  paginator: ScreenPaginator,
  message: ScreenEventMessage | ScreenPageMessage,
): void {
  if (call.settled || call.surface.pending !== call) return;
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
        model,
      );
      applyChanges(schema, model, message.changes, paginator);
      paginator.selectPage(message.bind, message.page, model);
      call.surface.snapshot = call.snapshot();
    } catch (error) {
      state.channel.send({
        type: "session.error",
        code: "pagination_failed",
        message: error instanceof Error
          ? error.message
          : "screen page request is invalid",
      });
      return;
    }
    state.lastClientSequence = message.clientSequence;
    publishPresentation(state);
    state.channel.send({
      type: "server.ack",
      clientSequence: message.clientSequence,
    });
    return;
  }
  try {
    applyChanges(schema, model, message.changes, paginator);
    call.surface.snapshot = call.snapshot();
  } catch (error) {
    state.channel.send({
      type: "session.error",
      code: "validation_failed",
      message: error instanceof Error
        ? error.message
        : "screen changes are invalid",
    });
    return;
  }
  state.lastClientSequence = message.clientSequence;
  state.channel.send({
    type: "server.ack",
    clientSequence: message.clientSequence,
  });
  settleCall(state, call, {
    event: {
      action: message.action,
      controlId: message.controlId,
      bind: message.bind,
      eventType: message.eventType ?? "action",
      value: message.value,
      clientSequence: message.clientSequence,
    },
  });
}

function scheduleRedraw<T extends z.ZodRawShape>(
  state: BoundSession,
  call: ActiveScreenCall,
  schema: z.ZodObject<T>,
  model: z.infer<z.ZodObject<T>>,
): void {
  if (call.settled || call.redrawQueued) return;
  call.redrawQueued = true;
  queueMicrotask(() => {
    call.redrawQueued = false;
    if (
      call.settled || !state.active || call.surface.pending !== call ||
      !call.surface.active || call.surface.closing
    ) return;
    const parsed = schema.safeParse(model);
    if (!parsed.success) {
      settleCall(state, call, { error: parsed.error });
      return;
    }
    call.surface.snapshot = call.snapshot();
    if (state.surfaces.at(-1) === call.surface) {
      publishPresentation(state);
    }
  });
}

function settleCall(
  state: BoundSession,
  call: ActiveScreenCall,
  outcome: { event: ScreenEvent } | { error: unknown },
  publish = true,
): void {
  if (call.settled) return;
  call.settled = true;
  if (call.surface.pending === call) call.surface.pending = undefined;
  call.detachChannel?.();
  call.detachChannel = undefined;
  if (publish && state.active) publishPresentation(state);
  if ("event" in outcome) call.resolve(outcome.event);
  else call.reject(outcome.error);
}

function visibleSurfaces(state: BoundSession): PresentationSurface[] {
  let firstPage = -1;
  for (let index = state.surfaces.length - 1; index >= 0; index--) {
    const surface = state.surfaces[index]!;
    if (surface.kind === "page" && surface.snapshot !== undefined) {
      firstPage = index;
      break;
    }
  }
  if (firstPage < 0) return [];
  return state.surfaces.slice(firstPage).filter((surface) =>
    surface.snapshot !== undefined
  );
}

function presentationSnapshot(state: BoundSession): PresentationSnapshot {
  const surfaces = visibleSurfaces(state);
  const top = state.surfaces.at(-1);
  const page = surfaces[0];
  const pageIndex = page === undefined ? -1 : state.surfaces.indexOf(page);
  return {
    pageDepth: pageIndex < 0
      ? 0
      : state.surfaces.slice(0, pageIndex + 1).filter((surface) =>
        surface.kind === "page"
      ).length,
    surfaces: surfaces.map((surface) => ({
      surfaceId: surface.id,
      kind: surface.kind,
      screen: surface.snapshot!,
    })),
    activeSurfaceId: top?.pending !== undefined && top.snapshot !== undefined
      ? top.id
      : null,
  };
}

function publishPresentation(state: BoundSession): void {
  if (!state.active) return;
  const presentation = presentationSnapshot(state);
  if (presentation.surfaces.length === 0) return;
  state.channel.send({ type: "presentation.show", presentation });
}

export function sendMessage(
  body: string,
  kind: UUIMessageKind = "info",
): void {
  if (boundSession === undefined) {
    throw new Error("sendMessage() requires a bound UUI session Worker");
  }
  if (
    typeof body !== "string" || body.trim().length === 0 ||
    body.length > MAX_UUI_MESSAGE_BODY_LENGTH
  ) {
    throw new TypeError(
      `message body must contain 1 to ${MAX_UUI_MESSAGE_BODY_LENGTH} characters`,
    );
  }
  if (!(UUI_MESSAGE_KINDS as readonly unknown[]).includes(kind)) {
    throw new TypeError(`unsupported UUI message kind ${String(kind)}`);
  }
  boundSession.channel.send({
    type: "notification.show",
    level: kind,
    message: body,
  });
}

export function copyText(text: string): void {
  if (boundSession === undefined) {
    throw new Error("UUI session channel is not bound");
  }
  if (typeof text !== "string" || text.length > 1_000_000) {
    throw new TypeError("clipboard text must not exceed 1,000,000 characters");
  }
  boundSession.channel.send({ type: "clipboard.write", text });
}

export function endSession(message?: string, redirectUrl?: string): void {
  if (boundSession === undefined) {
    throw new Error("UUI session channel is not bound");
  }
  boundSession.channel.send({ type: "session.end", message, redirectUrl });
}

export function currentSessionId(): string {
  if (boundSession === undefined) {
    throw new Error("UUI session channel is not bound");
  }
  return boundSession.channel.sessionId;
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
