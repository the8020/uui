import { assertEquals } from "@std/assert";
import { ListPageSizes } from "./page_size.ts";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

Deno.test("list page sizes remember only offered choices per list", () => {
  const storage = memoryStorage();
  const sizes = new ListPageSizes(storage);
  assertEquals(sizes.get("screen:list"), undefined);
  sizes.set("screen:list", 100);
  assertEquals(sizes.get("screen:list"), 100);
  assertEquals(sizes.get("screen:other"), undefined);
  storage.values.set("the8020.list-page-size:screen:other", "37");
  assertEquals(sizes.get("screen:other"), undefined);
  sizes.set("screen:list", undefined);
  assertEquals(sizes.get("screen:list"), undefined);
  assertEquals(storage.values.size, 1);
});

Deno.test("list page sizes fall back to automatic capacity without storage", () => {
  const blocked = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  };
  const sizes = new ListPageSizes(blocked);
  const error = console.error;
  console.error = () => {};
  try {
    sizes.set("screen:list", 50);
  } finally {
    console.error = error;
  }
  assertEquals(sizes.get("screen:list"), undefined);
  assertEquals(new ListPageSizes(undefined).get("screen:list"), undefined);
});
