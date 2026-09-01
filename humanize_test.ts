import { assertEquals } from "@std/assert";
import { humanize } from "./humanize.ts";

Deno.test("humanize converts identifiers to sentence-case labels", () => {
  assertEquals(humanize("thisIsCamel"), "This is camel");
  assertEquals(humanize("myAPIEndpoint"), "My API endpoint");
  assertEquals(humanize("changed_files"), "Changed files");
  assertEquals(humanize("already-words"), "Already words");
});
