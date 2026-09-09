import { assert, assertEquals } from "@std/assert";
import type { NativeBrowserFixtureContext } from "./browser_e2e.ts";

/** Real sandbox CLI, persistent Worker, two browsers, and cross-node routing. */
export default async function verify(context: NativeBrowserFixtureContext) {
  const {
    page,
    admin,
    credentials,
    waitForPage,
    waitForScreen,
    baseURL,
    otherNodeURL,
  } = context;
  // Recipient listeners are startup configuration, as in the shared native harness.
  await page.command("Page.navigate", { url: "about:blank" });
  for (
    const [run, url] of [[admin, baseURL], [
      context.otherAdmin,
      otherNodeURL,
    ]] as const
  ) {
    const nodeId = (await run(["kernel.status"])).instance_uuid as string;
    const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
    const port = (listener.addr as Deno.NetAddr).port;
    listener.close();
    const arguments_ = [
      "system.nodes.set",
      nodeId,
      "--url",
      url,
      "--recipient-address",
      "127.0.0.1",
      "--recipient-port",
      String(port),
      "--enabled",
    ];
    await admin(arguments_);
    await context.otherAdmin(arguments_);
  }
  await context.restartNodes();
  await admin(["dev-core.sandbox.create", credentials.username]);
  await admin(["dev-core.sandbox.start", credentials.username]);
  const shell = async (command: string) => {
    const response = await admin([
      "dev-core.sandbox.shell",
      credentials.username,
      "--command",
      command,
    ]);
    return (response.shell as { output: string }).output;
  };
  const transcript = await shell("uui new the8020/demo/demo-form");
  assert(transcript.includes("screenCall:"), transcript);
  assert(
    transcript.includes("the8020/demo/programs/demo-form/program.ts:"),
    transcript,
  );
  assert(transcript.includes('field: "source/value"'), transcript);
  assert(transcript.includes('button: "download-file"'), transcript);
  assert(transcript.includes("value-help: true"), transcript);
  assert((await shell("uui value-help role viewer")).includes("viewer"));
  assert(
    (await shell("uui set source/value 'const proof = 42;' ")).includes(
      "const proof = 42;",
    ),
  );
  assert((await shell("uui click save")).includes("Saved 1 time."));
  const sessionURL = (await shell("uui url")).trim();
  const sessionId = new URL(sessionURL).searchParams.get("session")!;
  const browserURL = `${baseURL}/the8020/uui/shell/?session=${sessionId}`;
  await page.command("Page.navigate", { url: browserURL });
  await waitForScreen(page, "Form and binding demonstration", 30_000);
  await waitForPage(
    page,
    `document.querySelector('.cm-content')?.textContent.includes('const proof = 42;')`,
    "browser renders code edited by the agent",
  );
  const before = (await admin([
    "db.sql",
    `SELECT workerId FROM the8020__uui__sessions WHERE sessionId = '${sessionId}'`,
  ])).rows;
  assert(Array.isArray(before) && before.length === 1);

  const second = await context.openPage();
  await second.command("Page.navigate", {
    url: `${otherNodeURL}/the8020/uui/shell/?session=${sessionId}`,
  });
  await waitForScreen(second, "Form and binding demonstration", 30_000);
  await waitForPage(
    page,
    `document.querySelector('.uui-control-dialog')?.open === true && getComputedStyle(document.querySelector('.uui-control-dialog'), '::backdrop').backdropFilter.includes('blur')`,
    "displaced browser is covered and blurred",
  );
  await page.evaluate(
    `document.querySelector('.uui-control-dialog button').click()`,
  );
  await waitForPage(
    page,
    `!document.querySelector('.uui-control-dialog')?.open && document.querySelector('#connection-state')?.textContent === 'Connected'`,
    "explicit take control",
  );
  await waitForPage(
    second,
    `document.querySelector('.uui-control-dialog')?.open === true`,
    "second browser displaced",
  );
  await page.command("Page.navigate", { url: "about:blank" });
  await waitForPage(
    second,
    `!document.querySelector('.uui-control-dialog')?.open && document.querySelector('#connection-state')?.textContent === 'Connected'`,
    "previous browser resumes after controller disconnects",
    15_000,
  );

  await shell(`uui attach ${sessionId}`);
  await waitForPage(
    second,
    `!document.querySelector('.uui-control-dialog')?.open && document.querySelector('#connection-state')?.textContent === 'Connected'`,
    "agent returns control",
    15_000,
  );
  assert(
    (await shell("uui set primary-email 'headless@example.test'")).includes(
      "headless@example.test",
    ),
  );
  await shell("uui click save");
  await waitForPage(
    second,
    `!document.querySelector('.uui-control-dialog')?.open && document.querySelector('[data-bind="saveCount"]')?.value === '2'`,
    "agent acts in the original browser execution",
    15_000,
  );
  const after = (await admin([
    "db.sql",
    `SELECT workerId FROM the8020__uui__sessions WHERE sessionId = '${sessionId}'`,
  ])).rows;
  assertEquals(after, before, "takeover must keep the same Worker");

  const remoteSession = await second.evaluate<string>(`(async () => {
    const response = await fetch('/the8020/uui/session/connect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ program: 'the8020/demo/demo-form' }) });
    if (!response.ok) throw new Error('Remote session creation failed');
    return response.headers.get('the8020-session');
  })()`);
  assert(remoteSession);
  await shell(`uui attach ${remoteSession}`);
  assert(
    (await shell("uui set source/value 'const acrossNodes = true;' ")).includes(
      "const acrossNodes = true;",
    ),
  );

  const localOnly = await shell(
    `deno eval 'const c = JSON.parse(await Deno.readTextFile("/root/.the8020/allowance.json")); const r = await fetch(Deno.env.get("DEVELOPMENT_SYSTEM_URL") + "/the8020/uui/shell/sessions", {redirect:"manual",headers:{"the8020-authorization":"Bearer " + c.token,"the8020-internal-local-authentication":"true"}}); console.log(r.status); await r.body?.cancel();'`,
  );
  assertEquals(
    localOnly.trim(),
    "302",
    "public HTTP must reject a local allowance, even with a forged internal header",
  );
  const signIns = (await admin(["users.sessions.list", credentials.username]))
    .authentication_sessions as Array<
      { session_id: string; type: string; transport: string }
    >;
  const allowance = signIns.find((session) =>
    session.type === "token" && session.transport === "local"
  );
  assert(allowance, "sandbox token appears with normal sign-ins");
  const cachedSession = (await shell(
    `deno eval 'const c = JSON.parse(await Deno.readTextFile("/root/.the8020/allowance.json")); console.log(JSON.parse(atob(c.token.split(".")[1])).sid);'`,
  )).trim();
  assert(
    signIns.some((session) =>
      session.session_id === cachedSession && session.type === "token"
    ),
  );
  await admin(["users.sessions.revoke", cachedSession]);
  const revoked = await shell("uui sessions 2>&1; test $? -eq 1");
  assert(
    revoked.includes("Session listing failed"),
    "revocation must apply to the next native request",
  );
  console.log(
    "Sandbox transcript, editor fallback, value help, browser takeover/return, cross-node routing, local-only auth and revocation passed.",
  );
}
