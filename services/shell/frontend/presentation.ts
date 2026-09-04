import { getPath, setPath } from "./model.ts";

/**
 * Tracks which visible presentation is current and which presentations were
 * obscured by later page surfaces. Surface IDs are globally unique within a
 * live UUI session, so a known base page means that the Worker is restoring a
 * suspended presentation rather than pushing a new page.
 */
export class PresentationHistory {
  #visible: string[] = [];
  #visiblePageDepth = 0;
  #hidden: Array<{ pageDepth: number; surfaceIds: string[] }> = [];

  visible(): readonly string[] {
    return this.#visible;
  }

  reconcile(
    next: readonly string[],
    pageDepth: number,
  ): { removed: string[] } {
    if (next.length === 0) {
      return { removed: this.clear() };
    }
    if (!Number.isSafeInteger(pageDepth) || pageDepth < 1) {
      throw new TypeError("presentation page depth must be a positive integer");
    }
    if (new Set(next).size !== next.length) {
      throw new TypeError("presentation contains duplicate surface IDs");
    }
    if (this.#visible.length === 0) {
      this.#visible = [...next];
      this.#visiblePageDepth = pageDepth;
      return { removed: [] };
    }

    const currentBase = this.#visible[0]!;
    const nextBase = next[0]!;
    if (currentBase === nextBase) {
      if (pageDepth !== this.#visiblePageDepth) {
        throw new TypeError("presentation page depth changed for a surface");
      }
      const retained = commonPrefixLength(this.#visible, next);
      const removed = this.#visible.slice(retained);
      this.#visible = [...next];
      return { removed };
    }

    const restored = this.#hidden.findLastIndex((item) =>
      item.pageDepth === pageDepth && item.surfaceIds[0] === nextBase
    );
    if (restored >= 0) {
      const removed = [...this.#visible];
      for (const frame of this.#hidden.slice(restored + 1)) {
        removed.push(...frame.surfaceIds);
      }
      const restoredPresentation = this.#hidden[restored]!.surfaceIds;
      const retained = commonPrefixLength(restoredPresentation, next);
      removed.push(...restoredPresentation.slice(retained));
      this.#hidden = this.#hidden.slice(0, restored);
      this.#visible = [...next];
      this.#visiblePageDepth = pageDepth;
      return { removed: unique(removed) };
    }

    if (pageDepth <= this.#visiblePageDepth) {
      const removed = [...this.#visible];
      const retainedFrames = [];
      for (const frame of this.#hidden) {
        if (frame.pageDepth >= pageDepth) removed.push(...frame.surfaceIds);
        else retainedFrames.push(frame);
      }
      this.#hidden = retainedFrames;
      this.#visible = [...next];
      this.#visiblePageDepth = pageDepth;
      return { removed: unique(removed) };
    }

    this.#hidden.push({
      pageDepth: this.#visiblePageDepth,
      surfaceIds: this.#visible,
    });
    this.#visible = [...next];
    this.#visiblePageDepth = pageDepth;
    return { removed: [] };
  }

  clear(): string[] {
    const removed = unique([
      ...this.#hidden.flatMap((frame) => frame.surfaceIds),
      ...this.#visible,
    ]);
    this.#hidden = [];
    this.#visible = [];
    this.#visiblePageDepth = 0;
    return removed;
  }
}

export function mergeServerModel(
  serverModel: unknown,
  currentModel: Record<string, unknown>,
  dirtyBindings: Iterable<string>,
): Record<string, unknown> {
  const merged = structuredClone(serverModel) as Record<string, unknown>;
  for (const bind of dirtyBindings) {
    setPath(merged, bind, structuredClone(getPath(currentModel, bind)));
  }
  return merged;
}

function commonPrefixLength(
  left: readonly string[],
  right: readonly string[],
): number {
  let index = 0;
  while (
    index < left.length && index < right.length &&
    left[index] === right[index]
  ) index++;
  return index;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
