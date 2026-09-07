import { assertEquals } from "@std/assert";
import { callScreen, Model, packageAssetURL, presentPage, z } from "./mod.ts";

interface Browser {
  evaluate<T>(expression: string): Promise<T>;
}

const asset = (name: string) => packageAssetURL("example/widget", name);

export async function prepareCustomElementAssets(root: string): Promise<void> {
  const directory = `${root}/packages/example/widget/public`;
  await Deno.mkdir(directory, { recursive: true });
  const module = `
    window.__customImports = (window.__customImports || 0) + 1;
    export default function mount({ host, config, signal, send }) {
      window.__customMounts = (window.__customMounts || 0) + 1;
      const button = document.createElement('button');
      button.className = 'custom-test-button';
      const update = value => { button.textContent = value.label; };
      update(config);
      button.onclick = () => send('component-action', { answer: 42 });
      host.append(button);
      signal.addEventListener('abort', () => window.__customAborts = (window.__customAborts || 0) + 1, { once: true });
      return {
        update,
        setActive(active) { host.dataset.componentActive = String(active); },
        dispose() { window.__customDisposes = (window.__customDisposes || 0) + 1; }
      };
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

export async function runCustomElementsProgram(): Promise<void> {
  let module: string | undefined;
  let label = "Program component";
  const model = new Model({ status: "Ready" });
  while (true) {
    const result = await callScreen({
      id: "custom-elements-test",
      title: "Custom elements",
      schema: z.object({ status: z.string() }),
      model,
      customElements: module
        ? [{
          id: "widget",
          module: asset(module),
          styles: [asset("widget.css")],
          config: { label },
          preserve: true,
        }]
        : [],
      ...(module
        ? {
          layout: {
            schema: 1,
            id: "custom-layout",
            root: { type: "custom", customElement: "widget" },
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
        ],
      },
    });
    if (result.action === "show") module = "widget.js";
    if (result.action === "hide") module = undefined;
    if (result.action === "update") label = "Updated component";
    if (result.action === "replace") module = "replacement.js";
    if (result.action === "slow") module = "slow.js";
    if (result.action === "slow-mount") module = "slow-mount.js";
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

export async function verifyCustomElements(page: Browser): Promise<void> {
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
  await page.evaluate(
    "window.__retainedCustom = document.querySelector('[data-custom-element-id=widget]'); window.__retainedButton = document.querySelector('.custom-test-button')",
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
