import { defineService, HTTPError, type RequestMetadata } from "@the8020/http";
import { kernel, WorkerInvokeError } from "@the8020/kernel";
import { controlRequest } from "../../agent.ts";
import { AssetServer } from "./assets.ts";
import uiConfig from "../../ui-config.json" with { type: "json" };

const frontend = new URL("./frontend/", import.meta.url);
const sharedFrontend = new URL("../../frontend/", import.meta.url);
const generated = new URL("./.generated/", import.meta.url);
const staticRoots = [generated, frontend, sharedFrontend] as const;
const assets = new AssetServer();
const service = defineService();

service.get(
  "/sessions",
  { summary: "List your UUI sessions" },
  async ({ meta }) => {
    const { default: Sessions } = await import("../../tables/sessions.ts");
    const sessions = await Sessions.selectAll().where(
      Sessions.authenticatedUserId,
      "=",
      meta.user.userId,
    )
      .orderBy(Sessions.updatedAt, "desc").limit(100).execute();
    return Response.json({
      sessions: sessions.map((session) => ({
        sessionId: session.sessionId,
        state: session.state,
        screen: session.currentScreenId,
        updatedAt: session.updatedAt,
      })),
    });
  },
);

service.post("/control", {
  summary: "Claim, release, or check control of your UUI session",
}, async ({ meta, request }) => {
  const input = controlRequest.parse(await request.json());
  const { default: Sessions } = await import("../../tables/sessions.ts");
  const session = await Sessions.selectAll().where(
    Sessions.sessionId,
    "=",
    input.sessionId,
  ).executeTakeFirst();
  if (
    session === undefined || session.authenticatedUserId !== meta.user.userId
  ) throw new HTTPError(404, { error: "uui_session_not_found" });
  const target = {
    nodeId: session.nodeId,
    sandboxId: session.sandboxId,
    workerId: session.workerId,
    persistentExecutionId: session.persistentExecutionId,
  };
  try {
    const control = await kernel.worker.invoke<
      { active: boolean; control: number }
    >({ ...target, function: "uui.session.control", input });
    return Response.json({
      ...control,
      ...(control.active ? { route: await kernel.services.route(target) } : {}),
    });
  } catch (error) {
    throw new HTTPError(
      error instanceof WorkerInvokeError && error.code === "target_not_found"
        ? 410
        : 409,
      {
        error: "session_unavailable",
        message: error instanceof Error ? error.message : "Session unavailable",
      },
    );
  }
});

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
  ({ request }) => staticResponse(request),
);

async function shellResponse(meta: RequestMetadata): Promise<Response> {
  let source = await Deno.readTextFile(new URL("index.html", frontend));
  const versions = await Promise.all([
    assets.version(generated, "main.js"),
    assets.version(frontend, "styles.css"),
    assets.version(sharedFrontend, "markdown.css"),
  ]);
  for (
    const [index, path] of ["main.js", "styles.css", "markdown.css"].entries()
  ) {
    source = source.replace(`"${path}"`, `"${path}?v=${versions[index]}"`);
  }
  const requestURL = new URL(meta.originalUrl);
  const websocketScheme = requestURL.protocol === "https:" ? "wss:" : "ws:";
  const themeNonce = contentSecurityNonce();
  const boot = {
    username: meta.user.username,
    logoutUrl: uiConfig.logoutUrl,
    websocketUrl:
      `${websocketScheme}//${requestURL.host}${uiConfig.sessionWebSocketPath}`,
    protocol: uiConfig.protocolVersion,
    heartbeatInterval: uiConfig.heartbeatIntervalMilliseconds,
    reconnectInitialDelay: uiConfig.reconnectInitialDelayMilliseconds,
    reconnectMaximumDelay: uiConfig.reconnectMaximumDelayMilliseconds,
    buildVersion: versions[0],
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
        `default-src 'self'; connect-src 'self' ws: wss:; script-src 'self' 'nonce-${themeNonce}'; style-src 'self' 'nonce-${themeNonce}'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`,
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

async function staticResponse(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname.replace(/^\/+/, "");
  if (path.startsWith("package-assets/")) {
    return await assets.package(
      request,
      path.slice("package-assets/".length),
    ) ?? notFoundResponse();
  }
  // Authored TypeScript and unrelated package files are never shell assets.
  if (!/\.(?:js|js\.map|css|svg|woff2)$/.test(path)) return notFoundResponse();
  for (const root of staticRoots) {
    const response = await assets.file(request, root, path);
    if (response) return response;
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
