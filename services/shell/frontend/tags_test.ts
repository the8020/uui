import { assertEquals } from "@std/assert";
import {
  addEntries,
  tagEntries,
  tagLabel,
  tagValue,
  typedEntries,
} from "./tags.ts";

Deno.test("tags edit arrays and separated text without changing written values", () => {
  const text = { separator: ",", escape: "-*?!" };
  const entries = tagEntries("SK, 7500-7599,!CZ,a\\-b", text);
  assertEquals(entries, ["SK", "7500-7599", "!CZ", "a\\-b"]);
  assertEquals(entries.map((entry) => tagLabel(entry, text)), [
    "SK",
    "7500-7599",
    "!CZ",
    "a-b",
  ]);
  const next = addEntries(entries, typedEntries("DE, SK,8000-8100", text));
  assertEquals(tagValue(next, text), "SK,7500-7599,!CZ,a\\-b,DE,8000-8100");

  const array = { maximum: 3 };
  assertEquals(tagEntries(["a", "b"], array), ["a", "b"]);
  assertEquals(tagEntries("a,b", array), []);
  assertEquals(typedEntries(" a,b ", array), ["a,b"]);
  assertEquals(tagValue(["a", "a,b"], array), ["a", "a,b"]);
  assertEquals(tagValue([], text), undefined);
  assertEquals(tagValue([], array), []);
});
