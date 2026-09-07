import { assert, assertEquals, assertMatch } from "@std/assert";
import { Supervisor } from "../../../kernel/defaults/config/runtime/deno/supervisor/supervisor.ts";
import { readHTTPResponse } from "../../../kernel/defaults/config/runtime/deno/supervisor/unix_http.ts";

// Exercise the real shell Worker, supervisor listener, and Go supervisor client.
// Read wire bytes: fetch() silently decompresses responses and can hide mistakes.
const token = "asset-delivery-test-token";
const supervisor = new Supervisor({
  nodeId: "nod-0000000001",
  sandboxId: "sbx-0000000001",
  workloadType: "service",
  token,
  supervisorVersion: "asset-delivery-test",
});
const worker = await supervisor.startWorker({
  metadata: {
    nodeId: "nod-0000000001",
    sandboxId: "sbx-0000000001",
    workerId: "wrk-0000000001",
    workloadType: "service",
    ownerId: "the8020/uui",
    workloadId: "asset-test",
    user: { userId: "user:assettest", username: "assettest" },
    origin: { type: "service", id: "the8020/uui/shell" },
    releaseId: "test",
    databaseBackend: "sqlite",
    entrypoint: new URL("./service.ts", import.meta.url).href,
    debuggerName: "service:asset-delivery-test",
    service: {
      serviceId: "the8020/uui/shell",
      generation: 1,
      canonicalBasePath: "/the8020/uui/shell",
      executionMode: "stateless",
    },
  },
  permissions: {
    read: [
      new URL("../../", import.meta.url).pathname,
      new URL("../../../kernel/defaults/config/runtime/", import.meta.url)
        .pathname,
    ],
  },
});
supervisor.configureService("asset-test", [worker.metadata.workerId], 2);
const server = supervisor.serve({
  hostname: "127.0.0.1",
  port: 0,
  onListen() {},
});
const temporaryRoot = await Deno.makeTempDir({ prefix: "uui-asset-delivery-" });
let relay: Deno.ChildProcess | undefined;
let publicPort = 0;
let assertions = 0;
try {
  const source = `${temporaryRoot}/relay.go`;
  await Deno.writeTextFile(source, relaySource());
  relay = new Deno.Command(
    Deno.args.find((value) => value.startsWith("--go="))?.slice(5) ?? "go",
    {
      args: ["run", source, `http://127.0.0.1:${server.addr.port}`, token],
      cwd: new URL("../../../kernel/", import.meta.url).pathname,
      stdout: "piped",
      stderr: "inherit",
    },
  ).spawn();
  const reader = relay.stdout.pipeThrough(new TextDecoderStream()).getReader();
  const timeout = setTimeout(() => relay?.kill("SIGTERM"), 30_000);
  try {
    let address = "";
    while (!address.includes("\n")) {
      const chunk = await reader.read();
      assert(!chunk.done, "Go relay exited before listening");
      address += chunk.value;
    }
    publicPort = Number(new URL(address.trim()).port);
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }
  for (const file of ["main.js", "styles.css", "markdown.css"]) {
    const identity = await request(`/${file}`, {
      "accept-encoding": "identity",
    });
    assertEquals(identity.status, 200);
    assertEquals(identity.headers.get("content-encoding"), null);
    assertEquals(identity.headers.get("cache-control"), "no-cache");
    assert(identity.body.length > 1024);
    const etag = identity.headers.get("etag")!;
    assertMatch(etag, /^W\/"[a-f0-9]{64}"$/);
    const path = `/${file}?v=${etag.slice(3, -1)}`;
    for (
      const [accept, encoding] of [
        ["identity", null],
        ["gzip", "gzip"],
        ["gzip;q=0.5, br;q=1", "br"],
        ["br;q=1,gzip;q=0,identity;q=0", "br"],
        ["gzip;q=0, br;q=0", null],
      ] as const
    ) {
      const response = await request(path, { "accept-encoding": accept });
      assertEquals(response.status, 200);
      assertEquals(response.headers.get("content-encoding"), encoding);
      assertEquals(response.headers.get("etag"), etag);
      assertEquals(
        response.headers.get("cache-control"),
        "public, max-age=31536000, immutable",
      );
      assertEquals(response.headers.get("vary"), "Accept-Encoding");
      let body = response.body;
      if (encoding) {
        assert(body.length < identity.body.length);
        assertEquals(response.headers.get("content-length"), null);
        body = new Uint8Array(
          await new Response(
            new Response(body).body!.pipeThrough(
              new DecompressionStream(encoding === "br" ? "brotli" : "gzip"),
            ),
          ).arrayBuffer(),
        );
      } else {
        assertEquals(
          response.headers.get("content-length"),
          String(body.length),
        );
      }
      assertEquals(body, identity.body);
      const unchanged = await request(path, {
        "accept-encoding": accept,
        "if-none-match": `"unrelated", ${etag}`,
      });
      assertEquals(unchanged.status, 304);
      assertEquals(unchanged.body.length, 0);
      assertEquals(unchanged.headers.get("etag"), etag);
      assertEquals(unchanged.headers.get("vary"), "Accept-Encoding");
      assertEquals(
        unchanged.headers.get("cache-control"),
        response.headers.get("cache-control"),
      );
      console.log(
        `${file}: ${
          encoding ?? "identity"
        } ${response.body.length} bytes; exact body and 304 passed`,
      );
      assertions++;
    }
    const head = await request(path, { "accept-encoding": "br, gzip" }, "HEAD");
    assertEquals(head.status, 200);
    assertEquals(head.body.length, 0);
    assertEquals(head.headers.get("content-length"), null);
    assertEquals(head.headers.get("etag"), etag);
    assertEquals(head.headers.get("vary"), "Accept-Encoding");
    const stale = await request(`/${file}?v=stale`, {
      "accept-encoding": "gzip",
    });
    assertEquals(stale.status, 404);
  }
  const html = await request("/", { "accept-encoding": "gzip" });
  assertEquals(html.status, 200);
  assertEquals(html.headers.get("content-encoding"), "gzip");
  assertEquals(html.headers.get("cache-control"), "no-store");
  console.log(
    `Passed ${assertions} asset encoding/revalidation cases, HEAD, stale versions, and shell HTML through the real Worker, supervisor listener, and Go client.`,
  );
} finally {
  if (publicPort) {
    await fetch(`http://127.0.0.1:${publicPort}/__test_stop`, {
      method: "POST",
    });
  } else if (relay) {
    try {
      relay.kill("SIGTERM");
    } catch { /* Already exited. */ }
  }
  if (relay) await relay.status;
  await supervisor.drain();
  await server.shutdown();
  await Deno.remove(temporaryRoot, { recursive: true });
}

async function request(path: string, extra: HeadersInit, method = "GET") {
  const port = publicPort;
  const connection = await Deno.connect({ hostname: "127.0.0.1", port });
  const timeout = setTimeout(() => connection.close(), 10_000);
  try {
    const headers = new Headers(extra);
    const bytes = new TextEncoder().encode([
      `${method} ${path} HTTP/1.0`,
      `Host: 127.0.0.1:${port}`,
      "Content-Length: 0",
      "Connection: close",
      ...[...headers].map(([name, value]) => `${name}: ${value}`),
      "\r\n",
    ].join("\r\n"));
    let written = 0;
    while (written < bytes.length) {
      written += await connection.write(bytes.subarray(written));
    }
    const raw = await readHTTPResponse(connection);
    const boundary = raw.findIndex((byte, index) =>
      byte === 13 && raw[index + 1] === 10 &&
      raw[index + 2] === 13 && raw[index + 3] === 10
    );
    assert(boundary >= 0);
    const lines = new TextDecoder().decode(raw.subarray(0, boundary)).split(
      "\r\n",
    );
    const status = Number(lines.shift()!.split(" ")[1]);
    const responseHeaders = new Headers(lines.map((line): [string, string] => {
      const colon = line.indexOf(":");
      return [line.slice(0, colon), line.slice(colon + 1).trim()];
    }));
    assertEquals(responseHeaders.has("transfer-encoding"), false);
    return {
      status,
      headers: responseHeaders,
      body: new Uint8Array(raw.subarray(boundary + 4)),
    };
  } finally {
    clearTimeout(timeout);
    try {
      connection.close();
    } catch { /* Already closed by the timeout. */ }
  }
}

// The relay only supplies test placement and trusted ingress metadata. The
// actual private HTTP request, encoding preservation, and HEAD handling belong
// to Client.DispatchService, exactly as in the kernel's service router.
function relaySource(): string {
  return `package main

import (
  "context"
  "fmt"
  "io"
  "net"
  "net/http"
  "os"
  "sync/atomic"
  "time"
  "the8020/kernel/execution/supervisor"
  "the8020/kernel/runtime/protocol"
  "the8020/kernel/sandbox/model"
)

func main() {
  client, err := supervisor.New(supervisor.Config{
    ProtocolVersion: protocol.ProtocolVersion,
    Endpoint: func(model.SandboxSpec) (string, error) { return os.Args[1], nil },
  })
  if err != nil { panic(err) }
  listener, err := net.Listen("tcp", "127.0.0.1:0")
  if err != nil { panic(err) }
  spec := model.SandboxSpec{SandboxID: "sbx-0000000001", InternalToken: os.Args[2]}
  var sequence atomic.Uint64
  stopped := make(chan struct{})
  server := &http.Server{ReadHeaderTimeout: 5 * time.Second}
  server.Handler = http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
    if request.URL.Path == "/__test_stop" {
      writer.WriteHeader(http.StatusNoContent)
      go func() {
        ctx, cancel := context.WithTimeout(context.Background(), 5 * time.Second)
        defer cancel()
        _ = server.Shutdown(ctx)
        close(stopped)
      }()
      return
    }
    request.URL.Scheme, request.URL.Host = "http", "service"
    request.Header.Set("the8020-internal-context-id", fmt.Sprintf("ctx-%010d", sequence.Add(1)))
    response, err := client.DispatchService(request.Context(), spec, "asset-test", request)
    if err != nil { http.Error(writer, err.Error(), http.StatusBadGateway); return }
    defer response.Body.Close()
    for key, values := range response.Header { writer.Header()[key] = values }
    writer.WriteHeader(response.StatusCode)
    _, _ = io.Copy(writer, response.Body)
  })
  fmt.Println("http://" + listener.Addr().String())
  if err := server.Serve(listener); err != nil && err != http.ErrServerClosed { panic(err) }
  <-stopped
}
`;
}
