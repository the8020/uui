import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  defaultConfiguration,
  Localization,
  withLocalization,
} from "/p/the8020/i18n/mod.ts";
import { callScreen, Model, presentModal, z } from "./mod.ts";
import { withProgram } from "./programs.ts";
import { statusTestContext } from "./status_test_support.ts";
import { setInterfaceUserCheck } from "./technical_guard.ts";

interface Browser {
  evaluate<T>(expression: string): Promise<T>;
  command(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

export default async function fixture(root: string) {
  const context = await statusTestContext();
  setInterfaceUserCheck(() => Promise.resolve(true));
  const assets = `${root}/packages/the8020/uui/public`;
  await Deno.mkdir(assets, { recursive: true });
  for (const file of ["status-brand.js", "status-brand.css"]) {
    await Deno.copyFile(
      new URL(`./public/${file}`, import.meta.url),
      `${assets}/${file}`,
    );
  }
  const localization = new Localization(
    "en",
    defaultConfiguration,
    async (id) => ({
      package: id,
      language: "en",
      texts: JSON.parse(
        await Deno.readTextFile(
          new URL(
            `../${id.split("/")[1]}/i18n/locales/en.json`,
            import.meta.url,
          ),
        ),
      ).texts,
    }),
  );
  const model = new Model({ value: "original" });
  const schema = z.object({ value: z.string().min(3) });
  async function run() {
    while (true) {
      const event = await callScreen({
        id: "status",
        title: "Status fixture",
        model,
        schema,
        actions: [{ id: "submit", label: "Submit" }, {
          id: "modal",
          label: "Modal",
        }],
      });
      if (event.action === "modal") {
        await withProgram(
          "example/tools/child",
          () =>
            presentModal(() =>
              callScreen({
                id: "child",
                title: "Child modal",
                model: new Model({}),
                schema: z.object({}),
              })
            ),
        );
      }
    }
  }
  return {
    run: () =>
      withLocalization(
        localization,
        () => withProgram("example/tools/fixture", run),
      ),
    serve: () => Promise.resolve(undefined),
    close() {
      context.close();
      return Promise.resolve();
    },
    async verify(page: Browser) {
      const wait = async (expression: string) => {
        const end = Date.now() + 8000;
        while (!await page.evaluate(expression)) {
          if (Date.now() > end) throw new Error(`Timed out: ${expression}`);
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      };
      const click = async (selector: string) => {
        const position = await page.evaluate<{ x: number; y: number }>(`(() => {
          const node = document.querySelector(${JSON.stringify(selector)});
          node.scrollIntoView({block:'nearest'});
          const r = node.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};
        })()`);
        for (const type of ["mousePressed", "mouseReleased"]) {
          await page.command("Input.dispatchMouseEvent", {
            type,
            ...position,
            button: "left",
            clickCount: 1,
          });
        }
      };
      const ready = () =>
        wait("!document.querySelector('#screen-back').disabled");
      const open = async (fromLogo = false) => {
        await ready();
        if (fromLogo) await click("#brand-status");
        else {
          await click("#session-menu-toggle");
          await click("#session-status");
        }
        await wait(
          "document.querySelector('dialog[open] [data-bind=programId]') && !document.querySelector('#screen-back').disabled",
        );
        await wait(
          "document.querySelector('dialog[open] [aria-label=\"80|20\"]')",
        );
      };
      const value = (name: string) =>
        page.evaluate<string>(
          `document.querySelector('dialog[open] [data-bind=${name}]').value`,
        );
      await ready();
      assertEquals(
        await page.evaluate(
          "document.querySelector('#session-status').nextElementSibling.id",
        ),
        "session-logout",
      );
      await page.evaluate(
        "Object.defineProperty(navigator.clipboard, 'writeText', {value: async text => { window.copiedDiagnostics = text; }});",
      );
      await page.evaluate(
        "(() => { const input = document.querySelector('[data-bind=value]'); input.value = 'x'; input.dispatchEvent(new Event('input',{bubbles:true})); })()",
      );
      await open();
      assertEquals(model.data.value, "original");
      assertEquals(await value("username"), "alice");
      assertEquals(await value("fullName"), "Alice Example");
      assertEquals(await value("programId"), "example/tools/fixture");
      assertEquals(await value("screenId"), "status");
      assertEquals(
        await page.evaluate("document.querySelector('#brand-status').disabled"),
        true,
      );
      assertEquals(
        await page.evaluate(
          "document.querySelector('#session-status').disabled",
        ),
        true,
      );
      assertEquals(
        await page.evaluate("document.querySelector('dialog[open] a').href"),
        "https://github.com/the8020",
      );
      assertEquals(
        await page.evaluate(
          "document.querySelector('dialog[open] [data-bind=workerId]')",
        ),
        null,
      );
      await click("dialog[open] [data-element-id=technical]");
      await wait(
        "document.querySelector('dialog[open] [data-bind=workerId]') && !document.querySelector('#screen-back').disabled",
      );
      assertEquals(await value("workerId"), "wrk-status0001");
      await click("dialog[open] [data-element-id=copy]");
      await wait("window.copiedDiagnostics");
      const copied = await page.evaluate<string>("window.copiedDiagnostics");
      assertStringIncludes(copied, "example/tools/fixture");
      assertStringIncludes(copied, "wrk-status0001");
      assertEquals(copied.includes("/private/"), false);
      await ready();
      await click("dialog[open] [data-element-id=close]");
      await wait(
        "!document.querySelector('dialog[open]') && !document.querySelector('#screen-back').disabled",
      );
      assertEquals(
        await page.evaluate(
          "document.querySelector('[data-bind=value]').value",
        ),
        "x",
      );
      await click("[data-element-id=submit]");
      await ready();
      assertEquals(model.data.value, "original");
      assertEquals(
        await page.evaluate(
          "document.querySelector('[data-bind=value]').value",
        ),
        "x",
      );
      await page.evaluate(
        "(() => { const input = document.querySelector('[data-bind=value]'); input.value = 'saved'; input.dispatchEvent(new Event('input',{bubbles:true})); })()",
      );
      await click("[data-element-id=submit]");
      await ready();
      assertEquals(model.data.value, "saved");
      await open(true);
      assertEquals(await value("programId"), "example/tools/fixture");
      await click("dialog[open] [data-element-id=close]");
      await wait(
        "!document.querySelector('dialog[open]') && !document.querySelector('#screen-back').disabled",
      );
      await click("[data-element-id=modal]");
      await wait(
        "document.querySelector('dialog[open]') && !document.querySelector('#screen-back').disabled",
      );
      await open(true);
      assertEquals(
        await page.evaluate("document.querySelectorAll('dialog[open]').length"),
        2,
      );
      assertEquals(await value("programId"), "example/tools/child");
      assertEquals(await value("screenId"), "child");
      for (const width of [1280, 390]) {
        await page.command("Emulation.setDeviceMetricsOverride", {
          width,
          height: 900,
          deviceScaleFactor: 1,
          mobile: width < 500,
        });
        await wait("document.documentElement.scrollWidth <= innerWidth");
        await wait(
          "getComputedStyle(document.querySelector('.uui-status > .screen-title')).display === 'none'",
        );
        assertEquals(
          await page.evaluate(`(() => {
          const dialog = document.querySelector('.uui-status').closest('dialog');
          return document.getElementById(dialog.getAttribute('aria-labelledby')).textContent;
        })()`),
          "Status",
        );
        if (width === 1280) {
          assertEquals(
            await page.evaluate(`(() => {
            const root = document.querySelector('.uui-status');
            const field = name => root.querySelector('[data-bind='+name+']').getBoundingClientRect();
            const name = field('systemName'), id = field('systemId'), environment = field('systemRole');
            const subtitle = root.querySelector('[data-custom-element-id=brand] p');
            return Math.abs(name.y - id.y) < 2 && environment.y > name.bottom &&
              subtitle.contains(root.querySelector('a')) && subtitle.getBoundingClientRect().height < 30;
          })()`),
            true,
          );
        }
        assertEquals(
          await page.evaluate(`(() => {
          const logo = document.querySelector('.uui-status .brand-pipe');
          const navbar = document.querySelector('#brand-status .brand-pipe');
          const ratio = node => parseFloat(getComputedStyle(node, '::before').height) / parseFloat(getComputedStyle(node).fontSize);
          return Math.abs(ratio(logo) - ratio(navbar)) < 0.01;
        })()`),
          true,
        );
        assertEquals(
          await page.evaluate(
            `Array.from(document.querySelectorAll('.uui-status label')).map(label => label.textContent).filter(label => label.startsWith('Program'))`,
          ),
          ["Program name", "Program ID"],
        );
        assertEquals(
          await page.evaluate(`(() => {
          const brand = document.querySelector('dialog[open] [aria-label="80|20"]').getBoundingClientRect();
          const dialog = document.querySelectorAll('dialog[open]')[1].getBoundingClientRect();
          return brand.width > 0 && Math.abs(brand.x + brand.width/2 - dialog.x - dialog.width/2) < 10;
        })()`),
          true,
        );
        const screenshot = await page.command("Page.captureScreenshot", {
          format: "png",
        }) as { data: string };
        await Deno.writeFile(
          `/tmp/8020-status-${width}.png`,
          Uint8Array.fromBase64(screenshot.data),
        );
      }
      await click("#session-menu-toggle");
      await click("#theme-toggle");
      await wait("document.documentElement.dataset.theme === 'dark'");
      const dark = await page.command("Page.captureScreenshot", {
        format: "png",
      }) as { data: string };
      await Deno.writeFile(
        "/tmp/8020-status-dark.png",
        Uint8Array.fromBase64(dark.data),
      );
      await page.command("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Escape",
        code: "Escape",
        windowsVirtualKeyCode: 27,
      });
      await page.command("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "Escape",
        code: "Escape",
        windowsVirtualKeyCode: 27,
      });
      await wait(
        "document.querySelectorAll('dialog[open]').length === 1 && !document.querySelector('#screen-back').disabled",
      );
      await click("#screen-back");
      await wait(
        "!document.querySelector('dialog[open]') && !document.querySelector('#screen-back').disabled",
      );
    },
  };
}
