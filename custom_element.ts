import type { ControlDescriptor, ScreenElementState } from "./protocol.ts";

/** Browser-only contract. Programs publish a module that default-exports mount. */
export interface CustomElementContext {
  /** The retained wrapper. The module owns its contents and their styling. */
  readonly host: HTMLElement;
  readonly config: Record<string, unknown>;
  /** Current field metadata/value, when mounted as a model-bound control. */
  readonly control: Readonly<ControlDescriptor> | undefined;
  readonly value: unknown;
  /** Browser-owned metadata, synchronized with ordinary screen interactions. */
  readonly state: ScreenElementState;
  /** Edit the bound value through ordinary dirty binding/reactive field handling. */
  setValue(value: unknown): void;
  /** Aborted on removal or replacement, including while mount is pending. */
  readonly signal: AbortSignal;
  /** Render plain text and the shell's [[icon=...]] markup into an owned element. */
  renderText(target: HTMLElement, text: string): void;
  /** Send an ordinary screen action through the owning surface's interaction gate. */
  send(action: string, value?: unknown): void;
}

export interface CustomElementInstance {
  update?(config: Record<string, unknown>): void;
  /** Capture pending browser state before an ordinary interaction or redraw. */
  captureState?(): void;
  /** Presentation activity; hiding a retained page does not dispose its DOM. */
  setActive?(active: boolean): void;
  dispose?(): void;
}

export type MountCustomElement = (
  context: CustomElementContext,
) => CustomElementInstance | Promise<CustomElementInstance>;
