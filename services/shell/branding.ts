import {
  fetchBranding,
  fetchBrandingImage,
  PUBLIC_BRANDING_PATH,
} from "../../branding.ts";
import { brandingImage } from "../../src/branding_images.ts";
import { AssetServer } from "./assets.ts";

const defaults = new URL("./frontend/", import.meta.url);
const assets = new AssetServer();

export async function brandingAsset(
  request: Request,
): Promise<Response | undefined> {
  const path = new URL(request.url).pathname;
  const kind = (Object.keys(brandingImage) as Array<keyof typeof brandingImage>)
    .find((kind) => path === `/branding/${brandingImage[kind].file}`);
  if (!kind) return undefined;
  const bytes = await fetchBrandingImage(kind);
  if (bytes === null) {
    const url = new URL(request.url);
    url.search = "";
    return await assets.file(
      new Request(url, request),
      defaults,
      `default-${brandingImage[kind].file}`,
    );
  }
  const hash = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  const etag = `"${hash}"`;
  const headers = {
    "content-type": brandingImage[kind].type,
    "cache-control": "no-cache",
    "x-content-type-options": "nosniff",
    etag,
  };
  const matches = request.headers.get("if-none-match")?.split(",")
    .some((value) => [etag, "*"].includes(value.trim().replace(/^W\//, "")));
  return new Response(
    matches || request.method === "HEAD" ? null : new Uint8Array(bytes),
    { status: matches ? 304 : 200, headers },
  );
}

export function brandingHead(
  branding: Awaited<ReturnType<typeof fetchBranding>>,
  originalUrl: string,
  heading = "",
): string {
  const origin = new URL(originalUrl).origin;
  const title = escapeHTML(branding.title);
  const social = escapeHTML(
    `${origin}${PUBLIC_BRANDING_PATH}social.jpg?v=${branding.revision}`,
  );
  return `<title>${title}${heading ? ` ${escapeHTML(heading)}` : ""}</title>
    <link id="system-favicon" rel="icon" type="image/png" sizes="64x64" href="${PUBLIC_BRANDING_PATH}favicon.png?v=${branding.revision}">
    <meta property="og:type" content="website">
    <meta property="og:title" content="${title}">
    <meta property="og:site_name" content="${title}">
    <meta property="og:url" content="${
    escapeHTML(origin + "/the8020/uui/shell/")
  }">
    <meta property="og:image" content="${social}">
    <meta property="og:image:type" content="image/jpeg">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:image:alt" content="${title}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${title}">
    <meta name="twitter:image" content="${social}">`;
}

function escapeHTML(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
