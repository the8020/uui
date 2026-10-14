import { assertEquals } from "@std/assert";
import {
  callScreen,
  captureMessages,
  Channel,
  Model,
  nextScreenChannel,
  packageAssetURL,
  presentPage,
  type ScreenChannel,
  z,
} from "./mod.ts";

interface Browser {
  evaluate<T>(expression: string): Promise<T>;
}

const asset = (name: string) => packageAssetURL("example/widget", name);
const lateNotices: string[] = [];
let disposableReadSignal: AbortSignal | undefined;
const streamResults = new Map<string, number[]>();
const filteredUpdates: Array<[string, unknown]> = [];

export async function prepareCustomElementAssets(root: string): Promise<void> {
  const directory = `${root}/packages/example/widget/public`;
  await Deno.mkdir(directory, { recursive: true });
  const module = `
    window.__customImports = (window.__customImports || 0) + 1;
    export default function mount(context) {
      const { host, config, signal, send } = context;
      const primary = config.instance === 'widget';
      if (primary) window.__customMounts = (window.__customMounts || 0) + 1;
      window.__allCustomMounts = (window.__allCustomMounts || 0) + 1;
      host.dataset.instance = config.instance;
      const button = document.createElement('button');
      button.className = primary ? 'custom-test-button' : 'other-test-button';
      const update = value => { button.textContent = value.label; };
      update(config); button.onclick = () => send('component-action', { answer: 42 });
      const register = (acquire, name) => acquire().subscribe("*", async (id, data, { signal }) => {
        const channel = acquire();
        if (data instanceof ReadableStream) {
          const bytes = [...new Uint8Array(await new Response(data).arrayBuffer())];
          (window.__streamResults ||= {})[name] = bytes; return;
        }
        if (id === 'browser-status') channel.send('browser-status-result', { value: 'browser ' + name });
        if (id === 'update') {
          host.dataset[name === 'program' ? 'programPush' : 'push'] = data;
          if (name === 'program' && data === 'holding') window.__programHolding = true;
        }
        if (id === 'status-result') host.dataset[name === 'program' ? 'programReply' : 'reply'] = data.value;
        if (id === 'wait' && primary) {
          const component = context.channel, program = context.programChannel;
          window.__heldChannelSignal = signal; window.__heldChannelFinished = false;
          await new Promise(resolve => window.__releaseHeldChannel = resolve);
          try { component.subscribe("*", () => {}); window.__staleChannelHandle = 'installed'; }
          catch (error) { window.__staleChannelHandle = error.name; }
          window.__staleChannelRequests = [component, program].map(channel => {
            try { channel.send('notice', 'late ' + name); return 'sent'; } catch(error) { return error.name; }
          });
          try { component.send('bytes', (async function* () {})()); window.__staleStream = 'started'; }
          catch(error) { window.__staleStream = error.name; }
          component.dispose(); program.dispose(); window.__heldChannelFinished = true;
        }
      });
      register(() => context.channel, config.instance);
      if (primary) {
        register(() => context.programChannel, 'program');
        window.__exerciseStreams = async () => {
          for (const name of ['widget', 'other', 'program']) {
            const instance = window.__componentContexts[name === 'program' ? 'widget' : name];
            const channel = name === 'program' ? instance.programChannel : instance.channel;
            await channel.send('bytes', (async function* () { yield new Uint8Array([255, 0, 7, 8, 9, ['widget','other','program'].indexOf(name)]); })()).done;
            channel.send('exchange', null);
          }
          window.__streamsFinished = true;
        };
        window.__startDisposableRead = (program = false) => {
          window.__disposedRead = undefined;
          window.__programHolding = false;
          const gate = new Promise(resolve => window.__releaseUpload = resolve);
          const handle = (program ? context.programChannel : context.channel).send('hold-stream', (async function* () { yield new Uint8Array([1]); await gate; yield new Uint8Array([2]); })());
          window.__disposePendingRead = () => { handle.cancel(); window.__releaseUpload(); };
          handle.done.then(() => window.__disposedRead = 'resolved', error => window.__disposedRead = error.name);
        };
        const start = document.createElement('button'); start.textContent = 'Start delayed handler';
        start.onclick = () => context.channel.send('start', null);
        const read = document.createElement('button'); read.className = 'custom-read'; read.textContent = 'Read status';
        read.onclick = () => context.channel.send('status', null);
        const programRead = document.createElement('button'); programRead.className = 'program-read'; programRead.textContent = 'Program status';
        programRead.onclick = () => context.programChannel.send('status', null);
        host.append(button, read, programRead, start);
      } else host.append(button);
      (window.__componentContexts ||= {})[config.instance] = context;
      const updates = (id, data) => {
        if (!id.startsWith('dashboard.updates.')) throw new Error('Unmatched delivery');
        (window.__filteredUpdates ||= {})[config.instance] ||= [];
        window.__filteredUpdates[config.instance].push([id, data]);
      };
      const subscription = context.channel.subscribe('dashboard.updates.*', updates);
      (window.__inspectableSubscriptions ||= {})[config.instance] = subscription;
      if (subscription.id !== 'dashboard.updates.*' || subscription.handler !== updates) throw new Error('Subscription identity lost');
      signal.addEventListener('abort', () => { if(primary) window.__customAborts = (window.__customAborts || 0) + 1; }, { once: true });
      return { update, setActive(active) {
        host.dataset.componentActive = String(active);
        if (active) queueMicrotask(() => { if (!signal.aborted) { context.channel.send('ready', null); context.channel.send('dashboard.updates.browser', config.instance); context.channel.send('dashboard.other.browser', null); if(primary) context.programChannel.send('ready', null); } });
      }, dispose() { if(primary) window.__customDisposes = (window.__customDisposes || 0) + 1; } };
    }`;
  await Deno.writeTextFile(`${directory}/widget.js`, module);
  await Deno.writeTextFile(`${directory}/replacement.js`, module);
  await Deno.writeTextFile(
    `${directory}/widget.css`,
    ".custom-test-button { color: rgb(17, 34, 51); }",
  );
  await Deno.writeTextFile(
    `${directory}/slow.js`,
    `
    await new Promise(resolve => setTimeout(resolve, 600));
    window.__slowLoaded = true;
    export default function mount({ host }) {
      window.__slowMounted = true;
      host.textContent = 'slow';
      return {};
    }`,
  );
  await Deno.writeTextFile(
    `${directory}/slow-mount.js`,
    `
    export default async function mount({ host, signal }) {
      window.__slowMountStarted = true;
      await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
      host.textContent = 'must be removed';
      return { dispose() { window.__lateDisposed = true; } };
    }`,
  );
}

export function runCustomElementsProgram(): Promise<void> {
  return runWidget();
}

async function runWidget(): Promise<void> {
  lateNotices.length = 0;
  disposableReadSignal = undefined;
  streamResults.clear();
  filteredUpdates.length = 0;
  let programReady = 0;
  const model = new Model({
    status: "ready",
    otherValue: "",
    rows: [{ value: "One" }, { value: "Two" }],
  });
  let module: string | undefined, label = "Program component";
  let preserve = true;
  while (true) {
    const screenChannel = nextScreenChannel();
    const widget = new Channel(), other = new Channel();
    const attach = (channel: Channel | ScreenChannel, name: string) => {
      const handler = (id: string, data: unknown) => {
        filteredUpdates.push([id, data]);
        channel.send("dashboard.updates.ack", data);
      };
      const subscription = channel.subscribe("dashboard.updates.*", handler);
      assertEquals(subscription.id, "dashboard.updates.*");
      assertEquals(subscription.handler === handler, true);
      return channel.subscribe("*", async (id, data, { signal }) => {
        if (data instanceof ReadableStream) {
          if (id === "hold-stream") {
            disposableReadSignal = signal;
            channel.send("update", "holding");
            await data.getReader().read();
            await new Promise<void>((resolve) =>
              signal.addEventListener("abort", () => resolve(), { once: true })
            );
            signal.throwIfAborted();
          } else {streamResults.set(name, [
              ...new Uint8Array(await new Response(data).arrayBuffer()),
            ]);}
          return;
        }
        if (id === "notice") {
          lateNotices.push(String(data));
          return;
        }
        if (id === "ready") {
          channel.send("browser-status", null);
          channel.send("dashboard.updates.row", name);
          channel.send("dashboard.other.row", null);
        }
        if (id === "browser-status-result") {
          assertEquals(data, { value: `browser ${name}` });
          channel.send(
            "update",
            name === "program" ? `ready-${++programReady}` : `ready-${name}`,
          );
        }
        if (id === "status") {
          if (name === "widget") {
            const output = captureMessages();
            channel.send("update", "pending");
            await new Promise((resolve) => setTimeout(resolve, 30));
            output.send("Notification during pending request", "success");
            await new Promise((resolve) => setTimeout(resolve, 150));
          }
          channel.send("status-result", {
            value: name === "program" ? "backend program" : "backend component",
          });
        }
        if (id === "start") channel.send("wait", null);
        if (id === "redraw") {
          model.data.status = "redrawn";
          screenChannel.redraw();
        }
        if (id === "exchange") {
          await channel.send(
            "bytes",
            ReadableStream.from([
              new Uint8Array([
                0,
                255,
                9,
                8,
                7,
                ["widget", "other", "program"].indexOf(name),
              ]),
            ]),
          ).done;
        }
      });
    };
    attach(screenChannel, "program");
    attach(widget, "widget");
    attach(other, "other");
    const pending = callScreen({
      id: "custom-elements-test",
      title: "Custom elements",
      schema: z.object({
        status: z.string(),
        otherValue: z.string(),
        rows: z.object({ value: z.string() }).array(),
      }),
      controls: [{ bind: "rows" }],
      model,
      customElements: module
        ? [
          {
            id: "widget",
            module: asset(module),
            styles: [asset("widget.css")],
            config: { label, instance: "widget" },
            preserve,
            channel: widget,
          },
        ]
        : [],
      ...(module
        ? {
          layout: {
            schema: 1,
            id: "custom-layout",
            root: {
              type: "stack",
              children: [{ type: "custom", customElement: "widget" }, {
                type: "list",
                id: "rows",
                bind: "rows",
                toolbar: [{
                  id: "other",
                  bind: "otherValue",
                  custom: {
                    module: asset(module),
                    styles: [asset("widget.css")],
                    config: { label: "Other component", instance: "other" },
                    preserve: true,
                    channel: other,
                  },
                }],
              }],
            },
          },
        }
        : {}),
      header: {
        actions: [
          { id: "show", label: "Show component" },
          { id: "update", label: "Update component" },
          { id: "hide", label: "Remove component" },
          { id: "replace", label: "Replace module" },
          { id: "slow", label: "Slow import" },
          { id: "slow-mount", label: "Slow mount" },
          { id: "page", label: "Open another page" },
          { id: "reset", label: "Reset screen" },
          { id: "transient", label: "Transient component" },
        ],
      },
    });
    const result = await pending;
    if (result.action === "show") module = "widget.js";
    if (result.action === "hide") module = undefined;
    if (result.action === "update") label = "Updated component";
    if (result.action === "replace") module = "replacement.js";
    if (result.action === "slow") module = "slow.js";
    if (result.action === "slow-mount") module = "slow-mount.js";
    if (result.action === "reset") model.resetScreen();
    if (result.action === "transient") preserve = false;
    if (result.action === "component-action") {
      assertEquals(result.value, { answer: 42 });
      label = "Action received";
    }
    if (result.action === "page") {
      await presentPage(async () => {
        await callScreen({
          id: "another-page",
          title: "Another page",
          schema: z.object({}),
          model: new Model({}),
        });
      });
    }
  }
}

export async function verifyCustomElements(
  page: Browser,
  reconnect: () => Promise<void>,
): Promise<void> {
  await wait(
    page,
    "document.querySelector('.screen-title')?.textContent === 'Custom elements'",
  );
  assertEquals(
    await page.evaluate(
      "performance.getEntriesByType('resource').filter(entry => entry.name.includes('package-assets')).length",
    ),
    0,
  );
  assertEquals(await page.evaluate("window.__customImports"), undefined);
  await button(page, "Show component");
  await wait(
    page,
    "document.querySelector('.custom-test-button')?.textContent === 'Program component'",
  );
  assertEquals(
    await page.evaluate(
      "getComputedStyle(document.querySelector('.custom-test-button')).color",
    ),
    "rgb(17, 34, 51)",
  );
  await wait(
    page,
    "document.querySelector('[data-custom-element-id=widget]')?.dataset.push === 'ready-widget' && document.querySelector('[data-custom-element-id=other]')?.dataset.push === 'ready-other' && document.querySelector('[data-custom-element-id=widget]')?.dataset.programPush?.startsWith('ready-')",
  );
  await page.evaluate("window.__exerciseStreams()");
  await wait(page, "window.__streamsFinished === true");
  await wait(
    page,
    "window.__streamResults && Object.keys(window.__streamResults).length === 3",
  );
  assertEquals(await page.evaluate("window.__allCustomMounts"), 2);
  assertEquals([...filteredUpdates].sort(), [[
    "dashboard.updates.browser",
    "other",
  ], [
    "dashboard.updates.browser",
    "widget",
  ]]);
  for (const name of ["widget", "other"]) {
    assertEquals(
      await page.evaluate(`window.__filteredUpdates[${JSON.stringify(name)}]`),
      [
        ["dashboard.updates.row", name],
        ["dashboard.updates.ack", name],
      ],
    );
  }
  await page.evaluate(
    "window.__retainedSubscription = window.__inspectableSubscriptions.widget",
  );
  for (const name of ["widget", "other", "program"]) {
    assertEquals(streamResults.get(name), [
      255,
      0,
      7,
      8,
      9,
      ["widget", "other", "program"].indexOf(name),
    ]);
    assertEquals(
      await page.evaluate(`window.__streamResults[${JSON.stringify(name)}]`),
      [0, 255, 9, 8, 7, ["widget", "other", "program"].indexOf(name)],
    );
  }
  await button(page, "Read status");
  await wait(
    page,
    "document.querySelector('[data-custom-element-id=widget]')?.dataset.push === 'pending'",
  );
  await wait(
    page,
    "document.querySelector('.message-toast-body')?.textContent.includes('Notification during pending request') === true",
  );
  assertEquals(
    await page.evaluate(
      "document.documentElement.hasAttribute('data-interaction-pending')",
    ),
    false,
  );
  await wait(
    page,
    "document.querySelector('[data-custom-element-id=widget]')?.dataset.reply === 'backend component' && !document.documentElement.hasAttribute('data-interaction-pending')",
  );
  await button(page, "Program status");
  await wait(
    page,
    "document.querySelector('[data-custom-element-id=widget]')?.dataset.programReply === 'backend program'",
  );
  await page.evaluate(
    "window.__retainedCustom = document.querySelector('[data-custom-element-id=widget]'); window.__retainedButton = document.querySelector('.custom-test-button')",
  );
  await button(page, "Start delayed handler");
  await wait(
    page,
    "window.__heldChannelSignal && !window.__heldChannelSignal.aborted",
  );
  await button(page, "Update component");
  await wait(
    page,
    "document.querySelector('.custom-test-button')?.textContent === 'Updated component'",
  );
  assertEquals(
    await page.evaluate(
      "window.__retainedButton === document.querySelector('.custom-test-button') && window.__customMounts === 1 && window.__customImports === 1",
    ),
    true,
  );
  await verifyCancelledHandler(page);
  for (let round = 0; round < 4; round++) {
    await button(page, "Update component");
    await wait(
      page,
      "!document.documentElement.hasAttribute('data-interaction-pending')",
    );
    await page.evaluate(
      `window.__componentContexts.widget.channel.send('dashboard.updates.browser', 'probe-${round}')`,
    );
    await wait(
      page,
      `window.__filteredUpdates.widget.some(([, value]) => value === 'probe-${round}')`,
    );
    assertEquals(
      await page.evaluate(
        `window.__filteredUpdates.widget.filter(([, value]) => value === 'probe-${round}').length`,
      ),
      1,
    );
    assertEquals(
      await page.evaluate(
        "window.__retainedSubscription === window.__inspectableSubscriptions.widget",
      ),
      true,
    );
  }
  await button(page, "Start delayed handler");
  await wait(
    page,
    "window.__heldChannelSignal && !window.__heldChannelSignal.aborted",
  );
  await reconnect();
  assertEquals(
    await page.evaluate(
      "window.__retainedCustom === document.querySelector('[data-custom-element-id=widget]') && window.__customMounts === 1",
    ),
    true,
  );
  await verifyCancelledHandler(page);
  await page.evaluate(
    "delete document.querySelector('[data-custom-element-id=widget]').dataset.programReply",
  );
  await button(page, "Program status");
  await wait(
    page,
    "document.querySelector('[data-custom-element-id=widget]')?.dataset.programReply === 'backend program'",
  );
  await button(page, "Updated component");
  await wait(
    page,
    "document.querySelector('.custom-test-button')?.textContent === 'Action received'",
  );
  await button(page, "Open another page");
  await wait(
    page,
    "document.querySelector('.presentation-page-layer:not([hidden]) .screen-title')?.textContent === 'Another page'",
  );
  assertEquals(
    await page.evaluate(
      "window.__retainedCustom.isConnected && window.__retainedCustom.dataset.componentActive === 'false' && !window.__customDisposes",
    ),
    true,
  );
  await button(page, "Back");
  await wait(
    page,
    "window.__retainedCustom.dataset.componentActive === 'true'",
  );
  assertEquals(
    await page.evaluate(
      "window.__retainedButton === document.querySelector('.custom-test-button')",
    ),
    true,
  );
  await button(page, "Replace module");
  await wait(page, "window.__customMounts === 2");
  assertEquals(
    await page.evaluate(
      "window.__customDisposes === 1 && window.__customAborts === 1 && window.__customImports === 2 && !window.__retainedCustom.isConnected",
    ),
    true,
  );
  await button(page, "Remove component");
  await wait(
    page,
    "!document.querySelector('[data-custom-element-id=widget]')",
  );
  assertEquals(
    await page.evaluate(
      "window.__customDisposes === 2 && !document.querySelector('link[href*=\"widget.css\"]')",
    ),
    true,
  );
  await button(page, "Slow import");
  await wait(
    page,
    "document.querySelector('[data-custom-element-id=widget]')?.getAttribute('aria-busy') === 'true'",
  );
  await button(page, "Remove component");
  await wait(page, "window.__slowLoaded === true");
  assertEquals(
    await page.evaluate(
      "!window.__slowMounted && !document.querySelector('[data-custom-element-id=widget]')",
    ),
    true,
  );
  await button(page, "Slow mount");
  await wait(page, "window.__slowMountStarted === true");
  await button(page, "Remove component");
  await wait(page, "window.__lateDisposed === true");
  assertEquals(
    await page.evaluate(
      "!document.querySelector('[data-custom-element-id=widget]') && !document.querySelector('link[href*=\"widget.css\"]')",
    ),
    true,
  );
  await button(page, "Show component");
  await wait(
    page,
    "document.querySelector('.custom-test-button')?.textContent === 'Action received'",
  );
  assertEquals(await page.evaluate("window.__customImports"), 2);
  await page.evaluate("window.__startDisposableRead()");
  await wait(
    page,
    "document.querySelector('[data-custom-element-id=widget]')?.dataset.push === 'holding'",
  );
  await page.evaluate("window.__disposePendingRead()");
  await wait(page, "window.__disposedRead === 'AbortError'");
  await page.evaluate(
    "delete document.querySelector('[data-custom-element-id=widget]').dataset.programReply",
  );
  await button(page, "Program status");
  await wait(
    page,
    "document.querySelector('[data-custom-element-id=widget]')?.dataset.programReply === 'backend program'",
  );
  assertEquals(disposableReadSignal?.aborted, true);
  await page.evaluate(
    "window.__beforeResetContext = window.__componentContexts.widget; window.__beforeResetMounts = window.__customMounts; window.__startDisposableRead()",
  );
  await wait(
    page,
    "document.querySelector('[data-custom-element-id=widget]')?.dataset.push === 'holding'",
  );
  await button(page, "Reset screen");
  await wait(
    page,
    "window.__customMounts === window.__beforeResetMounts + 1 && window.__disposedRead === 'AbortError'",
  );
  await page.evaluate("window.__releaseUpload()");
  assertEquals(disposableReadSignal?.aborted, true);
  assertEquals(
    await page.evaluate(`(() => {
    const old = window.__beforeResetContext;
    let unavailable;
    try { old.channel.subscribe('*', () => {}); unavailable = 'registered'; }
    catch (error) { unavailable = error.name; }
    return [old.signal.aborted, old.host.isConnected, unavailable,
      window.__componentContexts.widget.signal.aborted];
  })()`),
    [true, false, "AbortError", false],
  );
  await button(page, "Transient component");
  await wait(
    page,
    "!document.documentElement.hasAttribute('data-interaction-pending')",
  );
  await page.evaluate(
    "window.__beforeRedrawContext = window.__componentContexts.widget; window.__startDisposableRead(true)",
  );
  await wait(
    page,
    "window.__programHolding === true",
  );
  await page.evaluate(
    "window.__componentContexts.widget.programChannel.send('redraw', null)",
  );
  await wait(
    page,
    "window.__disposedRead === 'AbortError' && window.__componentContexts.widget !== window.__beforeRedrawContext",
  );
  await page.evaluate("window.__releaseUpload()");
  assertEquals(disposableReadSignal?.aborted, true);
  assertEquals(
    await page.evaluate(
      "[window.__beforeRedrawContext.signal.aborted, window.__beforeRedrawContext.host.isConnected]",
    ),
    [true, false],
  );
}

async function verifyCancelledHandler(page: Browser): Promise<void> {
  assertEquals(await page.evaluate("window.__heldChannelSignal.aborted"), true);
  await page.evaluate("window.__releaseHeldChannel()");
  await wait(page, "window.__heldChannelFinished === true");
  await new Promise((resolve) => setTimeout(resolve, 100));
  assertEquals(lateNotices, []);
  assertEquals(
    await page.evaluate("window.__staleChannelHandle"),
    "AbortError",
  );
  assertEquals(await page.evaluate("window.__staleChannelRequests"), [
    "AbortError",
    "AbortError",
  ]);
  assertEquals(await page.evaluate("window.__staleStream"), "AbortError");
}

async function button(page: Browser, label: string): Promise<void> {
  await wait(
    page,
    `(() => {
    const button = [...document.querySelectorAll('button')].find(item => !item.closest('[hidden],[inert]') && !item.disabled && (item.textContent.trim() === ${
      JSON.stringify(label)
    } || item.getAttribute('aria-label') === ${JSON.stringify(label)}));
    if (!button) return false;
    button.click(); return true;
  })()`,
  );
}

async function wait(page: Browser, expression: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await page.evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Custom element browser check timed out: ${expression}`);
}
