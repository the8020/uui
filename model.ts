import { newId } from "@the8020/kernel";
import { type ScreenState } from "./screen_state.ts";

/** A retained screen instance. Data is the caller's original object, not a copy. */
export class Model<T extends object> {
  data: T;
  readonly screen: ScreenState;

  constructor(data: T) {
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      throw new TypeError("Model data must be an object");
    }
    this.data = data;
    this.screen = {
      instanceId: newId("mdl"),
      version: 0,
      scroll: { x: 0, y: 0 },
      elements: {},
    };
  }

  /** Reset presentation state without replacing data or this screen instance. */
  resetScreen(): void {
    this.screen.version++;
    this.screen.scroll = { x: 0, y: 0 };
    this.screen.elements = {};
  }
}
