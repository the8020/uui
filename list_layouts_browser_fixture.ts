import { assert, assertEquals } from "@std/assert";
import { brandingDatabase } from "./branding_test_support.ts";
import { callScreen, field, Model, z } from "./mod.ts";
import demo from "./programs/list-layouts-demo/program.ts";

interface Browser {
  evaluate<T>(expression: string): Promise<T>;
  command(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

/** Also used against the installed package/auth/database preview. */
export async function verifyLayouts(page: Browser) {
  const wait = async (expression: string) => {
    const until = Date.now() + 20_000;
    while (!await page.evaluate(expression)) {
      if (Date.now() > until) throw new Error(`Timed out: ${expression}`);
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  };
  const list = `document.querySelector('[data-list-id="order-list"]')`;
  const dialog = `document.querySelector('dialog[aria-label="List layouts"]')`;
  const ready = () =>
    wait(`!!${list} && !document.querySelector('#screen-back').disabled`);
  const button = (id: string) =>
    `${dialog}.querySelector('[data-element-id="${id}"]')`;
  const field = (label: string) =>
    `Array.from(${dialog}.querySelectorAll('.field')).find(f=>f.querySelector('label')?.textContent===${
      JSON.stringify(label)
    })?.querySelector('input, select')`;
  const row = (name: string) =>
    `Array.from(${dialog}.querySelectorAll('tbody tr')).find(row=>row.dataset.layoutName===${
      JSON.stringify(name)
    })`;
  const click = async (expression: string) => {
    await wait(
      `!!(${expression})&&!(${expression}).disabled&&!(${expression}).closest('[inert]')&&!document.querySelector('#screen-back').disabled`,
    );
    await page.evaluate(
      "new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))",
    );
    if (
      await page.evaluate(
        `!(${expression}).matches('summary') && !!(${expression}).closest('details') && !(${expression}).closest('details').open`,
      )
    ) {
      await click(
        `(${expression}).closest('details').querySelector('summary')`,
      );
    }
    await page.evaluate(
      "new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))",
    );
    const point = await page.evaluate<{ x: number; y: number }>(
      `(()=>{const e=${expression};e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`,
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
  };
  const set = async (label: string, value: string) => {
    await page.evaluate(
      `(()=>{const e=${field(label)};e.value=${
        JSON.stringify(value)
      };e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
  };
  const open = async () => {
    if (
      await page.evaluate(`${list}.querySelector('.data-list-toolbar').hidden`)
    ) await click(`${list}.querySelector('.data-list-tools-toggle')`);
    await click(`${list}.querySelector('[aria-label="List layouts"]')`);
    await wait(
      `!!${dialog}?.querySelector('table[aria-label="Saved layouts"]')&&!${dialog}.querySelector('.uui-dialog-body').inert`,
    );
    assertEquals(
      await page.evaluate(`${dialog}.querySelector('input')===null`),
      true,
    );
  };
  await ready();
  await open();
  await click(button("new"));
  await set("Name", "Discarded");
  await click(button("back"));
  assertEquals(await page.evaluate(`!!${row("Discarded")}`), false);
  await click(button("new"));
  await set("Name", "Cancelled");
  await click(button("cancel"));
  assertEquals(await page.evaluate(`!!${row("Cancelled")}`), false);
  await click(button("new"));
  // Shared controls in compact rows; sort only at its column.
  assertEquals(
    await page.evaluate(
      `${dialog}.querySelector('select[aria-label="Sort"]')===null`,
    ),
    true,
  );
  const fields = `${dialog}.querySelector('.layout-fields-table')`;
  const keys = () =>
    page.evaluate<string[]>(
      `Array.from(${fields}.tBodies[0].rows,r=>r.dataset.columnKey)`,
    );
  const initial = await keys();
  const bindings = await page.evaluate(
    `Array.from(${fields}.querySelectorAll('input,select'),e=>e.dataset.bind)`,
  );
  const move = async (index: number, direction: "up" | "down") => {
    const before = await keys();
    const next = index + (direction === "up" ? -1 : 1);
    await click(button(`${direction}:${index}`));
    [before[index], before[next]] = [before[next]!, before[index]!];
    assertEquals(await keys(), before);
  };
  assertEquals(await page.evaluate(`${button("up:0")}.disabled`), true);
  assertEquals(
    await page.evaluate(`${button(`down:${initial.length - 1}`)}.disabled`),
    true,
  );
  await move(0, "down");
  await move(1, "up");
  const middle = Math.floor(initial.length / 2);
  await move(middle, "up");
  await move(middle - 1, "down");
  await move(initial.length - 1, "up");
  await move(initial.length - 2, "down");
  assertEquals(await keys(), initial);
  assertEquals(
    await page.evaluate(
      `Array.from(${fields}.querySelectorAll('input,select'),e=>e.dataset.bind)`,
    ),
    bindings,
  );
  // A moved field keeps its filter, visibility and sort bindings.
  await set("Filter Amount", ">3000");
  const amountPosition = initial.indexOf("amount");
  await move(amountPosition, "up");
  assertEquals(await page.evaluate(`${field("Filter Amount")}.value`), ">3000");
  await set("Filter Amount", ">4000");
  await set("Sort: Amount", "asc");
  assertEquals(await page.evaluate(`${field("Sort: Amount")}.value`), "asc");
  await move(amountPosition - 1, "down");
  assertEquals(await page.evaluate(`${field("Filter Amount")}.value`), ">4000");
  await click(field("Visible: Region"));
  await click(button("up:4")); // Amount moves before Region in the built-in order.
  await set("Filter Amount", ">3000");
  await set("Sort: Amount", "desc");
  await set("Name", "UX Mine with a long saved layout name");
  await click(field("Use this layout by default for me"));
  await click(button("save"));
  await wait(
    `!!${
      row("UX Mine with a long saved layout name")
    }&&!${dialog}.querySelector('.uui-dialog-body').inert`,
  );
  assert(
    (await page.evaluate<string>(
      `${row("UX Mine with a long saved layout name")}.textContent`,
    )).includes(
      "For me",
    ),
  );
  await click(
    `${row("UX Mine with a long saved layout name")}.querySelector('button')`,
  );
  await click(button("apply"));
  await wait(
    `!${dialog}&&${list}.querySelector('tbody tr')?.textContent.includes('7500')&&!document.querySelector('#screen-back').disabled`,
  );
  assertEquals(
    await page.evaluate(`${list}.querySelectorAll('thead th').length`),
    5,
  );
  assertEquals(
    await page.evaluate(
      `${list}.querySelector('th[aria-sort="descending"]')?.textContent.includes('Amount')`,
    ),
    true,
  );
  assertEquals(
    await page.evaluate(
      `document.querySelector('[data-list-id="delivery-list"]').querySelectorAll('thead th').length`,
    ),
    6,
  );
  await click(`document.querySelector('[data-element-id="refresh"]')`);
  await ready();
  await page.command("Page.reload");
  await ready();
  await wait(`${list}.querySelector('tbody tr')?.textContent.includes('7500')`);
  await open();
  await click(`${row("Built-in layout")}.querySelector('button')`);
  await click(button("apply"));
  await wait(
    `!${dialog}&&${list}.querySelectorAll('thead th').length===6&&!document.querySelector('#screen-back').disabled`,
  );
  await open();
  await click(
    `${row("UX Mine with a long saved layout name")}.querySelector('button')`,
  );
  assertEquals(
    await page.evaluate(
      `${field("Use this layout by default for me")}.checked`,
    ),
    true,
  );
  await click(field("Use this layout by default for me"));
  await click(button("save"));
  await wait(
    `!!${
      row("UX Mine with a long saved layout name")
    }&&!${dialog}.querySelector('.uui-dialog-body').inert`,
  );
  assertEquals(
    (await page.evaluate<string>(
      `${row("UX Mine with a long saved layout name")}.textContent`,
    )).includes(
      "For me",
    ),
    false,
  );
  await page.command("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await wait(
    `${dialog}.getBoundingClientRect().width<=390 && ${dialog}.scrollWidth<=${dialog}.clientWidth+1`,
  );
  await click(
    `${row("UX Mine with a long saved layout name")}.querySelector('button')`,
  );
  assert(
    await page.evaluate(
      `Array.from(${fields}.tBodies[0].rows).every(r=>r.getBoundingClientRect().height<=40&&Array.from(r.cells).every(c=>getComputedStyle(c).display!=='none'))`,
    ),
    "Mobile retains compact complete rows, not field cards",
  );
  assert(
    await page.evaluate(
      `${fields}.closest('.data-list-scroll').scrollWidth>${fields}.closest('.data-list-scroll').clientWidth`,
    ),
    "Narrow fields table uses ordinary horizontal scrolling",
  );
  const more = `${dialog}.querySelector('.program-header-overflow > summary')`;
  await wait(
    `${more}.getBoundingClientRect().width > 0 && !${more}.parentElement.hidden`,
  );
  assert(
    await page.evaluate(
      `(()=>{const e=${more},r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})()`,
    ),
    "Long mobile titles retain a reachable action overflow",
  );
  await page.command("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "F3",
    code: "F3",
    windowsVirtualKeyCode: 114,
  });
  await page.command("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "F3",
    code: "F3",
    windowsVirtualKeyCode: 114,
  });
  await wait(`!!${dialog}.querySelector('table')`);
  await click(
    `${
      row("UX Mine with a long saved layout name")
    }.querySelector('[aria-label="Delete: UX Mine with a long saved layout name"]')`,
  );
  await wait(`!${row("UX Mine with a long saved layout name")}`);
  await click(`${dialog}.querySelector('[aria-label="Close"]')`);
  await wait(`!${dialog}`);
  console.log(
    "List layouts browser passed: list/detail/Back/Cancel/Save/Apply/Delete, contextual default set/unset, column visibility/order/filter/sort, restore, isolated lists, refresh/reload and mobile.",
  );
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
          schema: z.object({
            rows: z.object({
              id: z.number(),
              label: field(z.string(), {
                label:
                  "A very long field label that must remain available in full through ordinary list overflow help without squeezing visibility, order, filter or sorting controls",
              }),
              amount: z.number(),
              active: z.boolean(),
            }).array(),
          }),
          model: new Model({
            rows: [{ id: 1, label: "Example", amount: 12, active: true }],
          }),
          controls: [{ id: "long-labels", bind: "rows", readOnly: true }],
          actions: [{ id: "open", label: "Open" }],
        });
      }
    },
    async verify(page: Browser) {
      await verifyLayouts(page);
      await page.evaluate(`document.querySelector('#screen-back').click()`);
      const wait = async (expression: string) => {
        const until = Date.now() + 20_000;
        while (!await page.evaluate(expression)) {
          if (Date.now() > until) throw new Error(`Timed out: ${expression}`);
          await new Promise((resolve) => setTimeout(resolve, 40));
        }
      };
      await wait(
        `!!document.querySelector('[data-list-id="long-labels"]')&&!document.querySelector('#screen-back').disabled`,
      );
      await page.evaluate(
        `document.querySelector('.data-list-tools-toggle').click()`,
      );
      await page.evaluate(
        "new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))",
      );
      await wait(`!document.querySelector('#screen-back').disabled`);
      await page.evaluate(
        `document.querySelector('[aria-label="List layouts"]').click()`,
      );
      await wait(`!!document.querySelector('[data-element-id="new"]')`);
      await page.evaluate(
        `document.querySelector('[data-element-id="new"]').click()`,
      );
      const table = `document.querySelector('.layout-fields-table')`;
      const help =
        `${table}.querySelector('[data-column-key="label"] .overflow-reveal')`;
      await wait(`!!${help}&&!${help}.hidden`);
      await page.evaluate(`${help}.click()`);
      await wait(`!!document.querySelector('.overflow-popover:popover-open')`);
      assert(
        (await page.evaluate<string>(
          `document.querySelector('.overflow-popover:popover-open').textContent`,
        )).includes("without squeezing"),
      );
      const shot = await page.command("Page.captureScreenshot", {
        format: "png",
      }) as { data: string };
      await Deno.writeFile(
        "/tmp/uui-layout-fields-long-mobile.png",
        Uint8Array.from(atob(shot.data), (c) => c.charCodeAt(0)),
      );
      assert(
        await page.evaluate(
          `Array.from(${table}.tBodies[0].rows).every(r=>r.getBoundingClientRect().height<=40)`,
        ),
      );
      console.log(
        "Compact fields: first/middle/last moves, stable edits and mobile long-label overflow help passed.",
      );
    },
  };
}
