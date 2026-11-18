import { assertEquals, assertStringIncludes } from "@std/assert";
import { test } from "./test_localization.ts";
import { screenProgram, withProgram } from "./programs.ts";
import { statusTestContext } from "./status_test_support.ts";

test("screen identity follows nested direct programs and survives awaited helper calls", async () => {
  await withProgram("example/tools/outer", async () => {
    await Promise.resolve();
    assertEquals(
      screenProgram(
        "at helper (file:///workspace/packages/example/tools/src/list.ts:12:1)",
      ),
      "example/tools/outer",
    );
    assertEquals(
      screenProgram(
        "at inner (file:///workspace/packages/other/tools/programs/inner/program.ts:40:2)",
      ),
      "other/tools/inner",
    );
    await withProgram("example/tools/child", async () => {
      await Promise.resolve();
      assertEquals(screenProgram(""), "example/tools/child");
    });
    assertEquals(screenProgram(""), "example/tools/outer");
  });
  assertEquals(screenProgram(""), undefined);
});

test("Status reads only the current account and projects diagnostic metadata", async () => {
  const fixture = await statusTestContext();
  try {
    const { readStatus } = await import("./programs/status/program.ts");
    const value = await readStatus({
      programId: "the8020/uui/home",
      screenId: "home",
      title: "Home",
      screenCall: "the8020/uui/programs/home/program.ts:90",
      sessionId: "uis-status0001",
      startedAt: "2026-11-18T00:00:00Z",
      connectionState: "CONNECTED",
      browser: {
        origin: "https://example.test",
        language: "cs",
        timeZone: "Europe/Prague",
      },
    });
    assertEquals(value.fullName, "Alice Example");
    assertEquals(value.systemRole, "test");
    assertEquals(value.systemId, "sys-status0001");
    assertEquals(value.programId, "the8020/uui/home");
    assertEquals(value.kernelVersion, "0.10.3+kernelcommit");
    assertEquals(value.executionId, "exe-status0001");
    assertEquals(value.language, "en");
    assertEquals(value.timeZone, "Europe/Prague");
    assertStringIncludes(value.uuiVersion, "1234567890ab");
    assertStringIncludes(value.uuiVersion, "Local modifications");
    assertEquals(
      fixture.calls.filter((call) =>
        call === "package.repository.inspect:the8020/uui"
      ).length,
      1,
    );
    assertEquals(JSON.stringify(value).includes("/private/"), false);
  } finally {
    fixture.close();
  }
});
