import { Model } from "./model.ts";
import { PACKAGE_ASSET_PREFIX } from "./browser_assets.ts";
import { AssetServer } from "./services/shell/assets.ts";
import {
  prepareCustomElementAssets,
  runCustomElementsProgram,
  verifyCustomElements,
} from "./custom_elements_browser_scenarios.ts";
import materialSymbols from "./services/shell/frontend/assets/material_symbols.json" with {
  type: "json",
};
import { assertEquals } from "@std/assert";
import { declaration } from "/p/the8020/services/src/configuration.ts";
import {
  runProgramsBrowser,
  verifyProgramsBrowser,
} from "./programs_browser_scenarios.ts";
import {
  listBrowserProbe,
  runListsProgram,
  verifyListsFlow,
} from "./lists_browser_scenarios.ts";
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
import {
  field as sharedField,
  money,
  type ValueHelpRequest,
} from "/p/the8020/db/fields.ts";

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

  async evaluate<Result>(
    expression: string,
    userGesture = true,
  ): Promise<Result> {
    const response = await this.command<{
      result?: { value?: Result; description?: string };
      exceptionDetails?: { text?: string };
    }>("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture,
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

interface PackageBrowserFixture {
  run(): Promise<void>;
  verify(
    page: BrowserPage,
    openPage: () => Promise<BrowserPage>,
  ): Promise<void>;
  serve(request: Request): Promise<Response | undefined>;
  close(): Promise<void>;
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
    if (Deno.args.includes("--lists")) listBrowserProbe.messages.push(message);
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

const fieldHelpRequests: ValueHelpRequest[] = [];
const FieldHelpUser = sharedField(z.string(), {
  label: "User",
  description:
    "Choose **who owns this work**.\n\nSearch by username, then choose a result.",
  valueHelp: (request) => {
    fieldHelpRequests.push(request);
    const matches = Array.from({ length: 2001 }, (_, index) => `user${index}`)
      .filter((value) => value.includes(request.query));
    return {
      items: matches.slice(request.offset, request.offset + request.limit)
        .map((value) => ({ value, label: value })),
      more: request.offset + request.limit < matches.length,
    };
  },
  open: (value) => runLeaf(`User ${value}`),
});
const FieldHelpScreen = z.object({
  amount: field(money(), {
    label: "Amount",
    description: "An **exact monetary amount**.",
  }),
  user: FieldHelpUser,
  note: field(z.string(), {
    label: "Note",
    description: "A **plain text** note.",
  }),
  recorded: field(FieldHelpUser, { label: "Recorded user", readOnly: true }),
});
const fieldHelpModel = new Model({
  amount: "90071992547409.91",
  user: "user0",
  note: "Before",
  recorded: "user1",
});

const browser = option("browser") ?? "/usr/bin/chromium";
const httpPort = freePort();
const debugPort = freePort();
let routeToken = "presentation-browser-route";
const connectionRequests: Array<{ method: string; route: string | null }> = [];
const establishmentResponses: ResponseInit[] = [];
let connectionRejection: ResponseInit | undefined;
let redirectTarget: string | undefined;
let redirectPageStatus = 200;
const sessionId = "presentation-browser-e2e";
const temporaryRoot = await Deno.makeTempDir({
  prefix: "the8020-presentation-browser-",
});
const browserAssets = new AssetServer();
const fixtureModule = option("fixture");
const fixture: PackageBrowserFixture | undefined = fixtureModule
  ? await (await import(new URL(fixtureModule, import.meta.url).href)).default(
    temporaryRoot,
  )
  : undefined;
await prepareCustomElementAssets(temporaryRoot);
if (Deno.args.includes("--programs")) {
  const target = `${temporaryRoot}/packages/the8020/dev-core/public`;
  await Deno.mkdir(target, { recursive: true });
  const source = new URL("../dev-core/public/", import.meta.url);
  for await (const file of Deno.readDir(source)) {
    if (file.isFile) {
      await Deno.copyFile(new URL(file.name, source), `${target}/${file.name}`);
    }
  }
}
const serverAbort = new AbortController();
let currentSocket: WebSocket | undefined;
let serverSequence = 0;
let connectionSequence = 0;
let processedClientSequence = 0;
let lastInteraction: UUIClientMessage | undefined;
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
const program =
  (fixture
    ? fixture.run()
    : Deno.args.includes("--native-back")
    ? runNativeBackProgram()
    : Deno.args.includes("--custom-elements")
    ? runCustomElementsProgram()
    : Deno.args.includes("--programs")
    ? runProgramsBrowser(temporaryRoot)
    : Deno.args.includes("--lists")
    ? runListsProgram()
    : runProgram()).catch(
      (error) => {
        if (!stopping) programError = error;
      },
    );

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
      ...(Deno.args.includes("--native-back")
        ? ["--window-size=1280,900"]
        : ["--headless=new", "--single-process"]),
      "--no-sandbox",
      "--no-zygote",
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
  page = await openPage(
    debugPort,
    `http://127.0.0.1:${httpPort}/${
      Deno.args.includes("--native-back") ? "before-uui" : ""
    }`,
  );
  if (Deno.args.includes("--native-back")) {
    await verifyNativeBack(page);
  } else if (fixture) {
    await fixture.verify(
      page,
      () => openPage(debugPort, `http://127.0.0.1:${httpPort}/`),
    );
  } else if (Deno.args.includes("--custom-elements")) {
    await verifyCustomElements(page);
  } else if (Deno.args.includes("--programs")) {
    await verifyProgramsBrowser(page);
  } else if (Deno.args.includes("--lists")) {
    await verifyListsFlow(page, () => currentSocket?.close());
  } else if (Deno.args.includes("--connection")) {
    await verifyConnectionFlow(page);
  } else if (Deno.args.includes("--field-help")) {
    await verifyFieldHelp(page);
  } else await verifyPresentationFlow(page);
  if (programError !== undefined) throw programError;
  assert(
    page.exceptions.length === 0,
    `browser exceptions: ${page.exceptions.join("\n")}`,
  );
  console.log(
    `${
      fixture
        ? "package fixture"
        : Deno.args.includes("--custom-elements")
        ? "custom element"
        : Deno.args.includes("--programs")
        ? Deno.args.includes("--runtime") ? "runtime program" : "program"
        : Deno.args.includes("--lists")
        ? "list"
        : Deno.args.includes("--connection")
        ? "connection"
        : Deno.args.includes("--native-back")
        ? "native Back"
        : Deno.args.includes("--field-help")
        ? "field help and icon"
        : "presentation"
    } browser E2E passed`,
  );
} catch (error) {
  if (Deno.args.includes("--lists")) {
    console.error(
      "Recent list interactions",
      JSON.stringify(listBrowserProbe.messages.slice(-12)),
    );
  }
  const state = page === undefined ? undefined : await page.evaluate(`({
      title: document.title,
      connection: document.querySelector('#connection-state')?.textContent,
      body: document.body?.innerText,
      overflow: { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, elements: [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1 && !e.closest('.data-list-scroll')).slice(0, 15).map(e => ({ tag: e.tagName, class: e.className, width: e.getBoundingClientRect().width, right: e.getBoundingClientRect().right })) },
    })`).catch(() => undefined);
  throw new Error(
    `${
      error instanceof Error ? error.stack ?? error.message : String(error)
    }; ` +
      `browser state: ${JSON.stringify(state)}; ` +
      `program error: ${String(programError ?? "none")}; ` +
      `last interaction: ${
        JSON.stringify(lastInteraction)
      }; processed: ${processedClientSequence}; ` +
      `field value: ${fieldHelpModel.data.user}; surfaces: ${
        JSON.stringify(
          retainedPresentation?.surfaces.map((surface) => ({
            id: surface.surfaceId,
            screen: surface.screen.id,
            revision: surface.screen.revision,
          })),
        )
      }`,
  );
} finally {
  stopping = true;
  page?.close();
  if (chromium !== undefined) await stopProcess(chromium);
  unbind();
  channel.close();
  await program;
  await fixture?.close();
  serverAbort.abort();
  await server.finished.catch(() => {});
  await Deno.remove(temporaryRoot, { recursive: true }).catch(() => {});
}

async function runProgram(): Promise<void> {
  while (true) {
    const event = await callScreen({
      id: "field-help-demo",
      title: "Field help",
      schema: FieldHelpScreen,
      model: fieldHelpModel,
      header: {
        actions: [{
          id: "next",
          label: "[[icon=delete]] [[icon=10k]] [[icon=rocket_launch]] Next",
        }],
      },
    });
    if (event.action === "next") break;
  }
  await runFieldGeometry();
  const screenModel = new Model({});
  sendMessage("Modal design probe");
  while (true) {
    const event = await callScreen({
      id: "presentation-page-a",
      title: "Presentation page A",
      schema: z.object({}),
      model: screenModel,
      customElements: [{
        id: "probe",
        module: "/presentation-probe.js",
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

async function runFieldGeometry(): Promise<void> {
  for (const rowSpan of [1, 2] as const) {
    await callScreen({
      id: `fields-${rowSpan}-row`,
      title: `Fields: ${rowSpan} row`,
      schema: z.object({
        liveState: field(z.string(), {
          label: "Live validation",
          length: "long",
          readOnly: true,
        }),
        messageLog: field(z.string(), {
          label: "Bounded message log",
          control: "textarea",
          length: "long",
          readOnly: true,
          ...(rowSpan === 2 ? { rowSpan } : {}),
        }),
        followingText: field(z.string(), { length: "long" }),
        editableLog: field(z.string(), {
          control: "textarea",
          rowSpan,
          description: "One reserved message line",
        }),
        enabled: field(z.boolean(), { control: "checkbox" }),
        active: field(z.boolean(), { control: "switch" }),
        level: field(z.number(), { control: "range" }),
        select: field(z.string(), {
          control: "select",
          options: [{ label: "One", value: "one" }],
        }),
        radio: field(z.string(), {
          control: "radio",
          rowSpan,
          options: ["one", "two", "three"].map((value) => ({
            label: value,
            value,
          })),
        }),
        quantity: z.number(),
        date: field(z.string(), { control: "date" }),
        datetime: field(z.string(), { control: "datetime" }),
      }),
      model: new Model({
        liveState: "LIVE",
        messageLog: JSON.stringify(
          { messages: ["Message".repeat(100)] },
          null,
          2,
        ),
        followingText: "Second ordinary row",
        editableLog: "Editable\nmessage\nlog",
        enabled: true,
        active: true,
        level: 30,
        select: "one",
        radio: "one",
        quantity: 10,
        date: "2026-09-05",
        datetime: "2026-09-05T09:30",
      }),
      layout: {
        schema: 1,
        id: "field-geometry",
        root: {
          type: "detail",
          controls: [
            "liveState",
            "messageLog",
            "followingText",
            "editableLog",
            "enabled",
            "active",
            "level",
            "select",
            "radio",
            "quantity",
            "date",
            "datetime",
          ],
        },
      },
      actions: [{ id: "next", label: "Next" }],
    });
  }
}

async function runModalB(): Promise<void> {
  await presentModal(async () => {
    const model = {
      value: "Edit this before the background redraw",
      status: "Waiting for background redraw",
    };
    const screenModel = new Model(model);
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
          model: screenModel,
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
    const screenModel = new Model(model);
    while (true) {
      const event = await callScreen({
        id: "presentation-page-d",
        title: "Presentation page D",
        schema: PresentationScreen,
        model: screenModel,
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
  const screenModel = new Model(model);
  while (true) {
    const event = await callScreen({
      id: "presentation-leaf",
      title,
      schema: PresentationScreen,
      model: screenModel,
      header: { actions: [{ id: "close", label: "Close modal" }] },
    });
    if (event.action === BACK_EVENT || event.action === "close") return;
  }
}

async function serve(request: Request): Promise<Response> {
  const supplied = await fixture?.serve(request);
  if (supplied) return supplied;
  const url = new URL(request.url);
  if (url.pathname === "/before-uui") {
    return new Response('<a href="/">Enter UUI</a>', {
      headers: { "content-type": "text/html" },
    });
  }
  if (url.pathname.startsWith(PACKAGE_ASSET_PREFIX)) {
    return await browserAssets.package(
      request,
      url.pathname.slice(PACKAGE_ASSET_PREFIX.length),
      `${temporaryRoot}/packages`,
    ) ?? new Response("not found", { status: 404 });
  }
  if (url.pathname === "/presentation-probe.js") {
    return new Response(
      `export default function ({ host, config }) { host.textContent = config.label; return { update(value) { host.textContent = value.label; } }; }`,
      { headers: { "content-type": "text/javascript" } },
    );
  }
  if (url.pathname === "/session" && Deno.args.includes("--connection")) {
    connectionRequests.push({
      method: request.method,
      route: request.method === "POST"
        ? request.headers.get("the8020-route")
        : url.searchParams.get("route"),
    });
    const rejection = connectionRejection ??
      (request.method === "POST" ? establishmentResponses.shift() : undefined);
    if (rejection !== undefined) return new Response(null, rejection);
  }
  if (url.pathname + url.search === redirectTarget) {
    // Keep the old document alive long enough to catch reconnects during navigation.
    if (request.headers.get("sec-fetch-mode") === "navigate") await delay(300);
    return new Response("<h1>Sign in</h1>", {
      status: redirectPageStatus,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  if (request.method === "POST" && url.pathname === "/session") {
    return new Response(null, {
      status: 204,
      headers: { "the8020-route": routeToken },
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
      if (message.type === "screen.event" || message.type === "screen.list") {
        lastInteraction = message;
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
  const asset = await staticAsset(request);
  return asset ?? new Response("not found", { status: 404 });
}

async function staticAsset(request: Request): Promise<Response | undefined> {
  const pathname = new URL(request.url).pathname;
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
    const response = await browserAssets.file(request, root, relative);
    if (response) return response;
  }
  return undefined;
}

async function verifyConnectionFlow(page: BrowserPage): Promise<void> {
  const origin = `http://127.0.0.1:${httpPort}`;
  const routeKey = `the8020.route:ws://127.0.0.1:${httpPort}/session`;
  const storedRoute = () =>
    page.evaluate<string | null>(
      `sessionStorage.getItem(${JSON.stringify(routeKey)})`,
    );
  const connected = () =>
    waitForPage(
      page,
      `document.querySelector('#connection-state')?.textContent === 'Connected' &&
        document.querySelector('[data-bind="user"]') !== null`,
      "connected session",
    );
  const reconnected = async (previous: number) => {
    await waitFor(
      () => connectionSequence > previous,
      "session reconnect",
      5_000,
    );
    await connected();
  };
  const redirected = async () => {
    await waitForPage(
      page,
      `location.pathname + location.search === ${
        JSON.stringify(redirectTarget)
      } &&
        document.querySelector('h1')?.textContent === 'Sign in'`,
      "server-selected redirect",
      5_000,
    );
    assertEquals(await storedRoute(), null);
  };
  await connected();

  // Lost executions are replaced through HTTP without reusing the stale route.
  connectionRequests.length = 0;
  const oldRoute = routeToken;
  routeToken = "replacement-browser-route";
  establishmentResponses.push({ status: 409 });
  let previous = connectionSequence;
  currentSocket!.close(1008, "execution lost");
  await reconnected(previous);
  assertEquals(connectionRequests, [
    { method: "POST", route: oldRoute },
    { method: "POST", route: null },
    { method: "GET", route: routeToken },
  ]);
  assertEquals(await storedRoute(), routeToken);

  // Transient establishment failure preserves both the route and dirty values.
  await setValue(page, '[data-bind="user"]', "pending edit");
  connectionRequests.length = 0;
  establishmentResponses.push({ status: 503 });
  previous = connectionSequence;
  currentSocket!.close(1008, "retry admission");
  await reconnected(previous);
  assertEquals(connectionRequests, [
    { method: "POST", route: routeToken },
    { method: "GET", route: routeToken },
  ]);
  assertEquals(
    await page.evaluate(
      `document.querySelector('[data-bind="user"]')?.value`,
    ),
    "pending edit",
  );

  // The real service declaration supplies the same redirect for HTTP and upgrades.
  const access = declaration(
    await Deno.readTextFile(
      new URL("./services/session/service.toml", import.meta.url),
    ),
  ).access;
  assertEquals(access.mode, "authenticated");
  assertEquals(access.unauthenticated.action, "redirect");
  redirectTarget = access.unauthenticated.redirect_url!;
  connectionRejection = {
    status: access.unauthenticated.status,
    headers: { location: redirectTarget, "cache-control": "no-store" },
  };
  connectionRequests.length = 0;
  currentSocket!.close(4000, "authentication expired");
  await redirected();
  assertEquals(connectionRequests, [
    { method: "GET", route: routeToken },
    { method: "POST", route: routeToken },
  ]);

  // A fresh shell honors any server-selected destination, even an error page.
  redirectTarget = "/identity/continue?reason=expired";
  redirectPageStatus = 409;
  connectionRejection = {
    status: 303,
    headers: { location: redirectTarget, "cache-control": "no-store" },
  };
  connectionRequests.length = 0;
  await page.command("Page.navigate", { url: origin });
  await redirected();
  assertEquals(connectionRequests, [{ method: "POST", route: null }]);

  // Authentication can fail between rejecting a stale route and creating its replacement.
  connectionRejection = undefined;
  await page.command("Page.navigate", { url: origin });
  await connected();
  connectionRequests.length = 0;
  establishmentResponses.push({ status: 409 }, {
    status: 302,
    headers: { location: redirectTarget, "cache-control": "no-store" },
  });
  currentSocket!.close(1008, "execution lost");
  await redirected();
  assertEquals(connectionRequests, [
    { method: "POST", route: routeToken },
    { method: "POST", route: null },
  ]);
}

async function runNativeBackProgram(): Promise<void> {
  const schema = z.object({ value: z.string() });
  async function layer(depth: number): Promise<void> {
    const model = new Model({ value: `Layer ${depth}` });
    while (true) {
      const event = await callScreen({
        id: `back-${depth}`,
        title: `Back layer ${depth}`,
        schema,
        model,
        header: { actions: [{ id: "next", label: "Next layer" }] },
      });
      if (event.action === BACK_EVENT && depth > 0) return;
      if (event.action === "next") {
        if (depth % 2 === 0) await presentPage(() => layer(depth + 1));
        else await presentModal(() => layer(depth + 1));
      }
    }
  }
  await layer(0);
}

async function verifyNativeBack(page: BrowserPage): Promise<void> {
  await page.command("Page.bringToFront");
  const inspect = (expression: string) =>
    page.evaluate<boolean>(expression, false);
  const ready = (depth: number) =>
    waitFor(
      () =>
        inspect(`(() => {
    const modal = [...document.querySelectorAll('dialog.presentation-modal[open]')].at(-1);
    const title = (modal ?? document.querySelector('#app .presentation-page-layer:not([hidden])'))?.querySelector('.screen-title')?.textContent;
    return title === 'Back layer ${depth}' && !document.querySelector('#screen-back')?.disabled && history.state?.['the8020.uui.back'] === 'guard';
  })()`),
      `native Back layer ${depth}`,
      10_000,
    );
  await waitFor(
    () => inspect(`!!document.querySelector('a')`),
    "preceding page",
    10_000,
  );
  await click(page, "a");
  await ready(0);
  for (let round = 0; round < 2; round++) {
    for (let depth = 1; depth <= 5; depth++) {
      await clickButton(page, "Next layer");
      await ready(depth);
    }
    // No interaction after traversal, including CDP userGesture assertions.
    // This exercises Chromium's history-skipping intervention, unlike history.back().
    const initial = await page.command<{ entries: Array<{ id: number }> }>(
      "Page.getNavigationHistory",
    );
    for (let depth = 4; depth >= 0; depth--) {
      const result = await new Deno.Command("xdotool", {
        args: ["key", "--clearmodifiers", "alt+Left"],
      }).output();
      assert(result.success, "native browser Back shortcut");
      await ready(depth);
      const history = await page.command<{ entries: Array<{ id: number }> }>(
        "Page.getNavigationHistory",
      );
      assertEquals(
        history.entries.map((entry) => entry.id),
        initial.entries.map((entry) => entry.id),
        "Back reuses the existing history entries",
      );
      if (depth === 3) {
        await page.command("Page.reload");
        await ready(depth);
      }
    }
    const result = await new Deno.Command("xdotool", {
      args: ["key", "--clearmodifiers", "alt+Left"],
    }).output();
    assert(result.success, "Back at the home screen");
    await ready(0);
    assert(
      await inspect(`location.pathname === '/'`),
      "Back stays in UUI instead of the preceding page",
    );
  }
}

async function verifyPresentationFlow(page: BrowserPage): Promise<void> {
  await verifyFieldHelp(page);
  await verifyFieldGeometry(page);
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

async function verifyFieldHelp(page: BrowserPage): Promise<void> {
  await waitForPage(
    page,
    `document.querySelector('[data-material-icon="rocket_launch"]') !== null`,
    "icons outside the former allowlist",
  );
  const missingIcons = await page.evaluate<string[]>(`(async () => {
    await document.fonts.load('24px "UUI Material Symbols"');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const ctx = canvas.getContext('2d');
    ctx.font = '24px "UUI Material Symbols"';
    const render = code => { ctx.clearRect(0, 0, 32, 32); ctx.fillText(String.fromCodePoint(code), 4, 26); return canvas.toDataURL(); };
    const missing = render(0x10ffff);
    return Object.entries(${
    JSON.stringify(materialSymbols.icons)
  }).filter(([,code]) => render(code) === missing).map(([name]) => name);
  })()`);
  assert(
    missingIcons.length === 0,
    `complete local font has no missing glyphs: ${missingIcons.join(", ")}`,
  );
  assert(
    await page.evaluate<boolean>(`(() => {
    const button = document.querySelector('[aria-label="View Recorded user: field help"]');
    const icon = button.querySelector('[data-material-icon="chevron_right"]');
    if (!icon) return false;
    const rect = icon.getBoundingClientRect(), bounds = button.getBoundingClientRect();
    const style = getComputedStyle(icon, '::before');
    return style.fontFamily.includes('UUI Material Symbols') && rect.width + 0.1 >= parseFloat(style.fontSize) && rect.left >= bounds.left && rect.right <= bounds.right;
  })()`),
    "read-only chevron fits its field button without clipping",
  );
  const hint = '[data-bind="user"]';
  await page.evaluate(
    `document.querySelector('${hint}').closest('.field').querySelector('.field-message').style.width = '120px'`,
  );
  await waitForPage(
    page,
    `!document.querySelector('${hint}').closest('.field').querySelector('.overflow-reveal').hidden`,
    "hint ellipsis after narrowing",
  );
  assert(
    await page.evaluate<boolean>(`(() => {
    const field = document.querySelector('${hint}').closest('.field');
    const text = field.querySelector('.field-message-text');
    text.click();
    const button = field.querySelector('.overflow-reveal');
    return !field.querySelector('.overflow-popover').matches(':popover-open') &&
      text.getAttribute('role') === null && text.tabIndex === -1 &&
      getComputedStyle(text).userSelect === 'text' &&
      getComputedStyle(button).fontSize === getComputedStyle(text).fontSize;
  })()`),
    "hint text stays selectable; only its font-sized ellipsis opens help",
  );
  await page.evaluate(
    `document.querySelector('${hint}').closest('.field').querySelector('.overflow-reveal').focus()`,
  );
  await page.command("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: " ",
    code: "Space",
    windowsVirtualKeyCode: 32,
    text: " ",
  });
  await page.command("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: " ",
    code: "Space",
    windowsVirtualKeyCode: 32,
  });
  await waitForPage(
    page,
    `document.querySelector('${hint}').closest('.field').querySelector('.overflow-popover').matches(':popover-open')`,
    "Space opens full hint",
  );
  assert(
    await page.evaluate<boolean>(
      `document.querySelector('${hint}').closest('.field').querySelector('.overflow-popover strong')?.textContent === 'who owns this work'`,
    ),
    "hint popover renders shared Markdown",
  );
  await page.command("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await page.command("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  assert(
    await page.evaluate<boolean>(
      `document.activeElement === document.querySelector('${hint}').closest('.field').querySelector('.overflow-reveal')`,
    ),
    "Escape returns focus to the hint ellipsis",
  );
  await page.evaluate(
    `document.querySelector('${hint}').closest('.field').querySelector('.field-message').style.width = '800px'`,
  );
  await waitForPage(
    page,
    `document.querySelector('${hint}').closest('.field').querySelector('.overflow-reveal').hidden`,
    "widening removes the ellipsis and its reserved space",
  );
  await page.evaluate(
    `document.querySelector('${hint}').closest('.field').querySelector('.field-message').style.removeProperty('width')`,
  );
  const modal = "dialog.presentation-modal[open]";
  await page.command("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await waitForPage(
    page,
    `document.querySelector('.screen-title')?.textContent === 'Field help' && document.querySelector('#connection-state')?.textContent === 'Connected'`,
    "field help page",
  );
  assertEquals(
    await page.evaluate(
      `(() => { const input = document.querySelector('[data-bind="amount"]'); return { type: input.type, mode: input.inputMode, value: input.value }; })()`,
    ),
    { type: "text", mode: "decimal", value: "90071992547409.91" },
    "money input preserves exact decimal strings",
  );
  await click(page, '[aria-label="Edit Amount: field help"]');
  await waitForPage(
    page,
    `document.querySelector('${modal} .screen-title')?.textContent === 'Amount'`,
    "money field help",
  );
  await setValue(page, `${modal} [data-bind="value"]`, "1.234");
  await clickButton(page, "Done");
  await waitForPage(
    page,
    `document.querySelector('${modal}') !== null && document.body.textContent.includes('exactly 2 decimal places')`,
    "money rejects excessive fractional digits",
  );
  assertEquals(fieldHelpModel.data.amount, "90071992547409.91");
  await setValue(page, `${modal} [data-bind="value"]`, "90071992547409.92");
  await clickButton(page, "Done");
  await waitForPage(
    page,
    `document.querySelectorAll('${modal}').length === 0`,
    "money help closes after a valid edit",
  );
  assertEquals(
    fieldHelpModel.data.amount,
    "90071992547409.92",
    "money editing keeps the last cent exact",
  );
  await setValue(page, '[data-bind="user"]', "user2");
  await page.evaluate(`document.querySelector('[data-bind="user"]').focus()`);
  await page.command("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "F4",
    code: "F4",
    windowsVirtualKeyCode: 115,
  });
  await page.command("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "F4",
    code: "F4",
    windowsVirtualKeyCode: 115,
  });
  await waitForPage(
    page,
    `document.querySelector('${modal} [data-bind="value"]')?.value === 'user2' && document.querySelector('${modal} .screen-description strong')?.textContent === 'who owns this work'`,
    "F4 opens the current value and Markdown help",
  );
  assertEquals(
    fieldHelpModel.data.user,
    "user2",
    "opening help flushes the inline edit",
  );
  assertEquals(
    fieldHelpRequests[0]?.limit,
    1,
    "initial measurement fetches one choice",
  );
  await waitForPage(
    page,
    `document.querySelectorAll('${modal} tr[data-row-index]').length > 1`,
    "measured choices",
  );
  await fieldHelpScreenshot(page, "desktop");
  const firstPage = fieldHelpRequests.at(-1)!;
  await click(page, `${modal} [aria-label="Page 2"]`);
  await waitFor(
    () => fieldHelpRequests.at(-1)?.offset === firstPage.limit,
    "next choice page",
    10_000,
  );
  await waitForPage(
    page,
    `document.querySelector('${modal} [aria-current="page"]')?.textContent === '2'`,
    "page two selected",
  );
  await setValue(page, `${modal} [aria-label="Search list"]`, "user1999");
  await page.command("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
  });
  await page.command("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
  });
  await waitForPage(
    page,
    `document.querySelector('${modal} tr[data-row-index="0"]')?.textContent?.includes('user1999')`,
    "searches all values",
  );
  await click(page, `${modal} tr[data-row-index="0"]`);
  await waitForPage(
    page,
    `document.querySelector('${modal} [data-bind="value"]')?.value === 'user1999'`,
    "selection fills draft",
  );
  assertEquals(
    fieldHelpModel.data.user,
    "user2",
    "selection does not commit before Done",
  );
  await clickButton(page, "Done");
  await waitForPage(
    page,
    `document.querySelectorAll('${modal}').length === 0 && document.querySelector('[data-bind="user"]')?.value === 'user1999'`,
    "choosing a value updates the original field",
  );
  assert(
    fieldHelpModel.data.user === "user1999",
    "selection changes the original model",
  );

  // Repeated identical presentations retain DOM and its live model binding.
  await page.evaluate(
    `window.__retainedNoteInput = document.querySelector('[data-bind="note"]')`,
  );
  assert(
    retainedPresentation !== undefined,
    "field-help caller presentation exists",
  );
  channel.send({
    type: "presentation.show",
    presentation: retainedPresentation!,
  });
  await page.evaluate(
    "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
  );
  assert(
    await page.evaluate<boolean>(
      `window.__retainedNoteInput === document.querySelector('[data-bind="note"]')`,
    ),
    "identical snapshot keeps the input DOM",
  );
  await setValue(page, '[data-bind="note"]', "After identical snapshot");
  await click(page, '[aria-label="Edit Note: field help"]');
  await waitForPage(
    page,
    `document.querySelector('${modal} [data-bind="value"]')?.value === 'After identical snapshot'`,
    "retained input edits the model submitted to field help",
  );
  await setValue(page, `${modal} [data-bind="value"]`, "After");
  await clickButton(page, "Done");
  await waitForPage(
    page,
    `document.querySelectorAll('${modal}').length === 0 && document.querySelector('[data-bind="note"]')?.value === 'After'`,
    "plain helper edits persist",
  );

  // Close and Escape discard invalid as well as valid drafts.
  await click(page, '[aria-label="Edit Amount: field help"]');
  await setValue(page, `${modal} [data-bind="value"]`, "invalid");
  await click(page, `${modal} .uui-dialog-close`);
  await waitForPage(
    page,
    `document.querySelector('${modal}') === null`,
    "Close discards invalid amount",
  );
  assertEquals(fieldHelpModel.data.amount, "90071992547409.92");
  await click(page, '[aria-label="Edit Note: field help"]');
  await setValue(page, `${modal} [data-bind="value"]`, "discard this");
  await pressEscape(page);
  await waitForPage(
    page,
    `document.querySelector('${modal}') === null`,
    "Escape discards draft",
  );
  assertEquals(fieldHelpModel.data.note, "After");
  const requestsBeforeReadonly = fieldHelpRequests.length;
  await click(page, '[aria-label="View Recorded user: field help"]');
  await waitForPage(
    page,
    `document.querySelector('${modal} [data-bind="value"]')?.readOnly === true && document.querySelector('${modal} [data-bind="value"]')?.value === 'user1' && !document.querySelector('${modal} [data-bind="query"]')`,
    "chevron opens read-only field help",
  );
  assert(
    fieldHelpRequests.length === requestsBeforeReadonly,
    "read-only help does not load editable choices",
  );
  assert(
    await page.evaluate<boolean>(
      `![...document.querySelectorAll('${modal} button')].some(button => button.textContent === 'Done')`,
    ),
    "read-only helper has no Done",
  );
  await clickButton(page, "Navigate");
  await waitForPage(
    page,
    `document.querySelector('#app .presentation-page-layer:not([hidden]) .screen-title')?.textContent === 'User user1'`,
    "related record opens its program",
  );
  await clickButton(page, "Back");
  await waitForPage(
    page,
    `document.querySelector('${modal} .screen-title')?.textContent === 'Recorded user'`,
    "Back restores field help",
  );
  await page.command("Page.reload");
  await waitForPage(
    page,
    `document.querySelector('${modal} [data-bind="value"]')?.value === 'user1' && document.querySelector('#connection-state')?.textContent === 'Connected'`,
    "reload restores field help",
  );
  await page.command("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await fieldHelpScreenshot(page, "mobile");
  assert(
    await page.evaluate<boolean>(
      `(() => { const box = document.querySelector('${modal}').getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth && box.bottom <= innerHeight; })()`,
    ),
    "field help fits the mobile viewport",
  );
  await pressEscape(page);
  await waitForPage(
    page,
    `document.querySelectorAll('${modal}').length === 0`,
    "Escape closes field help",
  );
  await page.command("Emulation.clearDeviceMetricsOverride");
  await clickButton(page, "Next");
}

async function fieldHelpScreenshot(
  page: BrowserPage,
  name: string,
): Promise<void> {
  if (!Deno.args.includes("--screenshots")) return;
  await waitForPage(
    page,
    `document.querySelector('dialog.presentation-modal[open]')?.inert === false`,
    "field help ready for screenshot",
  );
  const { data } = await page.command<{ data: string }>(
    "Page.captureScreenshot",
    { format: "png" },
  );
  await Deno.writeFile(
    `/tmp/uui-field-help-${name}.png`,
    Uint8Array.from(atob(data), (value) => value.charCodeAt(0)),
  );
}

async function verifyFieldGeometry(page: BrowserPage): Promise<void> {
  for (const rowSpan of [1, 2]) {
    await waitForPage(
      page,
      `document.querySelector('.screen-title')?.textContent === 'Fields: ${rowSpan} row'`,
      `${rowSpan}-row field screen`,
    );
    for (const width of [1280, 820, 390]) {
      await page.command("Emulation.setDeviceMetricsOverride", {
        width,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      });
      const failures = await page.evaluate<unknown[]>(`(() => {
        const close = (a, b) => Math.abs(a - b) < 0.5;
        return [...document.querySelectorAll('.field-group-fields > .field')].flatMap(field => {
          const gridStyle = getComputedStyle(field.parentElement);
          const rows = Number(field.dataset.fieldRowSpan);
          const height = rows * parseFloat(gridStyle.gridAutoRows) + (rows - 1) * parseFloat(gridStyle.rowGap);
          const bounds = field.getBoundingClientRect();
          const label = field.querySelector(':scope > :is(label,legend)').getBoundingClientRect();
          const shell = field.querySelector('.field-input-shell').getBoundingClientRect();
          const message = field.querySelector('.field-message').getBoundingClientRect();
          const textarea = field.querySelector('textarea');
          const input = field.querySelector('input:not([type=checkbox]):not([type=radio]):not([type=range]), select');
          const valid = close(bounds.height, height) && close(shell.bottom, message.top) &&
            close(message.bottom, bounds.bottom) &&
            (!textarea || close(textarea.getBoundingClientRect().height, height - label.height - message.height)) &&
            (!input || close(input.getBoundingClientRect().bottom, shell.bottom));
          return valid ? [] : [{ kind: field.dataset.controlKind, rows, height, field: bounds.toJSON(), shell: shell.toJSON(), message: message.toJSON() }];
        });
      })()`);
      assert(
        failures.length === 0,
        `fields clamp to their declared rows at ${width}px: ${
          JSON.stringify(failures)
        }`,
      );
      if (width === 1280) {
        assert(
          await page.evaluate<boolean>(`(() => {
            const log = document.querySelector('[data-bind=messageLog]').getBoundingClientRect();
            const aligned = document.querySelector('[data-bind=${
            rowSpan === 1 ? "liveState" : "followingText"
          }]').getBoundingClientRect();
            return Math.abs(log.bottom - aligned.bottom) < 0.5;
          })()`),
          `${rowSpan}-row textarea underline aligns with its ordinary field row`,
        );
      }
    }
    await clickButton(page, "Next");
  }
  await page.command("Emulation.clearDeviceMetricsOverride");
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
  await waitForPage(
    page,
    `document.querySelector(${
      JSON.stringify(selector)
    })?.getClientRects().length > 0 && !document.querySelector('#screen-back')?.disabled`,
    `editable input ${selector}`,
  );
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
  await waitForPage(
    page,
    `(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!(target instanceof HTMLElement) || target.closest('[inert],[hidden]') || target.disabled) return false;
    target.click();
    return true;
  })()`,
    `clickable ${selector}`,
  );
}

async function clickButton(page: BrowserPage, label: string): Promise<void> {
  await waitForPage(
    page,
    `(() => {
    const target = [...document.querySelectorAll('button')].find((item) =>
      !item.closest('[hidden],[inert]') && !item.disabled && (item.textContent?.trim() === ${
      JSON.stringify(label)
    } || item.getAttribute('aria-label') === ${JSON.stringify(label)}));
    if (!(target instanceof HTMLButtonElement)) return false;
    target.click();
    return true;
  })()`,
    `${label} button`,
  );
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
