import { assertEquals } from "@std/assert";
import { type KernelInvoke, kernelInvokeSymbol } from "@the8020/kernel";
import service from "./service.ts";

const context = {
  signal: new AbortController().signal,
  meta: {
    requestId: "request-test",
    serviceId: "the8020/uui/login",
    serviceGeneration: 1,
    canonicalBasePath: "/the8020/uui/login",
    originalUrl: "https://example.test/the8020/uui/login/",
    execution: {
      nodeId: "node-test",
      runtimeGroupId: "rgp-test",
      sandboxId: "sbx-test",
      workerId: "wrk-test",
      workerExecutionId: "execution-test",
    },
    auth: { authenticated: false },
  },
};

Deno.test("login page and kernel-issued authentication cookie", async () => {
  const calls: string[] = [];
  (globalThis as unknown as Record<symbol, unknown>)[kernelInvokeSymbol] =
    ((operation, input) => {
      calls.push(operation);
      return Promise.resolve(
        operation === "auth.bootstrapLogin"
          ? input.username === "Admin"
            ? {
              authenticated: true,
              setCookie: "the8020_auth=opaque; HttpOnly; Path=/; SameSite=Lax",
            }
            : { authenticated: false }
          : { setCookie: "the8020_auth=; Max-Age=0; HttpOnly; Path=/" },
      );
    }) satisfies KernelInvoke;
  try {
    const page = await service.fetch(new Request("https://service/"), context);
    assertEquals(page.status, 200);
    const markup = await page.text();
    assertEquals(markup.includes('type="password"'), true);
    assertEquals(markup.includes('<html lang="en" data-theme="dark">'), true);
    assertEquals(
      markup.includes('<link rel="stylesheet" href="styles.css">'),
      true,
    );
    assertEquals(markup.includes("<style>"), false);
    assertEquals(markup.includes("__the8020_login_error__"), false);
    assertEquals(markup.includes('class="login-card"'), true);
    assertEquals(markup.includes('class="group-title"'), true);
    assertEquals(markup.includes('class="brand"'), true);
    assertEquals(markup.includes('class="brand-gold"'), true);
    assertEquals(
      page.headers.get("content-security-policy")?.includes(
        "style-src 'self'",
      ),
      true,
    );
    assertEquals(
      page.headers.get("content-security-policy")?.includes("unsafe-inline"),
      false,
    );
    const stylesheet = await service.fetch(
      new Request("https://service/styles.css"),
      context,
    );
    assertEquals(stylesheet.status, 200);
    assertEquals(
      stylesheet.headers.get("content-type"),
      "text/css; charset=utf-8",
    );
    assertEquals(stylesheet.headers.get("cache-control"), "no-cache");
    const styles = await stylesheet.text();
    assertEquals(styles.includes("--bg: #10131d"), true);
    assertEquals(styles.includes("--surface: #191d2a"), true);
    assertEquals(
      /\.brand\s*\{[^}]*border-radius:\s*6px;/s.test(styles),
      true,
    );
    assertEquals(/\.error\s*\{[^}]*border-left:/s.test(styles), false);
    assertEquals(
      styles.includes("inset-inline-end: var(--group-padding-inline-end)"),
      true,
    );
    const unsupportedAsset = await service.fetch(
      new Request("https://service/service.ts"),
      context,
    );
    assertEquals(unsupportedAsset.status, 404);
    const rejectedLogin = await service.fetch(
      new Request("https://service/", {
        method: "POST",
        body: new URLSearchParams({ username: "Invalid", password: "wrong" }),
        headers: { "content-type": "application/x-www-form-urlencoded" },
      }),
      context,
    );
    assertEquals(rejectedLogin.status, 401);
    assertEquals(
      (await rejectedLogin.text()).includes("Invalid username or password."),
      true,
    );
    const login = await service.fetch(
      new Request("https://service/", {
        method: "POST",
        body: new URLSearchParams({ username: "Admin", password: "private" }),
        headers: { "content-type": "application/x-www-form-urlencoded" },
      }),
      context,
    );
    assertEquals(login.status, 303);
    assertEquals(login.headers.get("location"), "/the8020/uui/shell/");
    assertEquals(login.headers.get("set-cookie")?.includes("opaque"), true);
    const logout = await service.fetch(
      new Request("https://service/logout"),
      context,
    );
    assertEquals(logout.status, 303);
    assertEquals(calls, [
      "auth.bootstrapLogin",
      "auth.bootstrapLogin",
      "auth.logoutCurrent",
    ]);
  } finally {
    delete (globalThis as unknown as Record<symbol, unknown>)[
      kernelInvokeSymbol
    ];
  }
});
