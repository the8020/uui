import { assertEquals } from "@std/assert";
import { brandingDatabase } from "./branding_test_support.ts";
import { callScreen, Model, z } from "./mod.ts";
import demo from "./programs/list-layouts-demo/program.ts";

interface Browser {
  evaluate<T>(expression: string): Promise<T>;
  command(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

export default async function fixture() {
  const database = await brandingDatabase();
  return {
    close() {
      database.close();
      return Promise.resolve();
    },
    serve() {
      return Promise.resolve(undefined);
    },
    async run() {
      while (true) {
        await demo();
        await callScreen({
          id: "returned",
          title: "Returned",
          schema: z.object({}),
          model: new Model({}),
          actions: [{ id: "open", label: "Open" }],
        });
      }
    },
    async verify(page: Browser) {
      const wait = async (expression: string) => {
        const until = Date.now() + 12_000;
        while (!await page.evaluate(expression)) {
          if (Date.now() > until) throw new Error(`Timed out: ${expression}`);
          await new Promise((resolve) => setTimeout(resolve, 30));
        }
      };
      const ready = () =>
        wait(
          `!!document.querySelector('[data-list-id="order-list"]') && !document.querySelector('#screen-back').disabled`,
        );
      const list = `document.querySelector('[data-list-id="order-list"]')`;
      const dialog =
        `document.querySelector('dialog[aria-label="List layouts"]')`;
      const click = async (expression: string) => {
        await wait(
          `!!(${expression}) && !(${expression}).disabled && !document.querySelector('#screen-back').disabled`,
        );
        await page.evaluate(
          `new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`,
        );
        await wait(
          `!(${expression}).closest('[inert]') && !document.querySelector('#screen-back').disabled`,
        );
        const point = await page.evaluate<{ x: number; y: number }>(
          `(() => { const target=${expression}; target.scrollIntoView({block:'nearest'}); const r=target.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`,
        );
        await page.command("Input.dispatchMouseEvent", {
          type: "mousePressed",
          button: "left",
          clickCount: 1,
          ...point,
        });
        await page.command("Input.dispatchMouseEvent", {
          type: "mouseReleased",
          button: "left",
          clickCount: 1,
          ...point,
        });
        await wait(`!document.querySelector('#screen-back').disabled`);
      };
      const button = (text: string) =>
        `Array.from(${dialog}.querySelectorAll('button')).find(b=>b.textContent===${
          JSON.stringify(text)
        })`;
      const set = async (selector: string, value: string, event = "input") => {
        await page.evaluate(
          `(() => { const input=${dialog}.querySelector(${
            JSON.stringify(selector)
          }); input.value=${
            JSON.stringify(value)
          }; input.dispatchEvent(new Event(${
            JSON.stringify(event)
          },{bubbles:true})); })()`,
        );
      };
      const open = async () => {
        await click(`${list}.querySelector('[aria-label="List layouts"]')`);
        await wait(
          `${dialog}?.querySelector('[aria-label="Saved layouts"]')?.options.length >= 1 && !${dialog}.querySelector('div.uui-dialog-body > div').inert`,
        );
      };
      await ready();
      assertEquals(
        await page.evaluate(
          `${list}.querySelector('.data-list-toolbar').hidden`,
        ),
        true,
      );
      await click(`${list}.querySelector('thead th:nth-child(4) button')`);
      await wait(
        `${list}.querySelector('.data-list-popover')?.matches(':popover-open')`,
      );
      await click(
        `Array.from(${list}.querySelectorAll('.data-list-popover button')).find(b=>b.textContent==='Hide column')`,
      );
      await wait(`${list}.querySelectorAll('thead th').length===5`);
      await click(`${list}.querySelector('.data-list-tools-toggle')`);
      await open();
      await click(`${dialog}.querySelector('[aria-label="Visible: Region"]')`);
      await click(`${dialog}.querySelector('[aria-label="Move up: Amount"]')`);
      await set('[aria-label="Filter Amount"]', ">3000");
      await page.evaluate(
        `(() => { const input=${dialog}.querySelector('[aria-label="Sort"]'); input.value=Array.from(input.options).find(o=>o.textContent==='Amount · Sort descending').value; input.dispatchEvent(new Event('change',{bubbles:true})); })()`,
      );
      await set('[aria-label="Name"]', "Mine");
      await click(button("Save"));
      await wait(
        `${dialog}.querySelector('[aria-label="Saved layouts"]').options.length===2`,
      );
      await click(button("Set as default"));
      await wait(
        `Array.from(${dialog}.querySelector('[aria-label="Saved layouts"]').options).some(o=>o.textContent.includes('Mine · Personal · Default'))`,
      );
      await click(button("Apply"));
      await wait(
        `!${dialog} && ${list}.querySelector('thead th:nth-child(3)')?.textContent.includes('Amount')`,
      );
      const headings = await page.evaluate<string[]>(
        `Array.from(${list}.querySelectorAll('thead th')).map(th=>th.getAttribute('aria-sort'))`,
      );
      assertEquals(headings.includes("descending"), true);
      await wait(
        `${list}.querySelector('tbody tr')?.textContent.includes('7500')`,
      );
      assertEquals(
        await page.evaluate(
          `document.querySelector('[data-list-id="delivery-list"]').querySelectorAll('thead th').length`,
        ),
        6,
      );
      await click(`document.querySelector('[data-element-id="refresh"]')`);
      await wait(
        `${list}.querySelector('tbody tr')?.textContent.includes('7500')`,
      );
      await page.command("Page.reload");
      await ready();
      await wait(
        `${list}.querySelector('tbody tr')?.textContent.includes('7500')`,
      );
      await click(`document.querySelector('#screen-back')`);
      await wait(
        `document.querySelector('.screen-title')?.textContent==='Returned'`,
      );
      await click(`document.querySelector('[data-element-id="open"]')`);
      await ready();
      await wait(
        `${list}.querySelector('tbody tr')?.textContent.includes('7500')`,
      );
      assertEquals(
        await page.evaluate(
          `${list}.querySelector('.data-list-toolbar').hidden`,
        ),
        true,
      );
      await click(`${list}.querySelector('.data-list-tools-toggle')`);
      await open();
      await click(button("Built-in layout"));
      await click(button("Apply"));
      await wait(`${list}.querySelectorAll('thead th').length===6`);
      await open();
      await page.evaluate(
        `(() => { const select=${dialog}.querySelector('[aria-label="Saved layouts"]'); select.value=JSON.stringify(['personal','Mine']); select.dispatchEvent(new Event('change',{bubbles:true})); })()`,
      );
      await click(button("Apply"));
      await wait(
        `${list}.querySelector('tbody tr')?.textContent.includes('7500')`,
      );
      await click(`${list}.querySelector('thead th:nth-child(2) button')`);
      await click(
        `Array.from(${list}.querySelectorAll('.data-list-popover button')).find(b=>b.textContent==='Show all columns')`,
      );
      await wait(`${list}.querySelectorAll('thead th').length===6`);
      await open();
      await click(button("Clear personal default"));
      await wait(
        `!Array.from(${dialog}.querySelector('[aria-label="Saved layouts"]').options).some(o=>o.textContent.includes('Default'))`,
      );
      await page.command("Emulation.setDeviceMetricsOverride", {
        width: 390,
        height: 844,
        deviceScaleFactor: 1,
        mobile: true,
      });
      await wait(
        `${dialog}.getBoundingClientRect().width<=390 && ${dialog}.scrollWidth<=${dialog}.clientWidth+1`,
      );
      await click(`${dialog}.querySelector('[aria-label="Close"]')`);
      console.log(
        "List layouts browser passed: actual column menu, hidden-column restoration, ordering, typed filter/sort, private save/load/default/clear, new Model, refresh, reload, list isolation and mobile dialog.",
      );
    },
  };
}
