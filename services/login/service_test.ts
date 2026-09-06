import { assertEquals } from "@std/assert";
import {
  kernelDatabaseBackendSymbol,
  type KernelInvoke,
  kernelInvokeSymbol,
} from "@the8020/kernel";
(globalThis as unknown as Record<symbol, unknown>)[
  kernelDatabaseBackendSymbol
] = "sqlite";
const { default: service } = await import("./service.ts");
const { hashPassword } = await import("/p/the8020/users/src/password.ts");

const context = {
  signal: new AbortController().signal,
  meta: {
    contextId: "request-test",
    serviceId: "the8020/uui/login",
    serviceGeneration: 1,
    canonicalBasePath: "/the8020/uui/login",
    originalUrl: "https://example.test/the8020/uui/login/",
    client: { ipAddress: "203.0.113.4", networkScope: "public" as const },
    execution: {
      nodeId: "node-test",

      sandboxId: "sbx-test",
      workerId: "wrk-test",
    },
    user: { userId: "user:system", username: "system" },
    auth: { authenticated: false },
  },
};

Deno.test("public login page, users-package login, and stale-cookie logout", async () => {
  const calls: string[] = [];
  const passwordHash = await hashPassword("private");
  (globalThis as unknown as Record<symbol, unknown>)[kernelInvokeSymbol] =
    ((operation, input) => {
      calls.push(operation);
      if (operation === "database.execute") {
        return Promise.resolve(
          input.return_rows
            ? {
              columns: [
                "username",
                "passwordHash",
                "enabled",
                "authVersion",
                "createdAt",
                "updatedAt",
              ],
              rows: [[
                "admin",
                passwordHash,
                1,
                1,
                "2026-01-01T00:00:00Z",
                "2026-01-01T00:00:00Z",
              ]],
            }
            : {
              columns: [],
              rows: [],
              affected_rows: { type: "bigint", value: "1" },
            },
        );
      }
      return Promise.resolve({
        success: true,
        result: input.operation === "crypto.token.sign"
          ? { token: "issued-token" }
          : null,
      });
    }) satisfies KernelInvoke;
  try {
    const page = await service.fetch(
      new Request("https://service/", {
        headers: { cookie: "the8020_auth=expired" },
      }),
      context,
    );
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
    assertEquals(markup.includes("No user yet?"), false);
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
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: "the8020_auth=expired",
        },
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
        body: new URLSearchParams({ username: "admin", password: "private" }),
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: "the8020_auth=expired",
        },
      }),
      context,
    );
    assertEquals(login.status, 303);
    assertEquals(login.headers.get("location"), "/the8020/uui/shell/");
    assertEquals(
      login.headers.get("set-cookie")?.includes("issued-token"),
      true,
    );
    const logout = await service.fetch(
      new Request("https://service/logout", {
        headers: { cookie: "the8020_auth=expired" },
      }),
      context,
    );
    assertEquals(logout.status, 303);
    assertEquals(logout.headers.get("set-cookie")?.includes("Max-Age=0"), true);
    assertEquals(calls, [
      "database.execute",
      "runtime.operation",
      "database.execute",
      "runtime.operation",
    ]);
  } finally {
    delete (globalThis as unknown as Record<symbol, unknown>)[
      kernelInvokeSymbol
    ];
  }
});
