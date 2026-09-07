import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "@the8020/http";
import { buildControls, buildFieldCatalog, schemaAtPath } from "./fields.ts";
import { validateCustomElements } from "./custom_elements.ts";
import { resolveLayoutReferences, validateLayout } from "./layout.ts";
import { ScreenLists, StaleListView } from "./lists.ts";
import { Model } from "./model.ts";
import { runFieldHelp } from "./field_help.ts";
import { explicitElementIDs, resolveElementIDs } from "./identifiers.ts";
import {
  type ListChange,
  type ListQuery,
  screenElement,
  type ScreenStateUpdate,
  validScreenStateUpdate,
} from "./screen_state.ts";
import {
  type DownloadHandle,
  DownloadManager,
  type DownloadOptions,
} from "./downloads.ts";
import type {
  BrowserContext,
  ControlDeclaration,
  ControlDescriptor,
  CustomElementDeclaration,
  PresentationSnapshot,
  PresentationSurfaceKind,
  ScreenActionDeclaration,
  ScreenChange,
  ScreenEventMessage,
  ScreenHeader,
  ScreenListMessage,
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

export interface ListQueryScreenEvent {
  action: "list-query";
  eventType: "list-query";
  clientSequence: number;
  listId: string;
  bind: string;
  change: "search" | "filter" | "sort";
  query: ListQuery;
  /** Page sources whose queries or capacities changed in this interaction. */
  reloadLists?: string[];
}

export interface ListPageScreenEvent {
  action: "list-page";
  eventType: "list-page";
  clientSequence: number;
  listId: string;
  bind: string;
  change: "page" | "capacity";
  query: ListQuery;
  /** Page sources whose queries or capacities changed in this interaction. */
  reloadLists?: string[];
}

export type ScreenEvent =
  | ClientScreenEvent
  | ChannelScreenExit
  | ListQueryScreenEvent
  | ListPageScreenEvent;

type ScreenOutcome = { event: ScreenEvent } | { error: unknown };

export interface CallScreenOptions<T extends z.ZodRawShape> {
  id: string;
  schema: z.ZodObject<T>;
  model: Model<z.infer<z.ZodObject<T>>>;
  layout?: unknown;
  controls?: ControlDeclaration[];
  actions?: ScreenActionDeclaration[];
  header?: {
    controls?: ControlDeclaration[];
    actions?: ScreenActionDeclaration[];
  };
  title?: string;
  description?: string;
  customElements?: CustomElementDeclaration[];
  channel?: ScreenChannel;
}

export interface SessionChannel {
  readonly sessionId: string;
  readonly browser?: BrowserContext;
  send(message: UUIWorkerOutbound | Uint8Array): void;
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
  readonly receive: (message: ScreenEventMessage | ScreenListMessage) => void;
  readonly help: (control: ControlDescriptor) => void;
  readonly resolve: (event: ScreenEvent) => void;
  readonly reject: (error: unknown) => void;
  detachChannel?: () => void;
  redrawQueued: boolean;
  settled: boolean;
  helping: boolean;
  afterHelp?: ScreenOutcome;
}

interface BoundSession {
  readonly channel: SessionChannel;
  readonly downloads: DownloadManager;
  readonly root: PresentationSurface;
  readonly models: Set<Model<object>>;
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
      downloads: new DownloadManager(
        (message) => value.send(message),
        (message) =>
          value.send({ type: "notification.show", level: "error", message }),
      ),
      root,
      models: new Set<Model<object>>(),
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
    state.downloads.abortAll(reason.message);
    for (const surface of state.surfaces) {
      surface.active = false;
      if (surface.pending !== undefined) {
        settleCall(state, surface.pending, { error: reason }, false);
      }
    }
  };
}

/**
 * Start a background download on the current UUI session. Returns immediately;
 * await the handle's `done` only when the program needs to wait for completion.
 */
export function download(options: DownloadOptions): DownloadHandle {
  return requireBoundSession().downloads.start(options);
}

/** Infrastructure hook: connection loss cancels streams without replaying bytes. */
export function cancelDownloads(reason?: string): void {
  boundSession?.downloads.abortAll(reason);
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
  if (!(options.model instanceof Model)) {
    throw new TypeError("callScreen model must be a Model instance");
  }
  if (state.models.has(options.model)) {
    throw new TypeError(
      "a Model may be attached to only one pending callScreen",
    );
  }
  for (const model of state.models) {
    if (model.screen.instanceId === options.model.screen.instanceId) {
      throw new TypeError(
        "Model identity is already attached to a pending screen",
      );
    }
  }
  const initial = options.schema.safeParse(options.model.data);
  if (!initial.success) throw initial.error;
  const fields = buildFieldCatalog(options.schema);
  const headerDeclarations = options.header?.controls ?? [];
  const headerBindings = new Set(headerDeclarations.map((item) => item.bind));
  const bodyDeclarations: ControlDeclaration[] = options.controls?.length
    ? options.controls
    : fields.filter((field) => !headerBindings.has(field.bind)).map((
      field,
    ) => ({ ...field, id: undefined }));
  const authored: Array<{ id?: string }> = [
    ...bodyDeclarations,
    ...headerDeclarations,
    ...(options.actions ?? []),
    ...(options.header?.actions ?? []),
    ...(options.customElements ?? []),
  ];
  const collectAuthored = (value: unknown): void => {
    if (value === null || typeof value !== "object") return;
    const node = value as { id?: string; children?: unknown[] };
    authored.push(node);
    if (Array.isArray(node.children)) node.children.forEach(collectAuthored);
  };
  collectAuthored((options.layout as { root?: unknown } | undefined)?.root);
  const reserved = explicitElementIDs(authored);
  const resolvedControls =
    bodyDeclarations.length + headerDeclarations.length === 0
      ? []
      : buildControls(
        fields,
        [...bodyDeclarations, ...headerDeclarations],
        reserved,
      );
  const controls = resolvedControls.slice(0, bodyDeclarations.length);
  const headerControls = resolvedControls.slice(bodyDeclarations.length);
  const resolvedActions = resolveElementIDs(
    structuredClone([
      ...(options.actions ?? []),
      ...(options.header?.actions ?? []),
    ]),
    (action) => ({ label: action.label, kind: action.kind }),
    "action",
    reserved,
  );
  const actions = resolvedActions.slice(0, options.actions?.length ?? 0);
  const headerActions = resolvedActions.slice(options.actions?.length ?? 0);
  const customElements = validateCustomElements(
    options.customElements,
    reserved,
  );
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
    new Set(controls.flatMap((item) => [item.id, item.bind])),
    new Set(actions.map((item) => item.id)),
    new Set(customElements.map((item) => item.id)),
    reserved,
  );
  if (layout !== undefined) resolveLayoutReferences(layout, controls);
  const screenRevision = ++state.revision;
  const lists = new ScreenLists(
    options.schema,
    controls,
    layout,
    options.model.screen,
    headerControls,
  );
  const elementIDs = new Set(
    [
      ...controls,
      ...headerControls,
      ...actions,
      ...headerActions,
      ...customElements,
    ].map((item) => item.id),
  );
  const visit = (node: import("./layout.ts").LayoutNode): void => {
    elementIDs.add(node.id);
    node.children?.forEach(visit);
  };
  if (layout !== undefined) visit(layout.root);
  for (const id of elementIDs) screenElement(options.model.screen, id);
  const snapshot = (): ScreenSnapshot => {
    for (const id of elementIDs) screenElement(options.model.screen, id);
    const presented = lists.present(options.model.data);
    return {
      id: options.id,
      revision: screenRevision,
      title: options.title,
      description: options.description,
      fields,
      controls,
      model: lists.presentModel(options.model.data),
      state: {
        ...structuredClone(options.model.screen),
        elements: Object.fromEntries([...elementIDs].map((id) => [
          id,
          structuredClone(options.model.screen.elements[id]!),
        ])),
      },
      lists: presented,
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
        lists,
        elementIDs,
        message,
      ),
    help: (control) => {
      void showFieldHelp(control);
    },
    resolve: resolveResult,
    reject: rejectResult,
    redrawQueued: false,
    settled: false,
    helping: false,
  };
  async function showFieldHelp(control: ControlDescriptor): Promise<void> {
    if (call.helping || call.settled) return;
    call.helping = true;
    let changed = false;
    try {
      await surfaceContext.run(
        surface,
        () =>
          presentModal(() =>
            runFieldHelp(schemaAtPath(options.schema, control.bind)!, control, {
              get: () => getPath(options.model.data, control.bind),
              set: (value) => {
                if (control.readOnly) {
                  throw new TypeError("This field is read-only");
                }
                const candidate = structuredClone(options.model.data);
                setPath(candidate, control.bind, value);
                const parsed = options.schema.parse(candidate);
                const next = getPath(parsed, control.bind);
                changed ||= !Object.is(
                  getPath(options.model.data, control.bind),
                  next,
                );
                setPath(options.model.data, control.bind, next);
              },
            })
          ),
      );
    } catch (error) {
      call.afterHelp = { error };
    } finally {
      call.helping = false;
      if (call.afterHelp !== undefined) {
        settleCall(state, call, call.afterHelp);
      } else if (changed && control.reactive) {
        settleCall(state, call, {
          event: {
            action: "change",
            eventType: "change",
            bind: control.bind,
            controlId: control.id,
            value: getPath(options.model.data, control.bind),
            clientSequence: state.lastClientSequence,
          },
        });
      } else {
        scheduleRedraw(state, call, options.schema, options.model);
      }
    }
  }
  state.models.add(options.model);
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
    state.models.delete(options.model);
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
      if (message.type === "screen.event" || message.type === "screen.list") {
        routeScreenMessage(state, message);
      } else if (
        message.type === "download.credit" ||
        message.type === "download.done" ||
        message.type === "download.cancel"
      ) {
        if (message.sessionId !== state.channel.sessionId) {
          throw new TypeError("download session mismatch");
        }
        try {
          state.downloads.receive(message);
        } catch (error) {
          state.downloads.abortAll("Invalid download control message");
          state.channel.send({
            type: "session.error",
            code: "invalid_download_control",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  } catch (error) {
    if (!state.active || boundSession !== state) return;
    state.downloads.abortAll("UUI input closed");
    for (const surface of state.surfaces) {
      if (surface.pending !== undefined) {
        settleCall(state, surface.pending, { error }, false);
      }
    }
  }
}

function routeScreenMessage(
  state: BoundSession,
  message: ScreenEventMessage | ScreenListMessage,
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
  model: Model<z.infer<z.ZodObject<T>>>,
  lists: ScreenLists,
  elementIDs: ReadonlySet<string>,
  message: ScreenEventMessage | ScreenListMessage,
): void {
  if (call.settled || call.surface.pending !== call) return;
  let selection:
    | { value: unknown; bind: string; controlId: string }
    | undefined;
  let queryEvent: ListQueryScreenEvent | ListPageScreenEvent | undefined;
  let helpControl: ControlDescriptor | undefined;
  const controls = [
    ...call.surface.snapshot!.controls,
    ...(call.surface.snapshot!.header?.controls ?? []),
  ];
  try {
    if (message.instanceId !== model.screen.instanceId) {
      throw new TypeError("screen instance mismatch");
    }
    validateScreenUpdate(message.screenState, model, elementIDs);
    if (message.type === "screen.event" && message.eventType === "field-help") {
      helpControl = controls.find((control) =>
        control.id === message.controlId
      );
      if (
        message.action !== "field-help" || helpControl === undefined ||
        helpControl.bind !== message.bind || helpControl.hidden ||
        helpControl.fieldHelp === false || helpControl.control === "list"
      ) throw new TypeError("unknown or unavailable field help");
    }
    if (message.type === "screen.list") {
      if (
        message.updates.filter((item) => item.operation === "query").length > 1
      ) throw new TypeError("only one query may change per interaction");
      lists.validateRequests(message.updates, model.data);
    } else if (message.selection !== undefined) {
      selection = lists.select(message.selection, model.data);
    }
    applyChanges(
      schema,
      model.data,
      message.changes,
      lists,
      message.listChanges ?? [],
      controls,
    );
    model.screen.scroll = structuredClone(message.screenState.scroll);
    for (const [id, update] of Object.entries(message.screenState.elements)) {
      const element = screenElement(model.screen, id);
      element.scroll = structuredClone(update.scroll);
      element.toolbarOpen = update.toolbarOpen;
      if (update.selectedTab !== undefined) {
        element.selectedTab = update.selectedTab;
      }
    }
    if (message.type === "screen.list") {
      const reloadLists: string[] = [];
      for (const request of message.updates) {
        const changed = lists.update(request);
        if (changed !== undefined) {
          if (
            call.surface.snapshot!.lists.find((list) => list.id === changed.id)
              ?.pageSource !== undefined
          ) reloadLists.push(changed.id);
          // Preserve a query event when the browser also measures other lists.
          if (
            queryEvent?.eventType === "list-query" &&
            (changed.change === "page" || changed.change === "capacity")
          ) continue;
          queryEvent = {
            ...(changed.change === "page" || changed.change === "capacity"
              ? {
                action: "list-page",
                eventType: "list-page",
                change: changed.change,
              } as const
              : {
                action: "list-query",
                eventType: "list-query",
                change: changed.change,
              } as const),
            clientSequence: message.clientSequence,
            listId: changed.id,
            bind: changed.bind,
            query: changed.query,
          };
        }
      }
      if (queryEvent !== undefined && reloadLists.length > 0) {
        queryEvent.reloadLists = reloadLists;
      }
    }
    if (queryEvent === undefined) call.surface.snapshot = call.snapshot();
  } catch (error) {
    state.channel.send({
      type: "session.error",
      code: error instanceof StaleListView
        ? "list_view_mismatch"
        : "validation_failed",
      message: error instanceof Error
        ? error.message
        : "screen changes are invalid",
    });
    if (error instanceof StaleListView) {
      call.surface.snapshot = call.snapshot();
      publishPresentation(state);
    }
    return;
  }
  state.lastClientSequence = message.clientSequence;
  if (message.type === "screen.list" && queryEvent === undefined) {
    publishPresentation(state);
    state.channel.send({
      type: "server.ack",
      clientSequence: message.clientSequence,
    });
    return;
  }
  state.channel.send({
    type: "server.ack",
    clientSequence: message.clientSequence,
  });
  if (helpControl !== undefined) {
    call.help(helpControl);
  } else if (queryEvent !== undefined) {
    settleCall(state, call, { event: queryEvent });
  } else if (message.type === "screen.event") {
    if (message.eventType === "field-help") return;
    settleCall(state, call, {
      event: {
        action: message.action,
        controlId: selection?.controlId ?? message.controlId,
        bind: selection?.bind ?? message.bind,
        eventType: message.eventType ?? "action",
        value: selection === undefined ? message.value : selection.value,
        clientSequence: message.clientSequence,
      },
    });
  }
}

function validateScreenUpdate(
  update: ScreenStateUpdate,
  model: Model<object>,
  ids: ReadonlySet<string>,
): void {
  if (
    !validScreenStateUpdate(update) ||
    update.version !== model.screen.version ||
    Object.keys(update.elements).some((id) => !ids.has(id))
  ) throw new TypeError("invalid or stale screen state");
}

function scheduleRedraw<T extends z.ZodRawShape>(
  state: BoundSession,
  call: ActiveScreenCall,
  schema: z.ZodObject<T>,
  model: Model<z.infer<z.ZodObject<T>>>,
): void {
  if (call.settled || call.redrawQueued) return;
  call.redrawQueued = true;
  queueMicrotask(() => {
    call.redrawQueued = false;
    if (
      call.settled || !state.active || call.surface.pending !== call ||
      !call.surface.active || call.surface.closing
    ) return;
    const parsed = schema.safeParse(model.data);
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
  outcome: ScreenOutcome,
  publish = true,
): void {
  if (call.settled) return;
  if (call.helping && state.active) {
    call.afterHelp ??= outcome;
    return;
  }
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

/** Latest browser handshake metadata; absent for channels without a browser. */
export function currentBrowser(): BrowserContext | undefined {
  if (boundSession === undefined) {
    throw new Error("UUI session channel is not bound");
  }
  return boundSession.channel.browser;
}

function applyChanges<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
  model: z.infer<z.ZodObject<T>>,
  changes: readonly ScreenChange[],
  lists: ScreenLists,
  listChanges: readonly ListChange[],
  controls: readonly ControlDescriptor[],
): void {
  if (changes.length === 0 && listChanges.length === 0) return;
  const candidate = structuredClone(model) as Record<string, unknown>;
  const bindings = lists.bindings();
  const changed = lists.applyEdits(listChanges, model, candidate);
  for (const change of changes) {
    const target = schemaAtPath(schema, change.bind);
    if (target === undefined) {
      throw new TypeError(`unknown binding ${change.bind}`);
    }
    if (
      !controls.some((control) =>
        control.bind === change.bind && !control.readOnly && !control.hidden &&
        (change.controlId === undefined || change.controlId === control.id)
      )
    ) throw new TypeError(`binding ${change.bind} is not editable`);
    if (
      bindings.has(change.bind) ||
      [...bindings].some((bind) => bind.startsWith(`${change.bind}.`))
    ) {
      throw new TypeError("list edits require a displayed-row mapping");
    }
    const parsed = target.safeParse(change.value);
    if (!parsed.success) throw parsed.error;
    setPath(candidate, change.bind, parsed.data);
    changed.add(change.bind);
  }
  const parsed = schema.parse(candidate) as Record<string, unknown>;
  for (const bind of changed) {
    setPath(model as Record<string, unknown>, bind, getPath(parsed, bind));
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
