import { defineService } from "@the8020/http";
import { login, logout as logoutUser } from "/p/the8020/users/mod.ts";
import uiConfig from "../../ui-config.json" with { type: "json" };

const frontend = new URL("./frontend/", import.meta.url);
const staticContentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);
const service = defineService();

service.get(
  "/",
  { summary: "Render the user login" },
  async () => htmlResponse(await loginPage()),
);

service.post(
  "/",
  { summary: "Authenticate a user" },
  async ({ request }) => {
    const form = await request.formData();
    const username = String(form.get("username") ?? "");
    const password = String(form.get("password") ?? "");
    const result = await login(request, { username, password });
    if (!result.authenticated || result.setCookie === undefined) {
      return htmlResponse(
        await loginPage("Invalid username or password."),
        401,
      );
    }
    return new Response(null, {
      status: 303,
      headers: {
        location: uiConfig.postLoginUrl,
        "set-cookie": result.setCookie,
        "cache-control": "no-store",
      },
    });
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
  ({ request }) => staticResponse(new URL(request.url).pathname),
);

async function loginPage(error = ""): Promise<string> {
  const source = await Deno.readTextFile(new URL("index.html", frontend));
  const errorMarkup = error === ""
    ? ""
    : `<p class="error" role="alert">${escapeHTML(error)}</p>`;
  return source.replace("<!--__the8020_login_error__-->", errorMarkup);
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
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
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
