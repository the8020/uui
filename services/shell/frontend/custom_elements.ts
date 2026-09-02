import { CanvasAddon } from "@xterm/addon-canvas";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import type { CustomElementDescriptor } from "@packages/the8020/uui/mod.ts";
import { renderIconText } from "./icon_text.ts";

interface CustomElementInstance {
  readonly element: HTMLElement;
  update(config: Record<string, unknown>): void;
  dispose(): void;
}

interface Entry {
  initializer: string;
  instance: CustomElementInstance;
  used: boolean;
}

export class CustomElementRenderer {
  readonly #entries = new Map<string, Entry>();

  begin(): void {
    for (const entry of this.#entries.values()) entry.used = false;
  }

  render(descriptor: CustomElementDescriptor): HTMLElement {
    let entry = this.#entries.get(descriptor.id);
    if (
      entry !== undefined &&
      (!descriptor.preserve || entry.initializer !== descriptor.initializer)
    ) {
      entry.instance.dispose();
      this.#entries.delete(descriptor.id);
      entry = undefined;
    }
    if (entry === undefined) {
      entry = {
        initializer: descriptor.initializer,
        instance: initialize(descriptor.initializer, descriptor.config),
        used: true,
      };
      this.#entries.set(descriptor.id, entry);
    } else {
      entry.instance.update(descriptor.config);
      entry.used = true;
    }
    entry.instance.element.dataset.customElementId = descriptor.id;
    return entry.instance.element;
  }

  end(): void {
    for (const [id, entry] of this.#entries) {
      if (entry.used) continue;
      entry.instance.dispose();
      this.#entries.delete(id);
    }
  }

  dispose(): void {
    for (const entry of this.#entries.values()) entry.instance.dispose();
    this.#entries.clear();
  }
}

function initialize(
  initializer: string,
  config: Record<string, unknown>,
): CustomElementInstance {
  if (initializer === "sandbox-console.v1") {
    return new SandboxConsole(config);
  }
  const element = document.createElement("div");
  element.className = "custom-element-error";
  renderIconText(
    element,
    `Unsupported custom element initializer: ${initializer}`,
  );
  return { element, update() {}, dispose() {} };
}

interface ConsoleConfiguration {
  websocketPath: string;
  target: { kind: "runtime" | "development"; sandboxId: string };
  arguments: string[];
  environment: string[];
  workingDirectory: string;
}

class SandboxConsole implements CustomElementInstance {
  readonly element = document.createElement("div");
  readonly #terminal = new Terminal({
    cursorBlink: true,
    convertEol: false,
    scrollback: 5_000,
    fontFamily:
      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontSize: 14,
    theme: {
      background: "#0d1117",
      foreground: "#e6edf3",
      cursor: "#58a6ff",
      selectionBackground: "rgba(88, 166, 255, 0.62)",
      selectionInactiveBackground: "rgba(88, 166, 255, 0.42)",
    },
  });
  readonly #fit = new FitAddon();
  readonly #encoder = new TextEncoder();
  readonly #status = document.createElement("div");
  readonly #viewport = document.createElement("div");
  readonly #resizeObserver: ResizeObserver;
  #socket: WebSocket | undefined;
  #reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  #path = "";
  #configuration: ConsoleConfiguration | undefined;
  #signature = "";
  #enabled = false;
  #disposed = false;

  constructor(config: Record<string, unknown>) {
    this.element.className = "sandbox-console";
    this.#status.className = "sandbox-console-status";
    this.#viewport.className = "sandbox-console-viewport";
    this.element.append(this.#status, this.#viewport);
    this.#terminal.loadAddon(this.#fit);
    this.#terminal.open(this.#viewport);
    try {
      this.#terminal.loadAddon(new CanvasAddon());
    } catch {
      // xterm's DOM renderer remains available when Canvas2D is unavailable.
    }
    this.#terminal.onData((data) => {
      if (this.#socket?.readyState === WebSocket.OPEN) {
        this.#socket.send(this.#encoder.encode(data));
      }
    });
    this.#terminal.onSelectionChange(() => {
      this.element.dataset.hasSelection = this.#terminal.hasSelection()
        ? "true"
        : "false";
    });
    this.#terminal.onResize(({ cols, rows }) => this.#sendResize(cols, rows));
    this.#resizeObserver = new ResizeObserver(() => this.#fitTerminal());
    this.#resizeObserver.observe(this.element);
    this.element.addEventListener("click", () => this.#terminal.focus());
    this.update(config);
  }

  update(config: Record<string, unknown>): void {
    const enabled = config.enabled === true;
    const parsed = parseConsoleConfiguration(config);
    if (parsed === undefined) {
      this.#enabled = false;
      delete this.element.dataset.consoleTarget;
      renderIconText(this.#status, "Terminal configuration is invalid");
      this.#disconnect();
      return;
    }
    const signature = JSON.stringify(parsed);
    const changed = signature !== this.#signature;
    this.#path = parsed.websocketPath;
    this.#configuration = parsed;
    this.#signature = signature;
    this.#enabled = enabled;
    this.element.dataset.consoleTarget =
      `${parsed.target.kind}:${parsed.target.sandboxId}`;
    if (!enabled) {
      renderIconText(this.#status, "Start the sandbox to open a terminal");
      this.#disconnect();
      return;
    }
    if (changed) this.#disconnect();
    this.#connect();
    queueMicrotask(() => this.#fitTerminal());
  }

  dispose(): void {
    this.#disposed = true;
    this.#enabled = false;
    this.#resizeObserver.disconnect();
    this.#disconnect();
    this.#terminal.dispose();
  }

  #connect(): void {
    if (
      this.#disposed || !this.#enabled || this.#socket !== undefined ||
      this.#reconnectTimer !== undefined
    ) return;
    renderIconText(this.#status, "Connecting terminal…");
    const url = new URL(this.#path, location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(
      url,
      "the8020.console.v1",
    );
    socket.binaryType = "arraybuffer";
    this.#socket = socket;
    socket.addEventListener("open", () => {
      const configuration = this.#configuration;
      if (configuration === undefined) {
        socket.close(1008, "console configuration unavailable");
        return;
      }
      renderIconText(this.#status, "Terminal connected");
      this.#fitTerminal();
      socket.send(JSON.stringify({
        type: "open",
        target: configuration.target,
        arguments: configuration.arguments,
        environment: configuration.environment,
        workingDirectory: configuration.workingDirectory,
        columns: this.#terminal.cols,
        rows: this.#terminal.rows,
      }));
      this.#terminal.focus();
    });
    socket.addEventListener("message", (event) => {
      if (event.data instanceof ArrayBuffer) {
        this.#terminal.write(new Uint8Array(event.data));
        return;
      }
      if (event.data instanceof Blob) {
        void event.data.arrayBuffer().then((data) =>
          this.#terminal.write(new Uint8Array(data))
        );
        return;
      }
      if (typeof event.data !== "string") return;
      try {
        const message = JSON.parse(event.data) as {
          type?: unknown;
          message?: unknown;
        };
        if (message.type === "error" && typeof message.message === "string") {
          this.#enabled = false;
          renderIconText(this.#status, message.message);
          this.#terminal.writeln(`\r\n\x1b[31m${message.message}\x1b[0m`);
          socket.close(1008, "console open failed");
        }
      } catch {
        renderIconText(this.#status, "Terminal protocol error");
      }
    });
    socket.addEventListener("close", () => {
      if (this.#socket !== socket) return;
      this.#socket = undefined;
      if (!this.#enabled || this.#disposed) return;
      renderIconText(this.#status, "Terminal disconnected; reconnecting…");
      this.#reconnectTimer = setTimeout(() => {
        this.#reconnectTimer = undefined;
        this.#connect();
      }, 1_000);
    });
    socket.addEventListener("error", () => socket.close());
  }

  #disconnect(): void {
    if (this.#reconnectTimer !== undefined) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = undefined;
    }
    const socket = this.#socket;
    this.#socket = undefined;
    socket?.close(1000, "terminal element disconnected");
  }

  #fitTerminal(): void {
    if (!this.element.isConnected || this.element.clientWidth === 0) return;
    try {
      this.#fit.fit();
    } catch {
      return;
    }
  }

  #sendResize(cols: number, rows: number): void {
    if (this.#socket?.readyState !== WebSocket.OPEN) return;
    this.#socket.send(JSON.stringify({
      type: "resize",
      columns: cols,
      rows,
    }));
  }
}

function safeWebSocketPath(value: string): boolean {
  if (!value.startsWith("/") || value.startsWith("//")) return false;
  try {
    const url = new URL(value, location.href);
    return url.origin === location.origin &&
      (url.protocol === "http:" || url.protocol === "https:");
  } catch {
    return false;
  }
}

function parseConsoleConfiguration(
  value: Record<string, unknown>,
): ConsoleConfiguration | undefined {
  const websocketPath = typeof value.websocketPath === "string"
    ? value.websocketPath
    : "";
  if (!safeWebSocketPath(websocketPath)) return undefined;
  const target = value.target;
  if (
    target === null || typeof target !== "object" || Array.isArray(target)
  ) return undefined;
  const candidate = target as Record<string, unknown>;
  if (
    candidate.kind !== "runtime" && candidate.kind !== "development" ||
    typeof candidate.sandboxId !== "string" || candidate.sandboxId.length === 0
  ) return undefined;
  if (
    !Array.isArray(value.arguments) || value.arguments.length === 0 ||
    !value.arguments.every((item) => typeof item === "string") ||
    !Array.isArray(value.environment) ||
    !value.environment.every((item) => typeof item === "string") ||
    typeof value.workingDirectory !== "string"
  ) return undefined;
  return {
    websocketPath,
    target: {
      kind: candidate.kind,
      sandboxId: candidate.sandboxId,
    },
    arguments: [...value.arguments],
    environment: [...value.environment],
    workingDirectory: value.workingDirectory,
  };
}
