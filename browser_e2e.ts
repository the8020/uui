interface Options {
  sourceRoot: string;
  packageWorkspace: string;
  runtimeRoot: string;
  kernel: string;
  admin: string;
  browser: string;
}

interface KernelProcess {
  root: string;
  child: Deno.ChildProcess;
}

interface UISession {
  session_id: string;
  node_id: string;
  runtime_group_id: string;
  worker_id: string;
  sandbox_id: string;
  state: string;
}

interface CDPTarget {
  webSocketDebuggerUrl: string;
}

interface CDPResponse {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { message?: string };
}

interface WebSocketFrame {
  opcode: number;
  payloadData: string;
}

class BrowserPage {
  readonly exceptions: string[] = [];
  readonly websocketFrames: WebSocketFrame[] = [];
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
      if (message.method === "Network.webSocketFrameReceived") {
        const response = message.params?.response as
          | { opcode?: unknown; payloadData?: unknown }
          | undefined;
        if (
          typeof response?.opcode === "number" &&
          typeof response.payloadData === "string"
        ) {
          this.websocketFrames.push({
            opcode: response.opcode,
            payloadData: response.payloadData,
          });
        }
      }
      if (message.id === undefined) return;
      const pending = this.#pending.get(message.id);
      if (pending === undefined) return;
      this.#pending.delete(message.id);
      if (message.error !== undefined) {
        pending.reject(
          new Error(message.error.message ?? "CDP command failed"),
        );
      } else pending.resolve(message.result);
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
    await page.command("Network.enable");
    return page;
  }

  command<Result = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<Result> {
    if (this.#socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(
        new Error(`browser debugging connection is closed before ${method}`),
      );
    }
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

const options = parseOptions(Deno.args);
const temporaryRoot = await Deno.makeTempDir({ prefix: "the8020-phase1d-" });
const primaryRoot = `${temporaryRoot}/node-primary`;
const secondaryRoot = `${temporaryRoot}/node-secondary`;
const sharedDatabase = `${primaryRoot}/database/system.db`;
const browserData = `${temporaryRoot}/chromium`;
const primaryPort = await freePort();
const secondaryPort = await freePort();
const primarySSHPort = await freePort();
const secondarySSHPort = await freePort();
const debugPort = await freePort();
const kernels: KernelProcess[] = [];
let browser: Deno.ChildProcess | undefined;
const pages: BrowserPage[] = [];

try {
  await prepareWorkspaces(options, primaryRoot, secondaryRoot);
  kernels.push(
    startKernel(primaryRoot, primaryPort, primarySSHPort, sharedDatabase),
  );
  await waitForHTTP(`http://127.0.0.1:${primaryPort}/`);
  await waitForAdmin(primaryRoot);
  await waitForServices(primaryRoot, [
    "the8020/uui/login",
    "the8020/uui/session",
    "the8020/uui/shell",
  ]);
  await admin(
    primaryRoot,
    ["users.add", "admin", "--password-stdin"],
    "phase1d-password\n",
  );

  kernels.push(
    startKernel(secondaryRoot, secondaryPort, secondarySSHPort, sharedDatabase),
  );
  await waitForHTTP(`http://127.0.0.1:${secondaryPort}/`);
  await waitForAdmin(secondaryRoot);
  await waitForServices(secondaryRoot, ["the8020/uui/shell"]);

  browser = new Deno.Command(options.browser, {
    args: [
      "--headless=new",
      "--no-sandbox",
      "--no-zygote",
      "--single-process",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${browserData}`,
      "about:blank",
    ],
    stdout: "null",
    stderr: "inherit",
  }).spawn();
  await waitForHTTP(`http://127.0.0.1:${debugPort}/json/version`);

  const primaryBase = `http://127.0.0.1:${primaryPort}`;
  const first = await openPage(
    debugPort,
    `${primaryBase}/the8020/uui/shell/`,
  );
  pages.push(first);
  try {
    await waitForPage(
      first,
      `location.pathname === "/the8020/uui/login/" && document.querySelector("h1")?.textContent === "Sign in"`,
      "login redirect and form",
    );
  } catch (error) {
    const state = await first.evaluate(`({
      path: location.pathname,
      title: document.querySelector('h1')?.textContent,
      body: document.body?.innerText,
    })`);
    const services = await admin(primaryRoot, ["services.list"])
      .catch((serviceError) => ({
        error: serviceError instanceof Error
          ? serviceError.message
          : String(serviceError),
      }));
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}; state: ${
        JSON.stringify(state)
      }; services: ${JSON.stringify(services)}; ${await latestKernelLog(
        primaryRoot,
      )}`,
    );
  }
  await setValue(first, 'input[name="username"]', "admin");
  await setValue(first, 'input[name="password"]', "phase1d-password");
  await click(first, 'button[type="submit"]');
  try {
    await waitForScreen(first, "Welcome to 80|20");
  } catch (error) {
    const state = await first.evaluate(`({
      path: location.pathname,
      title: document.querySelector('h1')?.textContent,
      app: document.querySelector('#app')?.textContent,
      connection: document.querySelector('#connection-state')?.textContent
    })`);
    const sessions = await uiSessions(primaryRoot).catch(() => []);
    const serviceInspections = await Promise.all([
      "the8020/uui/login",
      "the8020/uui/shell",
      "the8020/uui/session",
    ].map(async (serviceID) => {
      try {
        return await admin(primaryRoot, ["services.inspect", serviceID]);
      } catch (inspectError) {
        return {
          service_id: serviceID,
          inspect_error: inspectError instanceof Error
            ? inspectError.message
            : String(inspectError),
        };
      }
    }));
    const kernelLog = await latestKernelLog(primaryRoot);
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}; state: ${
        JSON.stringify(state)
      }; session metadata: ${JSON.stringify(sessions)}; service inspections: ${
        JSON.stringify(serviceInspections)
      }; exceptions: ${JSON.stringify(first.exceptions)}; ${kernelLog}`,
    );
  }

  const materialAssets = await first.evaluate<
    Array<{
      path: string;
      status: number;
      contentType: string;
      length: number;
    }>
  >(`Promise.all([
    "/the8020/uui/shell/assets/material-arrow-back-24-e083cc60.svg",
    "/the8020/uui/shell/assets/material-arrow-drop-down-24-e083cc60.svg",
    "/the8020/uui/shell/assets/material-menu-24-e083cc60.svg",
    "/the8020/uui/shell/assets/material-more-vert-24-e083cc60.svg",
    "/the8020/uui/shell/assets/material-refresh-24-e083cc60.svg",
    "/the8020/uui/shell/assets/material-save-24-e083cc60.svg",
    "/the8020/uui/shell/assets/material-edit-24-a4b3c9f6.svg",
    "/the8020/uui/shell/assets/material-light-mode-24-e5b6e132.svg",
    "/the8020/uui/shell/assets/material-dark-mode-24-bab57d17.svg",
    "/the8020/uui/shell/assets/material-close-24-84ccef28.svg",
    "/the8020/uui/shell/assets/material-logout-24-84ccef28.svg",
    "/the8020/uui/shell/assets/material-tab-close-24-84ccef28.svg",
  ].map(async (path) => {
    const response = await fetch(path);
    return {
      path,
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      length: (await response.text()).length,
    };
  }))`);
  assert(
    materialAssets.every((asset) =>
      asset.status === 200 && asset.contentType === "image/svg+xml" &&
      asset.length > 0 && asset.length < 1_000
    ),
    `vendored Material assets are unavailable: ${
      JSON.stringify(materialAssets)
    }`,
  );

  const initialTheme = await first.evaluate<string>(
    `document.documentElement.dataset.theme ?? ""`,
  );
  assert(
    initialTheme === "light" || initialTheme === "dark",
    `shell selected invalid initial theme ${initialTheme}`,
  );
  await waitForPage(
    first,
    `(() => {
      const menu = document.querySelector("#session-menu");
      const toggle = document.querySelector("#session-menu-toggle");
      const username = document.querySelector("#session-username");
      const status = document.querySelector("#connection-state");
      const indicator = document.querySelector("#connection-indicator");
      const icon = document.querySelector('#session-menu-icon [data-material-icon="menu"]');
      if (!(menu instanceof HTMLDetailsElement) || !(toggle instanceof HTMLElement) ||
        !(username instanceof HTMLElement) || !(status instanceof HTMLElement) ||
        !(indicator instanceof HTMLElement) || !(icon instanceof HTMLElement)) return false;
      const indicatorStyle = getComputedStyle(indicator);
      const statusStyle = getComputedStyle(status);
      return !menu.open && username.textContent === "admin" && username.title === "admin" &&
        indicator.dataset.state === "connected" && indicatorStyle.width === "8px" &&
        indicatorStyle.height === "8px" &&
        ["rgb(20, 128, 94)", "rgb(95, 208, 170)"].includes(indicatorStyle.color) &&
        status.textContent === "Connected" && statusStyle.position === "absolute" &&
        statusStyle.width === "1px" && toggle.getAttribute("aria-expanded") === "false" &&
        toggle.getAttribute("aria-label") === "admin, Connected Open session menu" &&
        getComputedStyle(icon).maskImage !== "none";
    })()`,
    "connected username session control",
  );
  await click(first, "#session-menu-toggle");
  await waitForPage(
    first,
    `(() => {
      const menu = document.querySelector("#session-menu");
      const toggle = document.querySelector("#session-menu-toggle");
      const panel = document.querySelector("#session-menu-panel");
      const messages = document.querySelector("#messages-open");
      const theme = document.querySelector("#theme-toggle");
      const logout = document.querySelector("#session-logout");
      if (!(menu instanceof HTMLDetailsElement) || !(toggle instanceof HTMLElement) ||
        !(panel instanceof HTMLElement) || !(messages instanceof HTMLButtonElement) ||
        !(theme instanceof HTMLButtonElement) ||
        !(logout instanceof HTMLButtonElement)) return false;
      const toggleBounds = toggle.getBoundingClientRect();
      const panelBounds = panel.getBoundingClientRect();
      const actions = [messages, theme, logout];
      const labels = actions.map((action) =>
        action.querySelector(".session-menu-action-label")
      );
      const labelLefts = labels.map((label) => label?.getBoundingClientRect().left ?? -1);
      const alignedLabels = labelLefts.every((left) =>
        Math.abs(left - labelLefts[0]) < 1
      );
      return menu.open && toggle.getAttribute("aria-expanded") === "true" &&
        toggle.getAttribute("aria-label") === "admin, Connected Close session menu" &&
        getComputedStyle(panel).display === "grid" && panelBounds.top >= toggleBounds.bottom &&
        Math.abs(panelBounds.right - toggleBounds.right) < 2 &&
        actions.every((action) => getComputedStyle(action).textAlign === "left") &&
        messages.firstElementChild?.id === "messages-count" &&
        theme.firstElementChild?.getAttribute("data-material-icon")?.match(/^(light_mode|dark_mode)$/) &&
        logout.firstElementChild?.getAttribute("data-material-icon") === "logout" &&
        labels.every((label) => label instanceof HTMLElement) && alignedLabels &&
        ["Light mode", "Dark mode"].includes(theme.textContent?.trim() ?? "") &&
        logout.textContent?.trim() === "Logout";
    })()`,
    "anchored session menu",
  );
  await first.evaluate(
    `document.querySelector(".brand")?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))`,
  );
  await waitForPage(
    first,
    `document.querySelector("#session-menu")?.open === false &&
      document.querySelector("#session-menu-toggle")?.getAttribute("aria-expanded") === "false"`,
    "session menu light dismiss",
  );
  await clickSessionMenuAction(first, "#theme-toggle");
  const toggledTheme = initialTheme === "dark" ? "light" : "dark";
  await waitForPage(
    first,
    `document.documentElement.dataset.theme === ${
      JSON.stringify(toggledTheme)
    }`,
    "session shell theme toggle",
  );
  if (toggledTheme !== "dark") {
    await clickSessionMenuAction(first, "#theme-toggle");
  }
  await waitForPage(
    first,
    `document.documentElement.dataset.theme === "dark" &&
      document.querySelector("#theme-toggle")?.textContent?.trim() === "Light mode" &&
      document.querySelector("#theme-toggle")?.getAttribute("aria-pressed") === "true" &&
      document.querySelector("#theme-toggle")?.getAttribute("aria-label") === "Switch to light mode" &&
      document.querySelector('#theme-toggle [data-material-icon="dark_mode"]') === null &&
      getComputedStyle(document.querySelector('#theme-toggle [data-material-icon="light_mode"]')).maskImage !== "none" &&
      getComputedStyle(document.documentElement).getPropertyValue("--primary").trim() === "#8c8cff" &&
      getComputedStyle(document.querySelector(".navbar")).position === "sticky" &&
      getComputedStyle(document.querySelector(".screen")).borderTopWidth === "0px" &&
      getComputedStyle(document.querySelector(".screen")).paddingTop === "0px" &&
      getComputedStyle(document.querySelector(".screen")).backgroundColor === "rgba(0, 0, 0, 0)" &&
      getComputedStyle(document.querySelector(".screen")).boxShadow === "none" &&
      getComputedStyle(document.querySelector(".layout-list")).borderTopWidth === "1px" &&
      getComputedStyle(document.querySelector(".layout-list")).borderTopLeftRadius === "14px" &&
      getComputedStyle(document.querySelector(".layout-list")).borderTopRightRadius === "14px" &&
      getComputedStyle(document.querySelector(".layout-list")).paddingTop === "22px" &&
      getComputedStyle(document.querySelector(".layout-list")).backgroundColor === "rgb(25, 29, 42)" &&
      getComputedStyle(document.querySelector(".layout-list")).boxShadow.includes("rgba(0, 0, 0, 0.28)") &&
      document.querySelector(".brand")?.textContent?.trim() === "80|20" &&
      document.querySelector(".brand-mark") === null &&
      getComputedStyle(document.querySelector(".brand")).height === "30px" &&
      getComputedStyle(document.querySelector(".brand")).fontSize === "30px" &&
      getComputedStyle(document.querySelector(".brand")).fontWeight === "600" &&
      getComputedStyle(document.querySelector(".brand")).backgroundColor === "rgba(0, 0, 0, 0)" &&
      getComputedStyle(document.querySelector(".brand")).borderTopWidth === "0px" &&
      getComputedStyle(document.querySelector(".brand")).boxShadow === "none" &&
      getComputedStyle(document.querySelector(".brand-gold")).color === "rgb(242, 193, 78)" &&
      getComputedStyle(document.querySelector(".brand-pipe"), "::before").height === "24px" &&
      getComputedStyle(document.querySelector(".brand-pipe"), "::before").borderLeftWidth === "3px" &&
      getComputedStyle(document.querySelector(".brand-pipe"), "::before").borderLeftColor === getComputedStyle(document.body).color &&
      getComputedStyle(document.querySelector(".brand-pipe").nextElementSibling).color === getComputedStyle(document.body).color &&
      localStorage.getItem("the8020.uui.theme") === "dark" &&
      Object.entries(sessionStorage).some(([key, value]) => key.startsWith("the8020.uui.theme:session:") && value === "dark")`,
    "dark theme persistence in browser storage",
  );
  await first.command("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await waitForPage(
    first,
    `(() => {
      const inner = document.querySelector('.navbar-inner');
      const leading = document.querySelector('.navbar-leading');
      const program = document.querySelector('#program-header');
      const actions = document.querySelector('.navbar-actions');
      if (!(inner instanceof HTMLElement) || !(leading instanceof HTMLElement) ||
        !(program instanceof HTMLElement) || !(actions instanceof HTMLElement)) return false;
      const innerBounds = inner.getBoundingClientRect();
      const leadingBounds = leading.getBoundingClientRect();
      const actionsBounds = actions.getBoundingClientRect();
      const programStyle = getComputedStyle(program);
      const actionsStyle = getComputedStyle(actions);
      return Math.abs(actionsBounds.right - innerBounds.right) < 2 &&
        actionsBounds.left > leadingBounds.right &&
        programStyle.gridColumnStart === '2' && programStyle.gridRowStart === '1' &&
        actionsStyle.gridColumnStart === '3' && actionsStyle.gridRowStart === '1' &&
        actionsStyle.justifySelf === 'end';
    })()`,
    "wide navbar fixed-edge alignment",
  );

  await first.command("Page.addScriptToEvaluateOnNewDocument", {
    source: `(() => {
      const NativeWebSocket = window.WebSocket;
      window.WebSocket = class extends NativeWebSocket {
        constructor(...arguments_) {
          super(...arguments_);
          const protocols = arguments_[1];
          if (
            protocols === "the8020.uui.v1" ||
            (Array.isArray(protocols) && protocols.includes("the8020.uui.v1"))
          ) window.__the8020LastWebSocket = this;
        }
      };
      window.__the8020ThemeTransitions = [];
      window.__the8020FirstAnimationFrame = null;
      requestAnimationFrame((at) => {
        window.__the8020FirstAnimationFrame = at;
      });
      let previous = "";
      const record = () => {
        const theme = document.documentElement?.dataset.theme ?? "";
        if (theme === "" || theme === previous) return;
        previous = theme;
        window.__the8020ThemeTransitions.push({
          theme,
          at: performance.now(),
        });
      };
      new MutationObserver(record).observe(document, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["data-theme"],
      });
      record();
    })();`,
  });
  await clickSessionMenuAction(first, "#theme-toggle");
  await waitForPage(
    first,
    `document.documentElement.dataset.theme === "light" &&
      sessionStorage.getItem("the8020.uui.theme:initial") === "light" &&
      localStorage.getItem("the8020.uui.theme") === "light"`,
    "light theme ready for reload",
  );
  await first.command("Page.reload", { ignoreCache: true });
  await waitForScreen(first, "Welcome to 80|20");
  const websocketHook = await first.evaluate<{
    present: boolean;
    readyState?: number;
    closeType?: string;
    constructorName?: string;
    webSocketName?: string;
  }>(`(() => {
    const socket = window.__the8020LastWebSocket;
    return {
      present: socket !== undefined,
      readyState: socket?.readyState,
      closeType: typeof socket?.close,
      constructorName: socket?.constructor?.name,
      webSocketName: window.WebSocket?.name,
    };
  })()`);
  assert(
    websocketHook.present && websocketHook.readyState === 1 &&
      websocketHook.closeType === "function",
    `browser WebSocket reconnect hook is unavailable: ${
      JSON.stringify(websocketHook)
    }`,
  );
  await assertThemeInitializedBeforePaint(first, "light", "light reload");
  await waitForPage(
    first,
    `document.querySelector(".brand")?.textContent?.trim() === "80|20" &&
      getComputedStyle(document.querySelector(".brand-gold")).color === "rgb(205, 157, 0)" &&
      getComputedStyle(document.querySelector(".brand-pipe"), "::before").height === "24px" &&
      getComputedStyle(document.querySelector(".brand-pipe"), "::before").borderLeftWidth === "3px" &&
      getComputedStyle(document.querySelector(".brand-pipe"), "::before").borderLeftColor === getComputedStyle(document.body).color &&
      getComputedStyle(document.querySelector(".brand-pipe").nextElementSibling).color === getComputedStyle(document.body).color &&
      document.querySelector("#theme-toggle")?.textContent?.trim() === "Dark mode" &&
      document.querySelector("#theme-toggle")?.getAttribute("aria-label") === "Switch to dark mode" &&
      document.querySelector('#theme-toggle [data-material-icon="light_mode"]') === null &&
      getComputedStyle(document.querySelector('#theme-toggle [data-material-icon="dark_mode"]')).maskImage !== "none"`,
    "light theme gold brand and centered divider",
  );
  await clickSessionMenuAction(first, "#theme-toggle");
  await waitForPage(
    first,
    `document.documentElement.dataset.theme === "dark" &&
      sessionStorage.getItem("the8020.uui.theme:initial") === "dark" &&
      localStorage.getItem("the8020.uui.theme") === "dark"`,
    "dark theme restored after light reload proof",
  );

  const cookie = await authenticationCookie(first);
  assert(cookie.httpOnly === true, "authentication cookie is not HttpOnly");
  assert(
    cookie.value.length >= 64 && !cookie.value.includes("admin"),
    "authentication cookie is not opaque",
  );
  const shared = await fetch(
    `http://127.0.0.1:${secondaryPort}/the8020/uui/shell/`,
    {
      headers: { cookie: `${cookie.name}=${cookie.value}` },
      redirect: "manual",
    },
  );
  assert(
    shared.status === 200,
    `shared authentication state returned ${shared.status} on node two`,
  );
  await shared.body?.cancel();

  await waitForPage(
    first,
    `document.querySelectorAll(".data-list tbody tr").length >= 2`,
    "home program discovery",
  );

  const beforeKernelRestart = await waitForUISessions(primaryRoot, 1);
  const priorSessionID = beforeKernelRestart[0]!.session_id;
  const framesBeforeKernelRestart = first.websocketFrames.length;
  await stopKernel(kernels[0]!);
  kernels[0] = startKernel(
    primaryRoot,
    primaryPort,
    primarySSHPort,
    sharedDatabase,
  );
  await waitForHTTP(`http://127.0.0.1:${primaryPort}/`);
  await waitForAdmin(primaryRoot);
  await waitForServices(primaryRoot, [
    "the8020/uui/login",
    "the8020/uui/session",
    "the8020/uui/shell",
  ]);
  await waitForPage(
    first,
    `document.querySelector("#connection-state")?.textContent === "Connected" &&
      document.querySelector("h1")?.textContent?.trim() === "Welcome to 80|20" &&
      !(document.querySelector("#app")?.textContent?.includes("Opening your session") ?? false)`,
    "automatic stale-route replacement after kernel restart",
    120_000,
  );
  let afterKernelRestart: UISession[] = [];
  await waitFor(
    async () => {
      afterKernelRestart = await uiSessions(primaryRoot);
      return afterKernelRestart.some((item) =>
        item.session_id !== priorSessionID
      );
    },
    "replacement UUI session metadata after kernel restart",
    15_000,
  );
  const firstSession = afterKernelRestart.find((item) =>
    item.session_id !== priorSessionID
  );
  assert(
    firstSession !== undefined,
    "kernel restart reused a lost logical UUI session",
  );
  await waitFor(
    () => first.websocketFrames.length > framesBeforeKernelRestart,
    "replacement session frame after kernel restart",
    15_000,
  );

  if (afterKernelRestart.some((item) => item.session_id === priorSessionID)) {
    await clickRow(first, "the8020/uui/sessions");
    await waitForScreen(first, "UUI sessions");
    await clickRow(first, priorSessionID);
    await waitForScreen(first, `UUI session ${priorSessionID}`);
    await waitForPage(
      first,
      `document.querySelector('[data-bind="liveState"]')?.value?.startsWith("STALE:") === true`,
      "kernel-restart session metadata represented as stale",
    );
    await clickButton(first, "Clean stale metadata");
    await waitForScreen(first, "UUI sessions");
    const cleaned = await waitForUISessions(primaryRoot, 1);
    assert(
      cleaned[0]?.session_id === firstSession.session_id,
      "kernel-restart stale metadata cleanup removed the live session",
    );
    await clickButton(first, "Back");
    await waitForScreen(first, "Welcome to 80|20");
  }

  await clickRow(first, "the8020/dev-core/development-test");
  await waitForScreen(first, "Development test", 120_000);
  await first.command("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await waitForPage(
    first,
    `(() => {
      const leading = document.querySelector('.navbar-leading');
      const program = document.querySelector('#program-header');
      const visible = document.querySelector('#program-header-visible');
      const overflow = document.querySelector('#program-header-overflow');
      const overflowItems = document.querySelector('#program-header-overflow-items');
      const session = document.querySelector('.navbar-actions');
      const itemKey = (item) => item.textContent?.trim();
      if (!(leading instanceof HTMLElement) || !(program instanceof HTMLElement) ||
        !(visible instanceof HTMLElement) || !(overflow instanceof HTMLDetailsElement) ||
        !(overflowItems instanceof HTMLElement) || !(session instanceof HTMLElement)) return false;
      const combined = [...visible.children, ...overflowItems.children].map(itemKey);
      return Math.abs(leading.getBoundingClientRect().top - program.getBoundingClientRect().top) < 8 &&
        visible.children.length > 0 &&
        overflowItems.children.length === 6 - visible.children.length &&
        overflow.hidden === (overflowItems.children.length === 0) &&
        JSON.stringify(combined) === JSON.stringify([
          'Activate changes', 'Stop sandbox', 'Restart sandbox', 'Reset source', 'Factory reset', 'Refresh'
        ]) &&
        document.querySelector('#app .screen-actions, #app .layout-actions') === null;
    })()`,
    "wide program header shows all controls on one row",
  );
  await first.command("Emulation.setDeviceMetricsOverride", {
    width: 700,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  try {
    await waitForPage(
      first,
      `(() => {
        const leading = document.querySelector('.navbar-leading');
        const program = document.querySelector('#program-header');
        const visible = document.querySelector('#program-header-visible');
        const overflow = document.querySelector('#program-header-overflow');
        const overflowItems = document.querySelector('#program-header-overflow-items');
        const overflowToggle = overflow?.querySelector(':scope > summary');
        const itemKey = (item) => item.textContent?.trim();
        if (!(leading instanceof HTMLElement) || !(program instanceof HTMLElement) ||
          !(visible instanceof HTMLElement) || !(overflow instanceof HTMLDetailsElement) ||
          !(overflowItems instanceof HTMLElement) || !(overflowToggle instanceof HTMLElement) ||
          !(visible.lastElementChild instanceof HTMLElement)) return false;
        const combined = [...visible.children, ...overflowItems.children].map(itemKey);
        const lastVisibleBounds = visible.lastElementChild.getBoundingClientRect();
        const toggleBounds = overflowToggle.getBoundingClientRect();
        const gap = parseFloat(getComputedStyle(program).columnGap);
        return Math.abs(leading.getBoundingClientRect().top - program.getBoundingClientRect().top) < 8 &&
          visible.children.length > 0 && visible.children.length < 6 &&
          !overflow.hidden && overflowItems.children.length === 6 - visible.children.length &&
          Math.abs(toggleBounds.left - lastVisibleBounds.right - gap) < 1 &&
          JSON.stringify(combined) === JSON.stringify([
            'Activate changes', 'Stop sandbox', 'Restart sandbox', 'Reset source', 'Factory reset', 'Refresh'
          ]);
      })()`,
      "header hides a right-hand suffix at intermediate width",
    );
  } catch (error) {
    const state = await first.evaluate(`(() => {
      const bounds = (selector) => {
        const item = document.querySelector(selector);
        if (!(item instanceof HTMLElement)) return undefined;
        const rect = item.getBoundingClientRect();
        return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height };
      };
      const visible = document.querySelector('#program-header-visible');
      const overflow = document.querySelector('#program-header-overflow');
      const overflowItems = document.querySelector('#program-header-overflow-items');
      const overflowToggle = overflow?.querySelector(':scope > summary');
      const itemKey = (item) => item.textContent?.trim();
      return {
        viewport: innerWidth,
        leading: bounds('.navbar-leading'),
        program: bounds('#program-header'),
        session: bounds('.navbar-actions'),
        visible: [...(visible?.children ?? [])].map(itemKey),
        overflow: [...(overflowItems?.children ?? [])].map(itemKey),
        overflowHidden: overflow?.hidden,
      };
    })()`);
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}; state: ${
        JSON.stringify(state)
      }`,
    );
  }
  await first.command("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  try {
    await waitForPage(
      first,
      `(() => {
      const brand = document.querySelector('.brand');
      const back = document.querySelector('#screen-back');
      const leading = document.querySelector('.navbar-leading');
      const program = document.querySelector('#program-header');
      const visible = document.querySelector('#program-header-visible');
      const overflow = document.querySelector('#program-header-overflow');
      const overflowItems = document.querySelector('#program-header-overflow-items');
      const overflowToggle = overflow?.querySelector(':scope > summary');
      const session = document.querySelector('.navbar-actions');
      const sessionMenu = document.querySelector('#session-menu');
      const sessionToggle = document.querySelector('#session-menu-toggle');
      const connection = document.querySelector('#connection-indicator');
      const username = document.querySelector('#session-username');
      const sessionIcon = document.querySelector('#session-menu-icon [data-material-icon="menu"]');
      if (!(brand instanceof HTMLElement) || !(back instanceof HTMLButtonElement) ||
        !(leading instanceof HTMLElement) || !(program instanceof HTMLElement) ||
        !(visible instanceof HTMLElement) || !(overflow instanceof HTMLDetailsElement) ||
        !(overflowItems instanceof HTMLElement) || !(session instanceof HTMLElement) ||
        !(sessionMenu instanceof HTMLDetailsElement) || !(sessionToggle instanceof HTMLElement) ||
        !(connection instanceof HTMLElement) || !(username instanceof HTMLElement) ||
        !(sessionIcon instanceof HTMLElement) ||
        !(overflowToggle instanceof HTMLElement)) return false;
      const brandBounds = brand.getBoundingClientRect();
      const backBounds = back.getBoundingClientRect();
      const leadingBounds = leading.getBoundingClientRect();
      const programBounds = program.getBoundingClientRect();
      const sessionBounds = session.getBoundingClientRect();
      const sessionToggleBounds = sessionToggle.getBoundingClientRect();
      const connectionBounds = connection.getBoundingClientRect();
      const navbarBounds = session.closest('.navbar-inner')?.getBoundingClientRect();
      const toggleBounds = overflowToggle.getBoundingClientRect();
      const backIcon = back.querySelector('[data-material-icon="arrow_back"]');
      const overflowIcon = overflow.querySelector('[data-material-icon="more_vert"]');
      return !back.disabled && back.textContent?.trim() === '' &&
        back.getAttribute('aria-label') === 'Back' &&
        backIcon instanceof HTMLElement && getComputedStyle(backIcon).maskImage !== 'none' &&
        backBounds.left >= brandBounds.right &&
        !sessionMenu.open && getComputedStyle(sessionToggle).display !== 'none' &&
        connection.dataset.state === 'connected' && Math.abs(connectionBounds.width - 8) < 1 &&
        Math.abs(connectionBounds.height - 8) < 1 && username.textContent === 'admin' &&
        getComputedStyle(username).whiteSpace === 'nowrap' &&
        getComputedStyle(username).textOverflow === 'ellipsis' &&
        getComputedStyle(sessionIcon).maskImage !== 'none' &&
        navbarBounds !== undefined && navbarBounds.height <= 60 &&
        Math.abs(sessionBounds.right - navbarBounds.right) < 2 &&
        Math.abs(sessionToggleBounds.right - navbarBounds.right) < 2 &&
        sessionBounds.left >= programBounds.right &&
        Math.abs(leadingBounds.top - programBounds.top) < 8 &&
        visible.children.length === 0 && !overflow.hidden &&
        getComputedStyle(visible).display === 'none' &&
        Math.abs(toggleBounds.left - programBounds.left) < 1 &&
        overflowIcon instanceof HTMLElement && getComputedStyle(overflowIcon).maskImage !== 'none' &&
        overflowItems.children.length === 6 &&
        document.querySelector('#app .screen-actions, #app .layout-actions') === null;
      })()`,
      "narrow program header keeps one row and overflows every item",
    );
  } catch (error) {
    const state = await first.evaluate(`(() => {
      const bounds = (selector) => {
        const item = document.querySelector(selector);
        if (!(item instanceof HTMLElement)) return undefined;
        const rect = item.getBoundingClientRect();
        return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height };
      };
      const visible = document.querySelector('#program-header-visible');
      const overflow = document.querySelector('#program-header-overflow');
      const toggle = overflow?.querySelector(':scope > summary');
      return {
        viewport: innerWidth,
        navbar: bounds('.navbar-inner'),
        leading: bounds('.navbar-leading'),
        program: bounds('#program-header'),
        visible: bounds('#program-header-visible'),
        visibleDisplay: visible instanceof HTMLElement ? getComputedStyle(visible).display : undefined,
        visibleItems: visible?.children.length,
        toggle: toggle instanceof HTMLElement ? (() => {
          const rect = toggle.getBoundingClientRect();
          return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height };
        })() : undefined,
        overflowItems: document.querySelector('#program-header-overflow-items')?.children.length,
        overflowHidden: overflow?.hidden,
        session: bounds('.navbar-actions'),
      };
    })()`);
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}; state: ${
        JSON.stringify(state)
      }`,
    );
  }
  await first.evaluate(
    `document.querySelector('#program-header-overflow > summary')?.click()`,
  );
  await waitForPage(
    first,
    `(() => {
      const overflow = document.querySelector('#program-header-overflow');
      const container = document.querySelector('#program-header-overflow-items');
      if (!(overflow instanceof HTMLDetailsElement) || !(container instanceof HTMLElement) ||
        !overflow.open || container.children.length !== 6) return false;
      const containerBounds = container.getBoundingClientRect();
      const items = [...container.children].map((item) => item.getBoundingClientRect());
      return containerBounds.height > 0 &&
        containerBounds.left >= 9.5 && containerBounds.right <= innerWidth - 9.5 &&
        getComputedStyle(container).gridAutoFlow === 'row' &&
        items.slice(1).every((item, index) => item.top >= items[index].bottom + 9) &&
        items.every((item) => Math.abs(item.width - items[0].width) < 1);
    })()`,
    "program header overflow expands controls vertically",
  );
  await first.evaluate(
    `document.querySelector('#program-header-overflow > summary')?.click()`,
  );
  await first.command("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await waitForPage(
    first,
    `(() => {
      const leading = document.querySelector('.navbar-leading');
      const program = document.querySelector('#program-header');
      const visible = document.querySelector('#program-header-visible');
      const overflow = document.querySelector('#program-header-overflow');
      const overflowItems = document.querySelector('#program-header-overflow-items');
      const actions = document.querySelector('.navbar-actions');
      const inner = document.querySelector('.navbar-inner');
      const itemKey = (item) => item.textContent?.trim();
      if (!(leading instanceof HTMLElement) || !(program instanceof HTMLElement) ||
        !(visible instanceof HTMLElement) || !(overflow instanceof HTMLDetailsElement) ||
        !(overflowItems instanceof HTMLElement) ||
        !(actions instanceof HTMLElement) || !(inner instanceof HTMLElement)) return false;
      const combined = [...visible.children, ...overflowItems.children].map(itemKey);
      return Math.abs(leading.getBoundingClientRect().top - program.getBoundingClientRect().top) < 8 &&
        Math.abs(actions.getBoundingClientRect().right - inner.getBoundingClientRect().right) < 2 &&
        visible.children.length > 0 &&
        overflowItems.children.length === 6 - visible.children.length &&
        overflow.hidden === (overflowItems.children.length === 0) &&
        JSON.stringify(combined) === JSON.stringify([
          'Activate changes', 'Stop sandbox', 'Restart sandbox', 'Reset source', 'Factory reset', 'Refresh'
        ]);
    })()`,
    "wide program header restores its largest ordered prefix",
  );
  await waitForPage(
    first,
    `getComputedStyle(document.querySelector('[data-bind="state"]')).borderLeftWidth === "0px" &&
      getComputedStyle(document.querySelector('[data-bind="state"]')).borderBottomWidth === "1px" &&
      getComputedStyle(document.querySelector('[data-bind="state"]')).paddingLeft === "0px" &&
      getComputedStyle(document.querySelector('[data-bind="state"]')).paddingTop === "0px" &&
      getComputedStyle(document.querySelector('[data-bind="state"]')).paddingBottom === "0px" &&
      getComputedStyle(document.querySelector('[data-bind="state"]')).backgroundColor === "rgba(0, 0, 0, 0)"`,
    "flat read-only UUI field",
  );
  await waitForPage(
    first,
    `document.querySelector('[data-bind="state"]')?.value === "READY" &&
      document.querySelector('[data-bind="status"]')?.value === "Development sandbox created and started"`,
    "automatic development sandbox creation",
    60_000,
  );
  await waitForPage(
    first,
    `(() => {
      const status = document.querySelector(".sandbox-console-status");
      const viewport = document.querySelector(".sandbox-console-viewport");
      const screen = document.querySelector(".xterm-screen");
      const canvas = document.querySelector(".xterm-text-layer");
      if (!(viewport instanceof HTMLElement) || !(screen instanceof HTMLElement)) return false;
      return status?.textContent === "Terminal connected" &&
        canvas instanceof HTMLCanvasElement &&
        screen.getBoundingClientRect().bottom <= viewport.getBoundingClientRect().bottom + 0.5;
    })()`,
    "development sandbox browser console",
    60_000,
  );
  const consoleFrameStart = first.websocketFrames.length;
  await enterTerminal(
    first,
    `clear && printf '\\036BROWSER_CONSOLE:%s:%s\\037\\n' "$BASH_VERSION" "$TERM"`,
  );
  try {
    await waitFor(
      () =>
        websocketOutput(first, consoleFrameStart).includes(
          "\x1eBROWSER_CONSOLE:",
        ) && websocketOutput(first, consoleFrameStart).includes(
          ":xterm-256color\x1f",
        ),
      "Bash output through the browser console WebSocket",
      15_000,
    );
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}; frames: ${
        JSON.stringify(first.websocketFrames.slice(consoleFrameStart))
      }`,
    );
  }
  await dragTerminalSelection(first);
  await waitForPage(
    first,
    `document.querySelector(".sandbox-console")?.dataset.hasSelection === "true"`,
    "terminal mouse selection",
  );
  const visibleSelection = await first.evaluate<boolean>(`(() => {
    const canvas = document.querySelector(".xterm-selection-layer");
    if (!(canvas instanceof HTMLCanvasElement)) return false;
    const context = canvas.getContext("2d");
    if (context === null) return false;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] !== 0) return true;
    }
    return false;
  })()`);
  assert(visibleSelection, "terminal selection was not visibly rendered");
  await first.evaluate(
    `window.__the8020ConsoleMarker = document.querySelector(".sandbox-console")`,
  );
  const refreshFrameStart = first.websocketFrames.length;
  await clickButton(first, "Refresh");
  try {
    await waitForPage(
      first,
      `document.querySelector('[data-bind="status"]')?.value === "Refreshed" &&
        window.__the8020ConsoleMarker === document.querySelector(".sandbox-console") &&
        document.querySelector(".sandbox-console-status")?.textContent === "Terminal connected" &&
        document.documentElement.dataset.theme === "dark"`,
      "preserved browser console across screen refresh",
    );
  } catch (error) {
    const state = await first.evaluate(`({
      status: document.querySelector('[data-bind="status"]')?.value,
      same: window.__the8020ConsoleMarker === document.querySelector(".sandbox-console"),
      consoleStatus: document.querySelector(".sandbox-console-status")?.textContent,
      title: document.querySelector("h1")?.textContent
    })`);
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}; state: ${
        JSON.stringify(state)
      }; frames: ${
        JSON.stringify(first.websocketFrames.slice(refreshFrameStart))
      }`,
    );
  }
  const activationFrameStart = first.websocketFrames.length;
  await enterTerminal(
    first,
    `printf 'private admin-core change\\n' > /workspace/packages/the8020/admin-core/uui-activation-proof.txt && printf 'private demo change\\n' > /workspace/packages/the8020/demo/uui-activation-proof.txt && printf '\\036ACTIVATION_CHANGES_READY\\037\\n'`,
  );
  await waitFor(
    () =>
      websocketOutput(first, activationFrameStart).includes(
        "\x1eACTIVATION_CHANGES_READY\x1f",
      ),
    "private development changes from the browser terminal",
    15_000,
  );
  assert(
    !(await fileExists(
      `${primaryRoot}/packages/the8020/admin-core/uui-activation-proof.txt`,
    )),
    "development overlay leaked a private file into the shared admin-core repository",
  );
  assert(
    !(await fileExists(
      `${primaryRoot}/packages/the8020/demo/uui-activation-proof.txt`,
    )),
    "development overlay leaked a private file into the shared demo repository",
  );

  await clickButton(first, "Activate changes");
  await waitForScreen(first, "Activate development changes", 60_000);
  await waitForPage(
    first,
    `(() => {
      const rows = [...document.querySelectorAll('[data-layout-id="changed-packages"] tbody tr')];
      return rows.length === 2 &&
        rows.some((row) => row.textContent?.includes('the8020/admin-core') && row.textContent?.includes('1')) &&
        rows.some((row) => row.textContent?.includes('the8020/demo') && row.textContent?.includes('1')) &&
        document.querySelector('[data-bind="status"]')?.value === 'Review all private package changes before activation';
    })()`,
    "development activation preview with per-package statistics",
    60_000,
  );
  await clickButton(first, "Sync all changes");
  await waitForPage(
    first,
    `document.querySelector('[data-bind="status"]')?.value === "A commit message is required"`,
    "activation commit-message validation",
  );
  await setValue(
    first,
    '[data-bind="message"]',
    "Activate browser development changes",
  );
  await clickButton(first, "Sync all changes");
  try {
    await waitForPage(
      first,
      `document.querySelector('[data-bind="status"]')?.value === "No private changes" &&
        document.querySelectorAll('[data-layout-id="changed-packages"] tbody tr').length === 0 &&
        ![...document.querySelectorAll('button')].some((button) => button.textContent?.trim() === "Sync all changes")`,
      "UUI activation publishes every package and clears the overlay",
      120_000,
    );
  } catch (error) {
    const state = await first.evaluate(`({
      title: document.querySelector('h1')?.textContent,
      status: document.querySelector('[data-bind="status"]')?.value,
      exceptionType: document.querySelector('[data-bind="exceptionType"]')?.value,
      exceptionMessage: document.querySelector('[data-bind="message"]')?.value,
      exceptionLocation: document.querySelector('[data-bind="location"]')?.value,
      exceptionDump: document.querySelector('[data-bind="dumpText"]')?.value,
      notice: document.querySelector('#notice')?.textContent,
      noticeHidden: document.querySelector('#notice')?.hidden,
      rows: [...document.querySelectorAll('[data-layout-id="changed-packages"] tbody tr')].map((row) => row.textContent),
      caption: document.querySelector('[data-layout-id="changed-packages"] caption')?.textContent,
      buttons: [...document.querySelectorAll('button')].map((button) => button.textContent?.trim()),
      connection: document.querySelector('#connection-state')?.textContent,
    })`);
    const repositories = await Promise.all(
      ["admin-core", "demo"].map(async (packageID) => ({
        packageID,
        status: await gitOutput(
          `${primaryRoot}/packages/the8020/${packageID}`,
          ["status", "--short"],
        ).catch((gitError) => String(gitError)),
        commit: await gitOutput(
          `${primaryRoot}/packages/the8020/${packageID}`,
          ["log", "-1", "--format=%an%n%B"],
        ).catch((gitError) => String(gitError)),
      })),
    );
    const development = await admin(primaryRoot, [
      "dev-core.sandbox.inspect",
      "admin",
    ]).catch((inspectError) => ({
      error: inspectError instanceof Error
        ? inspectError.message
        : String(inspectError),
    }));
    const activations = await admin(primaryRoot, [
      "db.sql",
      `SELECT "activationId", "stage", "error" FROM "the8020__packages__activations" ORDER BY "startedAt" DESC LIMIT 3`,
    ]).catch((queryError) => ({
      error: queryError instanceof Error
        ? queryError.message
        : String(queryError),
    }));
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}; state: ${
        JSON.stringify(state)
      }; repositories: ${JSON.stringify(repositories)}; development: ${
        JSON.stringify(development)
      }; activations: ${
        JSON.stringify(activations)
      }; kernel log: ${await latestKernelLog(primaryRoot)}`,
    );
  }
  assert(
    await fileText(
      `${primaryRoot}/packages/the8020/admin-core/uui-activation-proof.txt`,
    ) === "private admin-core change\n",
    "UUI activation did not publish the admin-core private file",
  );
  assert(
    await fileText(
      `${primaryRoot}/packages/the8020/demo/uui-activation-proof.txt`,
    ) ===
      "private demo change\n",
    "UUI activation did not publish the demo private file",
  );
  for (const packageID of ["admin-core", "demo"]) {
    const commit = await gitOutput(
      `${primaryRoot}/packages/the8020/${packageID}`,
      ["log", "-1", "--format=%an%n%B"],
    );
    assert(
      commit.startsWith("admin\nActivate browser development changes\n"),
      `UUI activation did not use the username as ${packageID} commit author`,
    );
    assert(
      commit.includes("[the8020.activation]") &&
        commit.includes('"metadata_client" = "uui"'),
      `UUI activation did not append TOML metadata to ${packageID}`,
    );
  }
  await clickButton(first, "Back");
  await waitForScreen(first, "Development test", 60_000);
  await waitForPage(
    first,
    `document.querySelector(".sandbox-console-status")?.textContent === "Terminal connected"`,
    "development console reconnect after UUI activation",
    60_000,
  );
  const beforeSourceReset = await first.evaluate<string>(
    `document.querySelector('[data-bind="sandboxId"]')?.value ?? ""`,
  );
  await clickButton(first, "Reset source");
  await waitForPage(
    first,
    `document.querySelector('[data-bind="status"]')?.value === "Select Confirm destructive reset before resetting the sandbox" &&
      document.querySelector('[data-bind="sandboxId"]')?.value === ${
      JSON.stringify(beforeSourceReset)
    }`,
    "rejected unconfirmed development reset",
  );
  await setChecked(
    first,
    '[data-bind="confirmDestructive"]',
    true,
  );
  await clickButton(first, "Reset source");
  await waitForPage(
    first,
    `document.querySelector('[data-bind="state"]')?.value === "READY" &&
      document.querySelector('[data-bind="status"]')?.value === "Development source reset" &&
      document.querySelector('[data-bind="sandboxId"]')?.value === ${
      JSON.stringify(beforeSourceReset)
    } && document.querySelector('[data-bind="confirmDestructive"]')?.checked === false`,
    "confirmed development source reset",
    60_000,
  );
  const beforeFactoryReset = await first.evaluate<string>(
    `document.querySelector('[data-bind="sandboxId"]')?.value ?? ""`,
  );
  await setChecked(
    first,
    '[data-bind="confirmDestructive"]',
    true,
  );
  await clickButton(first, "Factory reset");
  await waitForPage(
    first,
    `document.querySelector('[data-bind="state"]')?.value === "READY" &&
      document.querySelector('[data-bind="status"]')?.value === "Development sandbox factory reset" &&
      document.querySelector('[data-bind="sandboxId"]')?.value === ${
      JSON.stringify(beforeFactoryReset)
    } && document.querySelector('[data-bind="confirmDestructive"]')?.checked === false`,
    "confirmed development factory reset",
    60_000,
  );
  const beforeRestart = await first.evaluate<string>(
    `document.querySelector('[data-bind="sandboxId"]')?.value ?? ""`,
  );
  await clickButton(first, "Restart sandbox");
  await waitForPage(
    first,
    `document.querySelector('[data-bind="state"]')?.value === "READY" &&
      document.querySelector('[data-bind="status"]')?.value === "Development sandbox restarted" &&
      document.querySelector('[data-bind="sandboxId"]')?.value === ${
      JSON.stringify(beforeRestart)
    }`,
    "development sandbox restart",
    60_000,
  );
  await clickButton(first, "Stop sandbox");
  await waitForPage(
    first,
    `document.querySelector('[data-bind="state"]')?.value === "STOPPED" &&
      document.querySelector('[data-bind="status"]')?.value === "Development sandbox stopped" &&
      document.querySelector('[data-bind="sandboxId"]')?.value === ${
      JSON.stringify(beforeRestart)
    }`,
    "development sandbox stop",
    60_000,
  );
  await clickButton(first, "Start sandbox");
  try {
    await waitForPage(
      first,
      `document.querySelector('[data-bind="state"]')?.value === "READY" &&
        document.querySelector('[data-bind="status"]')?.value === "Development sandbox started" &&
        document.querySelector('[data-bind="sandboxId"]')?.value?.startsWith("dev-") === true &&
        document.querySelector(".sandbox-console-status")?.textContent === "Terminal connected"`,
      "development sandbox restart after stop",
      60_000,
    );
  } catch (error) {
    const state = await first.evaluate(`({
      sandbox: document.querySelector('[data-bind="sandboxId"]')?.value,
      state: document.querySelector('[data-bind="state"]')?.value,
      status: document.querySelector('[data-bind="status"]')?.value,
      consoleStatus: document.querySelector('.sandbox-console-status')?.textContent,
      buttons: [...document.querySelectorAll('#program-header button')].map((item) => item.textContent?.trim()),
    })`);
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}; state: ${
        JSON.stringify(state)
      }`,
    );
  }
  await clickButton(first, "Back");
  await waitForScreen(first, "Welcome to 80|20");

  const evaluatorJobsBeforeBrowse = await evaluatorExecutionCount(primaryRoot);
  await clickRow(first, "the8020/admin-db/database");
  await waitForScreen(first, "Database tables");
  await waitForPage(
    first,
    `(() => {
      const rows = [...document.querySelectorAll(".data-list tbody tr")]
        .filter((row) => row.querySelector("td")?.textContent?.trim() === "the8020/demo");
      const tables = rows.map((row) => row.querySelectorAll("td")[1]?.textContent?.trim());
      return JSON.stringify(tables) === JSON.stringify(["customers", "order_items", "orders"]) &&
        rows.every((row) => row.textContent?.includes("Active") && row.textContent?.includes("Synchronized")) &&
        rows.every((row) => !row.textContent?.includes("the8020__demo__"));
    })()`,
    "synchronized demo database tables",
  );
  await clickRow(first, "orders");
  await waitForScreen(first, "the8020__demo__orders");
  await waitForPage(
    first,
    `document.querySelector('[data-bind="package"]')?.value === "the8020/demo" &&
      document.querySelector('[data-bind="tableName"]')?.value === "orders" &&
      document.querySelector('[data-bind="physicalTable"]')?.value === "the8020__demo__orders" &&
      document.querySelector('[data-bind="tableState"]')?.value === "Active" &&
      document.querySelector('[data-bind="schemaState"]')?.value === "Synchronized" &&
      document.querySelectorAll('textarea').length === 0 &&
      JSON.stringify([...document.querySelectorAll('[data-layout-id="columns"] tbody tr')]
        .map((row) => row.querySelector('td')?.textContent?.trim())) ===
        JSON.stringify(["createdAt", "updatedAt", "id", "customerId", "status", "total", "score", "receipt", "metadata"]) &&
      [...document.querySelectorAll('[data-layout-id="columns"] tbody tr')].some((row) =>
        row.textContent?.includes("total") && row.textContent?.includes("decimal(18, 2)") && row.textContent?.includes("INTEGER")) &&
      [...document.querySelectorAll('[data-layout-id="differences"] tbody tr')].some((row) =>
        row.textContent?.includes("No differences detected")) &&
      !document.querySelector('#app')?.textContent?.includes('Worker "wrk-')`,
    "human-readable database field detail",
  );
  assert(
    await evaluatorExecutionCount(primaryRoot) === evaluatorJobsBeforeBrowse,
    "ordinary database list/detail browsing launched a table evaluator job",
  );
  await clickButton(first, "Compare activated definition");
  await waitForScreen(first, "Compare the8020__demo__orders", 120_000);
  await waitForPage(
    first,
    `document.querySelector('[data-bind="definitionState"]')?.value === "Present" &&
      [...document.querySelectorAll('[data-layout-id="columns"] tbody tr')].some((row) =>
        row.textContent?.includes("total") && row.textContent?.includes("decimal(18, 2)") && row.textContent?.includes("INTEGER")) &&
      [...document.querySelectorAll('[data-layout-id="differences"] tbody tr')].some((row) =>
        row.textContent?.includes("No differences detected")) &&
      document.querySelectorAll('textarea').length === 0 &&
      !document.querySelector('#app')?.textContent?.includes('Worker "wrk-')`,
    "structured activated database definition comparison after kernel restart",
    120_000,
  );
  assert(
    await evaluatorExecutionCount(primaryRoot) ===
      evaluatorJobsBeforeBrowse + 1,
    "explicit table comparison did not launch exactly one evaluator job",
  );
  await clickButton(first, "Back");
  await waitForScreen(first, "the8020__demo__orders");
  await clickButton(first, "Synchronize");
  await waitForPage(
    first,
    `document.querySelector(".message-toast-body")?.textContent?.includes("Table synchronized") === true`,
    "database table synchronization from UUI",
  );
  await waitForPage(
    first,
    `document.documentElement.hasAttribute("data-interaction-pending") === false`,
    "database table detail refresh after synchronization",
  );
  await clickButton(first, "Back");
  await waitForScreen(first, "Database tables");
  const evaluatorJobsAfterSynchronize = await evaluatorExecutionCount(
    primaryRoot,
  );
  await clickRow(first, "customers");
  await waitForScreen(first, "the8020__demo__customers");
  await waitForPage(
    first,
    `[...document.querySelectorAll('[data-layout-id="columns"] tbody tr')].some((row) =>
      row.textContent?.includes("email") && row.textContent?.includes("text") && row.textContent?.includes("TEXT")) &&
      document.querySelectorAll('textarea').length === 0`,
    "second fast database table detail",
  );
  assert(
    await evaluatorExecutionCount(primaryRoot) ===
      evaluatorJobsAfterSynchronize,
    "re-entering database detail launched an evaluator job",
  );
  await clickButton(first, "Back");
  await waitForScreen(first, "Database tables");
  await clickButton(first, "Back");
  await waitForScreen(first, "Welcome to 80|20");

  await clickRow(first, "the8020/admin-core/packages");
  await waitForScreen(first, "Packages");
  await clickRow(first, "the8020/demo");
  await waitForScreen(first, "Package the8020/demo");
  await waitForPage(
    first,
    `document.querySelector('[data-bind="packageId"]')?.value === "the8020/demo" &&
      document.querySelector('[data-bind="repositoryStatus"]')?.value?.length > 0 &&
      [...document.querySelectorAll('[data-layout-id="services"] tbody tr')].some((item) => item.textContent?.includes("the8020/demo/variables")) &&
      [...document.querySelectorAll('[data-layout-id="programs"] tbody tr')].some((item) => item.textContent?.includes("the8020/demo/demo-form")) &&
      [...document.querySelectorAll('[data-layout-id="files"] tbody tr')].some((item) => item.textContent?.includes("package.toml")) &&
      (() => {
        const section = document.querySelector('[data-layout-id="contents-section"]');
        const title = section?.querySelector(':scope > .section-title');
        const cards = [...document.querySelectorAll('[data-layout-id="contents"] > :is(.layout-field-group, .layout-detail, .layout-list)')];
        if (!(title instanceof HTMLElement) || cards.length < 2 ||
          !(cards[0] instanceof HTMLElement) || !(cards[1] instanceof HTMLElement)) return false;
        const titleBounds = title.getBoundingClientRect();
        const firstBounds = cards[0].getBoundingClientRect();
        const secondBounds = cards[1].getBoundingClientRect();
        const titleToFirst = firstBounds.top - titleBounds.bottom;
        const firstToSecond = secondBounds.top - firstBounds.bottom;
        return Math.abs(titleToFirst - 24) < 0.5 &&
          Math.abs(firstToSecond - 24) < 0.5 &&
          Math.abs(titleToFirst - firstToSecond) < 0.5;
      })()`,
    "selected package manifest, repository, services, programs, and files",
  );
  await clickRow(first, "the8020/demo/variables");
  await waitForScreen(first, "Service the8020/demo/variables");
  const guardedHistoryLength = await first.evaluate<number>("history.length");
  await first.evaluate("history.back()");
  await waitForScreen(first, "Package the8020/demo");
  await first.evaluate("history.back()");
  await waitForScreen(first, "Packages");
  await first.evaluate("history.back()");
  await waitForScreen(first, "Welcome to 80|20");
  assert(
    await first.evaluate<boolean>(
      `history.length === ${guardedHistoryLength} &&
       history.state?.["the8020.uui.back"] === "guard" &&
       location.pathname === "/the8020/uui/shell/"`,
    ),
    "browser Back did not retain and reuse the shell history guard",
  );

  await clickRow(first, "the8020/uui/sessions");
  await waitForScreen(first, "UUI sessions");
  await waitForPage(
    first,
    `[...document.querySelectorAll(".data-list tbody tr")].some((item) => item.textContent?.includes(${
      JSON.stringify(firstSession.session_id)
    }))`,
    "UUI session in package-owned session list",
  );
  await clickRow(first, firstSession.session_id);
  await waitForScreen(first, `UUI session ${firstSession.session_id}`);
  try {
    await waitForPage(
      first,
      `document.querySelector('[data-bind="sessionId"]')?.value === ${
        JSON.stringify(firstSession.session_id)
      } &&
        document.querySelector('[data-bind="sandboxId"]')?.value === ${
        JSON.stringify(firstSession.sandbox_id)
      } &&
        document.querySelector('[data-bind="workerId"]')?.value === ${
        JSON.stringify(firstSession.worker_id)
      } &&
        document.querySelector('[data-bind="liveState"]')?.value === "LIVE" &&
        document.querySelector('[data-bind="messageLog"]')?.value?.includes('"messages"') === true`,
      "UUI package session metadata and registered Worker inspection",
    );
  } catch (error) {
    const state = await first.evaluate(`Object.fromEntries(
      ['sessionId', 'sandboxId', 'workerId', 'liveState', 'messageLog']
        .map((name) => [name, document.querySelector('[data-bind="' + name + '"]')?.value])
    )`);
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}; expected: ${
        JSON.stringify(firstSession)
      }; state: ${JSON.stringify(state)}; sessions: ${
        JSON.stringify(await uiSessions(primaryRoot).catch(() => []))
      }; ${await latestKernelLog(primaryRoot)}`,
    );
  }
  await clickButton(first, "Back");
  await waitForScreen(first, "UUI sessions");
  await clickButton(first, "Back");
  await waitForScreen(first, "Welcome to 80|20");

  await clickRow(first, "the8020/admin-core/services");
  await waitForScreen(first, "Services");
  await clickRow(first, "the8020/uui/session");
  await waitForScreen(first, "Service the8020/uui/session");
  await clickButton(first, "Back");
  await waitForScreen(first, "Services");
  await clickRow(first, "the8020/demo/variables");
  await waitForScreen(first, "Service the8020/demo/variables");
  await first.command("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await waitForPage(
    first,
    `(() => {
      const grid = document.querySelector('[data-layout-id="scaling"]');
      const cards = ['worker-threads', 'single-worker', 'replication']
        .map((id) => document.querySelector('[data-layout-id="' + id + '"]'));
      if (!(grid instanceof HTMLElement) ||
        cards.some((card) => !(card instanceof HTMLElement))) return false;
      const cardElements = cards;
      const equalHeightOnEachRow = cardElements.every((card, index) => {
        const bounds = card.getBoundingClientRect();
        return cardElements.every((peer, peerIndex) => {
          if (peerIndex === index) return true;
          const peerBounds = peer.getBoundingClientRect();
          return Math.abs(bounds.top - peerBounds.top) >= 2 ||
            Math.abs(bounds.height - peerBounds.height) < 2;
        });
      });
      const insetBorderTitles = cardElements.every((card) => {
        const title = card.querySelector(':scope > .group-title');
        const contents = card.querySelector(':scope > .field-group-fields');
        if (!(title instanceof HTMLElement) || !(contents instanceof HTMLElement)) return false;
        const bounds = card.getBoundingClientRect();
        const titleBounds = title.getBoundingClientRect();
        const contentsBounds = contents.getBoundingClientRect();
        const cardStyle = getComputedStyle(card);
        const titleStyle = getComputedStyle(title);
        const titleOutline = getComputedStyle(title, '::before');
        const titleLeftContinuation = getComputedStyle(title, '::after');
        return Math.abs(titleBounds.top + titleBounds.height / 2 - bounds.top) < 2 &&
          Math.abs(titleBounds.left - bounds.left) < 2 &&
          titleStyle.fontSize === '16px' && titleStyle.fontWeight === '600' &&
          titleStyle.borderTopLeftRadius === '10px' &&
          titleStyle.borderTopRightRadius === '20px' &&
          titleStyle.paddingLeft === '12.48px' &&
          titleStyle.paddingRight === '24px' &&
          cardStyle.paddingLeft === titleStyle.paddingLeft &&
          cardStyle.paddingRight === titleStyle.paddingRight &&
          Math.abs(contentsBounds.left - bounds.left - 1 - parseFloat(titleStyle.paddingLeft)) < 1 &&
          Math.abs(bounds.right - contentsBounds.right - 1 - parseFloat(titleStyle.paddingRight)) < 1 &&
          titleStyle.textAlign === 'left' &&
          titleOutline.borderLeftWidth === '1px' &&
          titleOutline.borderBottomWidth === '0px' &&
          titleOutline.clipPath !== 'none' &&
          titleLeftContinuation.borderLeftWidth === '1px' &&
          titleLeftContinuation.borderRightWidth === '0px';
      });
      const section = document.querySelector('[data-layout-id="scaling-section"]');
      const sectionTitle = section?.querySelector(':scope > .section-title');
      const lifecycleSection = document.querySelector('[data-layout-id="lifecycle-section"]');
      const lifecycleTitle = lifecycleSection?.querySelector(':scope > .section-title');
      const serviceType = document.querySelector('[data-bind="serviceType"]');
      const sessionKeepAlive = document.querySelector('[data-bind="sessionKeepAlive"]');
      const screenTitle = document.querySelector('.screen > .screen-title');
      const screenLayout = document.querySelector('.screen > .layout-stack');
      const readOnly = document.querySelector('[data-bind="serviceId"]');
      const readOnlyCheckbox = document.querySelector('[data-bind="enabled"]');
      const editable = document.querySelector('[data-bind="minimumWorkers"]');
      const maximumWorkers = document.querySelector('[data-bind="maximumWorkers"]');
      const slider = document.querySelector('[data-bind="targetUtilization"]');
      const sliderValue = slider?.closest('.field-input-shell')?.querySelector('.field-range-value');
      const fieldLabel = editable?.closest('.field')?.querySelector(':scope > label');
      if (!(readOnly instanceof HTMLElement) ||
        !(readOnlyCheckbox instanceof HTMLInputElement) ||
        !(editable instanceof HTMLElement) ||
        !(maximumWorkers instanceof HTMLInputElement) ||
        !(slider instanceof HTMLInputElement) ||
        !(sliderValue instanceof HTMLOutputElement) ||
        !(fieldLabel instanceof HTMLLabelElement)) return false;
      const fieldLabelStyle = getComputedStyle(fieldLabel);
      const flat = [readOnly, editable].every((control) => {
        const style = getComputedStyle(control);
        return style.backgroundColor === 'rgba(0, 0, 0, 0)' &&
          style.borderTopWidth === '0px' && style.borderInlineStartWidth === '0px' &&
          style.borderInlineEndWidth === '0px' && style.borderBottomWidth === '1px';
      });
      const readOnlyIcon = readOnly.closest('.field')?.querySelector('.field-edit-icon');
      const readOnlyCheckboxShell = readOnlyCheckbox.closest('.field-input-shell');
      const readOnlyCheckboxIcon = readOnlyCheckbox.closest('.field')?.querySelector('.field-edit-icon');
      const editableIcon = editable.closest('.field')?.querySelector('.field-edit-icon');
      const sliderIcon = slider.closest('.field')?.querySelector('.field-edit-icon');
      const editableShell = editable.closest('.field-input-shell');
      const sliderShell = slider.closest('.field-input-shell');
      const maximumField = maximumWorkers.closest('.field');
      const sliderField = slider.closest('.field');
      const maximumMessage = maximumField?.querySelector(':scope > .field-message');
      const sliderMessage = sliderField?.querySelector(':scope > .field-message');
      const maximumHint = maximumMessage?.querySelector('.field-message-trigger');
      const iconStyle = editableIcon instanceof HTMLElement
        ? getComputedStyle(editableIcon)
        : undefined;
      const readOnlyCheckboxStyle = getComputedStyle(readOnlyCheckbox);
      const readOnlyCheckboxShellStyle = readOnlyCheckboxShell instanceof HTMLElement
        ? getComputedStyle(readOnlyCheckboxShell)
        : undefined;
      const sliderStyle = getComputedStyle(slider);
      const pencilAtEnd = editableIcon instanceof HTMLElement &&
        editableShell instanceof HTMLElement &&
        Math.abs(editableShell.getBoundingClientRect().right - editableIcon.getBoundingClientRect().right) < 1;
      const sliderPencilAtEnd = sliderIcon instanceof HTMLElement &&
        sliderShell instanceof HTMLElement &&
        Math.abs(sliderShell.getBoundingClientRect().right - sliderIcon.getBoundingClientRect().right) < 1;
      const sliderValueOnLeft = sliderValue.getBoundingClientRect().right <
        slider.getBoundingClientRect().left && sliderValue.nextElementSibling === slider;
      const reservedMessageRows = maximumField instanceof HTMLElement &&
        sliderField instanceof HTMLElement && maximumMessage instanceof HTMLElement &&
        sliderMessage instanceof HTMLElement && maximumHint instanceof HTMLElement &&
        sliderShell instanceof HTMLElement &&
        maximumMessage.dataset.messageKind === 'hint' &&
        sliderMessage.dataset.messageKind === 'none' &&
        sliderMessage.querySelector('.field-message-trigger') === null &&
        Math.abs(maximumField.getBoundingClientRect().height -
          sliderField.getBoundingClientRect().height) < 0.5 &&
        Math.abs(maximumMessage.getBoundingClientRect().height -
          sliderMessage.getBoundingClientRect().height) < 0.5 &&
        Math.abs(maximumWorkers.getBoundingClientRect().bottom -
          sliderShell.getBoundingClientRect().bottom) < 0.5 &&
        getComputedStyle(maximumHint).whiteSpace === 'nowrap' &&
        getComputedStyle(maximumHint).textOverflow === 'ellipsis' &&
        maximumHint.scrollHeight <= maximumHint.clientHeight + 1 &&
        maximumHint.scrollWidth > maximumHint.clientWidth;
      return grid.children.length === 3 &&
        cardElements.every((card) => card.parentElement === grid) &&
        equalHeightOnEachRow && insetBorderTitles && flat && reservedMessageRows &&
        screenTitle?.textContent === 'Service the8020/demo/variables' &&
        screenLayout instanceof HTMLElement &&
        getComputedStyle(screenLayout).marginTop === '32px' &&
        sectionTitle?.textContent === 'Scaling' &&
        sectionTitle instanceof HTMLElement &&
        getComputedStyle(sectionTitle).marginBottom === '0px' &&
        lifecycleTitle?.textContent === 'Lifecycle' &&
        document.querySelector('[data-layout-id="service-lifecycle"] > .group-title')?.textContent === 'Service lifecycle' &&
        serviceType instanceof HTMLSelectElement && !serviceType.disabled &&
        sessionKeepAlive === null &&
        document.querySelector('[data-bind*="replica" i], [data-bind*="instance" i]') === null &&
        document.querySelector('[data-layout-id="identity"] > .group-title')?.textContent === 'Status' &&
        document.querySelector('[data-layout-id="sandboxes"] > .group-title')?.textContent === 'Sandboxes' &&
        document.querySelector('.field-group-title, .region-title') === null &&
        fieldLabelStyle.color === 'rgb(166, 174, 194)' &&
        fieldLabelStyle.fontSize === '11.2px' &&
        fieldLabelStyle.fontWeight === '800' &&
        fieldLabelStyle.letterSpacing === '0.672px' &&
        fieldLabelStyle.textTransform === 'uppercase' &&
        readOnlyIcon === null && editableIcon instanceof HTMLElement &&
        readOnlyCheckbox.type === 'checkbox' && readOnlyCheckbox.disabled &&
        readOnlyCheckboxIcon === null && readOnlyCheckboxStyle.appearance === 'none' &&
        readOnlyCheckboxStyle.opacity === '1' &&
        readOnlyCheckboxShellStyle?.borderBottomWidth === '1px' &&
        pencilAtEnd &&
        editableIcon.dataset.materialIcon === 'edit' &&
        iconStyle?.opacity === '0.78' &&
        (iconStyle.maskImage !== 'none' || iconStyle.webkitMaskImage !== 'none') &&
        editable instanceof HTMLInputElement && editable.type === 'number' &&
        slider.type === 'range' && slider.min === '1' && slider.max === '100' &&
        slider.step === '0.1' && slider.value === '70' &&
        slider.getAttribute('aria-valuetext') === '70%' &&
        sliderValue.value === '70%' &&
        sliderStyle.appearance === 'none' && sliderStyle.opacity === '1' &&
        sliderStyle.paddingInlineEnd === '0px' &&
        sliderStyle.backgroundImage.includes('linear-gradient') &&
        sliderStyle.backgroundSize.includes('calc(100% - 14px)') &&
        slider.style.getPropertyValue('--range-progress').endsWith('%') &&
        sliderValueOnLeft && sliderIcon instanceof HTMLElement &&
        sliderPencilAtEnd && sliderIcon.dataset.materialIcon === 'edit' &&
        iconStyle.maskSize.includes('19.2px');
    })()`,
    "unified field groups and editable field affordances",
  );
  await first.evaluate(`document.querySelector('[data-bind="maximumWorkers"]')
    ?.closest('.field')?.querySelector('.field-message')
    ?.scrollIntoView({ block: 'center' })`);
  const openedServiceHint = await first.evaluate<boolean>(`(() => {
    const field = document.querySelector('[data-bind="maximumWorkers"]')?.closest('.field');
    const trigger = field?.querySelector('.field-message-trigger');
    const popover = field?.querySelector('.field-message-popover');
    if (!(trigger instanceof HTMLElement) || !(popover instanceof HTMLElement)) return false;
    trigger.click();
    const triggerBounds = trigger.getBoundingClientRect();
    const popoverBounds = popover.getBoundingClientRect();
    const besideHint = Math.abs(popoverBounds.left - triggerBounds.left) < 2 &&
      (Math.abs(popoverBounds.top - triggerBounds.bottom - 6) < 2 ||
        Math.abs(popoverBounds.bottom - triggerBounds.top + 6) < 2);
    return popover.matches(':popover-open') && besideHint &&
      popover.textContent?.trim() ===
        'Zero is unlimited at the service level; kernel sandbox and resource limits still apply.';
  })()`);
  assert(
    openedServiceHint,
    "clicking a service field hint did not open its full text",
  );
  await waitForPage(
    first,
    `(() => {
      const field = document.querySelector('[data-bind="maximumWorkers"]')?.closest('.field');
      const trigger = field?.querySelector('.field-message-trigger');
      const popover = field?.querySelector('.field-message-popover');
      return trigger?.getAttribute('aria-expanded') === 'true' &&
        popover?.matches(':popover-open') === true;
    })()`,
    "accessible service field hint popover",
  );
  await first.evaluate(`document.querySelector('[data-bind="maximumWorkers"]')
    ?.closest('.field')?.querySelector('.field-message-trigger')?.click()`);
  await setValue(first, '[data-bind="serviceType"]', "session");
  await waitForPage(
    first,
    `document.querySelector('[data-bind="serviceType"]')?.value === "session" &&
      document.querySelector('[data-bind="sessionKeepAlive"]') instanceof HTMLInputElement &&
      !document.querySelector('[data-bind="sessionKeepAlive"]').disabled`,
    "editable session lifecycle controls",
  );
  await setValue(first, '[data-bind="serviceType"]', "stateless");
  await waitForPage(
    first,
    `document.querySelector('[data-bind="serviceType"]')?.value === "stateless" &&
      document.querySelector('[data-bind="sessionKeepAlive"]') === null`,
    "stateless lifecycle hides only its session control",
  );
  await clickButton(first, "Enable");
  await waitForPage(
    first,
    `[...document.querySelectorAll("button")].some((item) => item.textContent?.trim() === "Disable")`,
    "service enable through Deno admin bus",
    30_000,
  );
  await setValue(first, '[data-bind="targetUtilization"]', "100");
  await waitForPage(
    first,
    `(() => {
      const slider = document.querySelector('[data-bind="targetUtilization"]');
      const output = slider?.closest('.field-input-shell')?.querySelector('.field-range-value');
      return slider instanceof HTMLInputElement &&
        output instanceof HTMLOutputElement && slider.value === '100' &&
        slider.style.getPropertyValue('--range-progress') === '100%' &&
        slider.getAttribute('aria-valuetext') === '100%' && output.value === '100%';
    })()`,
    "range endpoint value, fill, and label synchronization",
  );
  await setValue(first, '[data-bind="minimumWorkers"]', "2");
  await setValue(first, '[data-bind="targetUtilization"]', "65");
  await clickButton(first, "Save");
  let managedSandbox = "";
  await waitFor(
    async () => {
      const inspected = await admin(primaryRoot, [
        "services.inspect",
        "the8020/demo/variables",
      ]);
      const service = inspected.service as {
        worker_count?: number;
        sandboxes?: Array<{ sandbox_id?: string }>;
        effective_configuration?: {
          scaling?: {
            minimum_workers?: number;
            target_utilization?: number;
          };
        };
      };
      managedSandbox = service.sandboxes?.[0]?.sandbox_id ?? "";
      return service.worker_count === 2 &&
        service.effective_configuration?.scaling?.minimum_workers ===
          2 &&
        service.effective_configuration?.scaling?.target_utilization ===
          0.65 &&
        managedSandbox.length > 0;
    },
    "service capacity mutation through Deno admin bus",
    30_000,
    250,
  );
  await waitForPage(
    first,
    `[...document.querySelectorAll(".data-list tbody tr")].some((item) => item.textContent?.includes(${
      JSON.stringify(managedSandbox)
    }))`,
    "scaled service sandbox in refreshed detail screen",
    30_000,
  );
  await clickRow(first, managedSandbox);
  await waitForScreen(first, `Sandbox ${managedSandbox}`);
  await waitForPage(
    first,
    `(() => {
      const fields = document.querySelector('[data-layout-id="identity"] .field-group-fields');
      const failure = document.querySelector('[data-bind="failure"]')?.closest('.field');
      if (!(fields instanceof HTMLElement) || !(failure instanceof HTMLElement)) return false;
      const container = fields.getBoundingClientRect();
      const failureBounds = failure.getBoundingClientRect();
      const startsOnHalf = (field) => {
        const ratio = (field.getBoundingClientRect().left - container.left) / container.width;
        return Math.abs(ratio) < 0.02 || Math.abs(ratio - 0.5) < 0.02;
      };
      const longFields = [...fields.querySelectorAll('[data-field-length="long"]')];
      const label = failure.querySelector('label');
      const value = failure.querySelector('.field-input-shell');
      return Math.abs((failureBounds.left - container.left) / container.width - 0.5) < 0.02 &&
        longFields.every((field) => field instanceof HTMLElement && startsOnHalf(field)) &&
        getComputedStyle(failure).rowGap === '0px' &&
        label instanceof HTMLElement && value instanceof HTMLElement &&
        Math.abs(value.getBoundingClientRect().top - label.getBoundingClientRect().bottom) < 1;
    })()`,
    "sandbox field grid half-boundary alignment",
  );
  await clickButton(first, "Back");
  await waitForScreen(first, "Service the8020/demo/variables");
  await clickButton(first, "Back");
  await waitForScreen(first, "Services");
  await clickButton(first, "Back");
  await waitForScreen(first, "Welcome to 80|20");

  await clickRow(first, "the8020/admin-core/sandboxes");
  await waitForScreen(first, "Sandboxes");
  const rapidInteractionState = await first.evaluate<Record<string, unknown>>(
    `(() => {
    const row = [...document.querySelectorAll(".data-list tbody tr")].find((item) =>
      item.textContent?.includes(${JSON.stringify(managedSandbox)}));
    const app = document.querySelector("#app");
    const header = document.querySelector("#program-header");
    const back = document.querySelector("#screen-back");
    const shield = document.querySelector("#interaction-shield");
    const indicator = document.querySelector(".interaction-indicator");
    if (!(row instanceof HTMLTableRowElement) || !(app instanceof HTMLElement) ||
      !(header instanceof HTMLElement) || !(back instanceof HTMLButtonElement) ||
      !(shield instanceof HTMLElement) || !(indicator instanceof HTMLElement)) return { found: false };
    row.click();
    row.click();
    row.click();
    const shieldStyle = getComputedStyle(shield);
    const indicatorStyle = getComputedStyle(indicator);
    return {
      found: true,
      pending: document.documentElement.hasAttribute("data-interaction-pending"),
      appInert: app.inert,
      headerInert: header.inert,
      backDisabled: back.disabled,
      pointerEvents: shieldStyle.pointerEvents,
      backgroundColor: shieldStyle.backgroundColor,
      backdropFilter: shieldStyle.backdropFilter,
      shieldDelay: shieldStyle.transitionDelay,
      indicatorOpacity: indicatorStyle.opacity,
      indicatorDelay: indicatorStyle.transitionDelay,
    };
  })()`,
  );
  assert(
    rapidInteractionState.found === true &&
      rapidInteractionState.pending === true &&
      rapidInteractionState.appInert === true &&
      rapidInteractionState.headerInert === true &&
      rapidInteractionState.backDisabled === true &&
      rapidInteractionState.pointerEvents === "auto" &&
      (rapidInteractionState.backgroundColor === "rgba(0, 0, 0, 0)" ||
        String(rapidInteractionState.backgroundColor).endsWith("/ 0)")) &&
      rapidInteractionState.backdropFilter === "blur(0px)" &&
      String(rapidInteractionState.shieldDelay).includes("0.5s") &&
      rapidInteractionState.indicatorOpacity === "0" &&
      String(rapidInteractionState.indicatorDelay).includes("0.5s"),
    `rapid screen events were not immediately and invisibly blocked: ${
      JSON.stringify(rapidInteractionState)
    }`,
  );
  await waitForScreen(first, `Sandbox ${managedSandbox}`);
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert(
    await first.evaluate<boolean>(`(() => {
      const notice = document.querySelector("#notice");
      const app = document.querySelector("#app");
      return !document.documentElement.hasAttribute("data-interaction-pending") &&
        app instanceof HTMLElement && !app.inert &&
        !notice?.textContent?.includes("screen identity or revision mismatch");
    })()`),
    "rapid screen events escaped the interaction lock",
  );
  await first.evaluate(
    `document.documentElement.toggleAttribute("data-interaction-pending", true)`,
  );
  await waitForPage(
    first,
    `(() => {
      const shield = document.querySelector("#interaction-shield");
      const indicator = document.querySelector(".interaction-indicator");
      if (!(shield instanceof HTMLElement) || !(indicator instanceof HTMLElement)) return false;
      const shieldStyle = getComputedStyle(shield);
      return shieldStyle.backgroundColor !== "rgba(0, 0, 0, 0)" &&
        shieldStyle.backdropFilter === "blur(3px)" &&
        getComputedStyle(indicator).opacity === "1";
    })()`,
    "delayed interaction loading feedback",
  );
  await first.evaluate(
    `document.documentElement.removeAttribute("data-interaction-pending")`,
  );
  await clickRow(first, "the8020/demo/variables");
  await waitForScreen(first, "Service the8020/demo/variables");
  await clickButton(first, "Back");
  await waitForScreen(first, `Sandbox ${managedSandbox}`);
  await clickButton(first, "Back");
  await waitForScreen(first, "Sandboxes");
  await clickButton(first, "Back");
  await waitForScreen(first, "Welcome to 80|20");

  await clickRow(first, "the8020/admin-core/services");
  await waitForScreen(first, "Services");
  await clickRow(first, "the8020/demo/variables");
  await waitForScreen(first, "Service the8020/demo/variables");
  await clickButton(first, "Disable");
  await waitForPage(
    first,
    `[...document.querySelectorAll("button")].some((item) => item.textContent?.trim() === "Enable")`,
    "service disable through Deno admin bus",
    30_000,
  );
  await clickButton(first, "Back");
  await waitForScreen(first, "Services");
  await clickButton(first, "Back");
  await waitForScreen(first, "Welcome to 80|20");

  await clickRow(first, "the8020/demo/demo-form");
  await waitForScreen(first, "Form and binding demonstration");
  await waitForPage(
    first,
    `(() => {
      const titleIcon = document.querySelector('.screen-title [data-material-icon="edit"]');
      const save = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === 'Save');
      const saveIcon = save?.querySelector('[data-material-icon="save"]');
      if (!(titleIcon instanceof HTMLElement) || !(save instanceof HTMLButtonElement) ||
        !(saveIcon instanceof HTMLElement)) return false;
      const titleStyle = getComputedStyle(titleIcon);
      const saveButtonStyle = getComputedStyle(save);
      const saveStyle = getComputedStyle(saveIcon);
      const titleBounds = titleIcon.getBoundingClientRect();
      const saveBounds = save.getBoundingClientRect();
      const saveIconBounds = saveIcon.getBoundingClientRect();
      return titleIcon.classList.contains('material-icon-color-primary') &&
        saveStyle.color === 'rgb(255, 255, 255)' &&
        titleStyle.maskImage !== 'none' && saveStyle.maskImage !== 'none' &&
        titleStyle.verticalAlign === 'middle' &&
        Math.abs(titleBounds.width / parseFloat(titleStyle.fontSize) - 1.2) < 0.05 &&
        Math.abs(saveIconBounds.width / parseFloat(saveStyle.fontSize) - 1.5) < 0.05 &&
        Math.abs(parseFloat(saveButtonStyle.columnGap) /
          parseFloat(saveButtonStyle.fontSize) - 0.45) < 0.01 &&
        Math.abs((saveIconBounds.top + saveIconBounds.bottom) / 2 -
          (saveBounds.top + saveBounds.bottom) / 2) < 1;
    })()`,
    "properly sized, centered, and spaced icon placeholders",
  );

  await first.evaluate(`
    window.__the8020PresentationPage = document.querySelector(
      "#app .presentation-page-layer:not([hidden]) .screen"
    );
  `);
  await clickButton(first, "Presentation flow");
  await waitForPage(
    first,
    `(() => {
      const dialogs = [...document.querySelectorAll("dialog.presentation-modal[open]")];
      const dialog = dialogs[0];
      const title = dialog?.querySelector(".screen-title");
      const localHeader = dialog?.querySelector(".presentation-modal-header");
      return dialogs.length === 1 && title?.textContent?.trim() === "Presentation modal B" &&
        localHeader?.textContent?.includes("Close modal") === true &&
        document.querySelector("#program-header")?.textContent?.includes("Save") === true &&
        document.querySelector("#app")?.inert === true && dialog?.inert === false &&
        dialog?.contains(document.activeElement) === true &&
        document.title === "80|20 Presentation modal B";
    })()`,
    "first modal presentation",
  );
  await setValue(
    first,
    '.presentation-modal[open] [data-bind="value"]',
    "Locally edited during redraw",
  );
  await waitForPage(
    first,
    `(() => {
      const dialog = document.querySelector("dialog.presentation-modal[open]");
      const value = dialog?.querySelector('[data-bind="value"]');
      const status = dialog?.querySelector('[data-bind="status"]');
      return value?.value === "Locally edited during redraw" &&
        status?.value === "Background redraw completed" &&
        window.__the8020PresentationPage ===
          document.querySelector("#app .presentation-page-layer:not([hidden]) .screen");
    })()`,
    "modal background redraw preserves its dirty value and page DOM",
  );
  await first.evaluate(`
    window.__the8020PresentationModal = document.querySelector(
      "dialog.presentation-modal[open] .screen"
    );
  `);
  await clickButton(first, "Open nested modal");
  await waitForPage(
    first,
    `(() => {
      const dialogs = [...document.querySelectorAll("dialog.presentation-modal[open]")];
      return dialogs.length === 2 &&
        dialogs[0]?.querySelector(".screen-title")?.textContent?.trim() === "Presentation modal B" &&
        dialogs[1]?.querySelector(".screen-title")?.textContent?.trim() === "Presentation modal C" &&
        window.__the8020PresentationModal === dialogs[0]?.querySelector(".screen") &&
        dialogs[0]?.inert === true && dialogs[1]?.inert === false &&
        dialogs[1]?.contains(document.activeElement) === true &&
        document.title === "80|20 Presentation modal C";
    })()`,
    "nested modal presentation",
  );
  await pressEscape(first);
  await waitForPage(
    first,
    `document.querySelectorAll("dialog.presentation-modal[open]").length === 1 &&
      document.querySelector("dialog.presentation-modal[open] .screen-title")?.textContent?.trim() === "Presentation modal B" &&
      document.title === "80|20 Presentation modal B"`,
    "Escape returns to the underlying modal",
  );

  await first.evaluate(`
    window.__the8020PresentationPage = document.querySelector(
      "#app .presentation-page-layer:not([hidden]) .screen"
    );
    window.__the8020PresentationDialog = document.querySelector(
      "dialog.presentation-modal[open]"
    );
  `);
  await clickButton(first, "Open page");
  await waitForPage(
    first,
    `(() => {
      const visible = document.querySelector(
        "#app .presentation-page-layer:not([hidden]) .screen-title"
      );
      const priorPage = window.__the8020PresentationPage?.closest(
        ".presentation-page-layer"
      );
      return visible?.textContent?.trim() === "Presentation page D" &&
        document.querySelectorAll("dialog.presentation-modal[open]").length === 0 &&
        window.__the8020PresentationPage?.isConnected === true &&
        priorPage?.hidden === true &&
        window.__the8020PresentationDialog?.isConnected === true &&
        window.__the8020PresentationDialog?.open === false &&
        document.title === "80|20 Presentation page D";
    })()`,
    "page presentation hides without disposing its prior composition",
  );
  await clickButton(first, "Open modal E");
  await waitForPage(
    first,
    `document.querySelectorAll("dialog.presentation-modal[open]").length === 1 &&
      document.querySelector("dialog.presentation-modal[open] .screen-title")?.textContent?.trim() === "Presentation modal E" &&
      document.querySelector("#app .presentation-page-layer:not([hidden]) .screen-title")?.textContent?.trim() === "Presentation page D" &&
      document.title === "80|20 Presentation modal E"`,
    "modal over a later page",
  );
  await first.command("Page.reload", { ignoreCache: true });
  await waitForPage(
    first,
    `document.querySelector("#connection-state")?.textContent === "Connected" &&
      document.querySelectorAll("dialog.presentation-modal[open]").length === 1 &&
      document.querySelector("dialog.presentation-modal[open] .screen-title")?.textContent?.trim() === "Presentation modal E" &&
      document.querySelector("#app .presentation-page-layer:not([hidden]) .screen-title")?.textContent?.trim() === "Presentation page D" &&
      document.title === "80|20 Presentation modal E"`,
    "reload restores the current page and modal presentation",
  );
  await first.evaluate("history.back()");
  await waitForPage(
    first,
    `document.querySelectorAll("dialog.presentation-modal[open]").length === 0 &&
      document.querySelector("#app .presentation-page-layer:not([hidden]) .screen-title")?.textContent?.trim() === "Presentation page D" &&
      document.title === "80|20 Presentation page D"`,
    "browser Back targets the top modal",
  );
  await clickButton(first, "Back");
  await waitForPage(
    first,
    `document.querySelectorAll("dialog.presentation-modal[open]").length === 1 &&
      document.querySelector("dialog.presentation-modal[open] .screen-title")?.textContent?.trim() === "Presentation modal B" &&
      document.querySelector("#app .presentation-page-layer:not([hidden]) .screen-title")?.textContent?.trim() === "Form and binding demonstration" &&
      document.title === "80|20 Presentation modal B"`,
    "returning page restores its earlier page and modal continuation",
  );
  await clickButton(first, "Close modal");
  await waitForScreen(first, "Form and binding demonstration");
  assert(
    await first.evaluate(
      `document.querySelectorAll("dialog.presentation-modal[open]").length === 0`,
    ),
    "closing the restored modal did not return to its page",
  );
  try {
    await waitForPage(
      first,
      `(() => {
      const primaryEmail = document.querySelector('#control-primary-email');
      const confirmationEmail = document.querySelector('#control-confirmation-email');
      const biography = document.querySelector('#control-biography');
      const enabled = document.querySelector('#control-enabled');
      const role = document.querySelector('#control-role');
      const accountGrid = primaryEmail?.closest('.field-group-fields');
      const profileGrid = biography?.closest('.field-group-fields');
      const primaryPencil = primaryEmail?.closest('.field')?.querySelector('.field-edit-icon');
      const biographyPencil = biography?.closest('.field')?.querySelector('.field-edit-icon');
      const enabledShell = enabled?.closest('.field-input-shell');
      const enabledPencil = enabledShell?.querySelector('.field-edit-icon');
      const roleShell = role?.closest('.field-input-shell');
      const rolePencil = roleShell?.querySelector('.field-edit-icon');
      const roleArrow = roleShell?.querySelector('.field-select-icon');
      if (!(primaryEmail instanceof HTMLInputElement) ||
          !(confirmationEmail instanceof HTMLInputElement) ||
          !(biography instanceof HTMLTextAreaElement) ||
          !(enabled instanceof HTMLInputElement) ||
          !(role instanceof HTMLSelectElement) ||
          !(accountGrid instanceof HTMLElement) ||
          !(profileGrid instanceof HTMLElement) ||
          !(primaryPencil instanceof HTMLElement) ||
          !(biographyPencil instanceof HTMLElement) ||
          !(enabledShell instanceof HTMLElement) ||
          !(enabledPencil instanceof HTMLElement) ||
          !(roleShell instanceof HTMLElement) ||
          !(rolePencil instanceof HTMLElement) ||
          !(roleArrow instanceof HTMLElement)) return false;
      const aligned = (left, right) => Math.abs(left - right) < 0.5;
      const enabledStyle = getComputedStyle(enabled);
      const enabledShellStyle = getComputedStyle(enabledShell);
      return biography.closest('.field')?.dataset.fieldRowSpan === '2' &&
        accountGrid.classList.contains('field-group-fields-exact-rows') &&
        profileGrid.classList.contains('field-group-fields-exact-rows') &&
        aligned(accountGrid.getBoundingClientRect().top, profileGrid.getBoundingClientRect().top) &&
        aligned(biography.getBoundingClientRect().bottom, primaryEmail.getBoundingClientRect().bottom) &&
        aligned(biographyPencil.getBoundingClientRect().bottom, primaryPencil.getBoundingClientRect().bottom) &&
        aligned(biographyPencil.getBoundingClientRect().right, biography.getBoundingClientRect().right) &&
        aligned(enabledShell.getBoundingClientRect().bottom, confirmationEmail.getBoundingClientRect().bottom) &&
        enabled.type === 'checkbox' && !enabled.disabled &&
        enabledStyle.appearance === 'none' && enabledStyle.opacity === '1' &&
        enabledShellStyle.borderBottomWidth === '1px' &&
        aligned(enabledShell.getBoundingClientRect().right, enabledPencil.getBoundingClientRect().right) &&
        enabledPencil.dataset.materialIcon === 'edit' &&
        aligned(roleShell.getBoundingClientRect().right, rolePencil.getBoundingClientRect().right) &&
        roleArrow.getBoundingClientRect().right < rolePencil.getBoundingClientRect().left &&
        roleArrow.dataset.materialIcon === 'arrow_drop_down' &&
        getComputedStyle(roleArrow).pointerEvents === 'none' &&
        getComputedStyle(role).appearance === 'none';
      })()`,
      "exact textarea row-span alignment across sibling field groups",
    );
  } catch (error) {
    const geometry = await first.evaluate(`(() => {
      const bounds = (selector) => {
        const control = document.querySelector(selector);
        const field = control?.closest('.field');
        const grid = control?.closest('.field-group-fields');
        const rectangle = (item) => item instanceof HTMLElement
          ? Object.fromEntries(['top', 'right', 'bottom', 'left', 'width', 'height']
            .map((key) => [key, item.getBoundingClientRect()[key]]))
          : undefined;
        return {
          control: rectangle(control),
          pencil: rectangle(field?.querySelector('.field-edit-icon')),
          field: rectangle(field),
          grid: rectangle(grid),
          rowSpan: field?.dataset.fieldRowSpan,
          gridRow: field instanceof HTMLElement ? getComputedStyle(field).gridRow : undefined,
          gridClasses: grid?.className,
          autoRows: grid instanceof HTMLElement ? getComputedStyle(grid).gridAutoRows : undefined,
          rowGap: grid instanceof HTMLElement ? getComputedStyle(grid).rowGap : undefined,
        };
      };
      return {
        viewport: [innerWidth, innerHeight, devicePixelRatio],
        primaryEmail: bounds('#control-primary-email'),
        confirmationEmail: bounds('#control-confirmation-email'),
        biography: bounds('#control-biography'),
        enabled: bounds('#control-enabled'),
      };
    })()`);
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}; geometry: ${
        JSON.stringify(geometry)
      }`,
    );
  }

  await clickButton(first, "Message types");
  await waitForPage(
    first,
    `document.querySelector("#messages-count")?.textContent === "4" &&
      document.querySelectorAll(".message-toast").length === 4`,
    "four semantic message toasts",
  );
  const typeStack = await first.evaluate<{
    valid: boolean;
    kinds: string[];
    heights: number[];
    bottomOffsets: number[];
    expectedOffset: number;
    anchorGap: number;
    animationCount: number;
    animationDuration: number;
    closeButtons: number;
    dismissAllBelow: boolean;
    dismissAllVisible: boolean;
    borderlessControls: boolean;
    centeredCloseIcon: boolean;
    closeAllIcon: boolean;
    onlyTopBodyRendered: boolean;
    stackOwnsHover: boolean;
    unifiedHeader: boolean;
  }>(`(() => {
    const stack = document.querySelector("#message-toast-stack");
    const toggle = document.querySelector("#session-menu-toggle");
    const dismissAll = document.querySelector("#message-toast-dismiss-all");
    const cards = [...document.querySelectorAll(".message-toast")];
    if (!(stack instanceof HTMLElement) || !(toggle instanceof HTMLElement) ||
        !(dismissAll instanceof HTMLButtonElement) ||
        cards.some((card) => !(card instanceof HTMLElement)) || cards.length !== 4) {
      return { valid: false, kinds: [], heights: [], bottomOffsets: [], expectedOffset: 0, anchorGap: 0, animationCount: 0, animationDuration: 0, closeButtons: 0, dismissAllBelow: false, dismissAllVisible: false, borderlessControls: false, centeredCloseIcon: false, closeAllIcon: false, onlyTopBodyRendered: false, stackOwnsHover: false, unifiedHeader: false };
    }
    const typedCards = cards;
    const bounds = typedCards.map((card) => card.getBoundingClientRect());
    const rootSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const expectedOffset = rootSize * 0.5;
    const toggleBounds = toggle.getBoundingClientRect();
    const dismissAllBounds = dismissAll.getBoundingClientRect();
    const header = typedCards[0].querySelector(".message-toast-header");
    const close = typedCards[0].querySelector(".message-toast-close");
    const headerStyle = header instanceof HTMLElement ? getComputedStyle(header) : undefined;
    const closeIcon = close?.querySelector('[data-material-icon="close"]');
    const closeBounds = close instanceof HTMLElement ? close.getBoundingClientRect() : undefined;
    const closeIconBounds = closeIcon instanceof HTMLElement ? closeIcon.getBoundingClientRect() : undefined;
    const controls = [
      ...typedCards.map((card) => card.querySelector(".message-toast-close")),
      dismissAll,
    ];
    const animation = typedCards[0].querySelector(".message-toast-progress-fill")?.getAnimations()[0];
    const widthsMatch = bounds.every((item) => Math.abs(item.width - bounds[0].width) < 0.5);
    const heightsMatch = bounds.every((item) => Math.abs(item.height - rootSize * 5) < 1);
    const bottomsMatch = bounds.every((item, index) =>
      Math.abs(item.bottom - bounds[0].bottom - index * expectedOffset) < 1);
    return {
      valid: typedCards[0].classList.contains("message-toast-top") &&
        typedCards.filter((card) => card.classList.contains("message-toast-top")).length === 1 &&
        widthsMatch && heightsMatch && bottomsMatch &&
        Math.abs(bounds[0].right - toggleBounds.right) < 1 &&
        bounds[0].top > toggleBounds.bottom,
      kinds: typedCards.map((card) => card.dataset.messageKind ?? ""),
      heights: bounds.map((item) => item.height),
      bottomOffsets: bounds.map((item) => item.bottom - bounds[0].bottom),
      expectedOffset,
      anchorGap: bounds[0].top - toggleBounds.bottom,
      animationCount: typedCards[0].querySelector(".message-toast-progress-fill")?.getAnimations().length ?? 0,
      animationDuration: Number(animation?.effect?.getTiming().duration ?? 0),
      closeButtons: typedCards.filter((card) =>
        card.querySelector(".message-toast-close") instanceof HTMLButtonElement
      ).length,
      dismissAllBelow: dismissAllBounds.top > bounds.at(-1).bottom &&
        Math.abs(dismissAllBounds.right - bounds[0].right) < 1,
      dismissAllVisible: !dismissAll.hidden,
      borderlessControls: controls.every((control) =>
        control instanceof HTMLElement && getComputedStyle(control).borderTopWidth === "0px"
      ),
      centeredCloseIcon: closeBounds !== undefined && closeIconBounds !== undefined &&
        Math.abs(closeBounds.left + closeBounds.width / 2 -
          (closeIconBounds.left + closeIconBounds.width / 2)) < 0.5 &&
        Math.abs(closeBounds.top + closeBounds.height / 2 -
          (closeIconBounds.top + closeIconBounds.height / 2)) < 0.5,
      closeAllIcon: dismissAll.querySelector('[data-material-icon="tab_close"]') !== null,
      onlyTopBodyRendered: typedCards[0].querySelector(".message-toast-body.markdown") !== null &&
        typedCards.slice(1).every((card) =>
          card.querySelector(".message-toast-body")?.childElementCount === 0
        ),
      stackOwnsHover: getComputedStyle(stack).pointerEvents === "auto" &&
        getComputedStyle(typedCards[0]).userSelect === "none",
      unifiedHeader: headerStyle?.backgroundColor === "rgba(0, 0, 0, 0)" &&
        headerStyle.borderBottomWidth === "0px" && close instanceof HTMLElement &&
        Math.abs(close.getBoundingClientRect().right - bounds[0].right) < rootSize,
    };
  })()`);
  assert(
    typeStack.valid &&
      typeStack.kinds.join(",") === "info,success,warning,error" &&
      typeStack.animationCount === 1 && typeStack.closeButtons === 4 &&
      typeStack.animationDuration > 1_000 &&
      typeStack.animationDuration < 5_000 &&
      typeStack.dismissAllBelow && typeStack.dismissAllVisible &&
      typeStack.borderlessControls && typeStack.centeredCloseIcon &&
      typeStack.closeAllIcon && typeStack.onlyTopBodyRendered &&
      typeStack.stackOwnsHover && typeStack.unifiedHeader,
    `semantic toast stack geometry is invalid: ${JSON.stringify(typeStack)}`,
  );
  await delay(700);
  const progressedTime = await first.evaluate<number>(`(() => {
    const fill = document.querySelector(".message-toast-top .message-toast-progress-fill");
    return fill instanceof HTMLElement
      ? Number(fill.getAnimations()[0]?.currentTime ?? -1)
      : -1;
  })()`);
  const resetTime = await first.evaluate<number>(`(() => {
    const stack = document.querySelector("#message-toast-stack");
    const fill = stack?.querySelector(".message-toast-top .message-toast-progress-fill");
    if (!(stack instanceof HTMLElement) || !(fill instanceof HTMLElement)) return -1;
    stack.dispatchEvent(new MouseEvent("mouseenter"));
    return fill instanceof HTMLElement
      ? Number(fill.getAnimations()[0]?.currentTime ?? -1)
      : -1;
  })()`);
  await delay(600);
  const pausedProgress = await first.evaluate<{
    currentTime: number;
    playState: string;
    toastCount: number;
  }>(`(() => {
    const animation = document.querySelector(".message-toast-top .message-toast-progress-fill")?.getAnimations()[0];
    return {
      currentTime: Number(animation?.currentTime ?? -1),
      playState: animation?.playState ?? "missing",
      toastCount: document.querySelectorAll(".message-toast:not(.message-toast-leaving)").length,
    };
  })()`);
  assert(
    progressedTime > 500 && resetTime >= 0 && resetTime < 150,
    `stack hover did not reset adaptive toast progress: ${progressedTime} -> ${resetTime}`,
  );
  assert(
    pausedProgress.playState === "paused" && pausedProgress.toastCount === 4 &&
      Math.abs(pausedProgress.currentTime - resetTime) < 50,
    `toast progress continued while hovered: ${JSON.stringify(pausedProgress)}`,
  );
  const resumedState = await first.evaluate<string>(`(() => {
    const stack = document.querySelector("#message-toast-stack");
    if (!(stack instanceof HTMLElement)) return "missing";
    stack.dispatchEvent(new MouseEvent("mouseleave"));
    return stack.querySelector(".message-toast-top .message-toast-progress-fill")?.getAnimations()[0]?.playState ?? "missing";
  })()`);
  assert(
    resumedState === "running" || resumedState === "pending",
    `toast progress did not resume after hover: ${resumedState}`,
  );

  const rapidDismiss = await first.evaluate<{
    dismissedKinds: string[];
    leaving: number;
    remaining: number;
    activeKind: string;
    dismissAllVisible: boolean;
    exitingCardsOutOfFlow: boolean;
  }>(`(() => {
    const dismissedKinds = [];
    for (let index = 0; index < 3; index++) {
      const top = document.querySelector(".message-toast-top");
      const close = top?.querySelector(".message-toast-close");
      if (!(top instanceof HTMLElement) || !(close instanceof HTMLButtonElement)) break;
      dismissedKinds.push(top.dataset.messageKind ?? "");
      close.click();
    }
    const active = document.querySelector(".message-toast-top");
    return {
      dismissedKinds,
      leaving: document.querySelectorAll(".message-toast-leaving").length,
      remaining: document.querySelectorAll(".message-toast:not(.message-toast-leaving)").length,
      activeKind: active instanceof HTMLElement ? active.dataset.messageKind ?? "" : "",
      dismissAllVisible: document.querySelector("#message-toast-dismiss-all")?.hidden === false,
      exitingCardsOutOfFlow: [...document.querySelectorAll(".message-toast-leaving")].every((card) =>
        card instanceof HTMLElement && getComputedStyle(card).position === "absolute"
      ),
    };
  })()`);
  assert(
    rapidDismiss.dismissedKinds.join(",") === "info,success,warning" &&
      rapidDismiss.leaving === 3 && rapidDismiss.remaining === 1 &&
      rapidDismiss.activeKind === "error" && rapidDismiss.dismissAllVisible &&
      rapidDismiss.exitingCardsOutOfFlow,
    `rapid toast dismissal did not expose each following card: ${
      JSON.stringify(rapidDismiss)
    }`,
  );
  await first.evaluate(
    `document.querySelector("#message-toast-dismiss-all")?.click()`,
  );
  await waitForPage(
    first,
    `document.querySelectorAll(".message-toast").length === 0 &&
      document.querySelector("#message-toast-stack")?.hidden === true`,
    "dismiss all message toasts",
  );

  await clickButton(first, "Long Markdown");
  await waitForPage(
    first,
    `document.querySelector("#messages-count")?.textContent === "4" &&
      document.querySelectorAll(".message-toast").length === 4 &&
      document.querySelector(".message-toast-top .markdown h1")?.textContent === "Deployment summary" &&
      document.querySelector(".message-toast-top .markdown table") !== null`,
    "long Markdown toast stack",
  );
  const markdownStack = await first.evaluate<{
    valid: boolean;
    heights: number[];
    bottomOffsets: number[];
    bodyClientHeight: number;
    bodyScrollHeight: number;
    overflow: string;
    animationDuration: number;
    deferredBodies: boolean;
  }>(`(() => {
    const cards = [...document.querySelectorAll(".message-toast")];
    const top = cards[0];
    const body = top?.querySelector(".message-toast-body");
    if (!(top instanceof HTMLElement) || !(body instanceof HTMLElement) ||
        cards.length !== 4 || cards.some((card) => !(card instanceof HTMLElement))) {
      return { valid: false, heights: [], bottomOffsets: [], bodyClientHeight: 0, bodyScrollHeight: 0, overflow: "", animationDuration: 0, deferredBodies: false };
    }
    const typedCards = cards;
    const bounds = typedCards.map((card) => card.getBoundingClientRect());
    const rootSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const expectedOffset = rootSize * 0.5;
    const widthsMatch = bounds.every((item) => Math.abs(item.width - bounds[0].width) < 0.5);
    const bottomsMatch = bounds.every((item, index) =>
      Math.abs(item.bottom - bounds[0].bottom - index * expectedOffset) < 1);
    return {
      valid: bounds[0].height > rootSize * 5 + 40 &&
        bounds[0].height <= rootSize * 25 + 1 &&
        Math.abs(bounds[1].height - rootSize * 5) < 1 &&
        Math.abs(bounds[2].height - rootSize * 5) < 1 &&
        Math.abs(bounds[3].height - rootSize * 5) < 1 &&
        widthsMatch && bottomsMatch &&
        body.scrollHeight > body.clientHeight &&
        getComputedStyle(body).overflowY === "auto" &&
        body.querySelector("h1") !== null && body.querySelector("h2") !== null &&
        body.querySelector("table") !== null && body.querySelector("ul") !== null &&
        body.querySelector("code") !== null,
      heights: bounds.map((item) => item.height),
      bottomOffsets: bounds.map((item) => item.bottom - bounds[0].bottom),
      bodyClientHeight: body.clientHeight,
      bodyScrollHeight: body.scrollHeight,
      overflow: getComputedStyle(body).overflowY,
      animationDuration: Number(
        top.querySelector(".message-toast-progress-fill")?.getAnimations()[0]?.effect?.getTiming().duration ?? 0
      ),
      deferredBodies: typedCards.slice(1).every((card) => {
        const hiddenBody = card.querySelector(".message-toast-body");
        return hiddenBody instanceof HTMLElement && hiddenBody.childElementCount === 0;
      }) && document.querySelectorAll(".message-toast-body.markdown").length === 1,
    };
  })()`);
  assert(
    markdownStack.valid && markdownStack.animationDuration === 5_000 &&
      markdownStack.deferredBodies,
    `expanded Markdown toast geometry is invalid: ${
      JSON.stringify(markdownStack)
    }`,
  );
  const clickedMessageID = await first.evaluate<string>(`(() => {
    const stack = document.querySelector("#message-toast-stack");
    const top = document.querySelector(".message-toast-top");
    if (!(stack instanceof HTMLElement) || !(top instanceof HTMLElement)) return "";
    stack.dispatchEvent(new MouseEvent("mouseenter"));
    const id = top.dataset.messageId ?? "";
    top.click();
    return id;
  })()`);
  await waitForPage(
    first,
    `document.querySelector("#message-dialog")?.open === true &&
      document.querySelectorAll(".message-toast:not(.message-toast-leaving)").length === 0 &&
      document.querySelector('.message-history-entry[open][data-focused="true"]')?.getAttribute("data-message-id") === ${
      JSON.stringify(clickedMessageID)
    }`,
    "clicked toast history target",
  );
  const clickedHistory = await first.evaluate<{
    focusedID: string;
    count: number;
    markdown: boolean;
    focusedVisible: boolean;
    bodyBackground: string;
    dialogHeight: number;
    dialogMaxHeight: number;
    listMaxHeight: number;
    viewportHeight: number;
  }>(`(() => {
    const dialog = document.querySelector("#message-dialog");
    const list = document.querySelector("#message-history-list");
    const focused = list?.querySelector('.message-history-entry[open][data-focused="true"]');
    const body = focused?.querySelector(".message-history-body");
    if (!(dialog instanceof HTMLDialogElement) || !(list instanceof HTMLElement) ||
        !(focused instanceof HTMLElement) || !(body instanceof HTMLElement)) {
      return { focusedID: "", count: 0, markdown: false, focusedVisible: false, bodyBackground: "", dialogHeight: 0, dialogMaxHeight: 0, listMaxHeight: 0, viewportHeight: innerHeight };
    }
    const listBounds = list.getBoundingClientRect();
    const focusedBounds = focused.getBoundingClientRect();
    return {
      focusedID: focused.dataset.messageId ?? "",
      count: list.querySelectorAll(".message-history-entry").length,
      markdown: body.querySelector("table") !== null,
      focusedVisible: focusedBounds.top >= listBounds.top - 1 &&
        focusedBounds.top < listBounds.bottom,
      bodyBackground: getComputedStyle(body).backgroundColor,
      dialogHeight: dialog.getBoundingClientRect().height,
      dialogMaxHeight: parseFloat(getComputedStyle(dialog).maxHeight),
      listMaxHeight: parseFloat(getComputedStyle(list).maxHeight),
      viewportHeight: innerHeight,
    };
  })()`);
  assert(
    clickedHistory.focusedID === clickedMessageID &&
      clickedHistory.count === 4 &&
      clickedHistory.markdown && clickedHistory.focusedVisible &&
      clickedHistory.bodyBackground === "rgba(0, 0, 0, 0)" &&
      clickedHistory.dialogHeight > clickedHistory.viewportHeight * 0.5 &&
      clickedHistory.dialogMaxHeight >= clickedHistory.viewportHeight * 0.89 &&
      clickedHistory.dialogMaxHeight <= clickedHistory.viewportHeight * 0.91 &&
      clickedHistory.listMaxHeight > clickedHistory.viewportHeight * 0.75,
    `clicked toast did not open the expanded viewport-sized history entry: ${
      JSON.stringify(clickedHistory)
    }`,
  );
  await waitForPage(
    first,
    `document.querySelector("#message-dialog")?.open === true &&
      document.querySelectorAll(".message-toast").length === 0 &&
      document.querySelector("#message-toast-stack")?.hidden === true`,
    "clicked toast close-all completion",
  );
  await click(first, "#message-dialog-close");

  await clickButton(first, "Long Markdown");
  await waitForPage(
    first,
    `document.querySelector("#messages-count")?.textContent === "4" &&
      document.querySelectorAll(".message-toast").length === 4 &&
      document.querySelector(".message-toast-top .markdown h1")?.textContent === "Deployment summary"`,
    "second long Markdown toast stack",
  );

  const expiringMessageID = await first.evaluate<string>(`(() => {
    const stack = document.querySelector("#message-toast-stack");
    const top = document.querySelector(".message-toast-top");
    const toggle = document.querySelector("#session-menu-toggle");
    if (!(stack instanceof HTMLElement) || !(top instanceof HTMLElement) ||
        !(toggle instanceof HTMLElement)) return "";
    stack.dispatchEvent(new MouseEvent("mouseenter"));
    const cardBounds = top.getBoundingClientRect();
    const toggleBounds = toggle.getBoundingClientRect();
    window.__the8020MessageArchive = {
      observed: false,
      expectedX: toggleBounds.left + toggleBounds.width / 2 -
        (cardBounds.left + cardBounds.width / 2),
      expectedY: toggleBounds.top + toggleBounds.height / 2 -
        (cardBounds.top + cardBounds.height / 2),
    };
    new MutationObserver(() => {
      if (!top.classList.contains("message-toast-leaving") ||
          window.__the8020MessageArchive.observed) return;
      const style = getComputedStyle(top);
      const liveCards = [...document.querySelectorAll(
        ".message-toast:not(.message-toast-leaving)",
      )];
      const liveBounds = liveCards.map((card) => card.getBoundingClientRect());
      const rootSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
      Object.assign(window.__the8020MessageArchive, {
        observed: true,
        exitX: parseFloat(top.style.getPropertyValue("--message-exit-x")),
        exitY: parseFloat(top.style.getPropertyValue("--message-exit-y")),
        animationName: style.animationName,
        position: style.position,
        liveKinds: liveCards.map((card) => card.getAttribute("data-message-kind") ?? ""),
        liveHeights: liveBounds.map((bounds) => bounds.height),
        liveBottomOffsets: liveBounds.map((bounds) => bounds.bottom - liveBounds[0].bottom),
        expectedOffset: rootSize * 0.5,
        renderedBodies: liveCards.filter((card) =>
          card.querySelector(".message-toast-body.markdown") !== null
        ).length,
      });
    }).observe(top, { attributes: true, attributeFilter: ["class"] });
    stack.dispatchEvent(new MouseEvent("mouseleave"));
    return top.dataset.messageId ?? "";
  })()`);
  assert(
    expiringMessageID.length > 0,
    "expiring Markdown toast has no identity",
  );
  await waitForPage(
    first,
    `document.querySelector("#messages-count")?.textContent === "4" &&
      document.querySelectorAll(".message-toast").length === 3`,
    "oldest toast archive animation",
    7_000,
  );
  const archive = await first.evaluate<{
    observed: boolean;
    expectedX: number;
    expectedY: number;
    exitX?: number;
    exitY?: number;
    animationName?: string;
    position?: string;
    liveKinds?: string[];
    liveHeights?: number[];
    liveBottomOffsets?: number[];
    expectedOffset?: number;
    renderedBodies?: number;
  }>(`window.__the8020MessageArchive`);
  const baseToastHeight = 10 * (archive.expectedOffset ?? 0);
  assert(
    archive.observed && archive.animationName === "message-toast-archive" &&
      archive.position === "absolute" &&
      Math.abs((archive.exitX ?? Infinity) - archive.expectedX) < 2 &&
      Math.abs((archive.exitY ?? Infinity) - archive.expectedY) < 2 &&
      archive.liveKinds?.join(",") === "success,warning,error" &&
      archive.liveHeights?.length === 3 &&
      (archive.liveHeights[0] ?? 0) >= baseToastHeight - 1 &&
      archive.liveHeights.slice(1).every((height) =>
        Math.abs(height - baseToastHeight) < 1
      ) &&
      archive.liveBottomOffsets?.every((offset, index) =>
          Math.abs(offset - index * (archive.expectedOffset ?? 0)) < 1
        ) === true &&
      archive.renderedBodies === 1,
    `toast did not animate toward the session menu: ${JSON.stringify(archive)}`,
  );
  await first.evaluate(
    `document.querySelector("#message-toast-stack")?.dispatchEvent(
    new MouseEvent("mouseenter")
  )`,
  );
  await clickSessionMenuAction(first, "#messages-open");
  await waitForPage(
    first,
    `document.querySelector("#message-dialog")?.open === true &&
      document.querySelectorAll(".message-history-entry").length === 4 &&
      document.querySelector('.message-history-entry[open][data-focused="true"]') !== null`,
    "message history modal",
  );
  const historyState = await first.evaluate<{
    focusedID: string;
    count: number;
    overflow: string;
    maxHeight: string;
    markdown: boolean;
  }>(`(() => {
    const list = document.querySelector("#message-history-list");
    const focused = list?.querySelector('.message-history-entry[open][data-focused="true"]');
    return {
      focusedID: focused?.getAttribute("data-message-id") ?? "",
      count: list?.querySelectorAll(".message-history-entry").length ?? 0,
      overflow: list instanceof HTMLElement ? getComputedStyle(list).overflowY : "",
      maxHeight: list instanceof HTMLElement ? getComputedStyle(list).maxHeight : "",
      markdown: focused?.querySelector(".markdown table") !== null,
    };
  })()`);
  assert(
    historyState.focusedID === expiringMessageID &&
      historyState.count === 4 && historyState.overflow === "auto" &&
      historyState.markdown,
    `message history did not focus the archived Markdown message: ${
      JSON.stringify(historyState)
    }`,
  );
  await click(first, "#message-dialog-close");

  const alternatingAdvance = await first.evaluate<{
    firstWasShort: boolean;
    longExpanded: boolean;
    finalWasShort: boolean;
    leaving: number;
    remaining: number;
    dismissAllVisible: boolean;
  }>(`(async () => {
    const first = document.querySelector(".message-toast-top");
    const firstClose = first?.querySelector(".message-toast-close");
    const firstWasShort = first instanceof HTMLElement &&
      first.textContent?.includes("short success card") === true;
    if (firstClose instanceof HTMLButtonElement) firstClose.click();
    const long = document.querySelector(".message-toast-top");
    const rootSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const longExpanded = long instanceof HTMLElement &&
      long.querySelector(".markdown h2")?.textContent === "Follow-up validation" &&
      long.getBoundingClientRect().height > rootSize * 5 + 20;
    const animation = long?.querySelector(".message-toast-progress-fill")?.getAnimations()[0];
    animation?.finish();
    await animation?.finished;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const final = document.querySelector(".message-toast-top");
    return {
      firstWasShort,
      longExpanded,
      finalWasShort: final instanceof HTMLElement &&
        final.textContent?.includes("short error card") === true,
      leaving: document.querySelectorAll(".message-toast-leaving").length,
      remaining: document.querySelectorAll(".message-toast:not(.message-toast-leaving)").length,
      dismissAllVisible: document.querySelector("#message-toast-dismiss-all")?.hidden === false,
    };
  })()`);
  assert(
    alternatingAdvance.firstWasShort && alternatingAdvance.longExpanded &&
      alternatingAdvance.finalWasShort && alternatingAdvance.leaving === 2 &&
      alternatingAdvance.remaining === 1 &&
      alternatingAdvance.dismissAllVisible,
    `alternating short and Markdown messages did not advance immediately: ${
      JSON.stringify(alternatingAdvance)
    }`,
  );
  await first.evaluate(
    `document.querySelector("#message-toast-dismiss-all")?.click()`,
  );
  await waitForPage(
    first,
    `document.querySelectorAll(".message-toast").length === 0 &&
      document.querySelector("#message-toast-stack")?.hidden === true &&
      document.querySelector("#messages-count")?.textContent === "4"`,
    "alternating toast close-all dismissal",
  );

  await clickButton(first, "Message limits");
  await waitForPage(
    first,
    `document.querySelector("#messages-count")?.textContent === "100" &&
      document.querySelectorAll(".message-toast").length === 10`,
    "bounded message burst",
  );
  const boundedToasts = await first.evaluate<{
    labels: string[];
    renderedBodies: number;
  }>(`(() => {
    const stack = document.querySelector("#message-toast-stack");
    const cards = [...document.querySelectorAll(".message-toast")];
    stack?.dispatchEvent(new MouseEvent("mouseenter"));
    return {
      labels: cards.map((card) => card.getAttribute("aria-label") ?? ""),
      renderedBodies: document.querySelectorAll(".message-toast-body.markdown").length,
    };
  })()`);
  assert(
    boundedToasts.labels.length === 10 && boundedToasts.renderedBodies === 1 &&
      boundedToasts.labels[0]?.includes("Burst message 96 of 105.") === true &&
      boundedToasts.labels.at(-1)?.includes("Burst message 105 of 105.") ===
        true,
    `toast rendering was not capped to the last ten messages: ${
      JSON.stringify(boundedToasts)
    }`,
  );
  await clickSessionMenuAction(first, "#messages-open");
  await waitForPage(
    first,
    `document.querySelector("#message-dialog")?.open === true &&
      document.querySelectorAll(".message-history-entry").length === 100`,
    "bounded message history",
  );
  const boundedHistory = await first.evaluate<{
    entries: string[];
    renderedBodies: number;
  }>(`({
    entries: [...document.querySelectorAll(".message-history-entry")]
      .map((entry) => entry.textContent?.replace(/\\s+/g, " ").trim() ?? ""),
    renderedBodies: document.querySelectorAll(".message-history-body").length,
  })`);
  assert(
    boundedHistory.entries.length === 100 &&
      boundedHistory.entries[0]?.includes("Burst message 6 of 105.") === true &&
      boundedHistory.entries.at(-1)?.includes("Burst message 105 of 105.") ===
        true &&
      boundedHistory.renderedBodies === 1,
    `message history was not capped to the last hundred messages: ${
      JSON.stringify([
        boundedHistory.entries.length,
        boundedHistory.entries[0],
        boundedHistory.entries.at(-1),
        boundedHistory.renderedBodies,
      ])
    }`,
  );
  await click(first, "#message-dialog-close");
  await clickButton(first, "Single message");
  await waitForPage(
    first,
    `document.querySelector("#messages-count")?.textContent === "1" &&
      document.querySelectorAll(".message-toast").length === 1 &&
      document.querySelector(".message-toast-body")?.textContent?.includes("one informational message") === true &&
      document.querySelector("#message-toast-dismiss-all")?.hidden === true`,
    "roundtrip message reset",
  );

  await first.evaluate(`(() => {
    const app = document.querySelector("#app");
    const stack = document.querySelector("#message-toast-stack");
    const previousScreen = document.querySelector(".screen");
    window.__the8020AsyncMessageOrder = [];
    if (app instanceof HTMLElement) {
      new MutationObserver(() => {
        if (document.querySelector(".screen") !== previousScreen &&
            !window.__the8020AsyncMessageOrder.includes("screen")) {
          window.__the8020AsyncMessageOrder.push("screen");
        }
      }).observe(app, { childList: true });
    }
    if (stack instanceof HTMLElement) {
      new MutationObserver(() => {
        if (stack.querySelector(".message-toast") !== null &&
            !window.__the8020AsyncMessageOrder.includes("message")) {
          window.__the8020AsyncMessageOrder.push("message");
        }
      }).observe(stack, { childList: true });
    }
  })()`);
  await clickButton(first, "Async messages");
  await waitForPage(
    first,
    `document.querySelector("#messages-count")?.textContent === "3" &&
      document.querySelectorAll(".message-toast").length === 3`,
    "asynchronous backend messages",
  );
  const asyncState = await first.evaluate<{
    order: string[];
    kinds: string[];
  }>(`({
    order: window.__the8020AsyncMessageOrder ?? [],
    kinds: [...document.querySelectorAll(".message-toast")].map((card) => card.getAttribute("data-message-kind") ?? ""),
  })`);
  assert(
    asyncState.order[0] === "screen" && asyncState.order[1] === "message" &&
      asyncState.kinds.join(",") === "info,success,warning",
    `messages did not arrive asynchronously after the next screen: ${
      JSON.stringify(asyncState)
    }`,
  );
  await setValue(first, '[data-bind="email"]', "changed@example.test");
  assert(
    await first.evaluate<boolean>(
      `[...document.querySelectorAll('[data-bind="email"]')].every((item) => item.value === "changed@example.test")`,
    ),
    "controls sharing one binding did not synchronize",
  );

  await first.evaluate(`(() => {
    window.__the8020ScreenMarker = document.querySelector(".screen");
    window.__the8020ConnectionTransitions = [];
    const state = document.querySelector("#connection-state");
    const indicator = document.querySelector("#connection-indicator");
    const record = () => window.__the8020ConnectionTransitions.push({
      text: state?.textContent ?? "",
      state: indicator?.dataset.state ?? "",
      color: indicator instanceof HTMLElement ? getComputedStyle(indicator).color : "",
    });
    new MutationObserver(record).observe(state, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    new MutationObserver(record).observe(indicator, {
      attributes: true,
      attributeFilter: ["data-state"],
    });
    record();
  })()`);
  const closedForReconnect = await first.evaluate<boolean>(`(() => {
    const socket = window.__the8020LastWebSocket;
    if (socket === undefined || typeof socket.close !== "function" || socket.readyState !== 1) return false;
    socket.close(4000, "browser E2E reconnect proof");
    return true;
  })()`);
  assert(
    closedForReconnect,
    "active UUI WebSocket was unavailable for reconnect proof",
  );
  await waitForPage(
    first,
    `document.querySelector("#connection-state")?.textContent === "Connected" &&
      document.querySelector("#connection-indicator")?.dataset.state === "connected" &&
      window.__the8020ConnectionTransitions?.some((item) =>
        item.text === "Reconnecting…" && item.state === "reconnecting" &&
        ["rgb(196, 61, 75)", "rgb(255, 125, 139)"].includes(item.color))`,
    "brief WebSocket reconnect",
    15_000,
  );
  assert(
    await first.evaluate<boolean>(
      `window.__the8020ScreenMarker === document.querySelector(".screen") &&
       document.querySelector('[data-bind="email"]')?.value === "changed@example.test"`,
    ),
    "brief reconnect redrew the screen or lost a dirty edit",
  );

  await clickButton(first, "Save");
  await waitForPage(
    first,
    `document.querySelector('[data-bind="status"]')?.value === "Saved 1 time."`,
    "form action and model mutation",
  );
  await first.command("Page.reload", { ignoreCache: true });
  await waitForScreen(first, "Form and binding demonstration");
  await waitForPage(
    first,
    `document.querySelector('[data-bind="status"]')?.value === "Saved 1 time." &&
      document.querySelector('[data-bind="email"]')?.value === "changed@example.test" &&
      document.documentElement.dataset.theme === "dark" &&
      Object.entries(sessionStorage).some(([key, value]) => key.startsWith("the8020.uui.theme:session:") && value === "dark")`,
    "page-reload snapshot",
  );
  await assertThemeInitializedBeforePaint(first, "dark", "dark reload");
  const afterReload = await waitForUISessions(primaryRoot, 1);
  assert(
    afterReload[0]?.worker_id === firstSession.worker_id,
    "page reload did not resume the original Worker",
  );
  await clickButton(first, "Throw TypeError");
  await waitForScreen(first, "Program terminated");
  assert(
    await first.evaluate<boolean>(`(() => {
      const text = document.querySelector(".screen")?.textContent ?? "";
      const message = document.querySelector('[data-bind="message"]')?.value ?? "";
      const stack = document.querySelector('[data-bind="stack"]')?.value ?? "";
      const source = document.querySelector('[data-bind="source"]')?.value ?? "";
      return text.includes("TypeError") &&
        message.includes("intentionally raised an uncaught TypeError") &&
        stack.includes("demo-form/program.ts") &&
        source.includes("raiseDemoTypeError");
    })()`),
    "TypeError short dump is missing exception, stack, or source details",
  );
  await first.command("Browser.grantPermissions", {
    origin: primaryBase,
    permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"],
  });
  await clickButton(first, "Copy short dump");
  await waitForPage(
    first,
    `document.querySelector('[data-bind="copyStatus"]')?.value?.startsWith("Copied ") === true`,
    "short dump clipboard action",
  );
  assert(
    await first.evaluate<boolean>(
      `(async () => (await navigator.clipboard.readText()).includes("PROGRAM TERMINATED"))()`,
    ),
    "copied short dump is unavailable from the browser clipboard",
  );
  await clickButton(first, "Home");
  await waitForScreen(first, "Welcome to 80|20");

  await clickRow(first, "the8020/demo/demo-responsive-fields");
  await waitForScreen(first, "Responsive field layout demonstration");
  await waitForPage(
    first,
    `(() => {
      const reset = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === 'Reset');
      const icon = reset?.querySelector('[data-material-icon="refresh"]');
      return icon instanceof HTMLElement &&
        icon.classList.contains('material-icon-color-warning') &&
        getComputedStyle(icon).maskImage !== 'none';
    })()`,
    "semantic icon color in a UUI action",
  );
  await first.command("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await waitForResponsiveFieldLayout(first, "desktop");
  await first.evaluate(`document.querySelector('[data-bind="username"]')
    ?.closest('.field')?.querySelector('.field-message')
    ?.scrollIntoView({ block: 'center' })`);
  const responsiveHintState = await first.evaluate<{
    opened: boolean;
    text: string;
    trigger?: { top: number; right: number; bottom: number; left: number };
    popover?: { top: number; right: number; bottom: number; left: number };
  }>(`(() => {
    const field = document.querySelector('[data-bind="username"]')?.closest('.field');
    const trigger = field?.querySelector('.field-message-trigger');
    const popover = field?.querySelector('.field-message-popover');
    if (!(trigger instanceof HTMLElement) || !(popover instanceof HTMLElement)) {
      return { opened: false, text: '' };
    }
    trigger.click();
    const triggerBounds = trigger.getBoundingClientRect();
    const popoverBounds = popover.getBoundingClientRect();
    const text = popover.textContent?.trim() ?? '';
    const besideHint = Math.abs(popoverBounds.left - triggerBounds.left) < 2 &&
      (Math.abs(popoverBounds.top - triggerBounds.bottom - 6) < 2 ||
        Math.abs(popoverBounds.bottom - triggerBounds.top + 6) < 2);
    return {
      opened: popover.matches(':popover-open') && besideHint &&
      text === 'This deliberately long hint proves that supporting field messages stay on one reserved line across neighboring cards.',
      text,
      trigger: { top: triggerBounds.top, right: triggerBounds.right, bottom: triggerBounds.bottom, left: triggerBounds.left },
      popover: { top: popoverBounds.top, right: popoverBounds.right, bottom: popoverBounds.bottom, left: popoverBounds.left },
    };
  })()`);
  assert(
    responsiveHintState.opened,
    `responsive field hint did not open its complete text: ${
      JSON.stringify(responsiveHintState)
    }`,
  );
  await waitForPage(
    first,
    `document.querySelector('[data-bind="username"]')?.closest('.field')
      ?.querySelector('.field-message-trigger')?.getAttribute('aria-expanded') === 'true'`,
    "responsive field hint accessibility state",
  );
  await first.evaluate(`document.querySelector('[data-bind="username"]')
    ?.closest('.field')?.querySelector('.field-message-trigger')?.click()`);
  await first.command("Emulation.setDeviceMetricsOverride", {
    width: 800,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await waitForResponsiveFieldLayout(first, "tablet");
  await first.command("Emulation.setDeviceMetricsOverride", {
    width: 420,
    height: 900,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await waitForResponsiveFieldLayout(first, "mobile");
  await first.command("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await clickButton(first, "Back");
  await waitForScreen(first, "Welcome to 80|20");

  await clickRow(first, "the8020/demo/demo-master-detail");
  await waitForScreen(first, "Master-detail demonstration");
  assert(
    await first.evaluate<boolean>(`(() => {
      const split = document.querySelector(".layout-split");
      return split?.dataset.responsive === "stack" &&
        split?.style.getPropertyValue("--split-ratio") === "50fr 50fr";
    })()`),
    "master-detail split layout is not responsive 50/50 data",
  );
  await clickRow(first, "ORD-1002");
  await waitForPage(
    first,
    `document.querySelector('[data-bind="selectedOrder.customer"]')?.value === "Another Corp"`,
    "master-detail selection",
  );
  await clickButton(first, "Open form demo");
  await waitForScreen(first, "Form and binding demonstration");
  await clickButton(first, "Back");
  await waitForScreen(first, "Master-detail demonstration");
  await clickButton(first, "Throw ValueError");
  await waitForScreen(first, "Program terminated");
  assert(
    await first.evaluate<boolean>(`(() => {
      const text = document.querySelector(".screen")?.textContent ?? "";
      const properties = document.querySelector('[data-bind="properties"]')?.value ?? "";
      return text.includes("ValueError") && properties.includes("orderNumber") &&
        properties.includes("ORD-0");
    })()`),
    "custom ValueError short dump is missing custom exception properties",
  );
  await clickButton(first, "Home");
  await waitForScreen(first, "Welcome to 80|20");

  const second = await openPage(
    debugPort,
    `${primaryBase}/the8020/uui/shell/`,
  );
  pages.push(second);
  await waitForScreen(second, "Welcome to 80|20", 60_000);
  await waitForPage(
    second,
    `document.documentElement.dataset.theme === "dark" &&
      localStorage.getItem("the8020.uui.theme") === "dark" &&
      Object.entries(sessionStorage).some(([key, value]) => key.startsWith("the8020.uui.theme:session:") && value === "dark")`,
    "future tab inherited shared dark theme",
  );
  const isolated = await waitForUISessions(primaryRoot, 2);
  const secondSession = isolated.find((item) =>
    item.session_id !== firstSession.session_id
  );
  assert(
    secondSession !== undefined,
    "second browser tab reused a UUI session",
  );
  assert(
    secondSession.worker_id !== firstSession.worker_id,
    "two logical UUI sessions shared one Worker",
  );
  assert(secondSession.sandbox_id.length > 0, "second session has no sandbox");
  await clickSessionMenuAction(second, "#theme-toggle");
  await waitForPage(
    second,
    `document.documentElement.dataset.theme === "light" &&
      getComputedStyle(document.documentElement).getPropertyValue("--primary").trim() === "#5b5bd6" &&
      getComputedStyle(document.body).backgroundColor === "rgb(247, 248, 252)" &&
      getComputedStyle(document.querySelector(".screen")).backgroundColor === "rgba(0, 0, 0, 0)" &&
      getComputedStyle(document.querySelector(".layout-list")).backgroundColor === "rgb(255, 255, 255)" &&
      getComputedStyle(document.querySelector(".layout-list")).boxShadow !== "none" &&
      localStorage.getItem("the8020.uui.theme") === "light" &&
      Object.entries(sessionStorage).some(([key, value]) => key.startsWith("the8020.uui.theme:session:") && value === "light")`,
    "second session stored its light theme",
  );
  assert(
    await first.evaluate<boolean>(
      `document.documentElement.dataset.theme === "dark"`,
    ),
    "second session theme change replaced the first session theme",
  );
  await admin(primaryRoot, ["worker", "kill", firstSession.worker_id]);
  await waitFor(
    async () => {
      try {
        await admin(primaryRoot, ["worker", "inspect", firstSession.worker_id]);
        return false;
      } catch {
        return true;
      }
    },
    "single-Worker failure isolation",
    15_000,
  );
  await first.command("Page.navigate", { url: "about:blank" });
  await delay(250);
  await clickRow(second, "the8020/uui/sessions");
  await waitForScreen(second, "UUI sessions");
  await clickRow(second, firstSession.session_id);
  await waitForScreen(second, `UUI session ${firstSession.session_id}`);
  await waitForPage(
    second,
    `document.querySelector('[data-bind="liveState"]')?.value?.startsWith("STALE:") === true`,
    "failed Worker represented as stale package metadata",
  );
  await clickButton(second, "Clean stale metadata");
  await waitForScreen(second, "UUI sessions");
  await waitFor(
    async () => {
      const sessions = await uiSessions(primaryRoot);
      return sessions.length === 1 &&
        sessions[0]?.session_id === secondSession.session_id;
    },
    "package-owned stale-session cleanup",
    15_000,
  );
  const third = await openPage(
    debugPort,
    `${primaryBase}/the8020/uui/shell/`,
  );
  pages.push(third);
  await waitForScreen(third, "Welcome to 80|20");
  const terminable = await waitForUISessions(primaryRoot, 2);
  const thirdSession = terminable.find((item) =>
    item.session_id !== secondSession.session_id
  );
  assert(thirdSession !== undefined, "third browser session was not recorded");
  await clickButton(second, "Refresh");
  await waitForPage(
    second,
    `[...document.querySelectorAll(".data-list tbody tr")].some((item) => item.textContent?.includes(${
      JSON.stringify(thirdSession.session_id)
    }))`,
    "refreshed UUI session metadata",
  );
  await clickRow(second, thirdSession.session_id);
  await waitForScreen(second, `UUI session ${thirdSession.session_id}`);
  await clickButton(second, "Terminate");
  await waitForScreen(second, "UUI sessions");
  try {
    await waitForUISessions(primaryRoot, 1);
  } catch (error) {
    const worker = await admin(primaryRoot, [
      "worker",
      "inspect",
      thirdSession.worker_id,
    ]).catch((inspectionError) => ({
      error: inspectionError instanceof Error
        ? inspectionError.message
        : String(inspectionError),
    }));
    throw new Error(
      `${
        error instanceof Error ? error.message : String(error)
      }; expected retained session ${secondSession.session_id} and terminated session ${thirdSession.session_id}; target Worker ${
        JSON.stringify(worker)
      }; third-page frames ${
        websocketOutput(third, Math.max(0, third.websocketFrames.length - 12))
      }; third-page state ${await third.evaluate<string>(
        `JSON.stringify({location: location.href, notice: document.querySelector("#notice")?.textContent, connection: document.querySelector("#connection-state")?.textContent})`,
      )}; ${await latestKernelLog(primaryRoot)}`,
    );
  }
  await clickButton(second, "Back");
  await waitForScreen(second, "Welcome to 80|20");
  await clickRow(second, "the8020/demo/demo-form");
  await waitForScreen(second, "Form and binding demonstration");
  await clickButton(second, "Back");
  await waitForScreen(second, "Welcome to 80|20");

  await clickSessionMenuAction(second, "#session-logout");
  await waitForPage(
    second,
    `location.pathname === "/the8020/uui/login/" && document.querySelector("h1")?.textContent === "Sign in"`,
    "logout redirect",
  );
  const remainingCookies = await browserCookies(second);
  assert(
    !remainingCookies.some((item) => item.name === "the8020_auth"),
    "logout did not clear the authentication cookie",
  );
  await waitForUISessions(primaryRoot, 0);
  assert(
    pages.every((page) => page.exceptions.length === 0),
    `browser exceptions: ${
      pages.flatMap((page) => page.exceptions).join("; ")
    }`,
  );
  console.log(
    "Phase 1D browser E2E passed: login, browser-only persistent themes, responsive semantic field layouts, bounded Markdown and asynchronous messages, kernel-restart stale-route recovery, development Bash console, development activation and start/stop/restart/reset controls, package manifest/Git/content inspection, package-owned UUI session administration, service control, shared-node auth, programs, short dumps, recovery, reconnect, reload, isolation, and logout",
  );
} finally {
  for (const page of pages) page.close();
  if (browser !== undefined) await stopProcess(browser);
  for (const kernel of kernels.toReversed()) {
    await stopKernel(kernel);
  }
  await removeTemporaryRoot(temporaryRoot);
}

function parseOptions(arguments_: string[]): Options {
  const values = new Map<string, string>();
  for (const argument of arguments_) {
    const separator = argument.indexOf("=");
    if (!argument.startsWith("--") || separator < 3) {
      throw new Error(`invalid option ${argument}`);
    }
    values.set(argument.slice(2, separator), argument.slice(separator + 1));
  }
  const required = (name: string): string => {
    const value = values.get(name);
    if (value === undefined || value.length === 0) {
      throw new Error(`--${name}=... is required`);
    }
    return value;
  };
  return {
    sourceRoot: required("source-root"),
    packageWorkspace: required("package-workspace"),
    runtimeRoot: values.has("runtime-root")
      ? required("runtime-root")
      : required("source-root"),
    kernel: required("kernel"),
    admin: required("admin"),
    browser: required("browser"),
  };
}

async function prepareWorkspaces(
  options: Options,
  primary: string,
  secondary: string,
): Promise<void> {
  for (const root of [primary, secondary]) {
    await initializeInstance(options.kernel, root);
    await copyTree(
      `${options.sourceRoot}/defaults/config/runtime`,
      `${root}/node/kernel/runtime/definitions`,
    );
    await copyTree(`${options.sourceRoot}/defaults/scripts`, `${root}/scripts`);
    await linkTree(
      `${options.runtimeRoot}/node/kernel/runtime/images/rootless`,
      `${root}/node/kernel/runtime/images/rootless`,
    );
    await linkTree(
      `${options.runtimeRoot}/node/kernel/runtime/images/development`,
      `${root}/node/kernel/runtime/images/development`,
    );
    await Deno.mkdir(`${root}/node/kernel/bin`, { recursive: true });
    await linkFile(
      `${options.runtimeRoot}/node/kernel/bin/runsc`,
      `${root}/node/kernel/bin/runsc`,
    );
  }
  const manifest = await Deno.readTextFile(
    `${options.sourceRoot}/defaults/bootstrap-packages.toml`,
  );
  const packageIds = [...manifest.matchAll(/^id\s*=\s*"([^"]+)"$/gm)]
    .map((match) => match[1]!)
    .sort();
  for (const packageId of packageIds) {
    const repositoryName = packageId.split("/")[1];
    if (repositoryName === undefined) {
      throw new Error(`invalid bootstrap package ${packageId}`);
    }
    const repository = `${primary}/packages/${packageId}`;
    await copyTree(
      `${options.packageWorkspace}/${repositoryName}`,
      repository,
    );
    if (!await fileExists(`${repository}/.git`)) {
      await gitOutput("", ["init", "-q", "-b", "main", repository]);
    }
    await gitOutput(repository, ["add", "--all"]);
    await gitOutput(repository, [
      "-c",
      "user.name=Browser E2E",
      "-c",
      "user.email=browser-e2e@the8020.local",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--allow-empty",
      "--message=Browser E2E package snapshot",
    ]);
  }
  // Both nodes must expose the exact package set recorded by the shared test
  // database. Copying one committed snapshot keeps every commit identical.
  await copyTree(`${primary}/packages`, `${secondary}/packages`);
}

async function initializeInstance(kernel: string, root: string): Promise<void> {
  await Deno.mkdir(root, { recursive: true });
  const output = await new Deno.Command(kernel, {
    args: ["--root", root, "--init-defaults", "--init-only"],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(
      `initialize browser-E2E instance: ${
        new TextDecoder().decode(output.stderr).trim()
      }`,
    );
  }
}

async function copyTree(source: string, destination: string): Promise<void> {
  await Deno.mkdir(destination, { recursive: true });
  for await (const entry of Deno.readDir(source)) {
    const from = `${source}/${entry.name}`;
    const to = `${destination}/${entry.name}`;
    if (entry.isDirectory) await copyTree(from, to);
    else if (entry.isFile) await Deno.copyFile(from, to);
    else if (entry.isSymlink) {
      await Deno.symlink(await Deno.readLink(from), to);
    }
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

async function fileText(path: string): Promise<string> {
  return await Deno.readTextFile(path);
}

async function gitOutput(
  repository: string,
  arguments_: string[],
): Promise<string> {
  const output = await new Deno.Command("git", {
    args: ["-C", repository, ...arguments_],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(
      `git ${arguments_.join(" ")} failed in ${repository}: ${
        new TextDecoder().decode(output.stderr).trim()
      }`,
    );
  }
  return new TextDecoder().decode(output.stdout);
}

async function linkTree(
  source: string,
  destination: string,
  root = source,
): Promise<void> {
  await Deno.mkdir(destination, { recursive: true });
  for await (const entry of Deno.readDir(source)) {
    const from = `${source}/${entry.name}`;
    const to = `${destination}/${entry.name}`;
    if (entry.isDirectory) {
      await linkTree(from, to, root);
      continue;
    }
    if (entry.isFile) {
      await linkFile(from, to);
      continue;
    }
    if (entry.isSymlink) {
      const resolved = await resolveRootfsLink(root, from);
      if (resolved === undefined) continue;
      if (resolved.info.isDirectory) {
        if (resolved.path === root || source.startsWith(`${resolved.path}/`)) {
          continue;
        }
        await linkTree(resolved.path, to, root);
      } else if (resolved.info.isFile) {
        await linkFile(resolved.path, to);
      }
    }
  }
}

async function resolveRootfsLink(
  root: string,
  link: string,
): Promise<{ path: string; info: Deno.FileInfo } | undefined> {
  const rootPrefix = `${root}/`;
  if (!link.startsWith(rootPrefix)) {
    throw new Error(`rootfs link escaped source root: ${link}`);
  }
  const parent = link.slice(rootPrefix.length).split("/");
  parent.pop();
  const initialTarget = await Deno.readLink(link);
  const resolved = initialTarget.startsWith("/") ? [] : parent;
  const pending = initialTarget.split("/");
  let traversals = 0;
  while (pending.length > 0) {
    const component = pending.shift();
    if (component === undefined || component === "" || component === ".") {
      continue;
    }
    if (component === "..") {
      if (resolved.length === 0) {
        throw new Error(`rootfs link escaped source root: ${link}`);
      }
      resolved.pop();
      continue;
    }
    const candidate = `${root}/${[...resolved, component].join("/")}`;
    let info: Deno.FileInfo;
    try {
      info = await Deno.lstat(candidate);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }
    if (!info.isSymlink) {
      resolved.push(component);
      continue;
    }
    traversals++;
    if (traversals > 64) throw new Error(`rootfs symlink cycle: ${link}`);
    const target = await Deno.readLink(candidate);
    if (target.startsWith("/")) resolved.length = 0;
    pending.unshift(...target.split("/"));
  }
  const path = resolved.length === 0 ? root : `${root}/${resolved.join("/")}`;
  try {
    return { path, info: await Deno.lstat(path) };
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
}

async function linkFile(source: string, destination: string): Promise<void> {
  try {
    await Deno.link(source, destination);
  } catch {
    await Deno.copyFile(source, destination);
  }
}

function startKernel(
  root: string,
  port: number,
  sshPort: number,
  databaseLocation: string,
): KernelProcess {
  const child = new Deno.Command(options.kernel, {
    args: [
      "--root",
      root,
      "--set",
      `network.main_port=${port}`,
      "--set",
      `network.ssh_port=${sshPort}`,
      "--set",
      `database.location=${databaseLocation}`,
      "--set",
      "sandbox.runtime.mode=rootless",
      "--set",
      "sandbox.warm_pool.size=0",
    ],
    cwd: options.sourceRoot,
    stdout: "null",
    stderr: "inherit",
  }).spawn();
  return { root, child };
}

async function admin(
  root: string,
  arguments_: string[],
  input?: string,
): Promise<Record<string, unknown>> {
  const child = new Deno.Command(options.admin, {
    args: ["--root", root, "--json", ...arguments_],
    stdin: input === undefined ? "null" : "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  if (input !== undefined) {
    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode(input));
    await writer.close();
  }
  const output = await child.output();
  const text = new TextDecoder().decode(output.stdout).trim();
  if (!output.success) {
    const error = new TextDecoder().decode(output.stderr).trim();
    throw new Error(error || text || `${arguments_.join(" ")} failed`);
  }
  const envelope = JSON.parse(text) as {
    success?: boolean;
    result?: Record<string, unknown>;
    error?: { message?: string };
  };
  if (envelope.success !== true || envelope.result === undefined) {
    throw new Error(envelope.error?.message ?? "administrative command failed");
  }
  return envelope.result;
}

async function evaluatorExecutionCount(root: string): Promise<number> {
  const result = await admin(root, ["job", "list"]);
  const jobs = result.executions as Array<{ job_id?: string }> | undefined;
  return jobs?.filter((job) => job.job_id === "database-table-evaluator")
    .length ?? 0;
}

async function waitForServices(
  root: string,
  expected: string[],
): Promise<void> {
  let lastObservation = "service list was not available";
  try {
    await waitFor(
      async () => {
        try {
          const result = await admin(root, ["services.list"]);
          const services = result.services as
            | Array<{
              service_id?: string;
              state?: string;
              enabled?: boolean;
            }>
            | undefined;
          lastObservation = JSON.stringify(services ?? result);
          return services !== undefined &&
            expected.every((serviceId) =>
              services.some((service) =>
                service.service_id === serviceId && service.enabled === true &&
                (service.state === "IDLE" || service.state === "READY")
              )
            );
        } catch (error) {
          lastObservation = error instanceof Error
            ? error.message
            : String(error);
          return false;
        }
      },
      `enabled services in ${root}`,
      180_000,
      1_000,
    );
  } catch (error) {
    const inspections = await Promise.all(expected.map(async (serviceId) => {
      try {
        return await admin(root, ["services.inspect", serviceId]);
      } catch (inspectError) {
        return {
          service_id: serviceId,
          inspect_error: inspectError instanceof Error
            ? inspectError.message
            : String(inspectError),
        };
      }
    }));
    const log = await latestKernelLog(root);
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n` +
        `last service observation: ${lastObservation}\n` +
        `service inspections: ${JSON.stringify(inspections)}\n${log}`,
    );
  }
}

async function latestKernelLog(root: string): Promise<string> {
  const directory = `${root}/node/kernel/logs`;
  try {
    const candidates: Array<{ path: string; modified: number }> = [];
    for await (const entry of Deno.readDir(directory)) {
      if (!entry.isFile || !entry.name.endsWith(".log")) continue;
      const path = `${directory}/${entry.name}`;
      const info = await Deno.stat(path);
      candidates.push({ path, modified: info.mtime?.getTime() ?? 0 });
    }
    candidates.sort((left, right) => right.modified - left.modified);
    if (candidates.length === 0) return "kernel log: unavailable";
    const source = await Deno.readTextFile(candidates[0]!.path);
    return `kernel log tail:\n${source.slice(-8_000)}`;
  } catch (error) {
    return `kernel log: ${error instanceof Error ? error.message : error}`;
  }
}

async function waitForAdmin(root: string): Promise<void> {
  let lastError: unknown;
  try {
    await waitFor(
      async () => {
        try {
          await admin(root, ["kernel.status"]);
          return true;
        } catch (error) {
          lastError = error;
          return false;
        }
      },
      `kernel command bus in ${root}`,
      120_000,
      250,
    );
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}; ` +
        `last command error: ${
          lastError instanceof Error ? lastError.message : String(lastError)
        }; ${await latestKernelLog(root)}`,
    );
  }
}

async function uiSessions(root: string): Promise<UISession[]> {
  try {
    const result = await admin(root, [
      "db.sql",
      `SELECT "sessionId", "nodeId", "runtimeGroupId", "workerId", "sandboxId", "state" FROM "the8020__uui__sessions" ORDER BY "sessionId" LIMIT 200`,
    ]);
    const rows = result.rows as unknown[][] | undefined;
    return (rows ?? []).flatMap((row) => {
      if (row.length !== 6 || row.some((value) => typeof value !== "string")) {
        return [];
      }
      return [{
        session_id: row[0] as string,
        node_id: row[1] as string,
        runtime_group_id: row[2] as string,
        worker_id: row[3] as string,
        sandbox_id: row[4] as string,
        state: row[5] as string,
      }];
    });
  } catch {
    return [];
  }
}

async function waitForUISessions(
  root: string,
  count: number,
): Promise<UISession[]> {
  let sessions: UISession[] = [];
  try {
    await waitFor(
      async () => {
        sessions = await uiSessions(root);
        return sessions.length === count;
      },
      `${count} UUI sessions`,
      15_000,
    );
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}; observed ${
        JSON.stringify(sessions)
      }`,
    );
  }
  return sessions;
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

async function browserCookies(
  page: BrowserPage,
): Promise<Array<{ name: string; value: string; httpOnly?: boolean }>> {
  const response = await page.command<{
    cookies: Array<{ name: string; value: string; httpOnly?: boolean }>;
  }>("Network.getAllCookies");
  return response.cookies;
}

async function authenticationCookie(
  page: BrowserPage,
): Promise<{ name: string; value: string; httpOnly?: boolean }> {
  const cookie = (await browserCookies(page)).find((item) =>
    item.name === "the8020_auth"
  );
  if (cookie === undefined) throw new Error("authentication cookie is missing");
  return cookie;
}

function websocketOutput(page: BrowserPage, start: number): string {
  const decoder = new TextDecoder();
  return page.websocketFrames.slice(start).map((frame) => {
    if (frame.opcode !== 2) return frame.payloadData;
    const binary = atob(frame.payloadData);
    return decoder.decode(
      Uint8Array.from(binary, (character) => character.charCodeAt(0)),
      { stream: true },
    );
  }).join("");
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
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  assert(changed, `missing input ${selector}`);
}

async function setChecked(
  page: BrowserPage,
  selector: string,
  checked: boolean,
): Promise<void> {
  const changed = await page.evaluate<boolean>(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!(input instanceof HTMLInputElement) || input.type !== "checkbox") return false;
    input.checked = ${JSON.stringify(checked)};
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  assert(changed, `missing checkbox ${selector}`);
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

async function clickSessionMenuAction(
  page: BrowserPage,
  selector: string,
): Promise<void> {
  const clicked = await page.evaluate<boolean>(`(() => {
    const menu = document.querySelector("#session-menu");
    const toggle = document.querySelector("#session-menu-toggle");
    const action = document.querySelector(${JSON.stringify(selector)});
    if (!(menu instanceof HTMLDetailsElement) || !(toggle instanceof HTMLElement) ||
      !(action instanceof HTMLButtonElement)) return false;
    if (!menu.open) toggle.click();
    if (!menu.open) return false;
    action.click();
    return true;
  })()`);
  assert(clicked, `missing session-menu action ${selector}`);
}

async function enterTerminal(
  page: BrowserPage,
  command: string,
): Promise<void> {
  await click(page, ".xterm-helper-textarea");
  await page.command("Input.insertText", { text: command });
  await page.command("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Enter",
    code: "Enter",
    text: "\r",
    unmodifiedText: "\r",
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
  });
  await page.command("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
  });
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

async function dragTerminalSelection(page: BrowserPage): Promise<void> {
  const points = await page.evaluate<{
    startX: number;
    startY: number;
    endX: number;
  }>(`(() => {
    const screen = document.querySelector(".xterm-screen");
    if (!(screen instanceof HTMLElement)) throw new Error("terminal screen is missing");
    const rect = screen.getBoundingClientRect();
    return {
      startX: rect.left + 8,
      startY: rect.top + 8,
      endX: Math.min(rect.right - 8, rect.left + 160),
    };
  })()`);
  await page.command("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: points.startX,
    y: points.startY,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  await page.command("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: points.endX,
    y: points.startY,
    button: "left",
    buttons: 1,
  });
  await page.command("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: points.endX,
    y: points.startY,
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
}

async function clickButton(page: BrowserPage, label: string): Promise<void> {
  const clicked = await page.evaluate<boolean>(`(() => {
    const target = [...document.querySelectorAll("button")].find((item) =>
      item.textContent?.trim() === ${
    JSON.stringify(label)
  } || item.getAttribute("aria-label") === ${JSON.stringify(label)});
    if (!(target instanceof HTMLButtonElement)) return false;
    target.click();
    return true;
  })()`);
  assert(clicked, `missing ${label} button`);
}

async function clickRow(page: BrowserPage, text: string): Promise<void> {
  const clicked = await page.evaluate<boolean>(`(() => {
    const target = [...document.querySelectorAll(".data-list tbody tr")].find((item) => item.textContent?.includes(${
    JSON.stringify(text)
  }));
    if (!(target instanceof HTMLTableRowElement)) return false;
    target.click();
    return true;
  })()`);
  assert(clicked, `missing row containing ${text}`);
}

async function waitForScreen(
  page: BrowserPage,
  title: string,
  timeout = 10_000,
): Promise<void> {
  await waitForPage(
    page,
    `document.querySelector("#connection-state")?.textContent === "Connected" && document.querySelector(".screen > h1.screen-title")?.textContent?.trim() === ${
      JSON.stringify(title)
    } && document.title === ${JSON.stringify(`80|20 ${title}`)}`,
    title,
    timeout,
  );
}

function responsiveFieldLayoutExpression(
  mode: "desktop" | "tablet" | "mobile",
): string {
  return `(() => {
    const ratio = (bind) => {
      const input = document.querySelector('[data-bind="' + bind + '"]');
      const field = input?.closest('.field');
      const fields = field?.closest('.field-group-fields');
      if (!(field instanceof HTMLElement) || !(fields instanceof HTMLElement)) return 0;
      return field.getBoundingClientRect().width / fields.getBoundingClientRect().width;
    };
    const sameRow = (left, right) => Math.abs(left - right) < 2;
    const fieldFor = (bind) => document.querySelector('[data-bind="' + bind + '"]')?.closest('.field');
    const twoCards = [...document.querySelectorAll('[data-layout-id="two-group-grid"] > .layout-field-group')]
      .map((item) => item.getBoundingClientRect());
    const fourCards = [...document.querySelectorAll('[data-layout-id="four-group-grid"] > .layout-field-group')]
      .map((item) => item.getBoundingClientRect());
    const two = twoCards.map((item) => item.top);
    const four = fourCards.map((item) => item.top);
    const verticallySpaced = (items) => items.slice(1).every((item, index) =>
      Math.abs(item.top - items[index].bottom - 24) < 0.5
    );
    const section = document.querySelector('[data-layout-id="lengths-section"]');
    const card = document.querySelector('[data-layout-id="lengths-group"]');
    const sectionStyle = section instanceof HTMLElement ? getComputedStyle(section) : undefined;
    const cardStyle = card instanceof HTMLElement ? getComputedStyle(card) : undefined;
    const hierarchy = section?.querySelector(':scope > .section-title')?.tagName === 'H1' &&
      sectionStyle?.backgroundColor === 'rgba(0, 0, 0, 0)' &&
      cardStyle?.backgroundColor === 'rgb(25, 29, 42)' &&
      cardStyle?.boxShadow !== 'none' &&
      document.querySelector('[data-bind="shortOne"]')?.closest('.field')?.dataset.fieldLength === 'short' &&
      document.querySelector('[data-bind="mediumOne"]')?.closest('.field')?.dataset.fieldLength === 'medium' &&
      document.querySelector('[data-bind="longOne"]')?.closest('.field')?.dataset.fieldLength === 'long';
    const short = ratio('shortOne');
    const medium = ratio('mediumOne');
    const long = ratio('longOne');
    const usernameField = fieldFor('username');
    const languageField = fieldFor('language');
    const roleField = fieldFor('role');
    const localeField = fieldFor('locale');
    const usernameMessage = usernameField?.querySelector(':scope > .field-message');
    const languageMessage = languageField?.querySelector(':scope > .field-message');
    const usernameTrigger = usernameMessage?.querySelector('.field-message-trigger');
    const usernamePopover = usernameMessage?.querySelector('.field-message-popover');
    const hintStyle = usernameTrigger instanceof HTMLElement
      ? getComputedStyle(usernameTrigger)
      : undefined;
    const alignedSiblingMessageRows = ${JSON.stringify(mode)} === 'mobile' ||
      (usernameField instanceof HTMLElement && languageField instanceof HTMLElement &&
        roleField instanceof HTMLElement && localeField instanceof HTMLElement &&
        sameRow(usernameField.getBoundingClientRect().top, languageField.getBoundingClientRect().top) &&
        sameRow(roleField.getBoundingClientRect().top, localeField.getBoundingClientRect().top));
    const fieldMessages = usernameMessage instanceof HTMLElement &&
      languageMessage instanceof HTMLElement && usernameTrigger instanceof HTMLElement &&
      usernamePopover instanceof HTMLElement && alignedSiblingMessageRows &&
      usernameMessage.dataset.messageKind === 'hint' &&
      languageMessage.dataset.messageKind === 'none' &&
      languageMessage.querySelector('.field-message-trigger') === null &&
      Math.abs(usernameMessage.getBoundingClientRect().height -
        languageMessage.getBoundingClientRect().height) < 0.5 &&
      hintStyle?.whiteSpace === 'nowrap' && hintStyle.overflowX === 'hidden' &&
      hintStyle.textOverflow === 'ellipsis' &&
      hintStyle.cursor === 'help' && hintStyle.textDecorationLine === 'underline' &&
      hintStyle.textDecorationStyle === 'dotted' &&
      usernameTrigger.scrollHeight <= usernameTrigger.clientHeight + 1 &&
      usernameTrigger.scrollWidth > usernameTrigger.clientWidth &&
      usernameTrigger.getAttribute('role') === 'button' &&
      usernameMessage.dataset.messageOverflow === 'true' &&
      usernamePopover.getAttribute('popover') === 'auto' &&
      usernamePopover.getAttribute('role') === 'tooltip';
    const spanningNote = document.querySelector('[data-bind="spanningNote"]');
    const spanningTextarea = spanningNote instanceof HTMLTextAreaElement ? spanningNote : undefined;
    const spanningField = spanningTextarea?.closest('.field');
    const spanningShortOne = document.querySelector('[data-bind="spanningShortOne"]')?.closest('.field');
    const spanningShortTwo = document.querySelector('[data-bind="spanningShortTwo"]')?.closest('.field');
    const spanningLong = document.querySelector('[data-bind="spanningLong"]')?.closest('.field');
    const spanningShortOneLabel = spanningShortOne?.querySelector(':scope > label');
    const spanningShortOneLabelStyle = spanningShortOneLabel instanceof HTMLElement
      ? getComputedStyle(spanningShortOneLabel)
      : undefined;
    const spanningBounds = spanningField?.getBoundingClientRect();
    const spanningShortOneBounds = spanningShortOne?.getBoundingClientRect();
    const spanningShortTwoBounds = spanningShortTwo?.getBoundingClientRect();
    const spanningLongBounds = spanningLong?.getBoundingClientRect();
    const spanningMessage = spanningField?.querySelector(':scope > .field-message');
    const spanningText = spanningMessage?.querySelector('.field-message-text');
    const spanningTextStyle = spanningText instanceof HTMLElement
      ? getComputedStyle(spanningText)
      : undefined;
    const spanningTextOverflows = spanningText instanceof HTMLElement &&
      spanningText.scrollWidth > spanningText.clientWidth + 0.5;
    const spanningHintBehavior = spanningText instanceof HTMLElement &&
      (spanningTextOverflows
        ? spanningText.classList.contains('field-message-trigger') &&
          spanningText.getAttribute('role') === 'button' &&
          spanningTextStyle?.cursor === 'help' &&
          spanningTextStyle.textDecorationLine === 'underline'
        : !spanningText.classList.contains('field-message-trigger') &&
          spanningText.getAttribute('role') === null &&
          spanningTextStyle?.userSelect === 'text' &&
          spanningTextStyle.textDecorationLine === 'none' &&
          spanningTextStyle.cursor === 'text');
    const spanningLongMessage = spanningLong?.querySelector(':scope > .field-message');
    const spanningMessageBounds = spanningMessage?.getBoundingClientRect();
    const spanningLongMessageBounds = spanningLongMessage?.getBoundingClientRect();
    const spanningGrid = spanningField?.closest('.field-group-fields');
    const spanningGridStyle = spanningGrid instanceof HTMLElement
      ? getComputedStyle(spanningGrid)
      : undefined;
    const exactSpanHeight = spanningGridStyle === undefined ? 0 :
      parseFloat(spanningGridStyle.gridAutoRows) * 2 + parseFloat(spanningGridStyle.rowGap);
    const rowSpans = spanningField instanceof HTMLElement &&
      spanningShortOne instanceof HTMLElement && spanningShortTwo instanceof HTMLElement &&
      spanningLong instanceof HTMLElement && spanningTextarea !== undefined &&
      spanningShortOneLabel instanceof HTMLLabelElement &&
      spanningMessage instanceof HTMLElement && spanningLongMessage instanceof HTMLElement &&
      spanningHintBehavior &&
      spanningField.dataset.fieldRowSpan === '2' && getComputedStyle(spanningTextarea).resize === 'none' &&
      spanningShortOneLabelStyle?.whiteSpace === 'nowrap' &&
      spanningShortOneLabelStyle.overflowX === 'hidden' &&
      spanningShortOneLabelStyle.textOverflow === 'ellipsis' &&
      spanningShortOneLabel.scrollHeight <= spanningShortOneLabel.clientHeight + 1 &&
      spanningShortOneLabel.scrollWidth > spanningShortOneLabel.clientWidth &&
      Math.abs(spanningBounds.height - exactSpanHeight) < 2 &&
      Math.abs(spanningTextarea.getBoundingClientRect().bottom - spanningMessageBounds.top) < 2 &&
      spanningMessageBounds.height > 0 && spanningLongMessageBounds.height > 0 &&
      (${JSON.stringify(mode)} === 'desktop'
        ? sameRow(spanningBounds.top, spanningShortOneBounds.top) &&
          sameRow(spanningBounds.top, spanningShortTwoBounds.top) &&
          spanningLongBounds.top > spanningShortOneBounds.bottom + 10 &&
          sameRow(spanningBounds.bottom, spanningLongBounds.bottom) &&
          sameRow(spanningMessageBounds.bottom, spanningLongMessageBounds.bottom)
        : spanningShortOneBounds.top > spanningBounds.bottom + 10 &&
          sameRow(spanningShortOneBounds.top, spanningShortTwoBounds.top) &&
          spanningLongBounds.top > spanningShortOneBounds.bottom + 10);
    const layout = ${JSON.stringify(mode)} === 'desktop'
      ? short > 0.10 && short < 0.14 && medium > 0.22 && medium < 0.28 && long > 0.47 && long < 0.52 &&
        two.length === 2 && sameRow(two[0], two[1]) && four.length === 4 && four.every((top) => sameRow(top, four[0]))
      : ${JSON.stringify(mode)} === 'tablet'
      ? short > 0.22 && short < 0.27 && medium > 0.47 && medium < 0.52 && long > 0.95 &&
        two.length === 2 && sameRow(two[0], two[1]) && four.length === 4 &&
        sameRow(four[0], four[1]) && sameRow(four[2], four[3]) && four[2] > four[0] + 10
      : short > 0.46 && short < 0.51 && medium > 0.95 && long > 0.95 &&
        two.length === 2 && two[1] > two[0] + 10 && four.length === 4 &&
        four[1] > four[0] + 10 && four[2] > four[1] + 10 && four[3] > four[2] + 10 &&
        verticallySpaced(twoCards) && verticallySpaced(fourCards);
    return hierarchy && layout && fieldMessages && rowSpans;
  })()`;
}

async function waitForResponsiveFieldLayout(
  page: BrowserPage,
  mode: "desktop" | "tablet" | "mobile",
): Promise<void> {
  try {
    await waitForPage(
      page,
      responsiveFieldLayoutExpression(mode),
      `${mode} semantic field layout`,
    );
  } catch (error) {
    const state = await page.evaluate(
      responsiveFieldLayoutDiagnosticsExpression(),
    );
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}; state: ${
        JSON.stringify(state)
      }`,
    );
  }
}

function responsiveFieldLayoutDiagnosticsExpression(): string {
  return `(() => {
    const ratio = (bind) => {
      const input = document.querySelector('[data-bind="' + bind + '"]');
      const field = input?.closest('.field');
      const fields = field?.closest('.field-group-fields');
      return {
        length: field?.dataset.fieldLength,
        field: field?.getBoundingClientRect().width,
        container: fields?.getBoundingClientRect().width,
      };
    };
    const tops = (id) => [...document.querySelectorAll('[data-layout-id="' + id + '"] > .layout-field-group')]
      .map((item) => item.getBoundingClientRect().top);
    const bounds = (bind) => {
      const input = document.querySelector('[data-bind="' + bind + '"]');
      const field = input?.closest('.field');
      if (!(field instanceof HTMLElement)) return undefined;
      const rect = field.getBoundingClientRect();
      const inputRect = input?.getBoundingClientRect();
      const message = field.querySelector(':scope > .field-message');
      const messageRect = message?.getBoundingClientRect();
      const trigger = message?.querySelector('.field-message-trigger');
      const grid = field.closest('.field-group-fields');
      const label = field.querySelector(':scope > :is(label, legend)');
      return {
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        inputBottom: inputRect?.bottom,
        label: label instanceof HTMLElement ? {
          width: label.clientWidth,
          scrollWidth: label.scrollWidth,
          height: label.clientHeight,
          scrollHeight: label.scrollHeight,
          whiteSpace: getComputedStyle(label).whiteSpace,
          textOverflow: getComputedStyle(label).textOverflow,
          overflowX: getComputedStyle(label).overflowX,
        } : undefined,
        message: messageRect === undefined ? undefined : {
          top: messageRect.top,
          bottom: messageRect.bottom,
          width: messageRect.width,
          height: messageRect.height,
          kind: message?.dataset.messageKind,
          triggerWidth: trigger?.clientWidth,
          triggerScrollWidth: trigger?.scrollWidth,
          triggerHeight: trigger?.clientHeight,
          triggerScrollHeight: trigger?.scrollHeight,
          whiteSpace: trigger instanceof HTMLElement ? getComputedStyle(trigger).whiteSpace : undefined,
          textOverflow: trigger instanceof HTMLElement ? getComputedStyle(trigger).textOverflow : undefined,
          overflowX: trigger instanceof HTMLElement ? getComputedStyle(trigger).overflowX : undefined,
        },
        rowSpan: field.dataset.fieldRowSpan,
        gridColumn: getComputedStyle(field).gridColumn,
        gridRow: getComputedStyle(field).gridRow,
        gridAutoRows: grid instanceof HTMLElement ? getComputedStyle(grid).gridAutoRows : undefined,
        gridRowGap: grid instanceof HTMLElement ? getComputedStyle(grid).rowGap : undefined,
        resize: input instanceof HTMLTextAreaElement ? getComputedStyle(input).resize : undefined,
      };
    };
    const section = document.querySelector('[data-layout-id="lengths-section"]');
    const card = document.querySelector('[data-layout-id="lengths-group"]');
    return {
      viewport: [innerWidth, innerHeight, devicePixelRatio],
      short: ratio('shortOne'),
      medium: ratio('mediumOne'),
      long: ratio('longOne'),
      username: bounds('username'),
      language: bounds('language'),
      role: bounds('role'),
      locale: bounds('locale'),
      spanningNote: bounds('spanningNote'),
      spanningShortOne: bounds('spanningShortOne'),
      spanningShortTwo: bounds('spanningShortTwo'),
      spanningLong: bounds('spanningLong'),
      two: tops('two-group-grid'),
      four: tops('four-group-grid'),
      sectionTitle: section?.querySelector(':scope > .section-title')?.tagName,
      sectionBackground: section instanceof HTMLElement ? getComputedStyle(section).backgroundColor : '',
      cardBackground: card instanceof HTMLElement ? getComputedStyle(card).backgroundColor : '',
      cardShadow: card instanceof HTMLElement ? getComputedStyle(card).boxShadow : '',
    };
  })()`;
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
        return await page.evaluate<boolean>(expression || "false");
      } catch {
        return false;
      }
    },
    description,
    timeout,
  );
}

async function assertThemeInitializedBeforePaint(
  page: BrowserPage,
  expected: "light" | "dark",
  description: string,
): Promise<void> {
  const observation = await page.evaluate<{
    theme: string;
    initializerTheme: string;
    initializerAt: number | null;
    firstPaint: number | null;
    firstAnimationFrame: number | null;
    transitions: Array<{ theme: string; at: number }>;
  }>(`(() => {
    const initializer = window.__the8020InitialThemeApplied;
    const paints = performance.getEntriesByType("paint");
    return {
      theme: document.documentElement.dataset.theme ?? "",
      initializerTheme: initializer?.theme ?? "",
      initializerAt: initializer?.at ?? null,
      firstPaint: paints.length > 0
        ? Math.min(...paints.map((entry) => entry.startTime))
        : null,
      firstAnimationFrame: window.__the8020FirstAnimationFrame ?? null,
      transitions: window.__the8020ThemeTransitions ?? [],
    };
  })()`);
  assert(
    observation.theme === expected && observation.initializerTheme === expected,
    `${description} initialized the wrong theme: ${
      JSON.stringify(observation)
    }`,
  );
  const firstRenderBoundary = observation.firstPaint ??
    observation.firstAnimationFrame;
  assert(
    observation.initializerAt !== null && firstRenderBoundary !== null &&
      observation.initializerAt <= firstRenderBoundary,
    `${description} theme initializer ran after first paint: ${
      JSON.stringify(observation)
    }`,
  );
  assert(
    observation.transitions.length > 0 &&
      observation.transitions.at(-1)?.theme === expected &&
      observation.transitions.every((transition) =>
        transition.theme === expected ||
        transition.at <= (firstRenderBoundary ?? -1)
      ),
    `${description} changed away from ${expected} after first paint: ${
      JSON.stringify(observation)
    }`,
  );
}

async function waitForHTTP(url: string): Promise<void> {
  await waitFor(
    async () => {
      try {
        const response = await fetch(url, { redirect: "manual" });
        await response.body?.cancel();
        return response.status > 0;
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
  interval = 50,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!(await predicate())) {
    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for ${description}`);
    }
    await delay(interval);
  }
}

function freePort(): number {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  return port;
}

function stopChild(child: Deno.ChildProcess): void {
  try {
    child.kill("SIGKILL");
  } catch {
    // The process already exited.
  }
}

async function stopProcess(child: Deno.ChildProcess): Promise<void> {
  stopChild(child);
  await child.status.catch(() => {});
}

async function stopKernel(kernel: KernelProcess): Promise<void> {
  try {
    await admin(kernel.root, ["kernel.shutdown"]);
  } catch {
    await stopProcess(kernel.child);
    return;
  }
  const exited = await Promise.race([
    kernel.child.status.then(() => true, () => true),
    delay(15_000).then(() => false),
  ]);
  if (!exited) await stopProcess(kernel.child);
}

async function removeTemporaryRoot(root: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await Deno.remove(root, { recursive: true });
      return;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return;
      lastError = error;
      await delay(100 * (attempt + 1));
    }
  }
  console.error(
    `Phase 1D E2E cleanup could not remove ${root}: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
