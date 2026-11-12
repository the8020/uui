import { assert, assertEquals } from "@std/assert";
import { brandingDatabase } from "./branding_test_support.ts";
import { createTableSQL } from "/p/the8020/db/internal/ddl.ts";

interface Browser {
  evaluate<T>(expression: string): Promise<T>;
  command(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

/** Also run unchanged against the installed Docker/auth/database stack. */
export async function verifySelection(page: Browser) {
  const wait = async (expression: string) => {
    const until = Date.now() + 20_000;
    while (true) {
      try {
        if (await page.evaluate(expression)) return;
      } catch { /* A presentation can replace its DOM between frames. */ }
      if (Date.now() > until) {
        throw new Error(
          `Timed out: ${expression}\n${await page.evaluate(
            "document.body.innerText.slice(-4000)",
          )}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  };
  const ready = () => wait("!document.querySelector('#screen-back').disabled");
  const active =
    `Array.from(document.querySelectorAll('dialog.presentation-modal[open]')).at(-1)`;
  const button = (id: string, root = "document") =>
    `${root}.querySelector('[data-element-id="${id}"]')`;
  const list = (id: string) =>
    `document.querySelector('[data-list-id="${id}"]')`;
  const field = (bind: string) =>
    `document.querySelector('[data-bind="${bind}"]').closest('.field')`;
  const click = async (expression: string) => {
    await ready();
    await wait(
      `!!(${expression}) && !(${expression}).disabled && !(${expression}).closest('[inert]')`,
    );
    await page.evaluate(
      "new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))",
    );
    const point = await page.evaluate<{ x: number; y: number }>(
      `(()=>{const target=${expression};target.scrollIntoView({block:'nearest'});const r=target.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
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
  const set = async (bind: string, value: string) => {
    await ready();
    await page.evaluate(
      `(()=>{const input=${active}.querySelector('[data-bind="${bind}"]');input.value=${
        JSON.stringify(value)
      };input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
  };
  const help = async (bind: string) => {
    await click(`${field(bind)}.querySelector('.field-help-button')`);
    await wait(
      `!!${
        list("criteria")
      } && !document.querySelector('#screen-back').disabled`,
    );
  };
  const close = async () => {
    await click(`${active}.querySelector('.presentation-modal-close')`);
    await ready();
  };
  await wait(`!!${list("results")}?.querySelector('tbody tr')`);
  // Click/type/Enter and blur/Run use the ordinary field commit, without help.
  const inline = `${field("ids")}.querySelector('input')`;
  await click(inline);
  assertEquals(
    await page.evaluate("document.querySelectorAll('dialog[open]').length"),
    0,
  );
  for (const value of ["5", "10"]) {
    await page.command("Input.insertText", { text: value });
    await page.command("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
    });
    await page.command("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
    });
  }
  assertEquals(
    await page.evaluate(
      `${field("ids")}.querySelectorAll('.field-tag').length`,
    ),
    2,
  );
  assertEquals(
    await page.evaluate("document.querySelectorAll('dialog[open]').length"),
    0,
  );
  await click(button("execute"));
  await wait(
    `${
      list("results")
    }.querySelectorAll('tbody tr').length===2 && !document.querySelector('#screen-back').disabled`,
  );
  assertEquals(
    await page.evaluate(
      `Array.from(${
        list("results")
      }.querySelectorAll('tbody tr td:first-child .overflow-text-content')).map(e=>e.textContent)`,
    ),
    ["5", "10"],
  );
  await click(`${field("ids")}.querySelector('.field-tag-remove')`);
  await click(inline);
  await page.command("Input.insertText", { text: "20" });
  await click(button("execute"));
  await wait(
    `${
      list("results")
    }.querySelector('tbody tr')?.textContent.includes('0010') && !document.querySelector('#screen-back').disabled`,
  );
  assertEquals(
    await page.evaluate(
      `${field("ids")}.querySelectorAll('.field-tag').length`,
    ),
    2,
  );
  assertEquals(
    await page.evaluate("document.querySelectorAll('dialog[open]').length"),
    0,
  );
  await click(button("clear"));
  await ready();
  await click(button("examples"));
  await wait(
    `${
      field("ids")
    }.querySelectorAll('.field-tag').length===3 && !document.querySelector('#screen-back').disabled`,
  );
  assertEquals(
    await page.evaluate(
      `${
        list("results")
      }.querySelector('tbody tr td .overflow-text-content')?.textContent`,
    ),
    "10",
  );
  assert(
    (await page.evaluate<string>(`${field("ids")}.textContent`)).includes(
      "10 … 30",
    ),
  );
  assert(
    (await page.evaluate<string>(`${field("names")}.textContent`)).includes(
      "~ Order 00*",
    ),
  );
  await help("ids");
  await click(button("add", active));
  await wait(`!!${active}?.querySelector('[data-bind="option"]')`);
  await set("option", "BT");
  await wait(
    `!${active}.querySelector('[data-bind="high"]').closest('.field').hidden`,
  );
  await set("low", "40");
  await set("high", "42");
  await click(button("save", active));
  await wait(
    `${
      list("criteria")
    }.querySelectorAll('tbody tr').length===4 && !document.querySelector('#screen-back').disabled`,
  );
  await click(`${list("criteria")}.querySelector('tbody tr:last-child td')`);
  await wait(`!!${button("edit", active)}`);
  await click(button("edit", active));
  await wait(`!!${active}.querySelector('[data-bind="low"]')`);
  await set("sign", "E");
  await set("low", "41");
  await click(button("save", active));
  await wait(
    `${list("criteria")}?.querySelector('tbody')?.textContent.includes('41')`,
  );
  await close();
  await help("ids");
  await wait(`${list("criteria")}.querySelectorAll('tbody tr').length===3`);
  assertEquals(
    await page.evaluate(
      `${list("criteria")}.querySelectorAll('tbody tr').length`,
    ),
    3,
  );
  await click(`${list("criteria")}.querySelector('tbody tr:first-child td')`);
  await wait(`!!${button("delete", active)}`);
  await click(button("delete", active));
  await wait(`${list("criteria")}.querySelectorAll('tbody tr').length===2`);
  await click(button("done", active));
  await wait(
    `!document.querySelector('dialog.presentation-modal[open]') && ${
      field("ids")
    }.querySelectorAll('.field-tag').length===2`,
  );
  await help("ids");
  await wait(`${list("criteria")}.querySelectorAll('tbody tr').length===2`);
  assertEquals(
    await page.evaluate(
      `${list("criteria")}.querySelectorAll('tbody tr').length`,
    ),
    2,
  );
  await close();
  // Value help keeps keys across pages; cancelling the outer draft discards its Done.
  await help("names");
  await click(button("values", active));
  await wait(
    `${list("choices")}?.querySelectorAll('tbody tr').length > 1`,
  );
  await click(
    `${list("choices")}.querySelector('tbody input[type="checkbox"]')`,
  );
  await wait(
    `${
      list("choices")
    }.querySelector('.data-list-page-summary').textContent.startsWith('(1 of')`,
  );
  await click(
    `${
      list("choices")
    }.querySelector('.data-list-page-numbers [aria-label="Page 2"]')`,
  );
  await wait(
    `${
      list("choices")
    }.querySelector('[aria-current="page"]')?.textContent==='2'`,
  );
  await click(
    `${list("choices")}.querySelector('tbody input[type="checkbox"]')`,
  );
  await wait(
    `${
      list("choices")
    }.querySelector('.data-list-page-summary').textContent.startsWith('(2 of')`,
  );
  await click(button("done", active));
  await wait(`${list("criteria")}?.querySelectorAll('tbody tr').length===3`);
  await close();
  await help("names");
  assertEquals(
    await page.evaluate(
      `${list("criteria")}.querySelectorAll('tbody tr').length`,
    ),
    1,
  );
  await click(button("values", active));
  await wait(
    `${list("choices")}?.querySelectorAll('tbody tr').length > 1`,
  );
  await click(
    `${list("choices")}.querySelector('tbody input[type="checkbox"]')`,
  );
  await wait(
    `${
      list("choices")
    }.querySelector('.data-list-page-summary').textContent.startsWith('(1 of')`,
  );
  await click(button("done", active));
  await wait(`${list("criteria")}?.querySelectorAll('tbody tr').length===2`);
  await click(button("done", active));
  await wait(
    `!document.querySelector('dialog.presentation-modal[open]') && ${
      field("names")
    }.querySelectorAll('.field-tag').length===2`,
  );
  // A real several-thousand selection roundtrips, queries SQL, pages and edits.
  const started = Date.now();
  await click(button("large"));
  await wait(
    `${
      field("ids")
    }.querySelector('.selection-more')?.textContent==='+4996 more' && !document.querySelector('#screen-back').disabled`,
  );
  assertEquals(
    await page.evaluate(
      `${field("ids")}.querySelectorAll('.field-tag').length`,
    ),
    5,
  );
  assert(
    (await page.evaluate<number>(
      `${list("results")}.querySelectorAll('tbody tr').length`,
    )) < 100,
  );
  await click(`${field("ids")}.querySelector('.selection-more')`);
  await wait(
    `${
      list("criteria")
    }?.querySelector('.data-list-page-summary')?.textContent.includes('5000')`,
  );
  assert(
    (await page.evaluate<number>(
      `${list("criteria")}.querySelectorAll('tbody tr').length`,
    )) < 100,
  );
  assertEquals(
    await page.evaluate(
      "document.querySelectorAll('.field-selection .field-tag').length",
    ),
    5,
  );
  await click(
    `${
      list("criteria")
    }.querySelector('.data-list-page-numbers [aria-label="Page 2"]')`,
  );
  await wait(
    `${
      list("criteria")
    }.querySelector('[aria-current="page"]')?.textContent==='2'`,
  );
  const low = await page.evaluate<string>(
    `${
      list("criteria")
    }.querySelector('tbody tr td:nth-child(3) .overflow-text-content').textContent`,
  );
  await click(`${list("criteria")}.querySelector('tbody tr td')`);
  await wait(`!!${button("edit", active)}`);
  await click(button("edit", active));
  await wait(`!!${active}.querySelector('[data-bind="low"]')`);
  assertEquals(
    await page.evaluate(`${active}.querySelector('[data-bind="low"]').value`),
    low,
  );
  await set("low", "6001");
  await click(button("save", active));
  await wait(
    `!!${list("criteria")} && !document.querySelector('#screen-back').disabled`,
  );
  await click(button("delete", active));
  await wait(
    `${
      list("criteria")
    }.querySelector('.data-list-page-summary').textContent.includes('4999')`,
  );
  await click(button("done", active));
  await wait(
    `${
      field("ids")
    }.querySelector('.selection-more')?.textContent==='+4995 more' && !document.querySelector('dialog.presentation-modal[open]')`,
  );
  await click(button("execute"));
  await wait(
    `${
      list("results")
    }.querySelector('.data-list-page-summary')?.textContent.includes('4999') && !document.querySelector('#screen-back').disabled`,
  );
  await page.command("Page.reload");
  await wait(
    `${
      field("ids")
    }.querySelector('.selection-more')?.textContent==='+4995 more' && !document.querySelector('#screen-back').disabled`,
  );
  await help("ids");
  assert(
    (await page.evaluate<string>(
      `${
        list("criteria")
      }.querySelector('.data-list-page-summary').textContent`,
    )).includes("4999"),
  );
  await close();
  await page.command("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await ready();
  const fits = await page.evaluate<boolean>(
    `(()=>{const b=${
      field("ids")
    }.querySelector('.selection-more').getBoundingClientRect();return b.right<=innerWidth && b.width>0;})()`,
  );
  assert(fits, "overflow remains clickable on mobile");
  assert(
    await page.evaluate<boolean>(
      `Array.from(${
        field("ids")
      }.querySelectorAll('.field-tag:not(.selection-more)')).every(token=>token.scrollWidth<=token.clientWidth+1)`,
    ),
    "short value tokens stay readable on mobile",
  );
  await page.command("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  console.log(
    `Selection browser passed: typed tokens; add/edit/delete; isolated Cancel/Done; value-help keys across pages; 5,000 SQL criteria, bounded DOM, exact counts, page-two edit and reload (${
      Date.now() - started
    } ms including browser interactions).`,
  );
}

export default async function fixture() {
  const database = await brandingDatabase();
  const { descriptorOf } = await import("/p/the8020/db/mod.ts");
  const { default: records } = await import("./tables/selection_demo.ts");
  database.database.exec(createTableSQL("sqlite", descriptorOf(records)));
  const { default: report } = await import(
    "./programs/selection-demo/program.ts"
  );
  return {
    close() {
      database.close();
      return Promise.resolve();
    },
    serve() {
      return Promise.resolve(undefined);
    },
    run: report,
    verify: verifySelection,
  };
}
