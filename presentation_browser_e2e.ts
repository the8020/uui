import {
  BACK_EVENT,
  callScreen,
  field,
  parseClientMessage,
  presentModal,
  presentPage,
  ScreenChannel,
  sendMessage,
  UUI_PROTOCOL_VERSION,
  type UUIClientMessage,
  type UUIWorkerOutbound,
  z,
} from "./mod.ts";
import { bindSession, type SessionChannel } from "./internal.ts";

interface CDPResponse {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { message?: string };
}

interface CDPTarget {
  webSocketDebuggerUrl: string;
}

class BrowserPage {
  readonly exceptions: string[] = [];
  readonly #socket: WebSocket;
  readonly #pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();
  #sequence = 0;

  private constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as CDPResponse;
      if (message.method === "Runtime.exceptionThrown") {
        this.exceptions.push(JSON.stringify(message.params ?? {}));
      }
      if (message.id === undefined) return;
      const pending = this.#pending.get(message.id);
      if (pending === undefined) return;
      this.#pending.delete(message.id);
      if (message.error !== undefined) {
        pending.reject(
          new Error(message.error.message ?? "CDP command failed"),
        );
      } else {
        pending.resolve(message.result);
      }
    };
    socket.onclose = () => {
      for (const pending of this.#pending.values()) {
        pending.reject(new Error("browser debugging connection closed"));
      }
      this.#pending.clear();
    };
  }

  static async connect(webSocketURL: string): Promise<BrowserPage> {
    const socket = new WebSocket(webSocketURL);
    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve();
      socket.onerror = () => reject(new Error("connect to browser debugger"));
    });
    const page = new BrowserPage(socket);
    await page.command("Runtime.enable");
    await page.command("Page.enable");
    return page;
  }

  command<Result = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<Result> {
    const id = ++this.#sequence;
    return new Promise<Result>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`browser debugging command ${method} timed out`));
      }, 10_000);
      this.#pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value as Result);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
      try {
        this.#socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        clearTimeout(timeout);
        this.#pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async evaluate<Result>(expression: string): Promise<Result> {
    const response = await this.command<{
      result?: { value?: Result; description?: string };
      exceptionDetails?: { text?: string };
    }>("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (response.exceptionDetails !== undefined) {
      throw new Error(
        response.result?.description ?? response.exceptionDetails.text ??
          "browser evaluation failed",
      );
    }
    return response.result?.value as Result;
  }

  close(): void {
    this.#socket.close();
  }
}

class LocalSessionChannel implements SessionChannel {
  readonly sessionId = "presentation-browser-e2e";
  readonly #messages: UUIClientMessage[] = [];
  readonly #receivers: Array<{
    resolve(message: UUIClientMessage): void;
    reject(error: Error): void;
  }> = [];
  #closed = false;

  constructor(readonly outbound: (message: UUIWorkerOutbound) => void) {}

  send(message: UUIWorkerOutbound): void {
    this.outbound(message);
  }

  receive(): Promise<UUIClientMessage> {
    const available = this.#messages.shift();
    if (available !== undefined) return Promise.resolve(available);
    if (this.#closed) return Promise.reject(new Error("local channel closed"));
    return new Promise((resolve, reject) => {
      this.#receivers.push({ resolve, reject });
    });
  }

  push(message: UUIClientMessage): void {
    if (this.#closed) return;
    const receiver = this.#receivers.shift();
    if (receiver !== undefined) receiver.resolve(message);
    else this.#messages.push(message);
  }

  close(): void {
    this.#closed = true;
    for (const receiver of this.#receivers.splice(0)) {
      receiver.reject(new Error("local channel closed"));
    }
  }
}

const PresentationScreen = z.object({
  value: field(z.string(), { label: "Value", length: "long" }),
  status: field(z.string(), {
    label: "Background status",
    length: "long",
    readOnly: true,
  }),
});

const browser = option("browser") ?? "/usr/bin/chromium";
const httpPort = freePort();
const debugPort = freePort();
const routeToken = "presentation-browser-route";
const sessionId = "presentation-browser-e2e";
const temporaryRoot = await Deno.makeTempDir({
  prefix: "the8020-presentation-browser-",
});
const serverAbort = new AbortController();
let currentSocket: WebSocket | undefined;
let serverSequence = 0;
let connectionSequence = 0;
let processedClientSequence = 0;
const initialOutbounds: UUIWorkerOutbound[] = [];
let retainedPresentation:
  | Extract<
    UUIWorkerOutbound,
    { type: "presentation.show" }
  >["presentation"]
  | undefined;

function sendServer(payload: Record<string, unknown>): void {
  const socket = currentSocket;
  if (socket?.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({
    ...payload,
    protocol: UUI_PROTOCOL_VERSION,
    serverSequence: ++serverSequence,
    sessionId,
  }));
}

const channel = new LocalSessionChannel((message) => {
  if (message.type === "presentation.show") {
    retainedPresentation = structuredClone(message.presentation);
  }
  if (message.type === "server.ack") {
    processedClientSequence = Math.max(
      processedClientSequence,
      message.clientSequence,
    );
  }
  if (
    currentSocket?.readyState !== WebSocket.OPEN &&
    connectionSequence === 0 && message.type !== "presentation.show"
  ) {
    initialOutbounds.push(structuredClone(message));
    return;
  }
  sendServer(message);
});
const unbind = bindSession(channel);
let stopping = false;
let programError: unknown;
const program = runProgram().catch((error) => {
  if (!stopping) programError = error;
});

const server = Deno.serve({
  hostname: "127.0.0.1",
  port: httpPort,
  signal: serverAbort.signal,
  onListen() {},
}, serve);

let chromium: Deno.ChildProcess | undefined;
let page: BrowserPage | undefined;
try {
  chromium = new Deno.Command(browser, {
    args: [
      "--headless=new",
      "--no-sandbox",
      "--no-zygote",
      "--single-process",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${temporaryRoot}/chromium`,
      "about:blank",
    ],
    stdout: "null",
    stderr: "inherit",
  }).spawn();
  await waitForHTTP(`http://127.0.0.1:${debugPort}/json/version`);
  page = await openPage(debugPort, `http://127.0.0.1:${httpPort}/`);
  await verifyPresentationFlow(page);
  if (programError !== undefined) throw programError;
  assert(
    page.exceptions.length === 0,
    `browser exceptions: ${page.exceptions.join("\n")}`,
  );
  console.log("presentation browser E2E passed");
} catch (error) {
  const state = page === undefined ? undefined : await page.evaluate(`({
      title: document.title,
      connection: document.querySelector('#connection-state')?.textContent,
      body: document.body?.innerText,
    })`).catch(() => undefined);
  throw new Error(
    `${
      error instanceof Error ? error.stack ?? error.message : String(error)
    }; ` +
      `browser state: ${JSON.stringify(state)}; ` +
      `program error: ${String(programError ?? "none")}`,
  );
} finally {
  stopping = true;
  page?.close();
  if (chromium !== undefined) await stopProcess(chromium);
  unbind();
  channel.close();
  await program;
  serverAbort.abort();
  await server.finished.catch(() => {});
  await Deno.remove(temporaryRoot, { recursive: true }).catch(() => {});
}

async function runProgram(): Promise<void> {
  sendMessage("Modal design probe");
  while (true) {
    const event = await callScreen({
      id: "presentation-page-a",
      title: "Presentation page A",
      schema: z.object({}),
      model: {},
      customElements: [{
        id: "probe",
        initializer: "presentation-probe.v1",
        preserve: true,
        config: { label: "lifecycle probe" },
      }],
      layout: {
        schema: 1,
        id: "presentation-page-a-layout",
        root: {
          id: "probe-region",
          type: "custom",
          customElement: "probe",
        },
      },
      actions: [{ id: "open-flow", label: "Presentation flow" }],
      header: {
        actions: [{ id: "page-action", label: "Page action" }],
      },
    });
    if (event.action === "open-flow") await runModalB();
  }
}

async function runModalB(): Promise<void> {
  await presentModal(async () => {
    const model = {
      value: "Edit this before the background redraw",
      status: "Waiting for background redraw",
    };
    const channel = new ScreenChannel();
    while (true) {
      const redraw = setTimeout(() => {
        model.status = "Background redraw completed";
        channel.redraw();
      }, 400);
      let action: string;
      try {
        action = (await callScreen({
          id: "presentation-modal-b",
          title: "Presentation modal B",
          schema: PresentationScreen,
          model,
          channel,
          actions: [
            { id: "open-modal", label: "Open nested modal" },
            { id: "open-page", label: "Open page" },
          ],
          header: {
            actions: [{ id: "close", label: "Close modal" }],
          },
        })).action;
      } finally {
        clearTimeout(redraw);
      }
      if (action === BACK_EVENT || action === "close") return;
      if (action === "open-modal") {
        await presentModal(() => runLeaf("Presentation modal C"));
      }
      if (action === "open-page") await runPageD();
    }
  });
}

async function runPageD(): Promise<void> {
  await presentPage(async () => {
    const model = { value: "Page D", status: "Ready" };
    while (true) {
      const event = await callScreen({
        id: "presentation-page-d",
        title: "Presentation page D",
        schema: PresentationScreen,
        model,
        actions: [{ id: "open-modal", label: "Open modal E" }],
      });
      if (event.action === BACK_EVENT) return;
      if (event.action === "open-modal") {
        await presentModal(() => runLeaf("Presentation modal E"));
      }
    }
  });
}

async function runLeaf(title: string): Promise<void> {
  const model = { value: title, status: "Ready" };
  while (true) {
    const event = await callScreen({
      id: "presentation-leaf",
      title,
      schema: PresentationScreen,
      model,
      header: { actions: [{ id: "close", label: "Close modal" }] },
    });
    if (event.action === BACK_EVENT || event.action === "close") return;
  }
}

async function serve(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "POST" && url.pathname === "/session") {
    return new Response(null, {
      status: 204,
      headers: { "X-80-20-Route": routeToken },
    });
  }
  if (request.method === "GET" && url.pathname === "/session") {
    if (url.searchParams.get("route") !== routeToken) {
      return new Response("invalid route", { status: 403 });
    }
    const { socket, response } = Deno.upgradeWebSocket(request, {
      protocol: "the8020.uui.v1",
    });
    socket.onopen = () => {
      currentSocket = socket;
    };
    socket.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      let message: UUIClientMessage;
      try {
        message = parseClientMessage(JSON.parse(event.data));
      } catch {
        socket.close(1008, "invalid client message");
        return;
      }
      if (message.type === "session.connect") {
        connectionSequence++;
        if (connectionSequence === 1) {
          for (const outbound of initialOutbounds.splice(0)) {
            sendServer(outbound);
          }
          sendServer({
            type: "session.ready",
            resumeToken: routeToken,
            resumed: false,
          });
        } else {
          sendServer({
            type: "session.resumed",
            resumed: true,
            lastClientSequence: processedClientSequence,
          });
        }
        if (retainedPresentation !== undefined) {
          sendServer({
            type: "presentation.show",
            presentation: retainedPresentation,
          });
        }
        return;
      }
      channel.push(message);
    };
    socket.onclose = () => {
      if (currentSocket === socket) currentSocket = undefined;
    };
    return response;
  }
  if (request.method !== "GET") {
    return new Response("method not allowed", { status: 405 });
  }
  if (url.pathname === "/" || url.pathname === "/index.html") {
    const source = await Deno.readTextFile(
      new URL("./services/shell/frontend/index.html", import.meta.url),
    );
    const boot = {
      username: "Browser test",
      logoutUrl: "/logout",
      websocketUrl: `ws://127.0.0.1:${httpPort}/session`,
      protocol: UUI_PROTOCOL_VERSION,
      reconnectInitialDelay: 25,
      reconnectMaximumDelay: 100,
      buildVersion: "presentation-browser-e2e",
    };
    const html = source.replaceAll("__the8020_theme_nonce__", "e2e").replace(
      /\{\s*"__the8020_boot_placeholder__"\s*:\s*true\s*\}/,
      JSON.stringify(boot),
    );
    return new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  const asset = await staticAsset(url.pathname);
  return asset ?? new Response("not found", { status: 404 });
}

async function staticAsset(pathname: string): Promise<Response | undefined> {
  const relative = pathname.replace(/^\/+/, "");
  if (
    relative.length === 0 ||
    !relative.split("/").every((part) =>
      /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part)
    )
  ) return undefined;
  const roots = [
    new URL("./services/shell/.generated/", import.meta.url),
    new URL("./services/shell/frontend/", import.meta.url),
    new URL("./frontend/", import.meta.url),
  ];
  for (const root of roots) {
    try {
      const body = await Deno.readFile(new URL(relative, root));
      return new Response(body, {
        headers: { "content-type": contentType(relative) },
      });
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) continue;
      throw error;
    }
  }
  return undefined;
}

function contentType(path: string): string {
  if (path.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".map")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

async function verifyPresentationFlow(page: BrowserPage): Promise<void> {
  await waitForPage(
    page,
    `document.querySelector('.screen-title')?.textContent?.trim() === 'Presentation page A' &&
      document.querySelector('#connection-state')?.textContent === 'Connected'`,
    "initial page",
  );
  assert(
    await page.evaluate<boolean>(`(() => {
      window.__presentationPage = document.querySelector(
        '#app .presentation-page-layer:not([hidden]) .screen'
      );
      window.__presentationProbe = document.querySelector(
        '[data-custom-element-id="probe"]'
      );
      return window.__presentationPage instanceof HTMLElement &&
        window.__presentationProbe instanceof HTMLElement;
    })()`),
    "initial page lifecycle markers are missing",
  );

  await click(page, "#messages-open");
  await waitForPage(
    page,
    `document.querySelector('#message-dialog')?.open === true &&
      document.querySelector('#message-history-list')?.textContent?.includes('Modal design probe') === true`,
    "shell Messages dialog",
  );
  assert(
    await page.evaluate<boolean>(`(() => {
      const dialog = document.querySelector('#message-dialog');
      const frame = dialog?.querySelector('.uui-dialog-frame');
      const toolbar = dialog?.querySelector('.uui-dialog-toolbar');
      const body = dialog?.querySelector('.uui-dialog-body');
      const close = dialog?.querySelector('.uui-dialog-close');
      if (!(dialog instanceof HTMLDialogElement) ||
        !(frame instanceof HTMLElement) || !(toolbar instanceof HTMLElement) ||
        !(body instanceof HTMLElement) || !(close instanceof HTMLButtonElement)) {
        return false;
      }
      const style = getComputedStyle(dialog);
      const backdrop = getComputedStyle(dialog, '::backdrop');
      window.__uuiDialogDesign = {
        borderRadius: style.borderRadius,
        backgroundColor: style.backgroundColor,
        boxShadow: style.boxShadow,
        backdrop: backdrop.backgroundColor,
        backdropFilter: backdrop.backdropFilter,
      };
      return close.querySelector('[data-material-icon="close"]') !== null;
    })()`),
    "Messages does not use the shared dialog structure",
  );
  await click(page, "#message-dialog-close");
  await waitForPage(
    page,
    `document.querySelector('#message-dialog')?.open === false`,
    "Messages dialog close",
  );

  await clickButton(page, "Presentation flow");
  await waitForPage(
    page,
    `(() => {
      const dialog = document.querySelector('dialog.presentation-modal[open]');
      return document.querySelectorAll('dialog.presentation-modal[open]').length === 1 &&
        dialog?.querySelector('.screen-title')?.textContent?.trim() === 'Presentation modal B' &&
        dialog?.querySelector('.presentation-modal-header')?.textContent?.includes('Close modal') === true &&
        document.querySelector('#program-header')?.textContent?.includes('Page action') === true &&
        document.querySelector('#app')?.inert === true && dialog?.inert === false &&
        dialog?.contains(document.activeElement) === true &&
        window.__presentationPage === document.querySelector('#app .screen') &&
        window.__presentationProbe === document.querySelector('[data-custom-element-id="probe"]') &&
        dialog?.classList.contains('uui-dialog') === true &&
        dialog?.querySelector('.uui-dialog-frame') !== null &&
        dialog?.querySelector('.uui-dialog-toolbar') !== null &&
        dialog?.querySelector('.uui-dialog-body') !== null &&
        dialog?.querySelector('.uui-dialog-close') !== null &&
        (() => {
          const style = getComputedStyle(dialog);
          const backdrop = getComputedStyle(dialog, '::backdrop');
          const design = window.__uuiDialogDesign;
          return style.borderRadius === design?.borderRadius &&
            style.backgroundColor === design?.backgroundColor &&
            style.boxShadow === design?.boxShadow &&
            backdrop.backgroundColor === design?.backdrop &&
            backdrop.backdropFilter === design?.backdropFilter;
        })();
    })()`,
    "first modal and preserved page",
  );
  await setValue(
    page,
    'dialog.presentation-modal[open] [data-bind="value"]',
    "Locally edited during redraw",
  );
  await waitForPage(
    page,
    `(() => {
      const dialog = document.querySelector('dialog.presentation-modal[open]');
      return dialog?.querySelector('[data-bind="value"]')?.value === 'Locally edited during redraw' &&
        dialog?.querySelector('[data-bind="status"]')?.value === 'Background redraw completed';
    })()`,
    "dirty modal redraw",
  );

  await clickButton(page, "Open nested modal");
  await waitForPage(
    page,
    `(() => {
      const dialogs = [...document.querySelectorAll('dialog.presentation-modal[open]')];
      return dialogs.length === 2 &&
        dialogs[0]?.querySelector('.screen-title')?.textContent?.trim() === 'Presentation modal B' &&
        dialogs[1]?.querySelector('.screen-title')?.textContent?.trim() === 'Presentation modal C' &&
        dialogs[0]?.inert === true && dialogs[1]?.inert === false &&
        dialogs[1]?.contains(document.activeElement) === true;
    })()`,
    "nested modal",
  );
  await pressEscape(page);
  await waitForPage(
    page,
    `document.querySelectorAll('dialog.presentation-modal[open]').length === 1 &&
      document.querySelector('dialog.presentation-modal[open] .screen-title')?.textContent?.trim() === 'Presentation modal B'`,
    "Escape restores modal B",
  );

  assert(
    await page.evaluate<boolean>(`(() => {
      window.__presentationDialog = document.querySelector(
        'dialog.presentation-modal[open]'
      );
      return window.__presentationDialog instanceof HTMLDialogElement;
    })()`),
    "modal lifecycle marker is missing",
  );
  await clickButton(page, "Open page");
  await waitForPage(
    page,
    `(() => {
      const oldPage = window.__presentationPage?.closest('.presentation-page-layer');
      return document.querySelector('#app .presentation-page-layer:not([hidden]) .screen-title')?.textContent?.trim() === 'Presentation page D' &&
        window.__presentationPage?.isConnected === true && oldPage?.hidden === true &&
        window.__presentationDialog?.isConnected === true && window.__presentationDialog?.open === false &&
        window.__presentationProbe?.isConnected === true;
    })()`,
    "page D hides the prior composition without disposal",
  );
  await clickButton(page, "Open modal E");
  await waitForPage(
    page,
    `document.querySelector('dialog.presentation-modal[open] .screen-title')?.textContent?.trim() === 'Presentation modal E' &&
      document.querySelector('#app .presentation-page-layer:not([hidden]) .screen-title')?.textContent?.trim() === 'Presentation page D'`,
    "modal E over page D",
  );
  await pressEscape(page);
  await waitForPage(
    page,
    `document.querySelectorAll('dialog.presentation-modal[open]').length === 0 &&
      document.querySelector('#app .presentation-page-layer:not([hidden]) .screen-title')?.textContent?.trim() === 'Presentation page D'`,
    "Escape restores page D",
  );
  await clickButton(page, "Back");
  await waitForPage(
    page,
    `window.__presentationPage === document.querySelector('#app .presentation-page-layer:not([hidden]) .screen') &&
      window.__presentationDialog === document.querySelector('dialog.presentation-modal[open]') &&
      window.__presentationProbe === document.querySelector('[data-custom-element-id="probe"]') &&
      document.querySelector('dialog.presentation-modal[open] .screen-title')?.textContent?.trim() === 'Presentation modal B'`,
    "page pop restores exact page and modal layers",
  );

  await clickButton(page, "Open page");
  await waitForPage(
    page,
    `document.querySelector('#app .presentation-page-layer:not([hidden]) .screen-title')?.textContent?.trim() === 'Presentation page D'`,
    "second page D",
  );
  await clickButton(page, "Open modal E");
  await waitForPage(
    page,
    `document.querySelector('dialog.presentation-modal[open] .screen-title')?.textContent?.trim() === 'Presentation modal E'`,
    "second modal E",
  );
  await page.command("Page.reload", { ignoreCache: true });
  await waitForPage(
    page,
    `document.querySelector('#connection-state')?.textContent === 'Connected' &&
      document.querySelector('#app .presentation-page-layer:not([hidden]) .screen-title')?.textContent?.trim() === 'Presentation page D' &&
      document.querySelector('dialog.presentation-modal[open] .screen-title')?.textContent?.trim() === 'Presentation modal E'`,
    "reload restores page D and modal E",
  );
  await page.evaluate("history.back()");
  await waitForPage(
    page,
    `document.querySelectorAll('dialog.presentation-modal[open]').length === 0 &&
      document.querySelector('#app .presentation-page-layer:not([hidden]) .screen-title')?.textContent?.trim() === 'Presentation page D'`,
    "browser Back returns from modal E",
  );
  await clickButton(page, "Back");
  await waitForPage(
    page,
    `document.querySelector('#app .presentation-page-layer:not([hidden]) .screen-title')?.textContent?.trim() === 'Presentation page A' &&
      document.querySelector('dialog.presentation-modal[open] .screen-title')?.textContent?.trim() === 'Presentation modal B'`,
    "post-reload page pop restores page A and modal B",
  );
  assert(
    await page.evaluate<boolean>(`(() => {
      window.__restoredProbe = document.querySelector(
        '[data-custom-element-id="probe"]'
      );
      return window.__restoredProbe instanceof HTMLElement;
    })()`),
    "restored custom element is missing",
  );
  await clickButton(page, "Close modal");
  await waitForPage(
    page,
    `document.querySelectorAll('dialog.presentation-modal[open]').length === 0 &&
      document.querySelector('.screen-title')?.textContent?.trim() === 'Presentation page A' &&
      window.__restoredProbe === document.querySelector('[data-custom-element-id="probe"]')`,
    "modal close returns to page A without recreating its custom element",
  );
}

async function openPage(port: number, url: string): Promise<BrowserPage> {
  const response = await fetch(
    `http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`,
    { method: "PUT" },
  );
  if (!response.ok) throw new Error(`create browser page: ${response.status}`);
  const target = await response.json() as CDPTarget;
  return await BrowserPage.connect(target.webSocketDebuggerUrl);
}

async function setValue(
  page: BrowserPage,
  selector: string,
  value: string,
): Promise<void> {
  const changed = await page.evaluate<boolean>(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement || input instanceof HTMLSelectElement)) return false;
    input.value = ${JSON.stringify(value)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  assert(changed, `missing input ${selector}`);
}

async function click(page: BrowserPage, selector: string): Promise<void> {
  const clicked = await page.evaluate<boolean>(`(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!(target instanceof HTMLElement)) return false;
    target.click();
    return true;
  })()`);
  assert(clicked, `missing clickable ${selector}`);
}

async function clickButton(page: BrowserPage, label: string): Promise<void> {
  const clicked = await page.evaluate<boolean>(`(() => {
    const target = [...document.querySelectorAll('button')].find((item) =>
      !item.closest('[hidden]') && (item.textContent?.trim() === ${
    JSON.stringify(label)
  } || item.getAttribute('aria-label') === ${JSON.stringify(label)}));
    if (!(target instanceof HTMLButtonElement)) return false;
    target.click();
    return true;
  })()`);
  assert(clicked, `missing ${label} button`);
}

async function pressEscape(page: BrowserPage): Promise<void> {
  await page.command("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
    nativeVirtualKeyCode: 27,
  });
  await page.command("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
    nativeVirtualKeyCode: 27,
  });
}

async function waitForPage(
  page: BrowserPage,
  expression: string,
  description: string,
  timeout = 10_000,
): Promise<void> {
  await waitFor(
    async () => {
      try {
        return await page.evaluate<boolean>(expression);
      } catch {
        return false;
      }
    },
    description,
    timeout,
  );
}

async function waitForHTTP(url: string): Promise<void> {
  await waitFor(
    async () => {
      try {
        const response = await fetch(url);
        await response.body?.cancel();
        return response.ok;
      } catch {
        return false;
      }
    },
    url,
    30_000,
  );
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  description: string,
  timeout: number,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!(await predicate())) {
    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for ${description}`);
    }
    await delay(50);
  }
}

function freePort(): number {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  return port;
}

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return Deno.args.find((argument) => argument.startsWith(prefix))?.slice(
    prefix.length,
  );
}

async function stopProcess(child: Deno.ChildProcess): Promise<void> {
  try {
    child.kill("SIGKILL");
  } catch {
    // The process already exited.
  }
  await child.status.catch(() => {});
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
