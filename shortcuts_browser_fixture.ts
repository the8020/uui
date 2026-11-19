import { assert, assertEquals } from "@std/assert";
import { kernelInvokeSymbol, type ProgramSummary } from "@the8020/kernel";
import { brandingDatabase } from "./branding_test_support.ts";
import { runHome } from "./programs/home/program.ts";
import { fetchUserPreferences, fetchUserShortcuts } from "./preferences.ts";
import { callScreen, Model, z } from "./mod.ts";

interface Browser {
  evaluate<T>(expression: string): Promise<T>;
  command<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T>;
}

export async function target(title: string) {
  await callScreen({
    id: title,
    title,
    schema: z.object({}),
    model: new Model({}),
  });
}

export default async function fixture(root: string) {
  const db = await brandingDatabase();
  const globals = globalThis as unknown as Record<symbol, unknown>;
  const invoke = globals[kernelInvokeSymbol] as (
    operation: string,
    input: Record<string, unknown>,
  ) => Promise<unknown>;
  const records: ProgramSummary[] = [];
  for (const [name, code] of [["first", "ONE"], ["second", "TWO"]]) {
    const directory = `${root}/packages/example/tools/programs/${name}`;
    await Deno.mkdir(directory, { recursive: true });
    await Deno.writeTextFile(
      `${directory}/program.toml`,
      `schema = 1\nuui = true\ndescription = "${name} program"\nshortcut = "${code}"\n`,
    );
    await Deno.writeTextFile(
      `${directory}/program.ts`,
      `import { target } from ${
        JSON.stringify(import.meta.url)
      }; export default () => target(${JSON.stringify(name)});`,
    );
    records.push({
      program_id: `example/tools/${name}`,
      package_id: "example/tools",
      name: name!,
      commit: "test",
      entrypoint: "program.ts",
      entrypoint_url: `file://${directory}/program.ts`,
    });
  }
  globals[kernelInvokeSymbol] = (
    operation: string,
    input: Record<string, unknown>,
  ) =>
    input.operation === "program.list"
      ? Promise.resolve({ success: true, result: records })
      : invoke(operation, input);
  const assets = `${root}/packages/the8020/uui/public`;
  await Deno.mkdir(assets, { recursive: true });
  for (const file of ["home-navigator.js", "home-navigator.css"]) {
    await Deno.copyFile(
      new URL(`./public/${file}`, import.meta.url),
      `${assets}/${file}`,
    );
  }
  return {
    run: () => runHome(`${root}/packages`),
    async serve(request: Request) {
      if (new URL(request.url).pathname === "/preferences") {
        return Response.json(await fetchUserPreferences());
      }
    },
    close() {
      db.close();
      return Promise.resolve();
    },
    async verify(page: Browser) {
      const wait = async (expression: string) => {
        const deadline = Date.now() + 15000;
        while (!await page.evaluate(expression)) {
          if (Date.now() > deadline) {
            throw new Error(`Timed out: ${expression}`);
          }
          await new Promise((resolve) => setTimeout(resolve, 30));
        }
      };
      const ready = () =>
        wait(
          "!document.querySelector('[data-interaction-pending]') && !document.querySelector('#screen-back').disabled",
        );
      const click = async (selector: string) => {
        await ready();
        await wait(`!!document.querySelector(${JSON.stringify(selector)})`);
        await page.evaluate(
          "new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))",
        );
        await ready();
        const point = await page.evaluate<{ x: number; y: number }>(
          `(() => { const e = document.querySelector(${
            JSON.stringify(selector)
          }); e.scrollIntoView({block:'nearest'}); const r = e.getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+r.height/2}; })()`,
        );
        for (const type of ["mousePressed", "mouseReleased"]) {
          await page.command("Input.dispatchMouseEvent", {
            type,
            ...point,
            button: "left",
            clickCount: 1,
          });
        }
      };
      const set = async (selector: string, value: string) => {
        await ready();
        await page.evaluate(
          `(() => { const e = document.querySelector(${
            JSON.stringify(selector)
          }); e.focus(); e.value = ${
            JSON.stringify(value)
          }; e.dispatchEvent(new Event('input', { bubbles: true })); })()`,
        );
      };
      const key = async (key: string, code: number) => {
        await page.command("Input.dispatchKeyEvent", {
          type: "keyDown",
          key,
          windowsVirtualKeyCode: code,
        });
        await page.command("Input.dispatchKeyEvent", {
          type: "keyUp",
          key,
          windowsVirtualKeyCode: code,
        });
      };
      const home = () =>
        wait(
          "!!document.querySelector('.home-navigator') && !document.querySelector('#screen-back').disabled",
        );
      const modal = "dialog.presentation-modal[open]";
      const menu = async () => {
        await ready();
        await page.evaluate(
          "document.querySelector('#session-menu').open = true",
        );
        await click("#session-customization");
        await wait(
          `!!document.querySelector('${modal} [data-list-id=shortcut-list]')`,
        );
      };
      const close = () => click(`${modal} .uui-dialog-close`);
      await page.command("Emulation.setDeviceMetricsOverride", {
        width: 1280,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await home();
      await wait(
        "document.querySelector('[data-tile-id=\"example/tools/first\"] .home-tile-shortcut')?.textContent.includes('ONE')",
      );
      assert(
        await page.evaluate(
          "(() => { const label=document.querySelector('.home-shortcut > label').getBoundingClientRect(), icon=document.querySelector('.home-shortcut .material-icon').getBoundingClientRect(); return label.top<=icon.top && label.bottom>=icon.bottom; })()",
        ),
      );
      assert(
        await page.evaluate(
          "(() => { const title=document.querySelector('.screen-title').getBoundingClientRect(), input=document.querySelector('.home-shortcut').getBoundingClientRect(); return input.left > title.left && Math.abs(input.top-title.top)<50 && input.bottom < document.querySelector('.home-navigator').getBoundingClientRect().top; })()",
        ),
      );
      await set(".home-shortcut input", "one");
      await key("Enter", 13);
      await wait(
        "document.querySelector('.screen-title')?.textContent === 'first'",
      );
      await click("#screen-back");
      await home();
      await page.evaluate(
        "document.querySelector('.home-shortcut input').focus()",
      );
      await key("F4", 115);
      await wait(
        `!!document.querySelector('${modal} [data-list-id=choices] tbody tr')`,
      );
      await click(`${modal} [data-element-id=help-action-0]`);
      await wait(
        "document.querySelectorAll('dialog.presentation-modal[open]').length === 2",
      );
      const top = "dialog.presentation-modal[open]:last-of-type";
      await click(`${top} [data-element-id=add-shortcut]`);
      await wait(
        "document.querySelectorAll('dialog.presentation-modal[open]').length === 3",
      );
      await set(`${top} [data-bind=shortcut]`, "one");
      await page.evaluate(
        `document.querySelector('${top} [data-bind=program]').focus()`,
      );
      await key("F4", 115);
      await wait(
        "document.querySelectorAll('dialog.presentation-modal[open]').length === 4",
      );
      await set(`${top} input.data-list-search`, "second");
      await key("Enter", 13);
      await wait(
        `document.querySelector('${top} [data-list-id=choices] tbody')?.textContent.includes('second')`,
      );
      await click(`${top} [data-list-id=choices] tbody tr`);
      await wait(
        "document.querySelectorAll('dialog.presentation-modal[open]').length === 3",
      );
      assertEquals(
        await page.evaluate(
          `document.querySelector('${top} [data-bind=program]').value`,
        ),
        "example/tools/second",
      );
      await click(`${top} [data-element-id=done]`);
      await wait(
        "document.querySelectorAll('dialog.presentation-modal[open]').length === 2",
      );
      await set(`${top} [data-bind=accentColor]`, "#16803e");
      await click(`${top} [data-element-id=save]`);
      await wait(
        "document.querySelectorAll('dialog.presentation-modal[open]').length === 1",
      );
      assertEquals(await fetchUserShortcuts(), [{
        shortcut: "ONE",
        program: "example/tools/second",
      }]);
      assertEquals((await fetchUserPreferences()).accentColor, "#16803e");
      await set(`${top} input.data-list-search`, "ONE");
      await key("Enter", 13);
      await wait(
        `document.querySelector('${top} [data-list-id=choices] tbody')?.textContent.includes('second')`,
      );
      await click(`${top} [data-list-id=choices] tbody tr`);
      await wait(
        "document.querySelectorAll('dialog.presentation-modal[open]').length === 0",
      );
      assertEquals(
        await page.evaluate(
          "document.querySelector('.home-shortcut input').value",
        ),
        "ONE",
      );
      await wait(
        "document.querySelector('[data-tile-id=\"example/tools/second\"] .home-tile-shortcut')?.textContent.includes('ONE') && !document.querySelector('[data-tile-id=\"example/tools/first\"] .home-tile-shortcut')?.textContent.includes('ONE')",
      );
      await key("Enter", 13);
      // Focus returns to the shortcut field after its help closes.
      await wait(
        "document.querySelector('.screen-title')?.textContent === 'second'",
      );
      await click("#screen-back");
      await home();
      await menu();
      await click(`${modal} [data-element-id=use-default]`);
      await click(`${modal} [data-element-id=save]`);
      await wait(
        "document.querySelectorAll('dialog.presentation-modal[open]').length === 0",
      );
      assertEquals((await fetchUserShortcuts()).length, 1);
      await menu();
      await click(`${modal} [data-element-id=add-shortcut]`);
      await wait(
        "document.querySelectorAll('dialog.presentation-modal[open]').length === 2",
      );
      await set(`${top} [data-bind=shortcut]`, "ONE");
      await set(`${top} [data-bind=program]`, "example/tools/first");
      await click(`${top} [data-element-id=done]`);
      await ready();
      assertEquals(
        await page.evaluate(
          "document.querySelectorAll('dialog.presentation-modal[open]').length",
        ),
        2,
      );
      await click(`${top} .uui-dialog-close`);
      await wait(
        "document.querySelectorAll('dialog.presentation-modal[open]').length === 1",
      );
      await click(
        `${modal} [data-list-id=shortcut-list] tbody .data-list-selection input`,
      );
      await click(`${modal} [data-element-id=delete-shortcuts]`);
      await close();
      await home();
      assertEquals((await fetchUserShortcuts()).length, 1);
      for (const theme of ["light", "dark"]) {
        if (
          await page.evaluate("document.documentElement.dataset.theme") !==
            theme
        ) {
          await click("#session-menu summary");
          await click("#theme-toggle");
          await page.evaluate(
            "document.querySelector('#session-menu').open = false",
          );
        }
        for (const width of [1280, 390]) {
          await page.command("Emulation.setDeviceMetricsOverride", {
            width,
            height: 900,
            deviceScaleFactor: 1,
            mobile: width === 390,
          });
          assert(
            await page.evaluate(
              "document.documentElement.scrollWidth<=innerWidth",
            ),
          );
          await ready();
          await page.evaluate(
            "new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))",
          );
          const shot = await page.command<{ data: string }>(
            "Page.captureScreenshot",
            { format: "png" },
          );
          await Deno.writeFile(
            `/tmp/8020-shortcuts-${theme}-${width}.png`,
            Uint8Array.from(atob(shot.data), (c) => c.charCodeAt(0)),
          );
        }
      }
      await menu();
      await click(
        `${modal} [data-list-id=shortcut-list] tbody .data-list-selection input`,
      );
      await click(`${modal} [data-element-id=delete-shortcuts]`);
      await click(`${modal} [data-element-id=save]`);
      await wait(
        "document.querySelectorAll('dialog.presentation-modal[open]').length === 0",
      );
      assertEquals(await fetchUserShortcuts(), []);
    },
  };
}
