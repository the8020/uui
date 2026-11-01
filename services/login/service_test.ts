import { test } from "../../test_localization.ts";
import { createHash } from "node:crypto";
import { assertEquals } from "@std/assert";
import {
  defaultConfiguration,
  Localization,
  withLocalization,
} from "/p/the8020/i18n/mod.ts";
import { brandingDatabase } from "../../branding_test_support.ts";
import { createTableSQL } from "/p/the8020/db/internal/ddl.ts";
import english from "../../i18n/locales/en.json" with { type: "json" };
import czech from "../../i18n/locales/cs.json" with { type: "json" };
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

Deno.test("login uses its configured default and remembers browser choices before authentication", async () => {
  using fixture = await brandingDatabase();
  const { descriptorOf } = await import("/p/the8020/db/mod.ts");
  const { default: Settings } = await import(
    "/p/the8020/system/tables/settings.ts"
  );
  fixture.database.exec(createTableSQL("sqlite", descriptorOf(Settings)));
  fixture.database.prepare(
    "INSERT INTO the8020__system__settings (key, value, definitionHash, updatedAt) VALUES (?, ?, ?, ?)",
  ).run(
    "system.profile",
    JSON.stringify({ id: "sys-aaaaaaaaaa", name: "Test", role: "test" }),
    "test",
    new Date().toISOString(),
  );
  const loader = (packageId: string, chain: readonly string[]) =>
    Promise.resolve({
      package: packageId,
      language: chain[0]!,
      texts: chain[0] === "cs" ? czech.texts : english.texts,
    });
  await withLocalization(
    new Localization("en", {
      ...defaultConfiguration,
      defaultLoginLanguage: "cs",
    }, loader),
    async () => {
      const initial = await service.fetch(
        new Request("https://service/"),
        context,
      );
      assertEquals(initial.headers.get("content-language"), "cs");
      assertEquals((await initial.text()).includes("Přihlásit se"), true);
      assertEquals(initial.headers.has("set-cookie"), false);

      const change = await service.fetch(
        new Request("https://service/?language=en"),
        context,
      );
      assertEquals(change.headers.get("content-language"), "en");
      const cookie = change.headers.get("set-cookie")!;
      assertEquals(
        cookie,
        "the8020_language_sys-aaaaaaaaaa=en; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000; Secure",
      );
      await change.body?.cancel();

      const remembered = await service.fetch(
        new Request("https://service/", {
          headers: { cookie: cookie.split(";")[0]! },
        }),
        context,
      );
      assertEquals(remembered.headers.get("content-language"), "en");
      assertEquals(
        (await remembered.text()).includes('<option value="en" selected>'),
        true,
      );

      for (
        const cookie of [
          "the8020_language_sys-aaaaaaaaaa=de",
          "the8020_language_sys-bbbbbbbbbb=en",
        ]
      ) {
        const response = await service.fetch(
          new Request("https://service/", { headers: { cookie } }),
          context,
        );
        assertEquals(response.headers.get("content-language"), "cs");
        await response.body?.cancel();
      }
      const reset = await service.fetch(
        new Request("https://service/?language=", {
          headers: { cookie: cookie.split(";")[0]! },
        }),
        context,
      );
      assertEquals(reset.headers.get("content-language"), "cs");
      assertEquals(
        reset.headers.get("set-cookie")?.includes("Max-Age=0"),
        true,
      );
      await reset.body?.cancel();

      const header = await service.fetch(
        new Request("https://service/", {
          headers: { "the8020-language": "en" },
        }),
        context,
      );
      assertEquals(header.headers.get("content-language"), "en");
      await header.body?.cancel();
      const rejected = await service.fetch(
        new Request("https://service/", {
          method: "POST",
          body: new URLSearchParams({ username: "Invalid", password: "wrong" }),
        }),
        context,
      );
      assertEquals(rejected.status, 401);
      assertEquals(rejected.headers.get("content-language"), "cs");
      assertEquals(
        (await rejected.text()).includes(czech.texts["login.invalid"]),
        true,
      );
    },
  );
  await withLocalization(
    new Localization("cs", defaultConfiguration, loader),
    async () => {
      const response = await service.fetch(
        new Request("https://service/"),
        context,
      );
      assertEquals(response.headers.get("content-language"), "en");
      await response.body?.cancel();
    },
  );
});

test("public login page, users-package login, and stale-cookie logout", async () => {
  const calls: string[] = [];
  let passwordHash = "";
  (globalThis as unknown as Record<symbol, unknown>)[kernelInvokeSymbol] =
    ((operation, input) => {
      if (
        operation === "database.execute" &&
        String(input.statement).includes("the8020__uui__branding")
      ) {
        return Promise.resolve({ columns: [], rows: [] });
      }
      if (
        operation === "runtime.operation" &&
        input.operation === "crypto.password.digest"
      ) {
        return Promise.resolve({
          success: true,
          result: {
            digest: createHash("sha256").update(JSON.stringify(input.input))
              .digest("base64"),
          },
        });
      }
      calls.push(operation);
      if (operation === "database.execute") {
        if (String(input.statement).includes("the8020__system__settings")) {
          return Promise.resolve({
            columns: ["value"],
            rows: [[
              JSON.stringify({
                id: "sys-aaaaaaaaaa",
                name: "Development",
                role: "development",
              }),
            ]],
          });
        }
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
    passwordHash = await hashPassword("admin", "private");
    const page = await service.fetch(
      new Request("https://service/", {
        headers: { cookie: "the8020_auth_sys-aaaaaaaaaa=expired" },
      }),
      context,
    );
    assertEquals(page.status, 200);
    const markup = await page.text();
    assertEquals(markup.includes("{{"), false);
    assertEquals(markup.includes(">Username</span>"), true);
    assertEquals(markup.includes('property="og:image"'), true);
    assertEquals(markup.includes('rel="icon"'), true);
    assertEquals(markup.includes('type="password"'), true);
    assertEquals(markup.includes(">Apply<"), false);
    assertEquals(
      markup.indexOf('name="language"') > markup.indexOf('name="password"'),
      true,
    );
    assertEquals(markup.includes('src="language.js"'), true);
    assertEquals(
      markup.includes('<html lang="en" dir="ltr" data-theme="dark">'),
      true,
    );
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
          cookie: "the8020_auth_sys-aaaaaaaaaa=expired",
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
          cookie: "the8020_auth_sys-aaaaaaaaaa=expired",
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
    assertEquals(
      login.headers.get("set-cookie")?.startsWith(
        "the8020_auth_sys-aaaaaaaaaa=",
      ),
      true,
    );
    const logout = await service.fetch(
      new Request("https://service/logout", {
        headers: { cookie: "the8020_auth_sys-aaaaaaaaaa=expired" },
      }),
      context,
    );
    assertEquals(logout.status, 303);
    assertEquals(logout.headers.get("set-cookie")?.includes("Max-Age=0"), true);
    assertEquals(calls, [
      "database.execute",
      "runtime.operation",
      "database.execute",
      "database.execute",
      "database.execute",
      "database.execute",
      "database.execute",
      "runtime.operation",
    ]);
  } finally {
    delete (globalThis as unknown as Record<symbol, unknown>)[
      kernelInvokeSymbol
    ];
  }
});
