import {
  BACK_EVENT,
  type ScreenEventType,
  type ScreenSnapshot,
  type UUIServerMessage,
} from "@packages/the8020/uui/mod.ts";
import {
  DirtyBindings,
  reconnectDelay,
  shouldAcceptServerMessage,
  synchronizeClientSequence,
} from "./model.ts";
import { CustomElementRenderer } from "./custom_elements.ts";
import {
  changesForBindings,
  disposeFieldMessages,
  type RenderCallbacks,
  renderScreen,
  renderScreenHeader,
} from "./renderer.ts";
import { ResponsiveProgramHeader } from "./responsive_header.ts";
import { type Theme, ThemePreferences } from "./theme.ts";
import { renderIconText } from "./icon_text.ts";
import { MessageCenter } from "./message_center.ts";
import { windowTitleForHeading } from "./window_title.ts";

interface BootData {
  username?: string;
  logoutUrl?: string;
  websocketUrl: string;
  protocol: number;
  heartbeatInterval?: number;
  reconnectInitialDelay?: number;
  reconnectMaximumDelay?: number;
  buildVersion?: string;
}

const app = requiredElement<HTMLElement>("app");
const connectionState = requiredElement<HTMLElement>("connection-state");
const connectionIndicator = requiredElement<HTMLElement>(
  "connection-indicator",
);
const notice = requiredElement<HTMLElement>("notice");
const sessionMenu = requiredElement<HTMLDetailsElement>("session-menu");
const sessionMenuToggle = requiredElement<HTMLElement>("session-menu-toggle");
const sessionMenuIcon = requiredElement<HTMLElement>("session-menu-icon");
const sessionUsername = requiredElement<HTMLElement>("session-username");
const sessionLogout = requiredElement<HTMLButtonElement>("session-logout");
const themeToggle = requiredElement<HTMLButtonElement>("theme-toggle");
const messagesOpen = requiredElement<HTMLButtonElement>("messages-open");
const messagesCount = requiredElement<HTMLElement>("messages-count");
const messageToastStack = requiredElement<HTMLElement>("message-toast-stack");
const messageToastDismissAll = requiredElement<HTMLButtonElement>(
  "message-toast-dismiss-all",
);
const messageDialog = requiredElement<HTMLDialogElement>("message-dialog");
const messageHistoryList = requiredElement<HTMLElement>(
  "message-history-list",
);
const messageDialogClose = requiredElement<HTMLButtonElement>(
  "message-dialog-close",
);
const screenBack = requiredElement<HTMLButtonElement>("screen-back");
const programHeaderOverflowToggle = requiredElement<HTMLElement>(
  "program-header-overflow-toggle",
);
const programHeaderRoot = requiredElement<HTMLElement>("program-header");
const programHeader = new ResponsiveProgramHeader(
  programHeaderRoot,
  requiredElement<HTMLElement>("program-header-visible"),
  requiredElement<HTMLDetailsElement>("program-header-overflow"),
  requiredElement<HTMLElement>("program-header-overflow-items"),
);
const boot = JSON.parse(
  requiredElement<HTMLScriptElement>("the8020-boot").textContent ?? "",
) as BootData;
const username =
  typeof boot.username === "string" && boot.username.trim() !== ""
    ? boot.username.trim()
    : "User";
const logoutUrl = typeof boot.logoutUrl === "string" &&
    boot.logoutUrl.startsWith("/") && !boot.logoutUrl.startsWith("//")
  ? boot.logoutUrl
  : "/the8020/uui/login/logout";
const routeKey = `the8020.route:${boot.websocketUrl}`;
const themePreferences = new ThemePreferences(
  sessionStorage,
  localStorage,
  boot.websocketUrl,
  matchMedia("(prefers-color-scheme: dark)").matches,
);
let routeToken = sessionStorage.getItem(routeKey);
let lastServerSequence = 0;
let clientSequence = 0;
let socket: WebSocket | undefined;
let reconnectAttempt = 0;
let ended = false;
let currentSessionID = "";
let screen: ScreenSnapshot | undefined;
let model: Record<string, unknown> = {};
let interactionSequence: number | undefined;
let connectionText = "Connecting…";
let logoutFallback: number | undefined;
let logoutRequested = false;
const dirty = new DirtyBindings();
const pending = new Map<
  number,
  { encoded: string; dirty: ReadonlyMap<string, number> }
>();
const customElements = new CustomElementRenderer();
const messageCenter = new MessageCenter({
  toastRegion: messageToastStack,
  sessionMenu,
  sessionToggle: sessionMenuToggle,
  openButton: messagesOpen,
  count: messagesCount,
  dialog: messageDialog,
  list: messageHistoryList,
  closeButton: messageDialogClose,
  dismissAllButton: messageToastDismissAll,
});

renderIconText(screenBack, "[[icon=arrow_back]]", { decorativeIcons: true });
renderIconText(programHeaderOverflowToggle, "[[icon=more_vert]]", {
  decorativeIcons: true,
});
renderIconText(sessionMenuIcon, "[[icon=menu]]", { decorativeIcons: true });
sessionUsername.textContent = username;
sessionUsername.title = username;
updateSessionMenuLabel();
applyTheme(themePreferences.current());
themeToggle.addEventListener("click", () => {
  applyTheme(
    themePreferences.select(
      themePreferences.current() === "dark" ? "light" : "dark",
    ),
  );
  sessionMenu.open = false;
});
sessionLogout.addEventListener("click", requestLogout);
sessionMenu.addEventListener("toggle", () => {
  sessionMenuToggle.setAttribute("aria-expanded", String(sessionMenu.open));
  updateSessionMenuLabel();
});
document.addEventListener("pointerdown", (event) => {
  if (
    sessionMenu.open && event.target instanceof Node &&
    !sessionMenu.contains(event.target)
  ) sessionMenu.open = false;
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !sessionMenu.open) return;
  sessionMenu.open = false;
  sessionMenuToggle.focus();
});
screenBack.addEventListener("click", () => dispatch(BACK_EVENT, BACK_EVENT));
synchronizeWindowTitle();
connect();

function connect(): void {
  void connectAttempt();
}

async function connectAttempt(): Promise<void> {
  if (ended) return;
  setConnectionState("Connecting…", "connecting");
  try {
    if (routeToken === null) await establishRoute(false);
  } catch {
    scheduleReconnect();
    return;
  }
  let opened = false;
  socket = new WebSocket(websocketRouteURL(), ["the8020.uui.v1"]);
  socket.addEventListener("open", () => {
    opened = true;
    reconnectAttempt = 0;
    setConnectionState("Connected", "connected");
    send({
      type: "session.connect",
      protocol: boot.protocol,
      resumeToken: currentSessionID === "" ? null : routeToken,
      lastServerSequence,
    });
    for (const item of pending.values()) socket?.send(item.encoded);
  });
  socket.addEventListener("message", (event) => receive(event.data));
  socket.addEventListener("close", (event) => {
    if (ended) return;
    setConnectionState("Reconnecting…", "reconnecting");
    if (!opened || event.code === 1008) {
      void establishRoute(true).catch(() => {}).finally(scheduleReconnect);
      return;
    }
    scheduleReconnect();
  });
  socket.addEventListener("error", () => socket?.close());
}

async function establishRoute(reuse: boolean): Promise<void> {
  const request = async (): Promise<Response> => {
    const headers = new Headers();
    if (reuse && routeToken !== null) {
      headers.set("X-80-20-Route", routeToken);
    }
    return await fetch(establishmentURL(), {
      method: "POST",
      credentials: "same-origin",
      headers,
    });
  };
  let response = await request();
  if (response.status === 409 && reuse && routeToken !== null) {
    replaceRoute(undefined);
    reuse = false;
    response = await request();
  }
  if (!response.ok) {
    throw new Error(`route establishment failed: ${response.status}`);
  }
  const token = response.headers.get("X-80-20-Route");
  if (token === null || token.length === 0) {
    throw new Error("route establishment returned no route token");
  }
  if (token !== routeToken) replaceRoute(token);
}

function replaceRoute(token: string | undefined): void {
  routeToken = token ?? null;
  if (token === undefined) sessionStorage.removeItem(routeKey);
  else sessionStorage.setItem(routeKey, token);
  lastServerSequence = 0;
  clientSequence = 0;
  currentSessionID = "";
  pending.clear();
  dirty.clear();
  messageCenter.beginRoundtrip();
  setInteractionPending(undefined);
}

function websocketRouteURL(): string {
  const url = new URL(boot.websocketUrl, location.href);
  url.searchParams.set("route", routeToken ?? "");
  return url.toString();
}

function establishmentURL(): string {
  const url = new URL(boot.websocketUrl, location.href);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.searchParams.delete("route");
  return url.toString();
}

function scheduleReconnect(): void {
  if (ended) return;
  const delay = reconnectDelay(
    reconnectAttempt++,
    boot.reconnectInitialDelay ?? 250,
    boot.reconnectMaximumDelay ?? 10_000,
  );
  setTimeout(connect, delay);
}

function receive(raw: unknown): void {
  if (typeof raw !== "string") return;
  let message: UUIServerMessage;
  try {
    message = JSON.parse(raw) as UUIServerMessage;
  } catch {
    showNotice("The server sent an invalid message.");
    return;
  }
  if (
    typeof message.sessionId === "string" &&
    message.sessionId !== currentSessionID
  ) {
    currentSessionID = message.sessionId;
    applyTheme(themePreferences.bindSession(currentSessionID));
  }
  if (
    message.protocol !== boot.protocol ||
    !shouldAcceptServerMessage(
      message.type,
      message.serverSequence,
      lastServerSequence,
    )
  ) return;
  lastServerSequence = Math.max(lastServerSequence, message.serverSequence);
  switch (message.type) {
    case "session.ready":
      break;
    case "session.resumed":
      clientSequence = synchronizeClientSequence(
        clientSequence,
        message.lastClientSequence,
      );
      setConnectionState("Connected", "connected");
      break;
    case "session.resync_required":
      setInteractionPending(undefined);
      showResync(
        message.message ?? "This session needs a fresh screen snapshot.",
      );
      break;
    case "session.ping":
      sendClient({ type: "session.pong" });
      break;
    case "screen.show":
      notice.hidden = true;
      screen = message.screen;
      screenBack.disabled = false;
      model = structuredClone(message.screen.model) as Record<string, unknown>;
      setInteractionPending(undefined);
      dirty.clear();
      pending.clear();
      renderCurrentScreen();
      break;
    case "screen.close":
      if (screen?.id === message.screenId) {
        setInteractionPending(undefined);
        customElements.dispose();
        disposeFieldMessages(app);
        disposeFieldMessages(programHeaderRoot);
        programHeader.clear();
        screenBack.disabled = true;
        app.replaceChildren();
        synchronizeWindowTitle();
      }
      break;
    case "notification.show":
      messageCenter.show(message);
      break;
    case "clipboard.write":
      void writeClipboard(message.text);
      break;
    case "server.ack":
      if (message.clientSequence !== undefined) {
        for (const sequence of pending.keys()) {
          if (sequence <= message.clientSequence) {
            const item = pending.get(sequence);
            if (item !== undefined) dirty.acknowledge(item.dirty);
            pending.delete(sequence);
          }
        }
      }
      break;
    case "session.error":
      if (interactionSequence !== undefined) {
        pending.delete(interactionSequence);
      }
      setInteractionPending(undefined);
      showNotice(message.message ?? message.code ?? "Session error");
      break;
    case "session.end":
      if (logoutFallback !== undefined) clearTimeout(logoutFallback);
      setInteractionPending(undefined);
      ended = true;
      messageCenter.dispose();
      customElements.dispose();
      disposeFieldMessages(programHeaderRoot);
      programHeader.clear();
      screenBack.disabled = true;
      themePreferences.endSession();
      sessionStorage.removeItem(routeKey);
      socket?.close(1000, "session ended");
      if (message.redirectUrl) location.assign(message.redirectUrl);
      else showNotice(message.message ?? "The session ended.");
      break;
  }
}

function applyTheme(theme: Theme): void {
  const dark = theme === "dark";
  document.documentElement.dataset.theme = theme;
  themeToggle.setAttribute("aria-pressed", String(dark));
  themeToggle.setAttribute(
    "aria-label",
    dark ? "Switch to light mode" : "Switch to dark mode",
  );
  renderIconText(
    themeToggle,
    dark ? "[[icon=light_mode]] Light mode" : "[[icon=dark_mode]] Dark mode",
    { decorativeIcons: true },
  );
}

function setConnectionState(
  text: string,
  state: "connecting" | "connected" | "reconnecting",
): void {
  renderIconText(connectionState, text);
  connectionIndicator.dataset.state = state;
  connectionText = text;
  updateSessionMenuLabel();
}

function updateSessionMenuLabel(): void {
  sessionMenuToggle.setAttribute(
    "aria-label",
    `${username}, ${connectionText} ${
      sessionMenu.open ? "Close" : "Open"
    } session menu`,
  );
}

function requestLogout(): void {
  if (logoutRequested) return;
  logoutRequested = true;
  sessionMenu.open = false;
  sessionLogout.disabled = true;
  themeToggle.disabled = true;
  const connected = socket?.readyState === WebSocket.OPEN &&
    currentSessionID !== "";
  if (connected) {
    sendClient({ type: "session.logout" });
    logoutFallback = setTimeout(() => location.assign(logoutUrl), 1_500);
    return;
  }
  location.assign(logoutUrl);
}

async function writeClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    try {
      if (!document.execCommand("copy")) {
        showNotice("The browser did not allow copying the short dump.");
      }
    } finally {
      textarea.remove();
    }
  }
}

function renderCurrentScreen(): void {
  if (screen === undefined) return;
  customElements.begin();
  const callbacks: RenderCallbacks = {
    changed(bind, _value, control) {
      dirty.mark(bind);
      if (control.reactive) dispatch("change", "change", undefined, bind);
    },
    action(action, eventType = "action", value) {
      dispatch(action, eventType, value);
    },
    page(bind, currentPage, page) {
      requestPage(bind, currentPage, page);
    },
  };
  renderScreen(app, screen, model, callbacks, customElements);
  synchronizeWindowTitle();
  disposeFieldMessages(programHeaderRoot);
  programHeader.render(renderScreenHeader(screen, model, callbacks));
  customElements.end();
}

function synchronizeWindowTitle(): void {
  const heading = app.querySelector<HTMLElement>(
    ".screen > h1.screen-title",
  );
  document.title = windowTitleForHeading(heading?.textContent);
}

function requestPage(bind: string, currentPage: number, page: number): void {
  if (screen === undefined) return;
  const pagination = screen.pagination?.lists.find((item) =>
    item.bind === bind
  );
  if (
    pagination === undefined || pagination.page !== currentPage ||
    !Number.isSafeInteger(page) || page < 1 || page > pagination.totalPages ||
    page === currentPage
  ) return;
  sendInteraction({
    type: "screen.page",
    screenId: screen.id,
    screenRevision: screen.revision,
    bind,
    currentPage,
    page,
    changes: changesForBindings(model, [...dirty.bindings(), bind]),
  });
}

function setInteractionPending(sequence: number | undefined): void {
  interactionSequence = sequence;
  const waiting = sequence !== undefined;
  document.documentElement.toggleAttribute(
    "data-interaction-pending",
    waiting,
  );
  app.inert = waiting;
  programHeaderRoot.inert = waiting;
  screenBack.disabled = waiting;
  for (const region of [app, programHeaderRoot]) {
    if (waiting) region.setAttribute("aria-busy", "true");
    else region.removeAttribute("aria-busy");
  }
}

function dispatch(
  action: string,
  eventType: ScreenEventType,
  value?: unknown,
  bind?: string,
): void {
  if (screen === undefined) return;
  sendInteraction({
    type: "screen.event",
    screenId: screen.id,
    screenRevision: screen.revision,
    action,
    eventType,
    value,
    bind,
    changes: changesForBindings(model, dirty.bindings()),
  });
}

function sendInteraction(payload: Record<string, unknown>): void {
  if (interactionSequence !== undefined) return;
  const sequence = sendClient(payload, true);
  if (sequence !== undefined) {
    messageCenter.beginRoundtrip();
    setInteractionPending(sequence);
  }
}

function sendClient(
  payload: Record<string, unknown>,
  remember = false,
): number | undefined {
  if (routeToken === null) return undefined;
  const message = {
    ...payload,
    protocol: boot.protocol,
    clientSequence: ++clientSequence,
    sessionId: currentSessionID,
    ...(screen === undefined ? {} : {
      screenId: screen.id,
      screenRevision: screen.revision,
    }),
  };
  const encoded = JSON.stringify(message);
  if (remember) {
    pending.set(message.clientSequence, {
      encoded,
      dirty: dirty.capture(),
    });
  }
  if (socket?.readyState === WebSocket.OPEN) socket.send(encoded);
  return message.clientSequence;
}

function send(value: unknown): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
}

function showNotice(message: string): void {
  renderIconText(notice, message);
  notice.hidden = false;
}

function showResync(message: string): void {
  const text = document.createElement("span");
  renderIconText(text, message);
  const button = document.createElement("button");
  button.type = "button";
  renderIconText(button, "Reload current screen");
  button.addEventListener("click", () => {
    notice.hidden = true;
    sendClient({ type: "client.ack", resync: true });
  });
  notice.replaceChildren(text, document.createTextNode(" "), button);
  notice.hidden = false;
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (value === null) throw new Error(`missing #${id}`);
  return value as T;
}
