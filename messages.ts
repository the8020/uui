import {
  MAX_UUI_MESSAGE_BODY_LENGTH,
  UUI_MESSAGE_KINDS,
  type UUIMessageKind,
} from "./protocol.ts";

/** Accepted domain state, independent of any live communication attachment. */
export interface UUIMessage {
  readonly sequence: number;
  readonly level: UUIMessageKind;
  readonly message: string;
}

export interface MessageOutput {
  send(body: string, kind?: UUIMessageKind): void;
}

export const MAX_RETAINED_MESSAGES = 100;

export function validateMessage(body: string, kind: UUIMessageKind): void {
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
}

export function parseMessage(value: unknown): UUIMessage {
  const item = value as UUIMessage | undefined;
  if (!item || !Number.isSafeInteger(item.sequence) || item.sequence < 1) {
    throw new TypeError("Invalid message identity");
  }
  validateMessage(item.message, item.level);
  return { sequence: item.sequence, level: item.level, message: item.message };
}

export function parseMessageHistory(value: unknown): UUIMessage[] {
  if (!Array.isArray(value) || value.length > MAX_RETAINED_MESSAGES) {
    throw new TypeError("Invalid message history");
  }
  const items = value.map(parseMessage);
  if (
    items.some((item, index) =>
      index > 0 && item.sequence <= items[index - 1]!.sequence
    )
  ) throw new TypeError("Invalid message history");
  return items;
}

export class MessageHistory {
  #sequence = 0;
  #items: UUIMessage[] = [];

  add(body: string, kind: UUIMessageKind): UUIMessage {
    validateMessage(body, kind);
    const item = { sequence: ++this.#sequence, level: kind, message: body };
    this.#items.push(item);
    if (this.#items.length > MAX_RETAINED_MESSAGES) this.#items.shift();
    return item;
  }

  snapshot(): UUIMessage[] {
    return this.#items.map((item) => ({ ...item }));
  }

  get sequence(): number {
    return this.#sequence;
  }

  clear(through = this.#sequence): void {
    this.#items = this.#items.filter((item) => item.sequence > through);
  }
}
