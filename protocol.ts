import {
  type ListChange,
  type ListOptions,
  type ListRequest,
  type ListSelection,
  MAX_LIST_PAGE_SIZE,
  type ScreenListSnapshot,
  type ScreenState,
  type ScreenStateUpdate,
  validListRequests,
  validScreenStateUpdate,
} from "./screen_state.ts";
export * from "./screen_state.ts";
import { type ChannelFrame, validChannelFrame } from "./channel.ts";
import uiConfig from "./ui-config.json" with { type: "json" };

export const UUI_PROTOCOL_VERSION = uiConfig.protocolVersion;
export const BACK_EVENT = "back" as const;
export const ACCOUNT_EVENT = "uui.account" as const;
export const CUSTOMIZATION_EVENT = "uui.customization" as const;
export const UUI_MESSAGE_KINDS = [
  "info",
  "success",
  "warning",
  "error",
] as const;
export const MAX_UUI_MESSAGE_BODY_LENGTH = 20_000;

export type UUIMessageKind = typeof UUI_MESSAGE_KINDS[number];

export type ScreenEventType =
  | "action"
  | "change"
  | "select"
  | "field-help"
  | typeof BACK_EVENT
  | "exit";

export type UUIMessageType =
  | "session.connect"
  | "session.ready"
  | "session.resumed"
  | "session.resync_required"
  | "session.error"
  | "session.end"
  | "session.open"
  | "session.logout"
  | "session.exit"
  | "session.ping"
  | "session.pong"
  | "presentation.show"
  | "screen.event"
  | "channel.frame"
  | "clipboard.write"
  | "client.ack"
  | "server.ack";

export interface SessionConnectMessage {
  type: "session.connect";
  protocol: number;
  resumeToken: string | null;
  lastServerSequence: number;
  browser?: BrowserContext;
  clientId?: string;
  control?: number;
}

/** Browser-reported presentation metadata, never authentication or routing authority. */
export interface BrowserContext {
  readonly origin: string;
  readonly language: string;
  readonly timeZone: string;
}

export function parseBrowserContext(value: unknown): BrowserContext {
  if (
    !isRecord(value) || typeof value.origin !== "string" ||
    value.origin.length > 2048 || typeof value.language !== "string" ||
    value.language.length > 128 || typeof value.timeZone !== "string" ||
    value.timeZone.length > 128 ||
    /\p{Cc}/u.test(value.language + value.timeZone)
  ) throw new TypeError("invalid browser context");
  const origin = new URL(value.origin);
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.origin !== value.origin
  ) throw new TypeError("browser origin must be an HTTP(S) origin");
  return Object.freeze({
    origin: value.origin,
    language: value.language,
    timeZone: value.timeZone,
  });
}

export interface ClientMessageBase {
  protocol: number;
  clientSequence: number;
  sessionId: string;
}

export interface ScreenChange {
  bind: string;
  value: unknown;
  controlId?: string;
}

export interface ScreenInteractionBase extends ClientMessageBase {
  surfaceId: string;
  screenId: string;
  instanceId: string;
  screenRevision: number;
  screenState: ScreenStateUpdate;
  changes: ScreenChange[];
  listChanges?: ListChange[];
}

export interface ScreenEventMessage extends ScreenInteractionBase {
  type: "screen.event";
  action: string;
  controlId?: string;
  bind?: string;
  eventType?: ScreenEventType;
  value?: unknown;
  selection?: ListSelection;
}

export interface ListUpdateRequest
  extends Omit<ScreenInteractionBase, keyof ClientMessageBase> {
  updates: ListRequest[];
}

export interface SessionPongMessage extends ClientMessageBase {
  type: "session.pong";
}

export interface SessionLogoutMessage extends ClientMessageBase {
  type: "session.logout";
}

export interface SessionExitMessage extends ClientMessageBase {
  type: "session.exit";
}

export interface ResyncConfirmMessage extends ClientMessageBase {
  type: "client.ack";
  resync?: boolean;
}

export type UUIClientMessage =
  | (ChannelFrame & ClientMessageBase)
  | SessionConnectMessage
  | ScreenEventMessage
  | SessionPongMessage
  | SessionLogoutMessage
  | SessionExitMessage
  | ResyncConfirmMessage;

export interface ServerMessageBase {
  type: Exclude<
    UUIMessageType,
    "session.connect" | "session.logout" | "session.exit" | "screen.event"
  >;
  protocol: number;
  serverSequence: number;
  sessionId?: string;
}

export interface SessionReadyMessage extends ServerMessageBase {
  type: "session.ready";
  sessionId: string;
  resumeToken: string;
  resumed: false;
  connection: string;
}

export interface SessionResumedMessage extends ServerMessageBase {
  type: "session.resumed";
  sessionId: string;
  resumed: true;
  connection: string;
  lastClientSequence: number;
}

export interface SessionErrorMessage extends ServerMessageBase {
  type: "session.error" | "session.resync_required" | "session.end";
  code?: string;
  connection?: string;
  message?: string;
  redirectUrl?: string;
}

export interface PresentationShowMessage extends ServerMessageBase {
  type: "presentation.show";
  sessionId: string;
  presentation: PresentationSnapshot;
}

export interface ClipboardWriteMessage extends ServerMessageBase {
  type: "clipboard.write";
  sessionId: string;
  text: string;
}

export interface SessionOpenMessage extends ServerMessageBase {
  type: "session.open";
  targetSessionId: string;
}

export interface AcknowledgementMessage extends ServerMessageBase {
  type: "server.ack" | "client.ack";
  sessionId: string;
  clientSequence?: number;
}

export interface PingMessage extends ServerMessageBase {
  type: "session.ping" | "session.pong";
  sessionId: string;
}

export type UUIServerMessage =
  | SessionReadyMessage
  | SessionResumedMessage
  | SessionErrorMessage
  | PresentationShowMessage
  | (ChannelFrame & ServerMessageBase)
  | ClipboardWriteMessage
  | SessionOpenMessage
  | AcknowledgementMessage
  | PingMessage;

export interface FieldOption {
  value: string | number | boolean;
  label: string;
}

export type ControlKind =
  | "text"
  | "password"
  | "email"
  | "color"
  | "number"
  | "range"
  | "textarea"
  | "checkbox"
  | "switch"
  | "radio"
  | "select"
  | "date"
  | "datetime"
  | "file"
  | "custom"
  | "list";

export type FieldLength = "short" | "medium" | "long";

export const MAX_FIELD_ROW_SPAN = 8;

/** Application keys; F1–F4 belong to the framework. */
export interface KeyboardShortcut {
  key: "F5" | "F6" | "F7" | "F8" | "F9" | "F10" | "F11" | "F12";
  control?: boolean;
  alt?: boolean;
  shift?: boolean;
}

export function shortcutKey(shortcut: KeyboardShortcut): string {
  return `${shortcut.control ? "Control+" : ""}${shortcut.alt ? "Alt+" : ""}${
    shortcut.shift ? "Shift+" : ""
  }${shortcut.key}`;
}

export function validateShortcut(
  value: unknown,
): asserts value is KeyboardShortcut | undefined {
  if (value === undefined) return;
  if (
    !isRecord(value) || !/^F(?:[5-9]|1[0-2])$/.test(String(value.key)) ||
    typeof value.key !== "string" ||
    Object.keys(value).some((key) =>
      !["key", "control", "alt", "shift"].includes(key)
    ) ||
    [value.control, value.alt, value.shift].some((flag) =>
      flag !== undefined && typeof flag !== "boolean"
    )
  ) {
    throw new TypeError(
      "shortcut requires F5–F12 and optional boolean control, alt, shift modifiers",
    );
  }
}

/** Applied to the component's root DOM element. */
export interface ComponentStyle {
  /** Space-separated CSS classes, added to the framework classes. */
  class?: string;
  /** Inline CSS declarations, for example `border: 1px solid red;`. */
  style?: string;
}

export function validateComponentStyle(value: {
  class?: unknown;
  style?: unknown;
}): asserts value is ComponentStyle {
  for (const key of ["class", "style"] as const) {
    if (value[key] !== undefined && typeof value[key] !== "string") {
      throw new TypeError(`component ${key} must be a string`);
    }
  }
}

export interface FieldDescriptor extends ComponentStyle {
  bind: string;
  label: string;
  description?: string;
  control: ControlKind;
  group?: string;
  length: FieldLength;
  rowSpan: number;
  order?: number;
  readOnly?: boolean;
  hidden?: boolean;
  required: boolean;
  placeholder?: string;
  reactive?: boolean;
  enterEvent?: string;
  shortcut?: KeyboardShortcut;
  minimum?: number;
  maximum?: number;
  step?: number;
  valueSuffix?: string;
  options?: FieldOption[];
  fieldHelp?: boolean;
  valueHelp?: boolean;
  semanticType?: string;
  list?: ListOptions;
  /** A model-bound instance of the ordinary custom-element host. */
  custom?: CustomElementOptions & { channelNamespace?: string };
}

export interface ControlDescriptor extends Partial<FieldDescriptor> {
  id: string;
  bind: string;
}

export type ControlDeclaration = Omit<ControlDescriptor, "id"> & {
  id?: string;
};

export interface ScreenAction extends ComponentStyle {
  shortcut?: KeyboardShortcut;
  id: string;
  label: string;
  kind?: "primary" | "secondary" | "danger";
}
export type ScreenActionDeclaration = Omit<ScreenAction, "id"> & {
  id?: string;
};

/** Flexible empty space in an ordered row of UUI elements. */
export interface Separator extends ComponentStyle {
  id: string;
  type: "separator";
}
export type ScreenElement = ControlDescriptor | ScreenAction | Separator;
export type ScreenElementDeclaration =
  | ControlDeclaration
  | ScreenActionDeclaration
  | Omit<Separator, "id"> & { id?: string };

export interface ScreenHeader {
  elements?: ScreenElement[];
  controls: ControlDescriptor[];
  actions: ScreenAction[];
}

export interface CustomElementDescriptor extends ComponentStyle {
  /** Internal routing assigned by the owning call; never authored wiring. */
  channelNamespace?: string;
  id: string;
  /** Same-origin browser module, loaded only when this element is rendered. */
  module: string;
  /** Program-owned stylesheets, loaded before mounting the module. */
  styles?: string[];
  preserve?: boolean;
  config: Record<string, unknown>;
  fallback?: CustomFallback;
}

/** Paths are relative to the component's bound value; an empty path is the value. */
export interface CustomFallbackField {
  name: string;
  path: string;
  label?: string;
  description?: string;
  multiline?: boolean;
}

export interface CustomFallback {
  inputs?: CustomFallbackField[];
  outputs?: CustomFallbackField[];
  actions?: Array<{ name: string; label: string; event: string }>;
}
export type CustomElementDeclaration =
  & Omit<CustomElementDescriptor, "id" | "channelNamespace">
  & {
    id?: string;
    channel?: import("./session.ts").Channel;
  };
export type CustomElementOptions = Omit<CustomElementDeclaration, "id">;

export interface ScreenSnapshot extends ComponentStyle {
  id: string;
  screenCall?: string;
  revision: number;
  title?: string;
  description?: string;
  fields: FieldDescriptor[];
  controls: ControlDescriptor[];
  model: unknown;
  state: ScreenState;
  lists: ScreenListSnapshot[];
  layout?: unknown;
  actions: ScreenAction[];
  header: ScreenHeader;
  customElements: CustomElementDescriptor[];
  /** Current callScreen/reset generation, never a channel grant or catalog. */
  channelGeneration?: string;
  /** Domain-native-save namespace on this same channel registry. */
  downloadNamespace?: string;
  /** Built-in message-center registration, scoped to this call generation. */
  messageNamespace?: string;
  /** Owning program attachment, assigned by UUI. */
  programNamespace?: string;
}

export type PresentationSurfaceKind = "page" | "modal";

export interface PresentationSurfaceSnapshot {
  surfaceId: string;
  kind: PresentationSurfaceKind;
  screen: ScreenSnapshot;
}

export interface PresentationSnapshot {
  /** One-based depth of the visible page in the Worker's logical page stack. */
  pageDepth: number;
  surfaces: PresentationSurfaceSnapshot[];
  activeSurfaceId: string | null;
  /** Accepted bounded domain history, never replayed channel operations. */
  messages?: import("./messages.ts").UUIMessage[];
}

export type UUIWorkerOutbound =
  | ChannelFrame
  | { type: "presentation.show"; presentation: PresentationSnapshot }
  | { type: "clipboard.write"; text: string }
  | { type: "session.open"; targetSessionId: string }
  | { type: "server.ack"; clientSequence: number }
  | { type: "session.error"; code: string; message: string }
  | { type: "session.end"; message?: string; redirectUrl?: string };

export function parseClientMessage(
  value: unknown,
  binary = false,
): UUIClientMessage {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new TypeError("UUI message must be an object with a type");
  }
  if (value.protocol !== UUI_PROTOCOL_VERSION) {
    throw new TypeError("unsupported UUI protocol version");
  }
  if (value.type === "session.connect") {
    if (
      value.resumeToken !== null && typeof value.resumeToken !== "string" ||
      value.clientId !== undefined &&
        (typeof value.clientId !== "string" ||
          !/^[A-Za-z0-9_-]{1,64}$/.test(value.clientId)) ||
      value.control !== undefined && !isSequence(value.control) ||
      !isSequence(value.lastServerSequence)
    ) throw new TypeError("invalid session.connect message");
    return {
      ...value,
      ...(value.browser === undefined
        ? {}
        : { browser: parseBrowserContext(value.browser) }),
    } as unknown as SessionConnectMessage;
  }
  if (
    !isSequence(value.clientSequence) || typeof value.sessionId !== "string" ||
    value.sessionId.length === 0
  ) throw new TypeError("invalid client message identity");
  if (value.type === "channel.frame") {
    if (!validChannelFrame(value) || value.kind === "stream.bytes" && !binary) {
      throw new TypeError("invalid channel frame");
    }
    return value as unknown as ChannelFrame & ClientMessageBase;
  }
  if (
    value.type === "session.pong" || value.type === "session.logout" ||
    value.type === "session.exit"
  ) {
    return value as unknown as
      | SessionPongMessage
      | SessionLogoutMessage
      | SessionExitMessage;
  }
  if (value.type === "client.ack") {
    if (value.resync !== undefined && typeof value.resync !== "boolean") {
      throw new TypeError("invalid client acknowledgement");
    }
    return value as unknown as ResyncConfirmMessage;
  }
  if (value.type === "screen.event") validateScreenInteraction(value);
  const eventTypes = new Set<ScreenEventType>([
    "action",
    "change",
    "select",
    "field-help",
    BACK_EVENT,
    "exit",
  ]);
  if (
    value.type !== "screen.event" ||
    typeof value.surfaceId !== "string" || value.surfaceId.length === 0 ||
    typeof value.screenId !== "string" ||
    value.screenId.length === 0 || !isSequence(value.screenRevision) ||
    value.screenRevision < 1 || typeof value.action !== "string" ||
    value.action.length === 0 ||
    value.controlId !== undefined && typeof value.controlId !== "string" ||
    value.bind !== undefined && typeof value.bind !== "string" ||
    value.eventType !== undefined &&
      (typeof value.eventType !== "string" ||
        !eventTypes.has(value.eventType as ScreenEventType)) ||
    (value.selection !== undefined && (!isRecord(value.selection) ||
      typeof value.selection.id !== "string" ||
      !isPositiveSequence(value.selection.revision) ||
      !isSequence(value.selection.index) || value.action !== "select" ||
      value.eventType !== "select")) ||
    !validChanges(value.changes) ||
    (value.action === BACK_EVENT || value.eventType === BACK_EVENT) &&
      (value.action !== BACK_EVENT || value.eventType !== BACK_EVENT)
  ) throw new TypeError("invalid screen.event message");
  return value as unknown as ScreenEventMessage;
}

function validateScreenInteraction(value: Record<string, unknown>): void {
  if (
    typeof value.surfaceId !== "string" || !value.surfaceId.length ||
    typeof value.screenId !== "string" || !value.screenId.length ||
    typeof value.instanceId !== "string" || !value.instanceId.length ||
    !isPositiveSequence(value.screenRevision) ||
    !validScreenStateUpdate(value.screenState) ||
    !validChanges(value.changes) || !validListChanges(value.listChanges)
  ) {
    throw new TypeError("invalid screen interaction metadata");
  }
}
export function parseListUpdate(value: unknown): ListUpdateRequest {
  if (!isRecord(value)) throw new TypeError("invalid list update");
  validateScreenInteraction(value);
  if (
    !validListRequests(value.updates) || Object.keys(value).some((key) =>
      ![
        "surfaceId",
        "screenId",
        "screenRevision",
        "instanceId",
        "screenState",
        "changes",
        "listChanges",
        "updates",
      ].includes(key)
    )
  ) {
    throw new TypeError("invalid list update");
  }
  return value as unknown as ListUpdateRequest;
}

function isSequence(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isPositiveSequence(value: unknown): value is number {
  return isSequence(value) && value > 0;
}

function validChanges(value: unknown): value is ScreenChange[] {
  return Array.isArray(value) &&
    value.every((change) =>
      isRecord(change) && typeof change.bind === "string" &&
      change.bind.length > 0 &&
      (change.controlId === undefined || typeof change.controlId === "string")
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validListChanges(value: unknown): boolean {
  return value === undefined ||
    Array.isArray(value) && value.length <= 200 &&
      value.every((item) =>
        isRecord(item) && typeof item.id === "string" &&
        isPositiveSequence(item.revision) &&
        Array.isArray(item.rows) && item.rows.length <= MAX_LIST_PAGE_SIZE &&
        item.rows.every((row) =>
          isRecord(row) && isSequence(row.index) && Object.hasOwn(row, "value")
        )
      );
}
