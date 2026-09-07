import { assertEquals, assertMatch } from "@std/assert";
import { AssetServer } from "./assets.ts";

Deno.test("browser assets delegate encoding, validate versions, and revalidate without downloading", async () => {
  const directory = await Deno.makeTempDir({ prefix: "uui-assets-" });
  const root = new URL(`file://${directory}/`);
  const server = new AssetServer();
  const source = 'export const example = "program-owned browser code";\n'
    .repeat(1000);
  try {
    await Deno.writeTextFile(new URL("component.js", root), source);
    const hash = await server.version(root, "component.js");
    assertMatch(hash, /^[a-f0-9]{64}$/);
    const url = `https://example/component.js?v=${hash}`;
    const request = (headers: HeadersInit = {}, method = "GET") =>
      new Request(url, { headers, method });
    const etag = `W/"${hash}"`;
    for (const accept of ["identity", "gzip", "br;q=1,gzip;q=0,identity;q=0"]) {
      const response = await server.file(
        request({ "accept-encoding": accept }),
        root,
        "component.js",
      );
      assertEquals(response?.status, 200);
      assertEquals(response?.headers.get("content-encoding"), null);
      assertEquals(
        response?.headers.get("cache-control"),
        "public, max-age=31536000, immutable",
      );
      assertEquals(response?.headers.get("vary"), "Accept-Encoding");
      assertEquals(response?.headers.get("etag"), etag);
      assertEquals(await response!.text(), source);
    }
    const unchanged = await server.file(
      request({ "if-none-match": `"unrelated", ${etag}` }),
      root,
      "component.js",
    );
    assertEquals(unchanged?.status, 304);
    assertEquals(unchanged?.headers.get("etag"), etag);
    assertEquals(unchanged?.headers.get("vary"), "Accept-Encoding");
    assertEquals(unchanged?.headers.get("content-length"), null);
    assertEquals(await unchanged!.text(), "");
    const identity = await server.file(
      request({ "accept-encoding": "gzip;q=0" }),
      root,
      "component.js",
    );
    assertEquals(identity?.headers.get("content-encoding"), null);
    assertEquals(await identity!.text(), source);
    const head = await server.file(
      request({ "accept-encoding": "gzip" }, "HEAD"),
      root,
      "component.js",
    );
    assertEquals(head?.headers.get("content-length"), null);
    assertEquals(head?.headers.get("content-encoding"), null);
    assertEquals(head?.headers.get("etag"), etag);
    assertEquals(await head!.text(), "");

    const plain = await server.file(
      new Request("https://example/component.js"),
      root,
      "component.js",
    );
    assertEquals(plain?.headers.get("cache-control"), "no-cache");
    await plain!.body?.cancel();
    await Deno.writeTextFile(
      new URL("component.js", root),
      "export const updated = true;",
    );
    assertEquals(await server.file(request(), root, "component.js"), undefined);
    const updated = await server.file(
      new Request("https://example/component.js", {
        headers: { "if-none-match": etag },
      }),
      root,
      "component.js",
    );
    assertEquals(updated?.status, 200);
    assertEquals(await updated!.text(), "export const updated = true;");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("package assets expose only explicit public files and reject traversal or symlink escapes", async () => {
  const root = await Deno.makeTempDir({ prefix: "uui-published-" });
  const owner = `${root}/example/editor`;
  const server = new AssetServer();
  const request = new Request(
    "https://example/package-assets/example/editor/element.js",
    { headers: { "accept-encoding": "br;q=1,gzip;q=0,identity;q=0" } },
  );
  const source = "export default () => ({});\n".repeat(1000);
  try {
    await Deno.mkdir(`${owner}/public/images`, { recursive: true });
    await Deno.writeTextFile(
      `${owner}/public/element.js`,
      source,
    );
    await Deno.writeTextFile(`${owner}/private.js`, "private package source");
    await Deno.symlink(`${owner}/private.js`, `${owner}/public/escape.js`);
    await Deno.symlink(`${owner}`, `${owner}/public/outside`);
    const publicFile = await server.package(
      request,
      "example/editor/element.js",
      root,
    );
    assertEquals(publicFile?.status, 200);
    assertEquals(publicFile?.headers.get("content-encoding"), null);
    assertEquals(await publicFile!.text(), source);
    for (
      const path of [
        "example/editor/private.js",
        "example/editor/../private.js",
        "example/editor/%2e%2e%2fprivate.js",
        "example/editor/escape.js",
        "example/editor/outside/private.js",
        "example/editor/.env",
        "example/editor//element.js",
      ]
    ) {
      assertEquals(await server.package(request, path, root), undefined, path);
    }
    await Deno.rename(`${owner}/public`, `${owner}/renamed`);
    await Deno.symlink(`${owner}/renamed`, `${owner}/public`);
    assertEquals(
      await server.package(request, "example/editor/element.js", root),
      undefined,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("immutable filenames must match their actual content", async () => {
  const directory = await Deno.makeTempDir({ prefix: "uui-immutable-" });
  const root = new URL(`file://${directory}/`);
  const server = new AssetServer();
  try {
    await Deno.writeTextFile(
      new URL("component-deadbeef.js", root),
      "export const a = 1;",
    );
    const hash = await server.version(root, "component-deadbeef.js");
    const wrong = await server.file(
      new Request("https://example/component-deadbeef.js"),
      root,
      "component-deadbeef.js",
    );
    assertEquals(wrong?.headers.get("cache-control"), "no-cache");
    await wrong!.body?.cancel();
    const name = `component-${hash.slice(0, 16)}.js`;
    await Deno.rename(
      new URL("component-deadbeef.js", root),
      new URL(name, root),
    );
    const immutable = await server.file(
      new Request(`https://example/${name}`),
      root,
      name,
    );
    assertEquals(
      immutable?.headers.get("cache-control"),
      "public, max-age=31536000, immutable",
    );
    await immutable!.body?.cancel();
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
