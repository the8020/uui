import { assertEquals } from "@std/assert";
import type { RequestMetadata } from "/p/the8020/services/http.ts";
import { technicalGuard } from "./technical_guard.ts";

function call(
  guard: ReturnType<typeof technicalGuard>,
  username: string,
  authenticated = true,
) {
  const meta = {
    user: { userId: `user:${username}`, username },
    auth: { authenticated },
  } as unknown as RequestMetadata;
  return guard(
    {
      request: new Request("https://example.test/"),
      signal: AbortSignal.timeout(1000),
      meta,
    },
    () => Promise.resolve(new Response("ui")),
  );
}

Deno.test("technical accounts are refused by the shell and UUI sessions", async () => {
  const technical = new Set(["monitor"]);
  const checks: string[] = [];
  let time = 0;
  const guard = technicalGuard((username) => {
    checks.push(username);
    return Promise.resolve(!technical.has(username));
  }, () => time);
  assertEquals(await (await call(guard, "alice")).text(), "ui");
  const refused = await call(guard, "monitor");
  assertEquals(refused.status, 403);
  assertEquals(
    await refused.text(),
    "Technical accounts cannot use the user interface.",
  );
  // Unauthenticated requests keep the service's own redirect policy.
  assertEquals(await (await call(guard, "", false)).text(), "ui");
  // Answers are reused for 30 seconds, then read again.
  technical.delete("monitor");
  assertEquals((await call(guard, "monitor")).status, 403);
  time = 30_000;
  assertEquals((await call(guard, "monitor")).status, 200);
  assertEquals(checks, ["alice", "monitor", "monitor"]);
});
