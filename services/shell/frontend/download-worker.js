// Browser-local bridge from a transferred stream to the native download manager.
// Only the reserved download path is intercepted; no application assets are cached.
self.addEventListener(
  "install",
  (event) => event.waitUntil(self.skipWaiting()),
);
self.addEventListener(
  "activate",
  (event) => event.waitUntil(self.clients.claim()),
);

const transfers = new Map();
const prefix = new URL("./__downloads/", self.registration.scope).href;
// deno-lint-ignore no-control-regex
const unsafeFilename = /[\/\\\x00-\x1f\x7f]/;

function forget(token) {
  const transfer = transfers.get(token);
  if (!transfer) return;
  transfers.delete(token);
  void transfer.stream.cancel().catch(() => {});
  transfer.port.close();
}

self.addEventListener("message", (event) => {
  const data = event.data;
  const source = event.source;
  if (!source?.url || !source.url.startsWith(self.registration.scope)) return;
  if (
    !data || typeof data.token !== "string" ||
    !/^[a-f0-9-]{36}$/.test(data.token)
  ) return;
  if (data.type === "download.forget") {
    if (transfers.get(data.token)?.clientId === source.id) forget(data.token);
    return;
  }
  if (data.type !== "download.register" || !event.ports[0]) return;
  for (const [token, transfer] of transfers) {
    if (transfer.expires < Date.now()) forget(token);
  }
  if (
    transfers.size >= 128 || transfers.has(data.token) ||
    !(data.stream instanceof ReadableStream) ||
    typeof data.filename !== "string" || data.filename.length > 255 ||
    unsafeFilename.test(data.filename) ||
    typeof data.contentType !== "string" || data.contentType.length > 200 ||
    /[\r\n]/.test(data.contentType)
  ) {
    event.ports[0].postMessage({ error: "Invalid or unavailable download" });
    if (data.stream instanceof ReadableStream) {
      void data.stream.cancel().catch(() => {});
    }
    return;
  }
  transfers.set(data.token, {
    stream: data.stream,
    filename: data.filename,
    contentType: data.contentType,
    clientId: source.id,
    port: event.ports[0],
    expires: Date.now() + 30_000,
  });
  event.ports[0].postMessage({ url: prefix + data.token });
});

self.addEventListener("fetch", (event) => {
  if (!event.request.url.startsWith(prefix)) return;
  const token = event.request.url.slice(prefix.length);
  const transfer = transfers.get(token);
  if (
    !transfer || transfer.expires < Date.now() || event.request.method !== "GET"
  ) {
    forget(token);
    event.respondWith(new Response("Download expired", { status: 410 }));
    return;
  }
  transfers.delete(token);
  const reader = transfer.stream.getReader();
  const complete = () => {
    transfer.port.postMessage({ complete: true });
    transfer.port.close();
  };
  // A transferred stream may prefetch its last chunk before navigation starts.
  // Signal completion only when the native response consumes its body.
  const body = new ReadableStream({
    async pull(controller) {
      try {
        const result = await reader.read();
        if (result.done) {
          controller.close();
          complete();
        } else controller.enqueue(result.value);
      } catch (error) {
        controller.error(error);
        complete();
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        complete();
      }
    },
  }, { highWaterMark: 0 });
  const filename = encodeURIComponent(transfer.filename).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
  event.respondWith(
    new Response(body, {
      headers: {
        "Content-Type": transfer.contentType,
        "Content-Disposition": "attachment; filename*=UTF-8''" + filename,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    }),
  );
});
