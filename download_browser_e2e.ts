import { Model } from "./model.ts";
/** Real UUI session + built shell + native Chromium downloads, without a kernel node. */
import { assert, assertEquals } from "@std/assert";
import type {
  RequestMetadata,
  WebSocketInboundEvent,
  WebSocketSession,
} from "/p/the8020/services/http.ts";
import {
  callScreen,
  Channel,
  currentBrowser,
  defineSessionService,
  download,
  type DownloadHandle,
  nextScreenChannel,
  type StreamPolicy,
  z,
} from "./mod.ts";
import { controlSession, workerFunctions } from "./session_service.ts";
import shell from "./services/shell/service.ts";
import demoForm from "/p/the8020/demo/programs/demo-form/program.ts";

const temporaryRoot = await Deno.makeTempDir({
  prefix: "uui-download-browser-",
});
const downloadsPath = `${temporaryRoot}/downloads`;
await Deno.mkdir(downloadsPath);
const serverAbort = new AbortController();
let sessionId: string | undefined;
let programError: unknown;
let refreshing = 0;
let sourceSequence = 0;
let backendDownloadRequests = 0;
const sources = new Map<string, {
  handle: DownloadHandle;
  release(): void;
  produced: number;
  cleaned: boolean;
}>();
const sockets = new Set<BrowserSocket>();
const uploadPolicy: StreamPolicy = {
  chunkBytes: 4,
  sourceChunkBytes: 16,
  activeStreams: 2,
  streamFrames: 2,
  directionFrames: 4,
  aggregateFrames: 8,
};
let uploaded: number[] | undefined;
let uploadDone = false;
const uploadModule = `export default function mount(context) {
  const button = document.createElement('button'); button.textContent = 'Upload bytes';
  button.onclick = async () => {
    await context.channel.send('bytes',
      (async function* () { yield new Uint8Array([0, 255, 1, 2, 3, 4, 5, 128, 0]); })(),
      { policy: ${JSON.stringify(uploadPolicy)} }).done;
    button.dataset.done = 'true';
  };
  context.host.append(button); return {};
}`;
const session = defineSessionService(async ({ signal }) => {
  const model = new Model({});
  try {
    assertEquals(
      currentBrowser()?.origin,
      `http://127.0.0.1:${server.addr.port}`,
    );
    let action = "";
    while (!signal.aborted) {
      const channel = nextScreenChannel();
      const upload = new Channel();
      upload.subscribe("*", async (id, data) => {
        if (id !== "bytes" || !(data instanceof ReadableStream)) return;
        uploaded = [...new Uint8Array(await new Response(data).arrayBuffer())];
        uploadDone = true;
      });
      const pending = callScreen({
        id: "download-browser-test",
        title: `Downloads ${refreshing}`,
        schema: z.object({}),
        model,
        customElements: [{
          id: "upload",
          channel: upload,
          module: "/the8020/uui/shell/upload.js",
          config: {},
        }],
        layout: {
          schema: 1,
          id: "upload-layout",
          root: { type: "custom", customElement: "upload" },
        },
        header: {
          actions: [
            { id: "export", label: "Export" },
            { id: "failure", label: "Fail export" },
            { id: "refresh", label: "Refresh" },
            { id: "demo-form", label: "Open demo form" },
          ],
        },
      });
      if (action === "export" || action === "failure") {
        for (let count = sourceSequence === 0 ? 2 : 1; count > 0; count--) {
          const index = ++sourceSequence;
          const name = `export-${index}.bin`;
          const gate = Promise.withResolvers<void>();
          const state = {
            produced: 0,
            cleaned: false,
            release: () => gate.resolve(),
            handle: undefined as unknown as DownloadHandle,
          };
          const bytes = async function* () {
            try {
              for (let chunk = 0; chunk < 64; chunk++) {
                if (chunk === 16) {
                  await gate.promise;
                  if (action === "failure") {
                    throw new Error("Export source failed");
                  }
                }
                state.produced++;
                yield new Uint8Array(65_536).fill((chunk + index) % 251);
              }
            } finally {
              state.cleaned = true;
            }
          };
          state.handle = download(
            { filename: name, body: bytes() },
            channel.downloads,
          );
          sources.set(name, state);
        }
      }
      const event = await pending;
      action = event.action;
      if (event.action === "refresh") refreshing++;
      if (event.action === "demo-form") await demoForm();
    }
  } catch (error) {
    if (!signal.aborted) programError = error;
  }
}, {
  metadataStore: {
    create(value) {
      if (sessionId !== undefined) throw new Error("duplicate session ID");
      sessionId = value.sessionId;
      return Promise.resolve();
    },
    put(value) {
      sessionId = value.sessionId;
      return Promise.resolve();
    },
    remove() {
      sessionId = undefined;
      return Promise.resolve();
    },
  },
  completePersistent: () => Promise.resolve(),
});

const server = Deno.serve({
  hostname: "127.0.0.1",
  port: 0,
  signal: serverAbort.signal,
  onListen() {},
}, async (request) => {
  const url = new URL(request.url);
  const isSession = url.pathname.startsWith("/the8020/uui/session/");
  const prefix = isSession ? "/the8020/uui/session" : "/the8020/uui/shell";
  const metadata: RequestMetadata = {
    contextId: crypto.randomUUID(),
    serviceId: isSession ? "the8020/uui/session" : "the8020/uui/shell",
    serviceGeneration: 1,
    canonicalBasePath: prefix + "/",
    originalUrl: url.href,
    client: { ipAddress: "127.0.0.1", networkScope: "loopback" },
    persistentExecutionId: "download-browser-execution",
    persistentKeepAliveMilliseconds: 600_000,
    execution: {
      nodeId: "node",

      sandboxId: "sandbox",
      workerId: "worker",
    },
    user: { userId: "user", username: "Browser test" },
    auth: {
      authenticated: true,
      realm: "user",
      userId: "user",
      username: "Browser test",
    },
  };
  url.pathname = url.pathname.slice(prefix.length) || "/";
  const relative = new Request(url, request);
  if (!isSession && url.pathname === "/upload.js") {
    return new Response(uploadModule, {
      headers: { "Content-Type": "text/javascript" },
    });
  }
  const context = { meta: metadata, signal: request.signal };
  if (!isSession && url.pathname === "/control") {
    const control = controlSession(await request.json(), metadata.user.userId);
    return Response.json({
      ...control,
      ...(control.active ? { route: "download-browser-route" } : {}),
    });
  }
  if (request.headers.get("upgrade") === "websocket") {
    const { socket, response } = Deno.upgradeWebSocket(request, {
      protocol: "the8020.uui.v1",
    });
    const bridge = new BrowserSocket(socket);
    sockets.add(bridge);
    socket.addEventListener("close", () => sockets.delete(bridge));
    const accepted = await session.connectWebSocket(relative, context, bridge);
    assertEquals(accepted.status, 204);
    return response;
  }
  if (url.pathname.includes("/__downloads/")) backendDownloadRequests++;
  if (isSession) {
    const response = await session.fetch(relative, context);
    response.headers.set("the8020-route", "download-browser-route");
    return response;
  }
  return shell.fetch(relative, context);
});

class BrowserSocket implements WebSocketSession {
  readonly protocol = "the8020.uui.v1";
  readonly #abort = new AbortController();
  readonly #inbound: WebSocketInboundEvent[] = [];
  readonly #pending: Array<(value: WebSocketInboundEvent) => void> = [];
  readonly #outbound: Array<string | Uint8Array> = [];
  constructor(readonly socket: WebSocket) {
    socket.binaryType = "arraybuffer";
    socket.addEventListener("open", () => {
      for (const value of this.#outbound.splice(0)) this.send(value);
    });
    socket.addEventListener(
      "message",
      (event) =>
        this.#push({
          type: "message",
          data: typeof event.data === "string"
            ? event.data
            : new Uint8Array(event.data),
        }),
    );
    socket.addEventListener("close", (event) => {
      this.#abort.abort();
      this.#push({ type: "close", code: event.code, reason: event.reason });
    });
  }
  get signal(): AbortSignal {
    return this.#abort.signal;
  }
  send(value: string | Uint8Array): void {
    if (typeof value === "string") {
      const message = JSON.parse(value);
      if (message.type === "session.error") {
        console.error("Download browser session error", message);
      }
    }
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(
        typeof value === "string" ? value : new Uint8Array(value),
      );
    } else this.#outbound.push(value);
  }
  receive(): Promise<WebSocketInboundEvent> {
    const value = this.#inbound.shift();
    return value
      ? Promise.resolve(value)
      : new Promise((resolve) => this.#pending.push(resolve));
  }
  close(code = 1000, reason = ""): void {
    this.socket.close(code, reason);
  }
  #push(value: WebSocketInboundEvent): void {
    const resolve = this.#pending.shift();
    if (resolve) resolve(value);
    else this.#inbound.push(value);
  }
}

interface DownloadRecord {
  guid: string;
  suggestedFilename: string;
  state?: string;
  receivedBytes?: number;
}
class Debugger {
  readonly downloads = new Map<string, DownloadRecord>();
  readonly exceptions: unknown[] = [];
  readonly #pending = new Map<
    number,
    {
      resolve(value: Record<string, unknown>): void;
      reject(error: Error): void;
    }
  >();
  #sequence = 0;
  constructor(readonly socket: WebSocket) {
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.#pending.get(message.id);
        this.#pending.delete(message.id);
        if (message.error) pending?.reject(new Error(message.error.message));
        else pending?.resolve(message.result);
      }
      if (message.method === "Browser.downloadWillBegin") {
        this.downloads.set(message.params.guid, { ...message.params });
      }
      if (message.method === "Browser.downloadProgress") {
        Object.assign(
          this.downloads.get(message.params.guid) ?? {},
          message.params,
        );
      }
      if (message.method === "Runtime.exceptionThrown") {
        this.exceptions.push(message.params);
      }
    };
  }
  call(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<Record<string, unknown>> {
    const id = ++this.#sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 10_000);
      this.#pending.set(id, {
        resolve(value) {
          clearTimeout(timer);
          resolve(value);
        },
        reject(error) {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  async evaluate(expression: string, sessionId: string): Promise<unknown> {
    const response = await this.call("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    }, sessionId);
    if (response.exceptionDetails) {
      throw new Error(JSON.stringify(response.exceptionDetails));
    }
    return (response.result as { value?: unknown }).value;
  }
}

const browserOption = Deno.args.find((value) => value.startsWith("--browser="));
const browser = new Deno.Command(
  browserOption?.slice("--browser=".length) ?? "/usr/bin/chromium",
  {
    args: [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--remote-debugging-port=0",
      `--user-data-dir=${temporaryRoot}/profile`,
      "about:blank",
    ],
    stdout: "null",
    stderr: "null",
  },
).spawn();
let debuggerSocket: WebSocket | undefined;
try {
  const portFile = await waitFor(async () => {
    try {
      return await Deno.readTextFile(
        `${temporaryRoot}/profile/DevToolsActivePort`,
      );
    } catch {
      return undefined;
    }
  }, "browser startup");
  const version = await (await fetch(
    `http://127.0.0.1:${portFile.split("\n")[0]}/json/version`,
  )).json();
  debuggerSocket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    debuggerSocket!.onopen = () => resolve();
    debuggerSocket!.onerror = () => reject(new Error("CDP connection failed"));
  });
  const debug = new Debugger(debuggerSocket);
  await debug.call("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: downloadsPath,
    eventsEnabled: true,
  });
  const target = await debug.call("Target.createTarget", {
    url: "about:blank",
  });
  const attached = await debug.call("Target.attachToTarget", {
    targetId: target.targetId,
    flatten: true,
  });
  const sid = attached.sessionId as string;
  await debug.call("Runtime.enable", {}, sid);
  await debug.call("Page.enable", {}, sid);
  await debug.call("Page.navigate", {
    url: `http://127.0.0.1:${server.addr.port}/the8020/uui/shell/`,
  }, sid);
  await waitFor(
    () =>
      debug.evaluate(
        "document.querySelector('.screen-title')?.textContent === 'Downloads 0'",
        sid,
      ),
    "UUI first screen",
  );
  const click = async (label: string) => {
    await waitFor(
      () =>
        debug.evaluate(
          "!document.documentElement.hasAttribute('data-interaction-pending')",
          sid,
        ),
      "screen ready",
    );
    await debug.evaluate(
      `Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim() === ${
        JSON.stringify(label)
      }).click()`,
      sid,
    );
  };
  const native = async (name: string) => {
    try {
      return await waitFor(
        () =>
          [...debug.downloads.values()].find((item) =>
            item.suggestedFilename === name
          ),
        name + " native download",
      );
    } catch (error) {
      console.error(
        "Download browser state",
        await debug.evaluate(
          "({body: document.body.innerText, pending: document.documentElement.hasAttribute('data-interaction-pending'), inert: document.querySelector('#app').inert, frames: [...document.querySelectorAll('iframe')].map(f=>f.src), worker: navigator.serviceWorker.controller?.state})",
          sid,
        ),
        debug.exceptions,
        [...debug.downloads.values()],
      );
      throw error;
    }
  };
  const partial = (name: string) =>
    waitFor(async () => {
      try {
        const size =
          (await Deno.stat(`${downloadsPath}/${name}.crdownload`)).size;
        return size > 0 ? size : undefined;
      } catch {
        return undefined;
      }
    }, name + " partial bytes on disk");

  await waitFor(
    () =>
      debug.evaluate(
        "[...document.querySelectorAll('button')].some(button => button.textContent === 'Upload bytes')",
        sid,
      ),
    "upload component mounted",
  );
  await click("Upload bytes");
  await waitFor(
    () =>
      debug.evaluate(
        "document.querySelector('[data-done=true]') !== null",
        sid,
      ),
    "browser stream accepted by backend sink",
  );
  assertEquals(uploaded, [0, 255, 1, 2, 3, 4, 5, 128, 0]);
  assertEquals(uploadDone, true);

  await click("Export");
  const first = await native("export-1.bin");
  await waitFor(
    () => sources.get("export-1.bin")?.produced === 16,
    "first batch gate",
  );
  const firstPartial = await partial("export-1.bin");
  const second = await native("export-2.bin");
  await partial("export-2.bin");
  for (const name of ["export-1.bin", "export-2.bin"]) {
    sources.get(name)!.release();
  }
  await waitFor(
    () => first.state === "completed" && second.state === "completed",
    "concurrent download completion",
  );
  for (let index = 1; index <= 2; index++) {
    const bytes = await Deno.readFile(`${downloadsPath}/export-${index}.bin`);
    assertEquals(bytes.length, 4 * 1024 * 1024);
    assert(
      bytes.every((byte, offset) =>
        byte === (Math.floor(offset / 65_536) + index) % 251
      ),
    );
    await sources.get(`export-${index}.bin`)!.handle.done;
  }

  // Inspect the actual native-save owner's one-use response headers in Chromium.
  assertEquals(
    await debug.evaluate(
      `(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    const token = crypto.randomUUID(), ports = new MessageChannel();
    const url = new Promise((resolve, reject) => ports.port1.onmessage = event => {
      if (event.data.url) resolve(event.data.url);
      else if (event.data.error) reject(new Error(event.data.error));
    });
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([120])); controller.close(); } });
    registration.active.postMessage({ type: 'download.register', token, stream, filename: 'metadata.csv', contentType: 'text/csv; charset=utf-8' }, [stream, ports.port2]);
    const destination = await url, response = await fetch(destination);
    const result = { type: response.headers.get('content-type'), disposition: response.headers.get('content-disposition'), bytes: [...new Uint8Array(await response.arrayBuffer())], secondStatus: (await fetch(destination)).status };
    ports.port1.close(); return result;
  })()`,
      sid,
    ),
    {
      type: "text/csv; charset=utf-8",
      disposition: "attachment; filename*=UTF-8''metadata.csv",
      bytes: [120],
      secondStatus: 410,
    },
  );

  await click("Export");
  const replaced = await native("export-3.bin");
  await partial("export-3.bin");
  await click("Refresh");
  await sources.get("export-3.bin")!.handle.done.then(() => {
    throw new Error("replacement resolved unfinished stream");
  }, (error) => assertEquals(error.name, "AbortError"));
  sources.get("export-3.bin")!.release();
  await waitFor(
    () => replaced.state === "canceled" && sources.get("export-3.bin")!.cleaned,
    "full replacement cancels unfinished native save",
  );

  await click("Fail export");
  const failed = await native("export-4.bin");
  await partial("export-4.bin");
  sources.get("export-4.bin")!.release();
  await waitFor(
    () => failed.state === "canceled",
    "producer error fails native download",
  );
  await waitFor(
    () =>
      debug.evaluate(
        "document.body.innerText.includes('Export source failed')",
        sid,
      ),
    "background error message",
  );

  await click("Export");
  const cancelled = await native("export-5.bin");
  await partial("export-5.bin");
  await debug.call("Browser.cancelDownload", { guid: cancelled.guid });
  await sources.get("export-5.bin")!.handle.done.then(() => {
    throw new Error("cancelled transfer resolved");
  }, (error) => assertEquals(error.name, "AbortError"));
  sources.get("export-5.bin")!.release();
  await waitFor(
    () => sources.get("export-5.bin")!.cleaned,
    "cancelled generator cleanup",
  );

  await click("Export");
  const disconnected = await native("export-6.bin");
  await partial("export-6.bin");
  for (const socket of sockets) socket.close(1001, "test disconnect");
  await sources.get("export-6.bin")!.handle.done.then(() => {
    throw new Error("disconnected transfer resolved");
  }, (error) => assertEquals(error.name, "AbortError"));
  sources.get("export-6.bin")!.release();
  await waitFor(
    () => disconnected.state === "canceled",
    "disconnect fails native download",
  );
  await waitFor(
    () =>
      debug.evaluate(
        "document.querySelector('#connection-state')?.textContent === 'Connected'",
        sid,
      ),
    "UUI reconnect",
  );
  await click("Refresh");
  await waitFor(
    () =>
      debug.evaluate(
        "document.querySelector('.screen-title')?.textContent === 'Downloads 2'",
        sid,
      ),
    "screen remains usable after reconnect",
  );
  assertEquals(
    debug.downloads.size,
    6,
    "downloads must not replay on reconnect",
  );

  await click("Open demo form");
  await waitFor(
    () =>
      debug.evaluate(
        "document.querySelector('input[data-bind=downloadRows]') !== null",
        sid,
      ),
    "demo download controls",
  );
  assertEquals(
    await debug.evaluate(
      `(() => {
    const group = document.querySelector('[data-layout-id="downloads"]');
    const slider = group.querySelector('input[type="range"]');
    return {
      buttons: Array.from(group.querySelectorAll('.screen-actions button')).map(button => button.textContent.trim()),
      value: slider.value, min: slider.min, max: slider.max, step: slider.step,
      downloadButtons: Array.from(document.querySelectorAll('button')).filter(button => button.textContent.startsWith('Download ')).length,
      remainingActions: Array.from(document.querySelectorAll('.screen > .screen-actions button')).map(button => button.textContent.trim()),
    };
  })()`,
      sid,
    ),
    {
      buttons: ["Download text file", "Download calculations CSV"],
      value: "100000",
      min: "1000",
      max: "1000000",
      step: "1000",
      downloadButtons: 2,
      remainingActions: [
        "Confirm Yes/No",
        "Presentation flow",
        "Single message",
        "Message types",
        "Long Markdown",
        "Async messages",
        "Message limits",
      ],
    },
  );
  await click("Download text file");
  const sample = await native("demo-example.txt");
  await waitFor(
    () => sample.state === "completed",
    "demo text file completion",
  );
  assertEquals(
    await Deno.readTextFile(`${downloadsPath}/demo-example.txt`),
    "Hello from the 80|20 demo form!\n\nThis is a small example text file.\n",
  );

  await click("Download calculations CSV");
  const csv = await native("calculations-100000.csv");
  await waitFor(() => csv.state === "completed", "100,000-row CSV completion");
  await click("Single message");
  await waitFor(
    () =>
      debug.evaluate(
        "document.body.innerText.includes('The demo sent one informational message.')",
        sid,
      ),
    "demo remains interactive",
  );
  await waitFor(() => csv.state === "completed", "100,000-row CSV completion");
  const rows =
    (await Deno.readTextFile(`${downloadsPath}/calculations-100000.csv`))
      .trimEnd().split("\r\n");
  assertEquals(rows.length, 100_001);
  assertEquals(rows[0], "row,previous_total,total");
  for (let row = 1; row <= 100_000; row++) {
    assertEquals(
      rows[row],
      `${row},${row * (row - 1) / 2},${row * (row + 1) / 2}`,
    );
  }
  await debug.evaluate(
    `(() => {
    const slider = document.querySelector('input[data-bind=downloadRows]');
    slider.value = '1000';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  })()`,
    sid,
  );
  await click("Download calculations CSV");
  const smallCsv = await native("calculations-1000.csv");
  await waitFor(
    () => smallCsv.state === "completed",
    "slider-selected CSV completion",
  );
  const smallRows =
    (await Deno.readTextFile(`${downloadsPath}/calculations-1000.csv`))
      .trimEnd().split("\r\n");
  assertEquals(smallRows.length, 1_001);
  assertEquals(smallRows.at(-1), "1000,499500,500500");
  await click("Message types");
  await waitFor(
    () =>
      debug.evaluate(
        "document.querySelector('#messages-count')?.textContent === '4' && document.querySelectorAll('.message-toast').length === 4",
        sid,
      ),
    "four message kinds",
  );
  assertEquals(
    await debug.evaluate(
      "Array.from(document.querySelectorAll('.message-toast')).map(item => item.dataset.messageKind)",
      sid,
    ),
    ["info", "success", "warning", "error"],
  );
  await click("Long Markdown");
  await waitFor(
    () =>
      debug.evaluate(
        "document.querySelector('.message-toast-body table') !== null && document.querySelector('#messages-count')?.textContent === '4'",
        sid,
      ),
    "message Markdown table",
  );
  await click("Message limits");
  await waitFor(
    () =>
      debug.evaluate(
        "document.querySelector('#messages-count')?.textContent === '100' && document.querySelectorAll('.message-toast').length === 10",
        sid,
      ),
    "bounded message burst",
  );
  await click("Async messages");
  await waitFor(
    () =>
      debug.evaluate(
        "!document.documentElement.hasAttribute('data-interaction-pending')",
        sid,
      ),
    "async message screen ready",
  );
  await debug.evaluate(
    `(() => {
    window.__messageDraft = document.querySelector('input[data-bind=email]');
    window.__messageDraft.value = 'uncommitted-message-draft@example.test';
    window.__messageDraft.dispatchEvent(new Event('input', { bubbles: true }));
    window.__messageScreen = document.querySelector('.screen');
  })()`,
    sid,
  );
  await waitFor(
    () =>
      debug.evaluate(
        "document.querySelector('#messages-count')?.textContent === '3'",
        sid,
      ),
    "live async messages",
  );
  assertEquals(
    await debug.evaluate(
      `window.__messageScreen === document.querySelector('.screen') &&
    window.__messageDraft === document.querySelector('input[data-bind=email]') &&
    window.__messageDraft.value === 'uncommitted-message-draft@example.test' &&
    !document.documentElement.hasAttribute('data-interaction-pending')`,
      sid,
    ),
    true,
  );
  await debug.call("Page.reload", {}, sid);
  await waitFor(
    () =>
      debug.evaluate(
        "document.querySelector('#connection-state')?.textContent === 'Connected' && document.querySelector('#messages-count')?.textContent === '3'",
        sid,
      ),
    "message history reconstruction",
  );
  assertEquals(
    await debug.evaluate(
      "document.querySelectorAll('.message-toast').length",
      sid,
    ),
    0,
  );
  await debug.evaluate("document.querySelector('#messages-open').click()", sid);
  await waitFor(
    () =>
      debug.evaluate(
        "document.querySelector('#message-dialog')?.open && document.querySelector('#message-history-list')?.textContent.includes('The background task reached its checkpoint.')",
        sid,
      ),
    "reconstructed message history",
  );
  await debug.evaluate(
    "document.querySelector('#message-dialog').close()",
    sid,
  );

  // The field and its actions stay in the same card at a narrow viewport.
  await debug.call("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: false,
  }, sid);
  await waitFor(
    () =>
      debug.evaluate(
        `(() => {
    const group = document.querySelector('[data-layout-id="downloads"]');
    const bounds = group.getBoundingClientRect();
    return [group.querySelector('input'), ...group.querySelectorAll('button')].filter(element => element.getClientRects().length > 0).every(element => {
      const rect = element.getBoundingClientRect();
      return rect.left >= bounds.left && rect.right <= bounds.right && rect.top >= bounds.top && rect.bottom <= bounds.bottom;
    }) && document.documentElement.scrollWidth <= innerWidth;
  })()`,
        sid,
      ),
    "mobile download card layout",
  );
  assertEquals(backendDownloadRequests, 0);
  assertEquals(debug.exceptions, []);
  if (programError) throw programError;
  console.log(JSON.stringify({
    concurrentDownloads: 2,
    browserUpload: true,
    nativeResponseMetadataAndOneUse: true,
    verifiedBytes: 8 * 1024 * 1024,
    firstPartialBytes: firstPartial,
    screenResponsive: true,
    producerFailure: true,
    nativeCancellation: true,
    fullReplacementCancellation: true,
    reconnectWithoutReplay: true,
    demoCsvRows: [100_000, 1_000],
    demoTextFile: true,
    groupedDownloadControls: true,
    messageKindsMarkdownBurstAsyncAndReload: true,
    backendDownloadRequests,
  }));
} finally {
  for (const state of sources.values()) {
    state.release();
    state.handle.cancel();
  }
  if (sessionId) await workerFunctions["uui.session.terminate"]({ sessionId });
  const killBrowser = () => {
    try {
      browser.kill("SIGKILL");
    } catch { /* Already stopped. */ }
  };
  const shutdownTimeout = setTimeout(killBrowser, 5_000);
  try {
    // Let Chromium stop its children before removing their shared profile.
    if (debuggerSocket?.readyState === WebSocket.OPEN) {
      debuggerSocket.send(JSON.stringify({ id: 0, method: "Browser.close" }));
    } else killBrowser();
    await browser.status;
  } finally {
    clearTimeout(shutdownTimeout);
    debuggerSocket?.close();
  }
  serverAbort.abort();
  await server.finished.catch(() => {});
  await Deno.remove(temporaryRoot, { recursive: true });
}

async function waitFor<T>(
  fn: () => T | Promise<T>,
  label: string,
): Promise<NonNullable<T>> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `Timed out: ${label}; program error: ${String(programError)}`,
  );
}
