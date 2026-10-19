/** Fixed rows-per-page choices; no choice keeps viewport-measured capacity. */
export const LIST_PAGE_SIZES = [25, 50, 100, 200] as const;

const PREFIX = "the8020.list-page-size:";

type PageSizeStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Browser-only rows-per-page choice per screen list, kept across sessions. */
export class ListPageSizes {
  constructor(private readonly storage: PageSizeStorage | undefined) {}

  get(key: string): number | undefined {
    try {
      const size = Number(this.storage?.getItem(PREFIX + key));
      return (LIST_PAGE_SIZES as readonly number[]).includes(size)
        ? size
        : undefined;
    } catch {
      return undefined;
    }
  }

  set(key: string, size: number | undefined): void {
    try {
      if (size === undefined) this.storage?.removeItem(PREFIX + key);
      else this.storage?.setItem(PREFIX + key, String(size));
    } catch (error) {
      console.error("list page size could not be saved", error);
    }
  }
}

export function browserPageSizes(): ListPageSizes {
  try {
    return new ListPageSizes(globalThis.localStorage);
  } catch {
    return new ListPageSizes(undefined);
  }
}
