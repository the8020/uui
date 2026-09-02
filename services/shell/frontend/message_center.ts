import {
  MAX_UUI_MESSAGE_BODY_LENGTH,
  type NotificationMessage,
  UUI_MESSAGE_KINDS,
  type UUIMessageKind,
} from "@packages/the8020/uui/mod.ts";
import { renderMarkdown } from "../../../frontend/mod.ts";

export const MAX_RENDERED_MESSAGES = 10;
export const MAX_RETAINED_MESSAGES = 100;
export const MESSAGE_TOAST_TIMEOUT_MILLISECONDS = 3_000;

export interface PresentedMessage {
  readonly id: string;
  readonly sequence: number;
  readonly kind: UUIMessageKind;
  readonly body: string;
  readonly receivedAt: number;
}

export interface AddedMessage {
  readonly message: PresentedMessage;
  readonly removedVisibleIDs: readonly string[];
}

export class MessageCollection {
  #history: PresentedMessage[] = [];
  #visible: PresentedMessage[] = [];

  add(message: PresentedMessage): AddedMessage | undefined {
    if (this.#history.some((item) => item.id === message.id)) return undefined;
    this.#history.push(message);
    if (this.#history.length > MAX_RETAINED_MESSAGES) {
      this.#history.splice(
        0,
        this.#history.length - MAX_RETAINED_MESSAGES,
      );
    }
    this.#visible.push(message);
    const removedVisible = this.#visible.length > MAX_RENDERED_MESSAGES
      ? this.#visible.splice(
        0,
        this.#visible.length - MAX_RENDERED_MESSAGES,
      )
      : [];
    return {
      message,
      removedVisibleIDs: removedVisible.map((item) => item.id),
    };
  }

  dismissVisible(id: string): boolean {
    const index = this.#visible.findIndex((item) => item.id === id);
    if (index < 0) return false;
    this.#visible.splice(index, 1);
    return true;
  }

  clear(): void {
    this.#history = [];
    this.#visible = [];
  }

  history(): readonly PresentedMessage[] {
    return [...this.#history];
  }

  historyLength(): number {
    return this.#history.length;
  }

  visible(): readonly PresentedMessage[] {
    return [...this.#visible];
  }
}

export interface MessageCenterElements {
  readonly toastRegion: HTMLElement;
  readonly sessionMenu: HTMLDetailsElement;
  readonly sessionToggle: HTMLElement;
  readonly openButton: HTMLButtonElement;
  readonly count: HTMLElement;
  readonly dialog: HTMLDialogElement;
  readonly list: HTMLElement;
  readonly closeButton: HTMLButtonElement;
}

export class MessageCenter {
  readonly #elements: MessageCenterElements;
  readonly #collection = new MessageCollection();
  readonly #cards = new Map<string, HTMLElement>();
  #activeID: string | undefined;
  #leavingID: string | undefined;
  #focusedID: string | undefined;
  #archivedID: string | undefined;
  #progressAnimation: Animation | undefined;
  #archiveFallback: number | undefined;
  #renderFrame: number | undefined;
  #disposed = false;

  constructor(elements: MessageCenterElements) {
    this.#elements = elements;
    elements.openButton.addEventListener("click", () => this.#openHistory());
    elements.closeButton.addEventListener("click", () => {
      elements.dialog.close();
    });
    elements.dialog.addEventListener("click", (event) => {
      if (event.target === elements.dialog) elements.dialog.close();
    });
    this.#updateMenuCount();
  }

  show(message: NotificationMessage): void {
    if (this.#disposed) return;
    if (typeof message.message !== "string") return;
    const body = message.message.slice(0, MAX_UUI_MESSAGE_BODY_LENGTH);
    if (body.trim().length === 0) return;
    const kind = (UUI_MESSAGE_KINDS as readonly string[]).includes(
        message.level,
      )
      ? message.level
      : "info";
    const added = this.#collection.add({
      id: `${message.sessionId}:${message.serverSequence}`,
      sequence: message.serverSequence,
      kind,
      body,
      receivedAt: Date.now(),
    });
    if (added === undefined) return;
    this.#focusedID = added.message.id;
    this.#updateMenuCount();
    this.#scheduleRender();
  }

  beginRoundtrip(): void {
    if (this.#disposed) return;
    this.#stopProgress();
    if (this.#archiveFallback !== undefined) {
      clearTimeout(this.#archiveFallback);
      this.#archiveFallback = undefined;
    }
    if (this.#renderFrame !== undefined) {
      cancelAnimationFrame(this.#renderFrame);
      this.#renderFrame = undefined;
    }
    this.#activeID = undefined;
    this.#leavingID = undefined;
    this.#focusedID = undefined;
    this.#archivedID = undefined;
    this.#collection.clear();
    for (const card of this.#cards.values()) card.remove();
    this.#cards.clear();
    this.#elements.toastRegion.replaceChildren();
    this.#elements.toastRegion.hidden = true;
    this.#updateMenuCount();
    if (this.#elements.dialog.open) this.#renderHistory();
  }

  #scheduleRender(): void {
    if (this.#renderFrame !== undefined) return;
    this.#renderFrame = requestAnimationFrame(() => {
      this.#renderFrame = undefined;
      if (this.#disposed) return;
      this.#syncToasts();
      if (this.#elements.dialog.open) this.#renderHistory();
    });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.beginRoundtrip();
    this.#disposed = true;
    if (this.#elements.dialog.open) this.#elements.dialog.close();
  }

  #syncToasts(): void {
    const visible = this.#collection.visible();
    const visibleIDs = new Set(visible.map((message) => message.id));
    for (const id of this.#cards.keys()) {
      if (!visibleIDs.has(id)) this.#removeCard(id);
    }
    visible.forEach((message, index) => {
      let card = this.#cards.get(message.id);
      if (card === undefined) {
        card = this.#createToast(message);
        this.#cards.set(message.id, card);
      }
      const top = index === 0;
      card.classList.toggle("message-toast-top", top);
      card.toggleAttribute("aria-hidden", !top);
      card.inert = !top;
      card.style.setProperty(
        "--message-stack-offset-y",
        `${index * 0.5}rem`,
      );
      card.style.zIndex = String(MAX_RENDERED_MESSAGES - index);
      this.#elements.toastRegion.append(card);
    });
    this.#elements.toastRegion.hidden = visible.length === 0;
    const nextID = visible[0]?.id;
    if (nextID === undefined) {
      this.#stopProgress();
      this.#activeID = undefined;
      return;
    }
    if (this.#leavingID !== nextID && this.#activeID !== nextID) {
      this.#startProgress(nextID);
    }
  }

  #createToast(message: PresentedMessage): HTMLElement {
    const card = document.createElement("article");
    card.className = "message-toast";
    card.dataset.messageId = message.id;
    card.dataset.messageKind = message.kind;
    card.setAttribute("role", message.kind === "error" ? "alert" : "status");

    const header = document.createElement("header");
    header.className = "message-toast-header";
    const marker = document.createElement("span");
    marker.className = "message-kind-marker";
    marker.setAttribute("aria-hidden", "true");
    const kind = document.createElement("strong");
    kind.className = "message-kind-label";
    kind.textContent = messageKindLabel(message.kind);
    header.append(marker, kind);

    const body = document.createElement("div");
    body.className = "message-toast-body";
    renderMarkdown(body, message.body);

    const progress = document.createElement("div");
    progress.className = "message-toast-progress";
    progress.setAttribute("aria-hidden", "true");
    const fill = document.createElement("span");
    fill.className = "message-toast-progress-fill";
    progress.append(fill);
    card.append(header, body, progress);
    card.addEventListener("mouseenter", () => {
      if (this.#activeID === message.id && this.#leavingID === undefined) {
        this.#startProgress(message.id);
      }
    });
    return card;
  }

  #startProgress(id: string): void {
    const card = this.#cards.get(id);
    const fill = card?.querySelector<HTMLElement>(
      ".message-toast-progress-fill",
    );
    if (card === undefined || fill === null || fill === undefined) return;
    this.#stopProgress();
    this.#activeID = id;
    this.#progressAnimation = fill.animate(
      [{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }],
      {
        duration: MESSAGE_TOAST_TIMEOUT_MILLISECONDS,
        easing: "linear",
        fill: "forwards",
      },
    );
    this.#progressAnimation.addEventListener("finish", () => {
      if (this.#activeID === id && this.#leavingID === undefined) {
        this.#archiveToast(id);
      }
    }, { once: true });
  }

  #stopProgress(): void {
    if (this.#progressAnimation !== undefined) {
      this.#progressAnimation.cancel();
      this.#progressAnimation = undefined;
    }
  }

  #archiveToast(id: string): void {
    const card = this.#cards.get(id);
    if (card === undefined || this.#leavingID !== undefined) return;
    this.#stopProgress();
    this.#activeID = undefined;
    this.#leavingID = id;
    this.#focusedID = id;
    this.#archivedID = id;
    card.inert = true;
    const cardBounds = card.getBoundingClientRect();
    const toggleBounds = this.#elements.sessionToggle.getBoundingClientRect();
    card.style.setProperty(
      "--message-exit-x",
      `${
        toggleBounds.left + toggleBounds.width / 2 -
        (cardBounds.left + cardBounds.width / 2)
      }px`,
    );
    card.style.setProperty(
      "--message-exit-y",
      `${
        toggleBounds.top + toggleBounds.height / 2 -
        (cardBounds.top + cardBounds.height / 2)
      }px`,
    );
    card.classList.add("message-toast-leaving");
    let completed = false;
    const complete = (): void => {
      if (completed || this.#leavingID !== id) return;
      completed = true;
      this.#completeArchive(id);
    };
    card.addEventListener("animationend", complete, { once: true });
    this.#archiveFallback = setTimeout(complete, 600);
  }

  #completeArchive(id: string): void {
    if (this.#archiveFallback !== undefined) {
      clearTimeout(this.#archiveFallback);
      this.#archiveFallback = undefined;
    }
    this.#collection.dismissVisible(id);
    this.#removeCard(id);
    this.#leavingID = undefined;
    this.#pulseMenuCount();
    this.#syncToasts();
    if (this.#elements.dialog.open) this.#renderHistory();
  }

  #removeCard(id: string): void {
    if (this.#activeID === id) {
      this.#stopProgress();
      this.#activeID = undefined;
    }
    if (this.#leavingID === id) {
      if (this.#archiveFallback !== undefined) {
        clearTimeout(this.#archiveFallback);
        this.#archiveFallback = undefined;
      }
      this.#leavingID = undefined;
    }
    const card = this.#cards.get(id);
    card?.remove();
    this.#cards.delete(id);
  }

  #updateMenuCount(): void {
    const count = this.#collection.historyLength();
    this.#elements.count.textContent = String(count);
    this.#elements.count.dataset.count = String(count);
    this.#elements.openButton.setAttribute(
      "aria-label",
      `Messages, ${count} ${count === 1 ? "message" : "messages"}`,
    );
  }

  #pulseMenuCount(): void {
    const count = this.#elements.count;
    count.classList.remove("message-count-arrival");
    void count.offsetWidth;
    count.classList.add("message-count-arrival");
  }

  #openHistory(): void {
    this.#elements.sessionMenu.open = false;
    this.#renderHistory();
    if (!this.#elements.dialog.open) this.#elements.dialog.showModal();
    const history = this.#collection.history();
    const targetMessage = this.#focusMessage(history);
    if (targetMessage === undefined) return;
    const targetID = targetMessage.id;
    const selector = `[data-message-id="${CSS.escape(targetID)}"]`;
    const target = this.#elements.list.querySelector<HTMLDetailsElement>(
      selector,
    );
    if (target === null) return;
    for (
      const entry of this.#elements.list.querySelectorAll<HTMLDetailsElement>(
        ".message-history-entry",
      )
    ) entry.open = entry === target;
    this.#ensureHistoryBody(target, targetMessage);
    target.dataset.focused = "true";
    requestAnimationFrame(() => target.scrollIntoView({ block: "center" }));
  }

  #renderHistory(): void {
    const expanded = new Set(
      [...this.#elements.list.querySelectorAll<HTMLDetailsElement>(
        ".message-history-entry[open]",
      )].map((entry) => entry.dataset.messageId ?? ""),
    );
    const fragment = document.createDocumentFragment();
    const history = this.#collection.history();
    const focusedID = this.#focusMessage(history)?.id;
    if (history.length === 0) {
      const empty = document.createElement("p");
      empty.className = "message-history-empty";
      empty.textContent = "No messages yet.";
      fragment.append(empty);
    }
    for (const message of history) {
      const entry = document.createElement("details");
      entry.className = "message-history-entry";
      entry.dataset.messageId = message.id;
      entry.dataset.messageKind = message.kind;
      entry.open = expanded.has(message.id);
      entry.toggleAttribute("data-focused", message.id === focusedID);

      const summary = document.createElement("summary");
      summary.className = "message-history-summary";
      const marker = document.createElement("span");
      marker.className = "message-kind-marker";
      marker.setAttribute("aria-hidden", "true");
      const kind = document.createElement("strong");
      kind.className = "message-kind-label";
      kind.textContent = messageKindLabel(message.kind);
      const preview = document.createElement("span");
      preview.className = "message-history-preview";
      preview.textContent = messagePreview(message.body);
      const time = document.createElement("time");
      time.className = "message-history-time";
      const timestamp = new Date(message.receivedAt);
      time.dateTime = timestamp.toISOString();
      time.textContent = timestamp.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      summary.append(marker, kind, preview, time);
      entry.append(summary);
      entry.addEventListener("toggle", () => {
        if (entry.open) this.#ensureHistoryBody(entry, message);
      });
      if (entry.open) this.#ensureHistoryBody(entry, message);
      fragment.append(entry);
    }
    this.#elements.list.replaceChildren(fragment);
  }

  #focusMessage(
    history: readonly PresentedMessage[],
  ): PresentedMessage | undefined {
    return history.find((item) => item.id === this.#archivedID) ??
      history.find((item) => item.id === this.#focusedID) ?? history.at(-1);
  }

  #ensureHistoryBody(
    entry: HTMLDetailsElement,
    message: PresentedMessage,
  ): void {
    if (entry.querySelector(".message-history-body") !== null) return;
    const body = document.createElement("div");
    body.className = "message-history-body";
    renderMarkdown(body, message.body);
    entry.append(body);
  }
}

function messageKindLabel(kind: UUIMessageKind): string {
  return kind === "info" ? "Info" : kind[0]!.toUpperCase() + kind.slice(1);
}

function messagePreview(body: string): string {
  const plain = body
    .replace(/```[\s\S]*?```/g, " code ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^[#>*+\-\d.\s]+/gm, "")
    .replace(/[*_~`|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length <= 96 ? plain : `${plain.slice(0, 95)}…`;
}
