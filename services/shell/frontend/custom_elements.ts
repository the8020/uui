import type {
  ControlDescriptor,
  CustomElementDescriptor,
  ScreenElementState,
} from "../../../protocol.ts";
import type {
  CustomElementInstance,
  MountCustomElement,
} from "../../../custom_element.ts";
import { validBrowserAssetURL } from "../../../browser_assets.ts";
import { renderIconText } from "./icon_text.ts";

interface HostCallbacks {
  send(action: string, value?: unknown): void;
  state(id: string): ScreenElementState;
  value(control: ControlDescriptor): unknown;
  change(control: ControlDescriptor, value: unknown): void;
}

interface Style {
  element: HTMLLinkElement;
  ready: Promise<void>;
  cancel(): void;
  references: number;
}
const styles = new Map<string, Style>();

function acquireStyle(url: string): { ready: Promise<void>; release(): void } {
  let style = styles.get(url);
  if (!style) {
    const element = document.createElement("link");
    element.rel = "stylesheet";
    element.href = url;
    let cancel = () => {};
    const ready = new Promise<void>((resolve, reject) => {
      cancel = () =>
        reject(new DOMException("Stylesheet released", "AbortError"));
      element.onload = () => resolve();
      element.onerror = () =>
        reject(new Error(`Unable to load stylesheet ${url}`));
    });
    style = { element, ready, cancel, references: 0 };
    styles.set(url, style);
    document.head.append(element);
  }
  style.references++;
  const retained = style;
  let released = false;
  return {
    ready: retained.ready,
    release() {
      if (released) return;
      released = true;
      if (--retained.references !== 0) return;
      retained.cancel();
      retained.element.remove();
      styles.delete(url);
    },
  };
}

class Entry {
  readonly host = document.createElement("div");
  readonly signature: string;
  readonly #lifetime = new AbortController();
  readonly #styles: ReturnType<typeof acquireStyle>[] = [];
  #config: Record<string, unknown>;
  #instance?: CustomElementInstance;
  #active: boolean;
  #control?: ControlDescriptor;
  used = true;
  failed = false;

  constructor(
    descriptor: CustomElementDescriptor,
    active: boolean,
    readonly callbacks: HostCallbacks,
    control?: ControlDescriptor,
  ) {
    this.signature = assetSignature(descriptor);
    this.#config = descriptor.config;
    this.#active = active;
    this.#control = control;
    this.host.className = "custom-element-host";
    this.host.dataset.customElementId = descriptor.id;
    this.host.setAttribute("aria-busy", "true");
    void this.#mount(descriptor).catch((error) => this.#fail(error));
  }

  async #mount(descriptor: CustomElementDescriptor): Promise<void> {
    if (
      !validBrowserAssetURL(descriptor.module, "module") ||
      !(descriptor.styles ?? []).every((url) =>
        validBrowserAssetURL(url, "style")
      )
    ) {
      throw new TypeError("Invalid custom element assets");
    }
    this.#styles.push(...(descriptor.styles ?? []).map(acquireStyle));
    const [module] = await whileMounted(
      Promise.all([
        import(descriptor.module) as Promise<{ default?: MountCustomElement }>,
        ...this.#styles.map((style) => style.ready),
      ]),
      this.#lifetime.signal,
    );
    if (this.#lifetime.signal.aborted) return;
    if (typeof module.default !== "function") {
      throw new TypeError(
        "Custom element module must default-export a mount function",
      );
    }
    const mountedConfig = this.#config;
    // Live context getters follow updates to this retained entry.
    // deno-lint-ignore no-this-alias
    const entry = this;
    const instance = await module.default({
      host: this.host,
      get config() {
        return entry.#config;
      },
      get control() {
        return entry.#control;
      },
      get value() {
        return entry.#control === undefined
          ? undefined
          : entry.callbacks.value(entry.#control);
      },
      get state() {
        return entry.callbacks.state(descriptor.id);
      },
      setValue: (value) => {
        if (
          !this.#lifetime.signal.aborted && this.#active &&
          this.#control && !this.#control.readOnly && !this.#control.hidden
        ) {
          this.callbacks.change(this.#control, value);
        }
      },
      signal: this.#lifetime.signal,
      renderText: (target, text) =>
        renderIconText(target, text, { decorativeIcons: true }),
      send: (action, value) => {
        if (!this.#lifetime.signal.aborted && this.#active) {
          this.callbacks.send(action, value);
        }
      },
    });
    if (!instance || typeof instance !== "object") {
      throw new TypeError(
        "Custom element mount must return its lifecycle object",
      );
    }
    if (this.#lifetime.signal.aborted) {
      instance.dispose?.();
      this.host.replaceChildren();
      return;
    }
    this.#instance = instance;
    if (this.#config !== mountedConfig) instance.update?.(this.#config);
    instance.setActive?.(this.#active);
    this.host.removeAttribute("aria-busy");
  }

  update(config: Record<string, unknown>, control?: ControlDescriptor): void {
    this.#config = config;
    this.#control = control;
    try {
      this.#instance?.update?.(config);
    } catch (error) {
      this.#fail(error);
    }
    this.used = true;
  }

  setActive(active: boolean): void {
    if (active === this.#active) return;
    this.#active = active;
    try {
      this.#instance?.setActive?.(active);
    } catch (error) {
      this.#fail(error);
    }
  }

  captureState(): void {
    try {
      this.#instance?.captureState?.();
    } catch (error) {
      this.#fail(error);
    }
  }

  updateBinding(bind: string, source: string): void {
    if (this.#control?.bind === bind && this.#control.id !== source) {
      this.update(this.#config, this.#control);
    }
  }

  dispose(): void {
    if (this.#lifetime.signal.aborted) return;
    this.#lifetime.abort();
    try {
      this.#instance?.dispose?.();
    } catch (error) {
      console.error(error);
    }
    this.#instance = undefined;
    for (const style of this.#styles) style.release();
    this.host.replaceChildren();
  }

  #fail(error: unknown): void {
    if (this.#lifetime.signal.aborted) return;
    this.dispose();
    this.failed = true;
    this.host.removeAttribute("aria-busy");
    this.host.classList.add("custom-element-error");
    this.host.textContent = "Unable to load this component.";
    console.error("Custom element failed", error);
  }
}

function assetSignature(descriptor: CustomElementDescriptor): string {
  return JSON.stringify([descriptor.module, descriptor.styles ?? []]);
}

function whileMounted<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    pending.then(resolve, reject).finally(() =>
      signal.removeEventListener("abort", abort)
    );
    if (signal.aborted) abort();
  });
}

export class CustomElementRenderer {
  readonly #entries = new Map<string, Entry>();
  #active = false;
  #callbacks!: HostCallbacks;

  begin(callbacks: HostCallbacks): void {
    this.#callbacks = callbacks;
    for (const entry of this.#entries.values()) entry.used = false;
  }

  render(
    descriptor: CustomElementDescriptor,
    control?: ControlDescriptor,
  ): HTMLElement {
    let entry = this.#entries.get(descriptor.id);
    if (
      entry &&
      (entry.failed || !descriptor.preserve ||
        entry.signature !== assetSignature(descriptor))
    ) {
      entry.dispose();
      this.#entries.delete(descriptor.id);
      entry = undefined;
    }
    if (!entry) {
      entry = new Entry(
        descriptor,
        this.#active,
        {
          send: (action, value) => this.#callbacks.send(action, value),
          state: (id) => this.#callbacks.state(id),
          value: (field) => this.#callbacks.value(field),
          change: (field, value) => this.#callbacks.change(field, value),
        },
        control,
      );
      this.#entries.set(descriptor.id, entry);
    } else entry.update(descriptor.config, control);
    return entry.host;
  }

  end(): void {
    for (const [id, entry] of this.#entries) {
      if (entry.used) continue;
      entry.dispose();
      this.#entries.delete(id);
    }
  }

  captureState(): void {
    for (const entry of this.#entries.values()) entry.captureState();
  }

  updateBinding(bind: string, source: string): void {
    for (const entry of this.#entries.values()) {
      entry.updateBinding(bind, source);
    }
  }

  setActive(active: boolean): void {
    this.#active = active;
    for (const entry of this.#entries.values()) entry.setActive(active);
  }

  dispose(): void {
    for (const entry of this.#entries.values()) entry.dispose();
    this.#entries.clear();
  }
}
