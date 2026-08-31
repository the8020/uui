import { defineService, type RequestMetadata } from "@the8020/http";
import uiConfig from "../../ui-config.json" with { type: "json" };

const frontend = new URL("./frontend/", import.meta.url);
const generated = new URL("./.generated/", import.meta.url);
const staticRoots = [generated, frontend] as const;
const staticContentTypes = new Map([
  [".js.map", "application/json; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);
const service = defineService();

service.get(
  "/",
  { summary: "Render the authenticated UUI shell" },
  ({ meta }) => shellResponse(meta),
);
service.get(
  "/index.html",
  { summary: "Render the authenticated UUI shell" },
  ({ meta }) => shellResponse(meta),
);
service.get(
  "/*",
  { summary: "Serve a static UUI shell asset" },
  ({ request }) => staticResponse(new URL(request.url).pathname),
);

async function shellResponse(meta: RequestMetadata): Promise<Response> {
  const source = await Deno.readTextFile(new URL("index.html", frontend));
  const requestURL = new URL(meta.originalUrl);
  const websocketScheme = requestURL.protocol === "https:" ? "wss:" : "ws:";
  const themeNonce = contentSecurityNonce();
  const boot = {
    websocketUrl:
      `${websocketScheme}//${requestURL.host}${uiConfig.sessionWebSocketPath}`,
    protocol: uiConfig.protocolVersion,
    heartbeatInterval: uiConfig.heartbeatIntervalMilliseconds,
    reconnectInitialDelay: uiConfig.reconnectInitialDelayMilliseconds,
    reconnectMaximumDelay: uiConfig.reconnectMaximumDelayMilliseconds,
    buildVersion: "phase-1d",
  };
  const html = source.replace("__the8020_theme_nonce__", themeNonce).replace(
    /\{\s*"__the8020_boot_placeholder__"\s*:\s*true\s*\}/,
    escapeJSON(boot),
  );
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy":
        `default-src 'self'; connect-src 'self' ws: wss:; script-src 'self' 'nonce-${themeNonce}'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`,
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
}

function contentSecurityNonce(): string {
  return Array.from(
    crypto.getRandomValues(new Uint8Array(16)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
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

  for (const root of staticRoots) {
    try {
      const body = await Deno.readFile(new URL(relativePath, root));
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
      if (error instanceof Deno.errors.NotFound) continue;
      throw error;
    }
  }
  return notFoundResponse();
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

function escapeJSON(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll(
    ">",
    "\\u003e",
  ).replaceAll("&", "\\u0026");
}

export default service;
