import { browserLocalization, languageCookie } from "../../localization.ts";
import {
  currentLocalization,
  direction,
  Localization,
  translations,
  withLocalization,
} from "/p/the8020/i18n/mod.ts";
import { defineService } from "/p/the8020/services/http.ts";
import { login, logout as logoutUser } from "/p/the8020/users/mod.ts";
import uiConfig from "../../ui-config.json" with { type: "json" };
import { fetchBranding } from "../../branding.ts";
import { brandingAsset, brandingHead } from "../shell/branding.ts";

const frontend = new URL("./frontend/", import.meta.url);
const staticContentTypes = new Map([
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);
const service = defineService();

service.get(
  "/",
  { summary: "Render the user login" },
  async ({ request, meta }) => {
    const current = currentLocalization()!;
    const browser = await browserLocalization(request);
    const requested = new URL(request.url).searchParams.get("language");
    const choice = requested ??
      (browser === current ? "" : browser.language);
    const selected =
      current.configuration.languages.some((item) => item.code === choice)
        ? choice
        : "";
    return await withLocalization(
      new Localization(
        selected ||
          (request.headers.has("the8020-language")
            ? current.language
            : current.configuration.defaultLoginLanguage ??
              current.configuration.defaultLanguage),
        current.configuration,
        current.loader,
      ),
      async () => {
        const response = htmlResponse(
          await loginPage(meta.originalUrl, "", selected),
        );
        if (requested !== null && requested === selected) {
          response.headers.append(
            "set-cookie",
            await languageCookie(request, selected),
          );
        }
        return response;
      },
    );
  },
);

service.post(
  "/",
  { summary: "Authenticate a user" },
  async ({ request, meta }) => {
    const form = await request.formData();
    const username = String(form.get("username") ?? "");
    const password = String(form.get("password") ?? "");
    const selected = String(form.get("language") ?? "");
    const current = currentLocalization()!;
    if (
      selected &&
      !current.configuration.languages.some((item) => item.code === selected)
    ) {
      return new Response("Invalid language", { status: 400 });
    }
    return await withLocalization(
      new Localization(
        selected ||
          (request.headers.has("the8020-language")
            ? current.language
            : current.configuration.defaultLoginLanguage ??
              current.configuration.defaultLanguage),
        current.configuration,
        current.loader,
      ),
      async () => {
        const t = await translations("the8020/uui");
        const result = await login(request, { username, password });
        if (!result.authenticated || result.setCookie === undefined) {
          return htmlResponse(
            await loginPage(meta.originalUrl, t("login.invalid"), selected),
            401,
          );
        }
        const headers = new Headers({
          location: uiConfig.postLoginUrl,
          "cache-control": "no-store",
        });
        headers.append("set-cookie", result.setCookie);
        headers.append("set-cookie", await languageCookie(request, selected));
        return new Response(null, { status: 303, headers });
      },
    );
  },
);

const logout = async ({ request }: { request: Request }): Promise<Response> => {
  const result = await logoutUser(request);
  if (result.status !== 204) return result;
  result.headers.set("location", uiConfig.loginUrl);
  return new Response(null, { status: 303, headers: result.headers });
};

service.post(
  "/logout",
  { summary: "End the current authentication session" },
  logout,
);
service.get(
  "/logout",
  { summary: "End the current authentication session" },
  logout,
);
service.get(
  "/*",
  { summary: "Serve a static login asset" },
  async ({ request }) =>
    await brandingAsset(request) ??
      staticResponse(new URL(request.url).pathname),
);

async function loginPage(
  originalUrl: string,
  error = "",
  selected = "",
): Promise<string> {
  const t = await translations("the8020/uui");
  const localization = currentLocalization()!;
  const source = await Deno.readTextFile(new URL("index.html", frontend));
  const errorMarkup = error === ""
    ? ""
    : `<p class="error" role="alert">${escapeHTML(error)}</p>`;
  const languages =
    `<option value="" data-i18n="login.accountLanguage">${
      escapeHTML(t("login.accountLanguage"))
    }</option>` +
    localization.configuration.languages.map((item) =>
      `<option value="${escapeHTML(item.code)}"${
        item.code === selected ? " selected" : ""
      }>${escapeHTML(item.name)}</option>`
    ).join("");
  return source.replace("<!--__the8020_login_error__-->", errorMarkup)
    .replace(
      "<title>80|20 sign in</title>",
      brandingHead(await fetchBranding(), originalUrl, t("login.signIn")),
    ).replace(
      'lang="en"',
      `lang="${escapeHTML(localization.language)}" dir="${
        direction(localization.language)
      }"`,
    )
    .replace("__language_options__", languages)
    .replace(
      /\{\{\s*([a-zA-Z.]+)\s*\}\}/g,
      (_, key: string) => escapeHTML(t(key)),
    );
}

async function staticResponse(path: string): Promise<Response> {
  const relativePath = path.replace(/^\/+/, "");
  const safe = relativePath.length > 0 && relativePath.split("/").every(
    (segment) => /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(segment),
  );
  const contentType = [...staticContentTypes].find(([suffix]) =>
    relativePath.endsWith(suffix)
  )?.[1];
  if (!safe || contentType === undefined) return notFoundResponse();

  try {
    const body = await Deno.readFile(new URL(relativePath, frontend));
    const immutable = /-[a-f0-9]{8}\.[a-z0-9]+$/.test(relativePath);
    return new Response(body, {
      headers: {
        "content-type": contentType,
        "cache-control": immutable
          ? "public, max-age=31536000, immutable"
          : "no-cache",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return notFoundResponse();
    throw error;
  }
}

function notFoundResponse(): Response {
  return new Response("Not Found\n", {
    status: 404,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-language": currentLocalization()!.language,
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; form-action 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
}

function escapeHTML(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(
    ">",
    "&gt;",
  ).replaceAll('"', "&quot;");
}

export default service;
