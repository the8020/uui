import {
  BACK_EVENT,
  type PresentationSnapshot,
  type PresentationSurfaceKind,
  type PresentationSurfaceSnapshot,
  type ScreenEventType,
  type ScreenSnapshot,
  type UUIServerMessage,
} from "@packages/the8020/uui/protocol.ts";
import {
  DirtyBindings,
  reconnectDelay,
  shouldAcceptServerMessage,
  shouldReconnectWebSocket,
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
import {
  createMaterialIcon,
  type MaterialIconName,
  renderIconText,
} from "./icon_text.ts";
import { MessageCenter } from "./message_center.ts";
import { mergeServerModel, PresentationHistory } from "./presentation.ts";
import { windowTitleForHeading } from "./window_title.ts";

interface FocusState {
  element?: HTMLElement;
  id?: string;
  bind?: string;
  selectionStart?: number | null;
  selectionEnd?: number | null;
}

interface PresentationLayer {
  readonly surfaceId: string;
  readonly kind: PresentationSurfaceKind;
  readonly shell: HTMLElement | HTMLDialogElement;
  readonly root: HTMLElement;
  readonly headerRoot?: HTMLElement;
  readonly customElements: CustomElementRenderer;
  readonly dirty: DirtyBindings;
  screen: ScreenSnapshot;
  screenFingerprint: string;
  model: Record<string, unknown>;
  headerItems: HTMLElement[];
  focus?: FocusState;
  scrollX: number;
  scrollY: number;
}

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
const modalLayers = requiredElement<HTMLElement>("modal-layers");
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
let interactionSequence: number | undefined;
let activeSurfaceID: string | null = null;
let connectionText = "Connecting…";
let logoutFallback: ReturnType<typeof setTimeout> | undefined;
let logoutRequested = false;
let terminalRedirect: string | undefined;
const pending = new Map<
  number,
  {
    encoded: string;
    surfaceId: string;
    dirty: ReadonlyMap<string, number>;
  }
>();
const layers = new Map<string, PresentationLayer>();
const presentationHistory = new PresentationHistory();
let globalHeaderSurfaceID: string | undefined;
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
renderIconText(messageDialogClose, "[[icon=close]]", {
  decorativeIcons: true,
});
renderSessionMenuAction(sessionLogout, "logout", "Logout");
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
screenBack.addEventListener("click", requestBack);
installBrowserBack();
synchronizeWindowTitle();
connect();

function requestBack(): void {
  if (screenBack.disabled) return;
  dispatch(BACK_EVENT, BACK_EVENT);
}

function installBrowserBack(): void {
  const key = "the8020.uui.back";
  const slot = (value: unknown): "base" | "guard" | undefined => {
    if (value === null || typeof value !== "object") return undefined;
    const marker = (value as Record<string, unknown>)[key];
    return marker === "base" || marker === "guard" ? marker : undefined;
  };
  const state = (marker: "base" | "guard"): Record<string, unknown> => ({
    ...(history.state !== null && typeof history.state === "object" &&
        !Array.isArray(history.state)
      ? history.state
      : {}),
    [key]: marker,
  });

  const current = slot(history.state);
  if (current === undefined) history.replaceState(state("base"), "");
  if (current !== "guard") history.pushState(state("guard"), "");
  addEventListener("popstate", (event) => {
    if (slot(event.state) !== "base") return;
    history.pushState(state("guard"), "");
    requestBack();
  });
}

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
    if (!shouldReconnectWebSocket(ended, event.code)) {
      if (terminalRedirect !== undefined) {
        if (logoutFallback !== undefined) clearTimeout(logoutFallback);
        location.assign(terminalRedirect);
        return;
      }
      if (!ended) {
        ended = true;
        sessionStorage.removeItem(routeKey);
        showNotice(event.reason || "The session ended.");
      }
      return;
    }
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
  clearPresentation();
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
    if (currentSessionID !== "") clearPresentation();
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
    case "presentation.show":
      notice.hidden = true;
      try {
        reconcilePresentation(message.presentation);
      } catch {
        showNotice("The server sent an invalid presentation.");
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
            if (item !== undefined) {
              layers.get(item.surfaceId)?.dirty.acknowledge(item.dirty);
            }
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
      setInteractionPending(undefined);
      ended = true;
      messageCenter.dispose();
      clearPresentation();
      themePreferences.endSession();
      sessionStorage.removeItem(routeKey);
      terminalRedirect = message.redirectUrl;
      if (terminalRedirect !== undefined) {
        if (logoutFallback !== undefined) clearTimeout(logoutFallback);
        logoutFallback = setTimeout(
          () => location.assign(terminalRedirect!),
          1_500,
        );
      } else showNotice(message.message ?? "The session ended.");
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
  renderSessionMenuAction(
    themeToggle,
    dark ? "light_mode" : "dark_mode",
    dark ? "Light mode" : "Dark mode",
  );
}

function renderSessionMenuAction(
  button: HTMLButtonElement,
  icon: MaterialIconName,
  label: string,
): void {
  const text = document.createElement("span");
  text.className = "session-menu-action-label";
  text.textContent = label;
  button.replaceChildren(
    createMaterialIcon(icon, undefined, { decorativeIcons: true }),
    text,
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

function reconcilePresentation(presentation: PresentationSnapshot): void {
  const surfaces = presentation.surfaces;
  if (
    !Number.isSafeInteger(presentation.pageDepth) ||
    presentation.pageDepth < 1 ||
    surfaces.length === 0 || surfaces[0]?.kind !== "page" ||
    surfaces.slice(1).some((surface) => surface.kind !== "modal") ||
    surfaces.some((surface) =>
      typeof surface.surfaceId !== "string" || surface.surfaceId.length === 0 ||
      typeof surface.screen?.id !== "string" ||
      surface.screen.id.length === 0 ||
      !Number.isSafeInteger(surface.screen.revision) ||
      surface.screen.revision < 1
    ) ||
    presentation.activeSurfaceId !== null &&
      presentation.activeSurfaceId !== surfaces.at(-1)?.surfaceId
  ) {
    showNotice("The server sent an invalid presentation.");
    return;
  }

  captureActiveFocus();
  const previousVisible = [...presentationHistory.visible()];
  const previousBase = previousVisible[0];
  if (previousBase !== undefined) {
    const layer = layers.get(previousBase);
    if (layer !== undefined) {
      layer.scrollX = scrollX;
      layer.scrollY = scrollY;
    }
  }
  if (
    interactionSequence !== undefined &&
    presentation.activeSurfaceId !== null
  ) {
    completeInteraction(interactionSequence);
  }

  let transition: { removed: string[] };
  try {
    transition = presentationHistory.reconcile(
      surfaces.map((surface) => surface.surfaceId),
      presentation.pageDepth,
    );
  } catch {
    showNotice("The server sent an invalid presentation.");
    return;
  }

  for (const surfaceId of transition.removed) disposeLayer(surfaceId);
  const changed = new Set<string>();
  for (const surface of surfaces) {
    let layer = layers.get(surface.surfaceId);
    if (layer === undefined) {
      layer = createLayer(surface);
      layers.set(surface.surfaceId, layer);
      changed.add(surface.surfaceId);
    } else if (updateLayer(layer, surface)) {
      changed.add(surface.surfaceId);
    }
  }

  const visible = new Set(surfaces.map((surface) => surface.surfaceId));
  for (const surfaceId of previousVisible.reverse()) {
    if (visible.has(surfaceId)) continue;
    hideLayer(layers.get(surfaceId));
  }
  for (const layer of layers.values()) {
    if (!visible.has(layer.surfaceId)) hideLayer(layer);
  }
  for (const surface of surfaces) showLayer(layers.get(surface.surfaceId)!);

  const base = layers.get(surfaces[0]!.surfaceId)!;
  if (
    globalHeaderSurfaceID !== base.surfaceId || changed.has(base.surfaceId)
  ) {
    programHeader.render(base.headerItems);
    globalHeaderSurfaceID = base.surfaceId;
  }

  activeSurfaceID = presentation.activeSurfaceId;
  updateInteractionState();
  synchronizeWindowTitle();

  if (previousBase !== base.surfaceId) {
    scrollTo(base.scrollX, base.scrollY);
  }
  if (activeSurfaceID !== null) {
    const active = layers.get(activeSurfaceID);
    if (active !== undefined) queueMicrotask(() => restoreFocus(active));
  }
}

function createLayer(surface: PresentationSurfaceSnapshot): PresentationLayer {
  let shell: HTMLElement | HTMLDialogElement;
  let root: HTMLElement;
  let headerRoot: HTMLElement | undefined;
  if (surface.kind === "page") {
    shell = document.createElement("section");
    shell.className = "presentation-page-layer";
    shell.dataset.surfaceId = surface.surfaceId;
    root = shell;
    if (app.querySelector(".loading") !== null) app.replaceChildren();
    app.append(shell);
  } else {
    const dialog = document.createElement("dialog");
    dialog.className = "uui-dialog presentation-modal";
    dialog.dataset.surfaceId = surface.surfaceId;
    dialog.setAttribute("aria-modal", "true");
    const frame = document.createElement("section");
    frame.className = "uui-dialog-frame presentation-modal-frame";
    const toolbar = document.createElement("header");
    toolbar.className = "uui-dialog-toolbar presentation-modal-toolbar";
    headerRoot = document.createElement("div");
    headerRoot.className = "uui-dialog-header presentation-modal-header";
    const close = document.createElement("button");
    close.type = "button";
    close.className =
      "btn btn-ghost btn-sm uui-dialog-close presentation-modal-close";
    close.setAttribute("aria-label", "Close");
    close.title = "Close";
    renderIconText(close, "[[icon=close]]", { decorativeIcons: true });
    close.addEventListener("click", () => requestLayerBack(surface.surfaceId));
    toolbar.append(headerRoot, close);
    root = document.createElement("div");
    root.className = "uui-dialog-body presentation-modal-body";
    const shield = document.createElement("div");
    shield.className = "presentation-modal-interaction-shield";
    shield.setAttribute("aria-hidden", "true");
    const indicator = document.createElement("div");
    indicator.className = "interaction-indicator";
    const spinner = document.createElement("span");
    spinner.className = "interaction-spinner";
    const label = document.createElement("span");
    label.textContent = "Loading…";
    indicator.append(spinner, label);
    shield.append(indicator);
    frame.append(toolbar, root, shield);
    dialog.append(frame);
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      requestLayerBack(surface.surfaceId);
    });
    modalLayers.append(dialog);
    shell = dialog;
  }
  const layer: PresentationLayer = {
    surfaceId: surface.surfaceId,
    kind: surface.kind,
    shell,
    root,
    headerRoot,
    customElements: new CustomElementRenderer(),
    dirty: new DirtyBindings(),
    screen: surface.screen,
    screenFingerprint: "",
    model: {},
    headerItems: [],
    scrollX: 0,
    scrollY: 0,
  };
  updateLayer(layer, surface);
  return layer;
}

function updateLayer(
  layer: PresentationLayer,
  surface: PresentationSurfaceSnapshot,
): boolean {
  if (layer.kind !== surface.kind) {
    throw new TypeError("presentation surface kind changed");
  }
  const fingerprint = JSON.stringify(surface.screen);
  if (fingerprint === layer.screenFingerprint) return false;
  rememberLayerFocus(layer);
  const sameScreen = layer.screenFingerprint !== "" &&
    layer.screen.id === surface.screen.id &&
    layer.screen.revision === surface.screen.revision;
  const nextModel = sameScreen
    ? mergeServerModel(
      surface.screen.model,
      layer.model,
      layer.dirty.bindings(),
    )
    : structuredClone(surface.screen.model) as Record<string, unknown>;
  if (!sameScreen) layer.dirty.clear();
  layer.screen = surface.screen;
  layer.screenFingerprint = fingerprint;
  layer.model = nextModel;
  renderLayer(layer);
  return true;
}

function renderLayer(layer: PresentationLayer): void {
  const callbacks: RenderCallbacks = {
    changed(bind, _value, control) {
      if (!layerIsActive(layer)) return;
      layer.dirty.mark(bind);
      if (control.reactive) {
        dispatchFromLayer(layer, "change", "change", undefined, bind);
      }
    },
    action(action, eventType = "action", value) {
      dispatchFromLayer(layer, action, eventType, value);
    },
    page(bind, currentPage, page) {
      requestPage(layer, bind, currentPage, page);
    },
  };
  layer.customElements.begin();
  renderScreen(
    layer.root,
    layer.screen,
    layer.model,
    callbacks,
    layer.customElements,
  );
  for (const item of layer.headerItems) disposeFieldMessages(item);
  layer.headerItems = renderScreenHeader(
    layer.screen,
    layer.model,
    callbacks,
  );
  if (layer.kind === "modal") {
    layer.headerRoot!.replaceChildren(...layer.headerItems);
    const heading = layer.root.querySelector<HTMLElement>(".screen-title");
    if (heading !== null) {
      heading.id = `presentation-title-${layer.surfaceId}`;
      heading.tabIndex = -1;
      layer.shell.setAttribute("aria-labelledby", heading.id);
    }
  }
  layer.customElements.end();
}

function hideLayer(layer: PresentationLayer | undefined): void {
  if (layer === undefined) return;
  if (layer.kind === "page") {
    layer.shell.hidden = true;
    return;
  }
  const dialog = layer.shell as HTMLDialogElement;
  if (dialog.open) dialog.close();
}

function showLayer(layer: PresentationLayer): void {
  if (layer.kind === "page") {
    layer.shell.hidden = false;
    return;
  }
  const dialog = layer.shell as HTMLDialogElement;
  if (!dialog.open) dialog.showModal();
}

function disposeLayer(surfaceId: string): void {
  const layer = layers.get(surfaceId);
  if (layer === undefined) return;
  if (layer.kind === "modal" && (layer.shell as HTMLDialogElement).open) {
    (layer.shell as HTMLDialogElement).close();
  }
  disposeFieldMessages(layer.root);
  for (const item of layer.headerItems) disposeFieldMessages(item);
  layer.customElements.dispose();
  layer.shell.remove();
  layers.delete(surfaceId);
  if (globalHeaderSurfaceID === surfaceId) globalHeaderSurfaceID = undefined;
  for (const [sequence, item] of pending) {
    if (item.surfaceId === surfaceId) pending.delete(sequence);
  }
}

function clearPresentation(): void {
  presentationHistory.clear();
  for (const surfaceId of [...layers.keys()]) disposeLayer(surfaceId);
  activeSurfaceID = null;
  interactionSequence = undefined;
  globalHeaderSurfaceID = undefined;
  programHeader.clear();
  screenBack.disabled = true;
  app.replaceChildren();
  synchronizeWindowTitle();
  updateInteractionState();
}

function synchronizeWindowTitle(): void {
  const top = activeSurfaceID === null
    ? presentationHistory.visible().at(-1)
    : activeSurfaceID;
  const heading = top === undefined
    ? undefined
    : layers.get(top)?.root.querySelector<HTMLElement>(
      ".screen > h1.screen-title",
    );
  document.title = windowTitleForHeading(heading?.textContent);
}

function requestPage(
  layer: PresentationLayer,
  bind: string,
  currentPage: number,
  page: number,
): void {
  if (!layerIsActive(layer)) return;
  const pagination = layer.screen.pagination?.lists.find((item) =>
    item.bind === bind
  );
  if (
    pagination === undefined || pagination.page !== currentPage ||
    !Number.isSafeInteger(page) || page < 1 || page > pagination.totalPages ||
    page === currentPage
  ) return;
  sendInteraction(layer, {
    type: "screen.page",
    bind,
    currentPage,
    page,
    changes: changesForBindings(layer.model, [
      ...layer.dirty.bindings(),
      bind,
    ]),
  });
}

function setInteractionPending(sequence: number | undefined): void {
  interactionSequence = sequence;
  updateInteractionState();
}

function updateInteractionState(): void {
  const visible = new Set(presentationHistory.visible());
  const waiting = interactionSequence !== undefined ||
    (visible.size > 0 && activeSurfaceID === null);
  const active = activeSurfaceID === null
    ? undefined
    : layers.get(activeSurfaceID);
  const feedbackLayer = active ?? layers.get(
    presentationHistory.visible().at(-1) ?? "",
  );
  const pageWaiting = waiting && feedbackLayer?.kind !== "modal";
  document.documentElement.toggleAttribute(
    "data-interaction-pending",
    pageWaiting,
  );
  for (const layer of layers.values()) {
    const isVisible = visible.has(layer.surfaceId);
    const isActive = activeSurfaceID === layer.surfaceId;
    layer.shell.inert = !isVisible || waiting || !isActive;
    const modalWaiting = waiting && feedbackLayer === layer &&
      layer.kind === "modal";
    layer.shell.toggleAttribute("data-interaction-pending", modalWaiting);
    if (modalWaiting) layer.root.setAttribute("aria-busy", "true");
    else layer.root.removeAttribute("aria-busy");
  }
  app.inert = waiting || active?.kind === "modal";
  programHeaderRoot.inert = waiting ||
    activeSurfaceID !== presentationHistory.visible()[0];
  screenBack.disabled = waiting || active === undefined;
  if (pageWaiting) {
    app.setAttribute("aria-busy", "true");
    programHeaderRoot.setAttribute("aria-busy", "true");
  } else {
    app.removeAttribute("aria-busy");
    programHeaderRoot.removeAttribute("aria-busy");
  }
}

function dispatch(
  action: string,
  eventType: ScreenEventType,
  value?: unknown,
  bind?: string,
): void {
  const layer = activeLayer();
  if (layer === undefined) return;
  dispatchFromLayer(layer, action, eventType, value, bind);
}

function dispatchFromLayer(
  layer: PresentationLayer,
  action: string,
  eventType: ScreenEventType,
  value?: unknown,
  bind?: string,
): void {
  if (!layerIsActive(layer)) return;
  sendInteraction(layer, {
    type: "screen.event",
    action,
    eventType,
    value,
    bind,
    changes: changesForBindings(layer.model, layer.dirty.bindings()),
  });
}

function requestLayerBack(surfaceId: string): void {
  const layer = layers.get(surfaceId);
  if (layer === undefined || !layerIsActive(layer)) return;
  dispatchFromLayer(layer, BACK_EVENT, BACK_EVENT);
}

function sendInteraction(
  layer: PresentationLayer,
  payload: Record<string, unknown>,
): void {
  if (interactionSequence !== undefined) return;
  const sequence = sendClient(
    {
      ...payload,
      surfaceId: layer.surfaceId,
      screenId: layer.screen.id,
      screenRevision: layer.screen.revision,
    },
    true,
    layer,
  );
  if (sequence !== undefined) {
    messageCenter.beginRoundtrip();
    setInteractionPending(sequence);
  }
}

function sendClient(
  payload: Record<string, unknown>,
  remember = false,
  layer?: PresentationLayer,
): number | undefined {
  if (routeToken === null) return undefined;
  const message = {
    ...payload,
    protocol: boot.protocol,
    clientSequence: ++clientSequence,
    sessionId: currentSessionID,
  };
  const encoded = JSON.stringify(message);
  if (remember) {
    if (layer === undefined) {
      throw new TypeError("remembered interaction requires a screen layer");
    }
    pending.set(message.clientSequence, {
      encoded,
      surfaceId: layer.surfaceId,
      dirty: layer.dirty.capture(),
    });
  }
  if (socket?.readyState === WebSocket.OPEN) socket.send(encoded);
  return message.clientSequence;
}

function completeInteraction(sequence: number): void {
  const item = pending.get(sequence);
  if (item !== undefined) {
    layers.get(item.surfaceId)?.dirty.acknowledge(item.dirty);
    pending.delete(sequence);
  }
  if (interactionSequence === sequence) interactionSequence = undefined;
}

function activeLayer(): PresentationLayer | undefined {
  return activeSurfaceID === null ? undefined : layers.get(activeSurfaceID);
}

function layerIsActive(layer: PresentationLayer): boolean {
  return interactionSequence === undefined &&
    activeSurfaceID === layer.surfaceId &&
    presentationHistory.visible().at(-1) === layer.surfaceId;
}

function captureActiveFocus(): void {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return;
  for (const layer of layers.values()) {
    if (
      layer.root.contains(active) ||
      layer.headerItems.some((item) => item === active || item.contains(active))
    ) {
      rememberLayerFocus(layer, active);
      return;
    }
  }
}

function rememberLayerFocus(
  layer: PresentationLayer,
  candidate: HTMLElement | null = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null,
): void {
  if (
    candidate === null ||
    !layer.root.contains(candidate) &&
      !layer.headerItems.some((item) =>
        item === candidate || item.contains(candidate)
      )
  ) return;
  const selectable = candidate instanceof HTMLInputElement ||
    candidate instanceof HTMLTextAreaElement;
  layer.focus = {
    element: candidate,
    id: candidate.id || undefined,
    bind: candidate.dataset.bind,
    selectionStart: selectable ? candidate.selectionStart : undefined,
    selectionEnd: selectable ? candidate.selectionEnd : undefined,
  };
}

function restoreFocus(layer: PresentationLayer): void {
  if (!layerIsActive(layer)) return;
  const saved = layer.focus;
  let target = saved?.element?.isConnected ? saved.element : undefined;
  if (target === undefined && saved?.id !== undefined) {
    target = elementsInLayer(layer).find((item) => item.id === saved.id);
  }
  if (target === undefined && saved?.bind !== undefined) {
    target = elementsInLayer(layer).find((item) =>
      item.dataset.bind === saved.bind
    );
  }
  if (target === undefined && layer.kind === "modal") {
    target = layer.root.querySelector<HTMLElement>(
      "input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled), [tabindex]:not([tabindex='-1'])",
    ) ?? layer.headerRoot?.querySelector<HTMLElement>(
      "input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled), [tabindex]:not([tabindex='-1'])",
    ) ?? layer.root.querySelector<HTMLElement>(".screen-title") ?? undefined;
  }
  if (target === undefined) return;
  target.focus({ preventScroll: true });
  if (
    saved !== undefined &&
    (target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement) &&
    saved.selectionStart !== undefined && saved.selectionEnd !== undefined
  ) {
    try {
      target.setSelectionRange(saved.selectionStart, saved.selectionEnd);
    } catch {
      // Inputs without text selection still receive focus.
    }
  }
}

function elementsInLayer(layer: PresentationLayer): HTMLElement[] {
  return [
    ...layer.root.querySelectorAll<HTMLElement>("*"),
    ...layer.headerItems.flatMap((item) => [
      item,
      ...item.querySelectorAll<HTMLElement>("*"),
    ]),
  ];
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
