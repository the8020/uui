import { assertEquals, assertStringIncludes } from "@std/assert";
import { buildShortDump, exceptionName } from "./short_dump.ts";

Deno.test("short dump preserves exception type, fields, stack, and source context", async () => {
  const source = new URL("short_dump_test.ts", import.meta.url).pathname;
  const error = new TypeError("demonstration failed") as TypeError & {
    code: string;
    context: Record<string, unknown>;
  };
  error.code = "DEMO_FAILURE";
  error.context = {};
  error.context.self = error.context;
  error.stack =
    `TypeError: demonstration failed\n    at demo (file://${source}:8:3)`;
  const dump = await buildShortDump({
    exception: error,
    programId: "the8020/demo/demo-form",
    entrypoint: source,
    occurredAt: "2026-08-23T12:00:00.000Z",
    homeProgram: "the8020/uui/home",
    terminatedProgram: "the8020/uui/program-terminated",
  });
  assertEquals(dump.exceptionType, "TypeError");
  assertStringIncludes(dump.message, "demonstration failed");
  assertStringIncludes(dump.properties, "DEMO_FAILURE");
  assertStringIncludes(dump.properties, "<circular>");
  assertStringIncludes(dump.location, "short_dump_test.ts:8:3");
  assertStringIncludes(dump.source, ">  8 |");
  assertEquals(dump.sourceDocument?.firstLine, 3);
  assertEquals(dump.sourceDocument?.line, 8);
  assertEquals(dump.sourceDocument?.path, source);
  const lines = (await Deno.readTextFile(source)).split("\n");
  assertEquals(dump.sourceDocument?.text, lines.slice(2, 13).join("\n"));
  assertStringIncludes(dump.dumpText, "CALL STACK");
});

Deno.test("short dump handles non-Error thrown values", async () => {
  const dump = await buildShortDump({
    exception: { reason: "plain object" },
    programId: "the8020/demo/demo-master-detail",
    entrypoint: "",
    occurredAt: "2026-08-23T12:00:00.000Z",
    homeProgram: "the8020/uui/home",
    terminatedProgram: "the8020/uui/program-terminated",
  });
  assertEquals(exceptionName("failed"), "string");
  assertEquals(dump.exceptionType, "Object");
  assertStringIncludes(dump.message, "plain object");
  assertEquals(dump.source, "Source location is unavailable.");
});

Deno.test("source truncation keeps original line numbers and rejects out-of-file locations", async () => {
  const path = await Deno.makeTempFile({ suffix: ".ts" });
  try {
    await Deno.writeTextFile(
      path,
      `${"x".repeat(1500)}\nthrow new Error('failed');\n`,
    );
    const error = new Error("failed");
    const input = {
      exception: error,
      programId: "the8020/uui/test",
      entrypoint: path,
      occurredAt: "2026-09-08T00:00:00Z",
      homeProgram: "the8020/uui/home",
      terminatedProgram: "the8020/uui/program-terminated",
    };
    error.stack = `Error: failed\n    at file://${path}:2:1`;
    const dump = await buildShortDump(input);
    assertEquals(dump.sourceDocument?.text.split("\n").length, 3);
    assertEquals(
      dump.sourceDocument?.text.split("\n")[1],
      "throw new Error('failed');",
    );
    assertEquals(dump.sourceDocument?.line, 2);
    error.stack = `Error: failed\n    at file://${path}:999:1`;
    const unavailable = await buildShortDump(input);
    assertEquals(unavailable.sourceDocument, undefined);
    assertEquals(unavailable.source, "Source location is outside the file.");
  } finally {
    await Deno.remove(path);
  }
});
