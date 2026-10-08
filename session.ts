import { getPath, setPath } from "./bindings.ts";
import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "/p/the8020/db/fields.ts";
import {
  buildControls,
  buildFieldCatalog,
  fieldMetadata,
  schemaAtPath,
} from "./fields.ts";
import {
  channelBinding,
  cloneDeclaration,
  isChannelBinding,
  validateCustomElements,
} from "./custom_elements.ts";
import { validateElementDeclarations } from "./list_options.ts";
import { resolveLayoutReferences, validateLayout } from "./layout.ts";
import {
  type ListTransactionContext,
  ScreenLists,
  StaleListView,
} from "./lists.ts";
import {
  type AttachedChannel,
  ChannelBindings,
  type ChannelConnection,
  ChannelRouter,
  type ChannelSubscriber,
  type ChannelSubscription,
} from "./channel.ts";
import type {
  ByteSource,
  StreamHandle,
  StreamPolicy,
} from "./channel_streams.ts";
import { Model } from "./model.ts";
import { MessageHistory, type MessageOutput } from "./messages.ts";
import { readValueHelp, runFieldHelp, valueHelpFor } from "./field_help.ts";
import { DOWNLOAD_POLICY } from "./download_metadata.ts";
import type { AgentOperation } from "./agent.ts";
import { displayPath, locationFromStack } from "./src/short_dump.ts";
import { explicitElementIDs, resolveElementIDs } from "./identifiers.ts";
import {
  type ListChange,
  type ListQuery,
  type ListRequest,
  screenElement,
  type ScreenStateUpdate,
  validScreenStateUpdate,
} from "./screen_state.ts";
import {
  type DownloadHandle,
  type DownloadOptions,
  startDownload,
} from "./downloads.ts";
import type {
  BrowserContext,
  ComponentStyle,
  ControlDeclaration,
  ControlDescriptor,
  CustomElementDeclaration,
  ListUpdateRequest,
  PresentationSnapshot,
  PresentationSurfaceKind,
  ScreenActionDeclaration,
  ScreenChange,
  ScreenElement,
  ScreenElementDeclaration,
  ScreenEventMessage,
  ScreenHeader,
  ScreenSnapshot,
  Separator,
  UUIClientMessage,
  UUIWorkerOutbound,
} from "./protocol.ts";
import {
  ACCOUNT_EVENT,
  BACK_EVENT,
  CUSTOMIZATION_EVENT,
  shortcutKey,
  UUI_PROTOCOL_VERSION,
  type UUIMessageKind,
  validateComponentStyle,
  validateShortcut,
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
}

export type ScreenEvent =
  | ClientScreenEvent
  | ChannelScreenExit
  | ListQueryScreenEvent;

type ScreenOutcome = { event: ScreenEvent } | { error: unknown };

export interface CallScreenOptions<T extends z.ZodRawShape>
  extends ComponentStyle {
  id: string;
  schema: z.ZodObject<T>;
  model: Model<z.infer<z.ZodObject<T>>>;
  layout?: unknown;
  controls?: ControlDeclaration[];
  actions?: ScreenActionDeclaration[];
  header?: {
    elements?: ScreenElementDeclaration[];
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
  readonly messageHistory?: MessageHistory;
  send(message: UUIWorkerOutbound | Uint8Array): void;
  receive(): Promise<UUIClientMessage | Uint8Array>;
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
  readonly messageEndpoint: () => AttachedChannel | undefined;
  readonly receive: (message: ScreenEventMessage) => void;
  readonly open: (
    target:
      | ControlDescriptor
      | typeof ACCOUNT_EVENT
      | typeof CUSTOMIZATION_EVENT,
  ) => void;
  readonly command: (
    command: AgentOperation,
    sequence: number,
  ) => Promise<unknown>;
  readonly resolve: (event: ScreenEvent) => void;
  readonly reject: (error: unknown) => void;
  detachChannel?: () => void;
  detachEndpoints?: () => void;
  refresh?: () => Promise<void>;
  refreshOnRestore?: () => void;
  redrawQueued: boolean;
  settled: boolean;
  presenting: boolean;
  afterPresentation?: ScreenOutcome;
}

interface BoundSession {
  readonly channel: SessionChannel;
  readonly structured: ChannelRouter;
  readonly messages: MessageHistory;
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
  endpoints: Map<string | object, AttachedChannel>;
  program: AttachedChannel;
  readonly generation: string;
}

const attachScreenChannel = Symbol("attachScreenChannel");
const attachChannel = Symbol("attachChannel");

/** Reusable program/component binding. Its current call owns delivery; nothing is replayed. */
export class Channel implements ChannelConnection {
  readonly [channelBinding] = true;
  #endpoint?: AttachedChannel;
  readonly #bindings = new ChannelBindings();
  send(
    id: string,
    data: ByteSource,
    options?: { signal?: AbortSignal; policy?: StreamPolicy },
  ): StreamHandle;
  send(id: string, data: unknown): void;
  send(
    id: string,
    data: unknown,
    options?: { signal?: AbortSignal; policy?: StreamPolicy },
  ): StreamHandle | void {
    const endpoint = this.#current();
    const signal = operationContext.getStore()?.signal;
    return endpoint.send(
      id,
      data as ByteSource,
      signal
        ? {
          ...options,
          signal: AbortSignal.any([
            signal,
            ...(options?.signal ? [options.signal] : []),
          ]),
        }
        : options,
    );
  }
  subscribe(id: string, handler: ChannelSubscriber): ChannelSubscription {
    if (operationContext.getStore()) this.#current();
    return this.#bindings.subscribe(id, handler);
  }
  /** Capture an initiating call/connection across an await. */
  capture(connected = true): AttachedChannel {
    return this.#current().capture(connected);
  }
  #current(): AttachedChannel {
    const endpoint = this.#endpoint;
    const operation = operationContext.getStore();
    operation?.signal.throwIfAborted();
    if (
      !endpoint ||
      operation && operation.generation !== endpoint.reference.generation
    ) {
      throw new DOMException(
        "Channel requires a live screen attachment",
        "AbortError",
      );
    }
    return endpoint;
  }
  [attachChannel](endpoint: AttachedChannel): () => void {
    if (this.#endpoint) {
      throw new TypeError("Channel may attach to only one component/program");
    }
    this.#endpoint = endpoint;
    this.#bindings.attach(endpoint);
    return () => {
      if (this.#endpoint !== endpoint) return;
      this.#endpoint = undefined;
      this.#bindings.attach();
    };
  }
}

/** Controls and communicates with the one pending callScreen it is attached to. */
export class ScreenChannel extends Channel {
  #attachment: ScreenChannelAttachment | undefined;
  readonly downloadNamespace = `native-save-${crypto.randomUUID()}`;
  get downloads(): AttachedChannel {
    const endpoint = this.#currentAttachment()?.endpoints.get(
      this.downloadNamespace,
    );
    if (!endpoint) {
      throw new DOMException(
        "Download requires a live ScreenChannel attachment",
        "AbortError",
      );
    }
    return endpoint.capture();
  }

  #currentAttachment(): ScreenChannelAttachment | undefined {
    const operation = operationContext.getStore();
    if (
      operation &&
      (operation.signal.aborted ||
        operation.generation !== this.#attachment?.generation)
    ) return;
    return this.#attachment;
  }

  redraw(): void {
    this.#currentAttachment()?.redraw();
  }

  exit(action = "exit"): void {
    this.#currentAttachment()?.exit(action);
  }

  fail(error: unknown): void {
    this.#currentAttachment()?.fail(error);
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
const operationContext = new AsyncLocalStorage<
  { generation: string; signal: AbortSignal }
>();
/** Existing authenticated socket hooks; no channel authentication or catalog. */
export function connectChannels(connection: string): void {
  requireBoundSession().structured.connect(connection);
}
export function disconnectChannels(reason?: string): void {
  boundSession?.structured.disconnect(reason);
}

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
      structured: new ChannelRouter("server", (frame) => value.send(frame)),
      messages: value.messageHistory ?? new MessageHistory(),
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
    state.structured.disconnect("UUI session ended");
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

/** Start native save under an explicitly captured pending screen/connection attachment. */
export function download(
  options: DownloadOptions,
  attachment: AttachedChannel,
): DownloadHandle {
  requireBoundSession();
  const output = captureMessages();
  return startDownload(
    attachment,
    options,
    (message) => output.send(message, "error"),
  );
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
  const source = locationFromStack(
    new Error().stack?.split("\n").slice(2).join("\n") ?? "",
  );
  const screenCall = source
    ? `${displayPath(source.path)}:${source.line}`
    : undefined;
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
  validateComponentStyle(options);
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
  const headerDeclarations = cloneDeclaration(options.header?.controls ?? []);
  const headerElements = cloneDeclaration(options.header?.elements);
  const layoutDeclaration = cloneDeclaration(options.layout);
  const inline: ScreenElementDeclaration[] = [];
  const collect = (elements: unknown, depth = 0): void => {
    if (elements === undefined) return;
    if (depth > 16) {
      throw new TypeError("UUI element nesting exceeds 16 levels");
    }
    validateElementDeclarations(elements);
    for (const item of elements as ScreenElementDeclaration[]) {
      inline.push(item);
      if ("bind" in item) {
        item.list ??= cloneDeclaration(
          fields.find((field) => field.bind === item.bind)?.list,
        );
        collect(item.list?.toolbar, depth + 1);
      }
    }
  };
  const layoutNodes: Array<
    {
      id?: string;
      elements?: ScreenElementDeclaration[];
      toolbar?: ScreenElementDeclaration[];
      children?: unknown[];
    }
  > = [];
  const collectLayout = (value: unknown): void => {
    if (value === null || typeof value !== "object") return;
    const node = value as typeof layoutNodes[number];
    layoutNodes.push(node);
    collect(node.elements);
    collect(node.toolbar);
    if (Array.isArray(node.children)) node.children.forEach(collectLayout);
  };
  collectLayout((layoutDeclaration as { root?: unknown } | undefined)?.root);
  collect(headerElements);
  const headerBindings = new Set(
    [
      ...headerDeclarations,
      ...inline.filter((item): item is ControlDeclaration => "bind" in item),
    ].map((item) => item.bind),
  );
  let bodyDeclarations: ControlDeclaration[] = options.controls?.length
    ? cloneDeclaration(options.controls)
    : fields.filter((field) => !headerBindings.has(field.bind)).map((
      field,
    ) => ({ ...field, id: undefined }));
  for (const control of [...bodyDeclarations, ...headerDeclarations]) {
    control.list ??= cloneDeclaration(
      fields.find((field) => field.bind === control.bind)?.list,
    );
    collect(control.list?.toolbar);
  }
  const inlineControls = inline.filter((item): item is ControlDeclaration =>
    "bind" in item
  );
  const inlineActions = inline.filter((item): item is ScreenActionDeclaration =>
    !("bind" in item) && !("type" in item)
  );
  const separators = inline.filter((
    item,
  ): item is Omit<Separator, "id"> & { id?: string } => "type" in item);
  if (!options.controls?.length) {
    const inlineBindings = new Set(
      inlineControls.map((control) => control.bind),
    );
    bodyDeclarations = bodyDeclarations.filter((control) =>
      !inlineBindings.has(control.bind)
    );
  }
  const allDeclarations = [
    ...bodyDeclarations,
    ...headerDeclarations,
    ...inlineControls,
  ];
  const actionDeclarations = [
    ...(options.actions ?? []),
    ...(options.header?.actions ?? []),
    ...inlineActions,
  ];
  const authored = [
    ...allDeclarations,
    ...actionDeclarations,
    ...separators,
    ...(options.customElements ?? []),
    ...layoutNodes,
  ];
  const reserved = explicitElementIDs(authored);
  const resolvedControls = allDeclarations.length === 0 ? [] : buildControls(
    fields,
    allDeclarations,
    reserved,
  );
  const controls = resolvedControls.slice(0, bodyDeclarations.length);
  const headerControls = resolvedControls.slice(
    bodyDeclarations.length,
    bodyDeclarations.length + headerDeclarations.length,
  );
  for (const control of resolvedControls) {
    if (control.control !== "list") {
      control.valueHelp =
        valueHelpFor(schemaAtPath(options.schema, control.bind)!, control) !==
          undefined;
    }
  }
  const resolvedActions = resolveElementIDs(
    cloneDeclaration(actionDeclarations),
    (action) => ({ label: action.label, kind: action.kind }),
    "action",
    reserved,
  );
  const shortcuts = new Set<string>();
  for (const element of [...resolvedControls, ...resolvedActions]) {
    validateComponentStyle(element);
    validateShortcut(element.shortcut);
    if (element.shortcut === undefined) continue;
    const key = shortcutKey(element.shortcut);
    if (shortcuts.has(key)) {
      throw new TypeError(`duplicate screen shortcut ${key}`);
    }
    shortcuts.add(key);
  }
  const actions = resolvedActions.slice(0, options.actions?.length ?? 0);
  const headerActions = resolvedActions.slice(
    options.actions?.length ?? 0,
    (options.actions?.length ?? 0) + (options.header?.actions?.length ?? 0),
  );
  const resolvedSeparators = resolveElementIDs(
    separators,
    () => ({ type: "separator" }),
    "separator",
    reserved,
  );
  const resolved = new Map<ScreenElementDeclaration, ScreenElement>([
    ...allDeclarations.map((item, i) => [item, resolvedControls[i]!] as const),
    ...actionDeclarations.map((item, i) =>
      [item, resolvedActions[i]!] as const
    ),
    ...separators.map((item, i) => [item, resolvedSeparators[i]!] as const),
  ]);
  const elements = (
    items: ScreenElementDeclaration[] | undefined,
  ): ScreenElement[] | undefined => items?.map((item) => resolved.get(item)!);
  allDeclarations.forEach((item, index) => {
    if (item.list?.toolbar) {
      resolvedControls[index]!.list!.toolbar = elements(item.list.toolbar);
    }
  });
  for (const node of layoutNodes) {
    if (node.elements) node.elements = elements(node.elements);
    if (node.toolbar) node.toolbar = elements(node.toolbar);
  }
  const customElements = validateCustomElements(
    options.customElements,
    reserved,
  );
  if (
    customElements.length +
        resolvedControls.filter((control) => control.custom).length > 16
  ) {
    throw new TypeError(
      "a screen supports at most 16 custom elements, including custom fields",
    );
  }
  const actionIDs = new Set<string>();
  for (const action of resolvedActions) {
    if (
      action.id.length === 0 || action.label.length === 0 ||
      actionIDs.has(action.id) || action.id === BACK_EVENT ||
      action.id === ACCOUNT_EVENT || action.id === CUSTOMIZATION_EVENT
    ) {
      throw new TypeError(
        `duplicate, empty, unlabeled, or reserved action ${action.id}`,
      );
    }
    actionIDs.add(action.id);
  }
  const header: ScreenHeader = {
    ...(options.header?.elements === undefined
      ? {}
      : { elements: elements(headerElements) }),
    controls: headerControls,
    actions: headerActions,
  };
  const layout = layoutDeclaration === undefined ? undefined : validateLayout(
    layoutDeclaration,
    new Set(controls.flatMap((item) => [item.id, item.bind])),
    new Set(actions.map((item) => item.id)),
    new Set(customElements.map((item) => item.id)),
    reserved,
  );
  if (layout !== undefined) {
    resolveLayoutReferences(layout, controls, [
      ...resolvedControls,
      ...resolvedActions,
      ...resolvedSeparators,
    ]);
  }
  const screenRevision = ++state.revision;
  const lists = new ScreenLists(
    options.schema,
    controls,
    layout,
    options.model.screen,
    [
      ...headerControls,
      ...resolvedControls.slice(
        bodyDeclarations.length + headerDeclarations.length,
      ),
    ],
    options.model,
  );
  const elementIDs = new Set(
    [
      ...resolvedControls,
      ...resolvedActions,
      ...resolvedSeparators,
      ...customElements,
    ].map((item) => item.id),
  );
  const visit = (node: import("./layout.ts").LayoutNode): void => {
    elementIDs.add(node.id);
    node.children?.forEach(visit);
  };
  if (layout !== undefined) visit(layout.root);
  for (const id of elementIDs) screenElement(options.model.screen, id);
  const wireFields = JSON.parse(
    JSON.stringify(
      fields,
      (_key, value) => isChannelBinding(value) ? undefined : value,
    ),
  );
  const endpoints = new Map<string | object, AttachedChannel>();
  const messageNamespace = `message-center-${crypto.randomUUID()}`;
  const programNamespace = `program-${crypto.randomUUID()}`;
  const screenChannel = options.channel ?? new ScreenChannel();
  const releaseChannels: Array<() => void> = [];
  const endpointLifetime = new AbortController();
  const runInCall = AsyncLocalStorage.snapshot();
  let endpointVersion = -1;
  let channelGeneration = "";
  const snapshot = (): ScreenSnapshot => {
    attachEndpoints();
    for (const id of elementIDs) screenElement(options.model.screen, id);
    const presented = lists.present(options.model.data);
    return {
      id: options.id,
      screenCall,
      ...(options.class === undefined ? {} : { class: options.class }),
      ...(options.style === undefined ? {} : { style: options.style }),
      revision: screenRevision,
      title: options.title,
      description: options.description,
      fields: wireFields,
      controls,
      model: lists.presentModel(options.model.data),
      state: {
        ...structuredClone(options.model.screen),
        elements: Object.fromEntries([...elementIDs].map((id) => [
          id,
          structuredClone(options.model.screen.elements[id]!),
        ])),
      },
      lists: presented.map((list) => ({
        ...list,
        channelNamespace: endpoints.get(list.id)!.reference.namespace,
      })),
      layout,
      actions,
      header,
      customElements,
      channelGeneration,
      downloadNamespace:
        endpoints.get(screenChannel.downloadNamespace)!.reference.namespace,
      messageNamespace: endpoints.get(messageNamespace)!.reference.namespace,
      programNamespace: endpoints.get(programNamespace)!.reference.namespace,
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
    messageEndpoint: () => {
      attachEndpoints();
      return endpoints.get(messageNamespace);
    },
    receive: (message) =>
      receiveScreenMessage(
        state,
        call,
        options.schema,
        options.model,
        lists,
        resolvedControls,
        elementIDs,
        message,
      ),
    open: (target) => {
      void showRelated(target);
    },
    command: async (command, sequence) => {
      if (command.op === "screen") return;
      const current = snapshot();
      const base = {
        protocol: UUI_PROTOCOL_VERSION,
        sessionId: state.channel.sessionId,
        clientSequence: sequence,
        surfaceId: surface.id,
        screenId: call.screenId,
        screenRevision: call.revision,
        instanceId: current.state.instanceId,
        screenState: {
          version: current.state.version,
          scroll: current.state.scroll,
          elements: {},
        },
        changes: [] as ScreenChange[],
      };
      const dispatch = (
        event: Partial<ScreenEventMessage> & { action: string },
      ) =>
        routeScreenMessage(state, {
          ...base,
          type: "screen.event",
          eventType: "action",
          ...event,
        });
      if (command.op === "back") {
        return dispatch({ action: BACK_EVENT, eventType: BACK_EVENT });
      }
      if (command.op === "event") {
        return dispatch({
          action: command.action,
          controlId: command.id,
          value: command.value,
        });
      }
      if (command.op === "select" || command.op === "list") {
        const list = current.lists.find((item) => item.id === command.id);
        if (!list) throw new TypeError(`Unknown list ${command.id}`);
        if (command.op === "select") {
          return dispatch({
            action: "select",
            eventType: "select",
            selection: {
              id: list.id,
              revision: list.revision,
              index: command.index,
            },
          });
        }
        const updates: import("./screen_state.ts").ListRequest[] = [];
        if (command.search !== undefined) {
          updates.push({
            id: list.id,
            revision: list.revision,
            operation: "query",
            query: { ...list.state.query, search: command.search },
          });
        }
        if (command.pageSize !== undefined) {
          updates.push({
            id: list.id,
            revision: list.revision,
            operation: "capacity",
            pageSize: command.pageSize,
          });
        }
        if (command.page !== undefined) {
          updates.push({
            id: list.id,
            revision: list.revision,
            operation: "page",
            page: command.page,
          });
        }
        if (command.selection !== undefined) {
          updates.push({
            id: list.id,
            revision: list.revision,
            operation: "selection",
            ...command.selection,
          });
        }
        if (updates.length) {
          const {
            protocol: _protocol,
            sessionId: _sessionId,
            clientSequence: _sequence,
            ...interaction
          } = base;
          await lists.updateMessage(
            list.id,
            { ...interaction, updates },
            AbortSignal.any([
              endpointLifetime.signal,
              state.structured.connectionSignal,
            ]),
            { clientSequence: sequence, afterReply: (callback) => callback() },
            transactLists,
          );
        }
        return;
      }
      if (command.op === "click") {
        const action = resolvedActions.find((item) => item.id === command.id);
        if (action) return dispatch({ action: action.id });
        for (
          const custom of [
            ...customElements,
            ...resolvedControls.filter((control) =>
              control.custom && !control.hidden
            ).map((
              control,
            ) => ({ ...control.custom!, id: control.id })),
          ]
        ) {
          const capability = custom.fallback?.actions?.find((action) =>
            `${custom.id}/${action.name}` === command.id
          );
          if (capability) {
            return dispatch({ action: capability.event, controlId: custom.id });
          }
        }
        throw new TypeError(`Unknown button ${command.id}`);
      }
      const control = resolvedControls.find((control) =>
        !control.hidden &&
        (control.id === command.id ||
          control.custom?.fallback?.inputs?.some((input) =>
            `${control.id}/${input.name}` === command.id
          ))
      );
      if (!control) throw new TypeError(`Unknown field ${command.id}`);
      const schema = schemaAtPath(options.schema, control.bind)!;
      if (command.op === "value-help") {
        const provider = valueHelpFor(schema, control);
        if (!provider) throw new TypeError(`No value help for ${command.id}`);
        const page = await readValueHelp(provider, {
          query: { search: command.search, filters: {}, sort: null },
          offset: command.offset,
          limit: command.limit,
        });
        return {
          columns: buildFieldCatalog(page.schema).map((
            { bind, label, description },
          ) => ({ id: bind, label, description })),
          rows: page.rows,
          more: page.more,
          total: page.totalItems,
        };
      }
      if (command.op === "enter") {
        if (control.readOnly || !control.enterEvent) {
          throw new TypeError(`Enter is unavailable for ${command.id}`);
        }
        return dispatch({
          action: control.enterEvent,
          controlId: control.id,
          bind: control.bind,
          value: getPath(options.model.data, control.bind),
        });
      }
      let value = command.value;
      if (control.custom) {
        const inputs = control.custom.fallback?.inputs ?? [];
        const input = inputs.find((input) =>
          `${control.id}/${input.name}` === command.id
        ) ??
          (inputs.length === 1 && inputs[0]!.path === ""
            ? inputs[0]
            : undefined);
        if (!input) {
          throw new TypeError(`Use a named input of ${control.id}`);
        }
        if (input.path !== "") {
          value = structuredClone(getPath(options.model.data, control.bind));
          setPath(value, input.path, command.value);
        }
      }
      const changes = [{ bind: control.bind, controlId: control.id, value }];
      if (control.reactive) {
        return dispatch({
          action: "change",
          eventType: "change",
          bind: control.bind,
          controlId: control.id,
          value,
          changes,
        });
      }
      applyChanges(
        options.schema,
        options.model.data,
        changes,
        lists,
        [],
        resolvedControls,
      );
      state.lastClientSequence = sequence;
      state.channel.send({ type: "server.ack", clientSequence: sequence });
      surface.snapshot = snapshot();
      publishPresentation(state);
    },
    resolve: resolveResult,
    reject: rejectResult,
    redrawQueued: false,
    settled: false,
    presenting: false,
  };
  async function showRelated(
    target:
      | ControlDescriptor
      | typeof ACCOUNT_EVENT
      | typeof CUSTOMIZATION_EVENT,
  ): Promise<void> {
    const control = typeof target === "string" ? undefined : target;
    if (call.presenting || call.settled) return;
    call.presenting = true;
    let changed = false;
    try {
      await surfaceContext.run(
        surface,
        () =>
          control === undefined
            ? presentPage(async () => {
              if (target === CUSTOMIZATION_EVENT) {
                const { default: customization } = await import(
                  "./programs/customization/program.ts"
                );
                await customization();
                return;
              }
              const { default: myAccount } = await import(
                "/p/the8020/users/programs/my-account/program.ts"
              );
              await myAccount();
            })
            : presentModal(() =>
              runFieldHelp(
                schemaAtPath(options.schema, control.bind)!,
                control,
                {
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
                },
              )
            ),
      );
    } catch (error) {
      call.afterPresentation = { error };
    } finally {
      call.presenting = false;
      if (call.afterPresentation !== undefined) {
        settleCall(state, call, call.afterPresentation);
      } else if (changed && control?.reactive) {
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
  function attachEndpoints(): void {
    if (endpointVersion === options.model.screen.version) return;
    for (const endpoint of endpoints.values()) endpoint.dispose();
    endpoints.clear();
    endpointVersion = options.model.screen.version;
    channelGeneration = crypto.randomUUID();
    const version = endpointVersion;
    const generation = channelGeneration;
    const signal = AbortSignal.any([
      endpointLifetime.signal,
      options.model.resetSignal,
    ]);
    for (const release of releaseChannels.splice(0)) release();
    const attach = (name: string | object, policy?: StreamPolicy) => {
      const endpoint = state.structured.register(
        `channel-${crypto.randomUUID()}`,
        channelGeneration,
        () => {
          signal.throwIfAborted();
          if (
            !state.active || boundSession !== state || call.settled ||
            surface.pending !== call || !surface.active || surface.closing ||
            state.surfaces.at(-1) !== surface ||
            options.model.screen.version !== version
          ) throw new Error("Channel presentation is stale or covered");
        },
        signal,
        policy,
        (handler, id, data, context) =>
          runInCall(() =>
            operationContext.run(
              { generation, signal: context.signal },
              () => handler(id, data, context),
            )
          ),
      );
      endpoints.set(name, endpoint);
      return endpoint;
    };
    for (const id of lists.ids()) {
      const endpoint = attach(id);
      const running = new Map<string, AbortController>();
      endpoint.subscribe("*", async (message, data, context) => {
        if (message === "cancel") {
          if (typeof data === "string") running.get(data)?.abort();
          return;
        }
        if (message !== "read" && message !== "update") return;
        if (
          !data || typeof data !== "object" || !("token" in data) ||
          typeof data.token !== "string" || data.token.length > 128 ||
          !("request" in data)
        ) throw new TypeError("Invalid list message");
        const { token, request } = data;
        if (running.has(token)) throw new TypeError("Duplicate list token");
        const controller = new AbortController();
        running.set(token, controller);
        const signal = AbortSignal.any([context.signal, controller.signal]);
        let complete: (() => void) | undefined;
        try {
          const value = message === "read"
            ? await lists.readMessage(
              id,
              request,
              options.model.data,
              () => scheduleRedraw(state, call, options.schema, options.model),
              signal,
            )
            : await lists.updateMessage(id, request, signal, {
              clientSequence: context.clientSequence,
              afterReply: (callback) => complete = callback,
            }, transactLists);
          signal.throwIfAborted();
          endpoint.send("result", { token, value });
          complete?.();
        } catch (error) {
          if (!signal.aborted) {
            endpoint.send("result", {
              token,
              error: error instanceof Error
                ? error.message.slice(0, 1000)
                : "List operation failed",
            });
          }
        } finally {
          running.delete(token);
        }
      });
    }
    const messages = attach(messageNamespace);
    messages.subscribe("refresh", (_id, data) => {
      if (data === null) {
        messages.send("history", state.messages.snapshot());
      }
    });
    const program = attach(programNamespace);
    releaseChannels.push(screenChannel[attachChannel](program));
    attach(screenChannel.downloadNamespace, DOWNLOAD_POLICY);
    for (const [index, descriptor] of customElements.entries()) {
      const endpoint = attach(descriptor);
      descriptor.channelNamespace = endpoint.reference.namespace;
      const channel = options.customElements?.[index]?.channel;
      if (channel) releaseChannels.push(channel[attachChannel](endpoint));
    }
    for (const [index, control] of resolvedControls.entries()) {
      if (!control.custom) continue;
      const endpoint = attach(control);
      control.custom.channelNamespace = endpoint.reference.namespace;
      const channel = (allDeclarations[index]?.custom ??
        fieldMetadata(schemaAtPath(options.schema, control.bind)!)?.custom)
        ?.channel;
      if (channel) releaseChannels.push(channel[attachChannel](endpoint));
    }
  }
  async function transactLists(
    request: ListUpdateRequest,
    signal: AbortSignal,
    context?: ListTransactionContext,
  ): Promise<null> {
    const previousMessages = state.messages.sequence;
    if (
      request.surfaceId !== surface.id || request.screenId !== call.screenId ||
      request.screenRevision !== call.revision ||
      request.instanceId !== options.model.screen.instanceId
    ) {
      throw new TypeError("screen identity or revision mismatch");
    }
    validateScreenUpdate(request.screenState, options.model, elementIDs);
    if (
      request.updates.filter((item) => item.operation === "query").length > 1
    ) throw new TypeError("only one query may change per interaction");
    try {
      lists.validateRequests(request.updates, options.model.data);
      const edits = prepareChanges(
        options.schema,
        options.model.data,
        request.changes,
        lists,
        request.listChanges ?? [],
        resolvedControls,
        request.updates,
      );
      const staged = await lists.prepareUpdates(
        request.updates,
        options.model.data,
        signal,
      );
      const parsed = options.schema.parse(edits.candidate);
      signal.throwIfAborted();
      validateScreenUpdate(request.screenState, options.model, elementIDs);
      staged.commit();
      for (const bind of edits.changed) {
        setPath(options.model.data, bind, getPath(parsed, bind));
      }
      mergeScreenUpdate(request.screenState, options.model);
      const sequence = context?.clientSequence ?? state.lastClientSequence;
      state.lastClientSequence = Math.max(state.lastClientSequence, sequence);
      if (context?.clientSequence !== undefined) {
        state.messages.clear(previousMessages);
        state.channel.send({ type: "server.ack", clientSequence: sequence });
      }
      surface.snapshot = snapshot();
      const changed = staged.events[0];
      context?.afterReply?.(() => {
        publishPresentation(state);
        if (changed) {
          settleCall(state, call, {
            event: {
              action: "list-query",
              eventType: "list-query",
              clientSequence: sequence,
              listId: changed.id,
              bind: changed.bind,
              change: changed.change,
              query: changed.query,
            },
          });
        }
      });
      return null;
    } catch (error) {
      if (error instanceof StaleListView) {
        surface.snapshot = snapshot();
        publishPresentation(state);
      }
      throw error;
    }
  }
  call.refresh = async () => {
    const ids = lists.providerIDs();
    if (!ids.length) return;
    const current = snapshot();
    await lists.updateMessage(
      ids[0]!,
      {
        surfaceId: surface.id,
        screenId: call.screenId,
        screenRevision: call.revision,
        instanceId: current.state.instanceId,
        screenState: {
          version: current.state.version,
          scroll: current.state.scroll,
          elements: {},
        },
        changes: [],
        updates: current.lists.filter((list) => ids.includes(list.id)).map((
          list,
        ) => ({ id: list.id, revision: list.revision, operation: "refresh" })),
      },
      AbortSignal.any([
        endpointLifetime.signal,
        state.structured.connectionSignal,
      ]),
      { afterReply: (callback) => callback() },
      transactLists,
    );
  };
  call.detachEndpoints = () => {
    for (const release of releaseChannels.splice(0)) release();
    endpointLifetime.abort();
    endpoints.clear();
  };
  state.models.add(options.model);
  surface.pending = call;
  try {
    call.detachChannel = screenChannel[attachScreenChannel]({
      endpoints,
      get program() {
        return endpoints.get(programNamespace)!;
      },
      get generation() {
        return channelGeneration;
      },
      redraw: () => scheduleRedraw(state, call, options.schema, options.model),
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
    surface.snapshot = snapshot();
    if (lists.providerIDs().length) await call.refresh();
    publishPresentation(state);
    return await result;
  } finally {
    state.models.delete(options.model);
    if (surface.pending === call) surface.pending = undefined;
    call.detachEndpoints?.();
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
  if (changed) {
    const restored = state.surfaces.at(-1)?.pending;
    const refresh = restored?.refreshOnRestore;
    if (restored) restored.refreshOnRestore = undefined;
    refresh?.();
    publishPresentation(state);
  }
  await surface.removed;
}

function requireBoundSession(): BoundSession {
  if (boundSession === undefined || !boundSession.active) {
    throw new Error("UUI session channel is not bound");
  }
  return boundSession;
}

/** The JSON transport uses the same live screen, validation and event dispatcher. */
export async function commandScreen(
  command: AgentOperation,
  sequence: number,
): Promise<unknown> {
  const call = requireBoundSession().surfaces.at(-1)?.pending;
  if (!call || call.settled) throw new Error("The screen is still working");
  return await call.command(command, sequence);
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
      if (message instanceof Uint8Array) {
        state.structured.bytes(message);
      } else if (message.type === "channel.frame") {
        if (message.sessionId === state.channel.sessionId) {
          state.structured.receive(message);
        }
      } else if (
        message.type === "screen.event"
      ) {
        routeScreenMessage(state, message);
      }
    }
  } catch (error) {
    if (!state.active || boundSession !== state) return;
    state.structured.disconnect("UUI input closed");
    for (const surface of state.surfaces) {
      if (surface.pending !== undefined) {
        settleCall(state, surface.pending, { error }, false);
      }
    }
  }
}

function routeScreenMessage(
  state: BoundSession,
  message: ScreenEventMessage,
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
  controls: readonly ControlDescriptor[],
  elementIDs: ReadonlySet<string>,
  message: ScreenEventMessage,
): void {
  if (call.settled || call.surface.pending !== call) return;
  let selection:
    | { value: unknown; bind: string; controlId: string }
    | undefined;
  let helpControl: ControlDescriptor | undefined;
  try {
    if (message.instanceId !== model.screen.instanceId) {
      throw new TypeError("screen instance mismatch");
    }
    validateScreenUpdate(message.screenState, model, elementIDs);
    if (message.eventType === "field-help") {
      helpControl = controls.find((control) =>
        control.id === message.controlId
      );
      if (
        message.action !== "field-help" || helpControl === undefined ||
        helpControl.bind !== message.bind ||
        helpControl.hidden || helpControl.fieldHelp === false ||
        helpControl.control === "list"
      ) throw new TypeError("unknown or unavailable field help");
    }
    if (message.selection !== undefined) {
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
    mergeScreenUpdate(message.screenState, model);
    call.surface.snapshot = call.snapshot();
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
  state.messages.clear();
  state.channel.send({
    type: "server.ack",
    clientSequence: message.clientSequence,
  });
  if (
    message.action === ACCOUNT_EVENT || message.action === CUSTOMIZATION_EVENT
  ) call.open(message.action);
  else if (helpControl !== undefined) call.open(helpControl);
  else if (message.eventType !== "field-help") {
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
  queueMicrotask(async () => {
    call.redrawQueued = false;
    if (
      call.settled || !state.active || call.surface.pending !== call ||
      !call.surface.active || call.surface.closing
    ) return;
    const output = captureCallMessages(state, call);
    try {
      if (state.surfaces.at(-1) === call.surface) await call.refresh?.();
      else if (call.refresh) {
        call.refreshOnRestore = () =>
          scheduleRedraw(state, call, schema, model);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        if (state.surfaces.at(-1) !== call.surface) {
          call.refreshOnRestore = () =>
            scheduleRedraw(state, call, schema, model);
        }
        return;
      }
      try {
        output.send(
          error instanceof Error ? error.message : "Could not refresh the list",
          "error",
        );
      } catch { /* stale captured output cannot change history */ }
      return;
    }
    if (call.settled) return;
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
  if (call.presenting && state.active) {
    call.afterPresentation ??= outcome;
    return;
  }
  call.settled = true;
  call.detachEndpoints?.();
  call.detachEndpoints = undefined;
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
    messages: state.messages.snapshot(),
  };
}

function publishPresentation(state: BoundSession): void {
  if (!state.active) return;
  const presentation = presentationSnapshot(state);
  if (presentation.surfaces.length === 0) return;
  state.structured.invalidate();
  state.channel.send({ type: "presentation.show", presentation });
}

export function sendMessage(
  body: string,
  kind: UUIMessageKind = "info",
): void {
  const state = requireBoundSession();
  const surface = currentSurface(state);
  const call = surface.pending;
  const operation = operationContext.getStore();
  operation?.signal.throwIfAborted();
  if (
    state.surfaces.at(-1) !== surface ||
    operation && operation.generation !== call?.snapshot().channelGeneration
  ) throw new DOMException("Message owner is stale or covered", "AbortError");
  const item = state.messages.add(body, kind);
  if (state.structured.connected) call?.messageEndpoint()?.send("append", item);
}

/** Capture before starting asynchronous output; stale sends fail before history changes. */
export function captureMessages(): MessageOutput {
  const state = requireBoundSession();
  const call = currentSurface(state).pending;
  if (!call) {
    throw new DOMException("Messages require a pending screen", "AbortError");
  }
  return captureCallMessages(state, call);
}

function captureCallMessages(
  state: BoundSession,
  call: ActiveScreenCall,
): MessageOutput {
  const endpoint = call.messageEndpoint()?.capture(false);
  const run = AsyncLocalStorage.snapshot();
  return {
    send: (body, kind = "info") =>
      run(() => {
        operationContext.getStore()?.signal.throwIfAborted();
        if (!endpoint) {
          throw new DOMException("Message channel detached", "AbortError");
        }
        endpoint.capture();
        const item = state.messages.add(body, kind);
        if (state.structured.connected) endpoint.send("append", item);
      }),
  };
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

/** Ask the browser to connect to another live session through the UUI shell. */
export function openSession(sessionId: string): void {
  if (boundSession === undefined) {
    throw new Error("UUI session channel is not bound");
  }
  boundSession.channel.send({
    type: "session.open",
    targetSessionId: sessionId,
  });
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
  requests: readonly ListRequest[] = [],
): void {
  const edits = prepareChanges(
    schema,
    model,
    changes,
    lists,
    listChanges,
    controls,
    requests,
  );
  const parsed = schema.parse(edits.candidate);
  for (const bind of edits.changed) setPath(model, bind, getPath(parsed, bind));
}
function prepareChanges<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
  model: z.infer<z.ZodObject<T>>,
  changes: readonly ScreenChange[],
  lists: ScreenLists,
  listChanges: readonly ListChange[],
  controls: readonly ControlDescriptor[],
  requests: readonly ListRequest[] = [],
) {
  if (
    changes.length === 0 && listChanges.length === 0 &&
    !requests.some((request) => request.operation === "selection")
  ) return { candidate: structuredClone(model), changed: new Set<string>() };
  const candidate = structuredClone(model) as Record<string, unknown>;
  const bindings = lists.bindings();
  const changed = lists.applyEdits(listChanges, model, candidate);
  for (const bind of lists.applySelection(requests, model, candidate)) {
    changed.add(bind);
  }
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
  schema.parse(candidate);
  return { candidate, changed };
}
function mergeScreenUpdate(
  update: ScreenStateUpdate,
  model: Model<object>,
): void {
  model.screen.scroll = structuredClone(update.scroll);
  for (const [id, data] of Object.entries(update.elements)) {
    const element = screenElement(model.screen, id);
    element.scroll = structuredClone(data.scroll);
    element.toolbarOpen = data.toolbarOpen;
    element.data = structuredClone(data.data);
    if (data.selectedTab !== undefined) element.selectedTab = data.selectedTab;
  }
}
