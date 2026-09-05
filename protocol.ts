import {
  type ListChange,
  type ListOptions,
  type ListRequest,
  type ListSelection,
  MAX_LIST_PAGE_SIZE,
  type ScreenListSnapshot,
  type ScreenState,
  type ScreenStateUpdate,
  validListQuery,
  validScreenStateUpdate,
} from "./screen_state.ts";
export * from "./screen_state.ts";
import uiConfig from "./ui-config.json" with { type: "json" };
import {
  DOWNLOAD_TRANSFER_FRAMES,
  type DownloadClientCommand,
  type DownloadServerCommand,
  validDownloadID,
} from "./download_protocol.ts";

export const UUI_PROTOCOL_VERSION = uiConfig.protocolVersion;
export const BACK_EVENT = "back" as const;
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
  | typeof BACK_EVENT
  | "exit";

export type UUIMessageType =
  | DownloadClientCommand["type"]
  | DownloadServerCommand["type"]
  | "session.connect"
  | "session.ready"
  | "session.resumed"
  | "session.resync_required"
  | "session.error"
  | "session.end"
  | "session.logout"
  | "session.ping"
  | "session.pong"
  | "presentation.show"
  | "screen.event"
  | "screen.list"
  | "notification.show"
  | "clipboard.write"
  | "client.ack"
  | "server.ack";

export interface SessionConnectMessage {
  type: "session.connect";
  protocol: number;
  resumeToken: string | null;
  lastServerSequence: number;
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

export interface ScreenListMessage extends ScreenInteractionBase {
  type: "screen.list";
  updates: ListRequest[];
}

export interface SessionPongMessage extends ClientMessageBase {
  type: "session.pong";
}

export interface SessionLogoutMessage extends ClientMessageBase {
  type: "session.logout";
}

export interface ResyncConfirmMessage extends ClientMessageBase {
  type: "client.ack";
  resync?: boolean;
}

export type UUIClientMessage =
  | (DownloadClientCommand & ClientMessageBase)
  | SessionConnectMessage
  | ScreenEventMessage
  | ScreenListMessage
  | SessionPongMessage
  | SessionLogoutMessage
  | ResyncConfirmMessage;

export interface ServerMessageBase {
  type: Exclude<
    UUIMessageType,
    "session.connect" | "session.logout" | "screen.event" | "screen.list"
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
}

export interface SessionResumedMessage extends ServerMessageBase {
  type: "session.resumed";
  sessionId: string;
  resumed: true;
  lastClientSequence: number;
}

export interface SessionErrorMessage extends ServerMessageBase {
  type: "session.error" | "session.resync_required" | "session.end";
  code?: string;
  message?: string;
  redirectUrl?: string;
}

export interface PresentationShowMessage extends ServerMessageBase {
  type: "presentation.show";
  sessionId: string;
  presentation: PresentationSnapshot;
}

export interface NotificationMessage extends ServerMessageBase {
  type: "notification.show";
  sessionId: string;
  level: UUIMessageKind;
  message: string;
}

export interface ClipboardWriteMessage extends ServerMessageBase {
  type: "clipboard.write";
  sessionId: string;
  text: string;
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
  | (DownloadServerCommand & ServerMessageBase)
  | SessionReadyMessage
  | SessionResumedMessage
  | SessionErrorMessage
  | PresentationShowMessage
  | NotificationMessage
  | ClipboardWriteMessage
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
  | "list";

export type FieldLength = "short" | "medium" | "long";

export const MAX_FIELD_ROW_SPAN = 8;

export interface FieldDescriptor {
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
  minimum?: number;
  maximum?: number;
  step?: number;
  valueSuffix?: string;
  options?: FieldOption[];
  searchHelp?: string;
  semanticType?: string;
  list?: ListOptions;
}

export interface ControlDescriptor extends Partial<FieldDescriptor> {
  id: string;
  bind: string;
}

export type ControlDeclaration = Omit<ControlDescriptor, "id"> & {
  id?: string;
};

export interface ScreenAction {
  id: string;
  label: string;
  kind?: "primary" | "secondary" | "danger";
}
export type ScreenActionDeclaration = Omit<ScreenAction, "id"> & {
  id?: string;
};

export interface ScreenHeader {
  controls: ControlDescriptor[];
  actions: ScreenAction[];
}

export interface CustomElementDescriptor {
  id: string;
  initializer: string;
  preserve?: boolean;
  config: Record<string, unknown>;
}
export type CustomElementDeclaration = Omit<CustomElementDescriptor, "id"> & {
  id?: string;
};

export interface ScreenSnapshot {
  id: string;
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
}

export type UUIWorkerOutbound =
  | DownloadServerCommand
  | { type: "presentation.show"; presentation: PresentationSnapshot }
  | {
    type: "notification.show";
    level: UUIMessageKind;
    message: string;
  }
  | { type: "clipboard.write"; text: string }
  | { type: "server.ack"; clientSequence: number }
  | { type: "session.error"; code: string; message: string }
  | { type: "session.end"; message?: string; redirectUrl?: string };

export function parseClientMessage(value: unknown): UUIClientMessage {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new TypeError("UUI message must be an object with a type");
  }
  if (value.protocol !== UUI_PROTOCOL_VERSION) {
    throw new TypeError("unsupported UUI protocol version");
  }
  if (value.type === "session.connect") {
    if (
      value.resumeToken !== null && typeof value.resumeToken !== "string" ||
      !isSequence(value.lastServerSequence)
    ) throw new TypeError("invalid session.connect message");
    return value as unknown as SessionConnectMessage;
  }
  if (
    !isSequence(value.clientSequence) || typeof value.sessionId !== "string" ||
    value.sessionId.length === 0
  ) throw new TypeError("invalid client message identity");
  if (value.type.startsWith("download.")) {
    if (
      !validDownloadID(value.downloadId) ||
      !(value.type === "download.done" || value.type === "download.cancel" ||
        value.type === "download.credit") ||
      value.type === "download.credit" &&
        (!isSequence(value.consumed) || !isSequence(value.frames) ||
          value.frames > DOWNLOAD_TRANSFER_FRAMES) ||
      value.type === "download.cancel" && value.error !== undefined &&
        (typeof value.error !== "string" || value.error.length > 1000)
    ) throw new TypeError("invalid download message");
    return value as unknown as DownloadClientCommand & ClientMessageBase;
  }
  if (value.type === "session.pong" || value.type === "session.logout") {
    return value as unknown as SessionPongMessage | SessionLogoutMessage;
  }
  if (value.type === "client.ack") {
    if (value.resync !== undefined && typeof value.resync !== "boolean") {
      throw new TypeError("invalid client acknowledgement");
    }
    return value as unknown as ResyncConfirmMessage;
  }
  if (value.type === "screen.list" || value.type === "screen.event") {
    if (
      typeof value.surfaceId !== "string" || value.surfaceId.length === 0 ||
      typeof value.screenId !== "string" || value.screenId.length === 0 ||
      typeof value.instanceId !== "string" || value.instanceId.length === 0 ||
      !isPositiveSequence(value.screenRevision) ||
      !validScreenStateUpdate(value.screenState) ||
      !validChanges(value.changes) || !validListChanges(value.listChanges)
    ) {
      throw new TypeError("invalid screen interaction metadata");
    }
  }
  if (value.type === "screen.list") {
    if (
      !Array.isArray(value.updates) || value.updates.length === 0 ||
      value.updates.length > 200 ||
      !value.updates.every((item) =>
        isRecord(item) && typeof item.id === "string" && item.id.length > 0 &&
        isPositiveSequence(item.revision) &&
        (item.operation === "page" && isPositiveSequence(item.page) ||
          item.operation === "capacity" && isPositiveSequence(item.pageSize) &&
            Number(item.pageSize) <= MAX_LIST_PAGE_SIZE ||
          item.operation === "query" && validListQuery(item.query))
      )
    ) {
      throw new TypeError("invalid screen.list message");
    }
    return value as unknown as ScreenListMessage;
  }
  const eventTypes = new Set<ScreenEventType>([
    "action",
    "change",
    "select",
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
