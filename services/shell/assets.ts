const safeSegment = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const contentTypes = new Map([
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".avif", "image/avif"],
  [".ico", "image/x-icon"],
  [".woff2", "font/woff2"],
  [".woff", "font/woff"],
  [".ttf", "font/ttf"],
  [".otf", "font/otf"],
  [".wasm", "application/wasm"],
]);

interface Asset {
  signature: string;
  body: Uint8Array<ArrayBuffer>;
  hash: string;
  bytes: number;
}

/** Bounded per-Worker cache. Source changes invalidate by native file metadata. */
export class AssetServer {
  readonly #cache = new Map<string, Asset>();
  readonly #loading = new Map<string, Promise<Asset | undefined>>();
  #bytes = 0;

  async version(root: URL, relative: string): Promise<string> {
    const asset = await this.#asset(root, relative);
    if (!asset) throw new Error(`Missing browser asset ${relative}`);
    return asset.hash;
  }

  async file(
    request: Request,
    root: URL,
    relative: string,
  ): Promise<Response | undefined> {
    const type = contentTypes.get(relative.slice(relative.lastIndexOf(".")));
    if (!type) return undefined;
    const asset = await this.#asset(root, relative);
    if (!asset) return undefined;
    const version = new URL(request.url).searchParams.get("v");
    if (version !== null && version !== asset.hash) return undefined;
    const nameHash = relative.match(/-([a-f0-9]{8,64})\.[a-z0-9.]+$/)?.[1];
    const immutable = version === asset.hash ||
      nameHash !== undefined && asset.hash.startsWith(nameHash);
    const headers = new Headers({
      "content-type": type,
      "cache-control": immutable
        ? "public, max-age=31536000, immutable"
        : "no-cache",
      "etag": `W/"${asset.hash}"`,
      "vary": "Accept-Encoding",
      "x-content-type-options": "nosniff",
    });
    const validators = request.headers.get("if-none-match")?.split(",").map((
      value,
    ) => value.trim().replace(/^W\//, ""));
    if (
      validators?.some((value) => value === "*" || value === `"${asset.hash}"`)
    ) {
      return new Response(null, { status: 304, headers });
    }
    // The supervisor negotiates compression after the Worker transfers this
    // response. Keep the source validator and Vary on bodyless revalidations too.
    // HEAD cannot predict the selected representation's encoded length.
    if (request.method === "HEAD") return new Response(null, { headers });
    headers.set("content-length", String(asset.body.byteLength));
    return new Response(asset.body, { headers });
  }

  async package(
    request: Request,
    relative: string,
    packagesRoot = "/workspace/packages",
  ): Promise<Response | undefined> {
    const parts = relative.split("/");
    if (parts.length < 3 || !parts.every((part) => safeSegment.test(part))) {
      return undefined;
    }
    try {
      const root = await Deno.realPath(packagesRoot);
      const owner = await Deno.realPath(`${root}/${parts[0]}/${parts[1]}`);
      if (!beneath(owner, root)) return undefined;
      const published = await Deno.realPath(`${owner}/public`);
      if (published !== `${owner}/public`) return undefined;
      return await this.file(
        request,
        new URL(`file://${published}/`),
        parts.slice(2).join("/"),
      );
    } catch (error) {
      if (missing(error)) return undefined;
      throw error;
    }
  }

  async #asset(root: URL, relative: string): Promise<Asset | undefined> {
    if (!relative.split("/").every((part) => safeSegment.test(part))) {
      return undefined;
    }
    try {
      const parent = await Deno.realPath(root);
      const path = await Deno.realPath(new URL(relative, root));
      if (!beneath(path, parent)) return undefined;
      const stat = await Deno.stat(path);
      if (!stat.isFile || stat.size > 16 * 1024 * 1024) return undefined;
      const signature =
        `${stat.size}:${stat.mtime?.getTime()}:${stat.ctime?.getTime()}`;
      const cached = this.#cache.get(path);
      if (cached?.signature === signature) {
        this.#cache.delete(path);
        this.#cache.set(path, cached);
        return cached;
      }
      const key = `${path}\0${signature}`;
      const loading = this.#loading.get(key);
      if (loading) return await loading;
      const pending = this.#load(path, signature);
      this.#loading.set(key, pending);
      try {
        return await pending;
      } finally {
        this.#loading.delete(key);
      }
    } catch (error) {
      if (missing(error)) return undefined;
      throw error;
    }
  }

  async #load(path: string, signature: string): Promise<Asset | undefined> {
    const body = await Deno.readFile(path);
    if (body.byteLength > 16 * 1024 * 1024) return undefined;
    const hash = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", body)),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    const asset = {
      signature,
      body,
      hash,
      bytes: body.byteLength,
    };
    const previous = this.#cache.get(path);
    if (previous) {
      this.#bytes -= previous.bytes;
      this.#cache.delete(path);
    }
    while (
      this.#cache.size >= 128 || this.#bytes + asset.bytes > 32 * 1024 * 1024
    ) {
      const oldest = this.#cache.entries().next().value;
      if (!oldest) break;
      this.#bytes -= oldest[1].bytes;
      this.#cache.delete(oldest[0]);
    }
    this.#cache.set(path, asset);
    this.#bytes += asset.bytes;
    return asset;
  }
}

function beneath(path: string, root: string): boolean {
  return path.startsWith(`${root}/`);
}
function missing(error: unknown): boolean {
  return error instanceof Deno.errors.NotFound ||
    error instanceof Deno.errors.NotADirectory;
}
