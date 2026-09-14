import { assert, assertEquals } from "@std/assert";
import { callScreen, field, Model, presentModal, z } from "./mod.ts";
import masterDetail from "/p/the8020/demo/programs/demo-master-detail/program.ts";

interface Browser {
  evaluate<T>(expression: string): Promise<T>;
  command(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

export default function fixture() {
  const model = new Model({
    note: "Before",
    enabled: false,
    count: 2,
    custom: "Before",
    rows: [{ id: 1, selected: false }],
  });
  const schema = z.object({
    note: z.string().min(1),
    enabled: z.boolean(),
    count: z.number(),
    custom: z.string(),
    rows: field(z.array(z.object({ id: z.number(), selected: z.boolean() })), {
      list: {
        selection: "selected",
        toolbar: [
          { id: "toolbar-note", bind: "note" },
          { id: "toolbar-enabled", bind: "enabled" },
          {
            id: "toolbar-count",
            bind: "count",
            control: "range",
            minimum: 0,
            maximum: 10,
          },
          { type: "separator" },
          {
            id: "toolbar-custom",
            bind: "custom",
            custom: { module: "/toolbar-custom.js", config: {} },
          },
          {
            id: "save-toolbar",
            label: "Save toolbar",
            shortcut: { key: "F8" },
          },
        ],
      },
    }),
  });
  const events: string[] = [];
  const split = (prefix: string) => [
    { id: `${prefix}-left`, label: "Left" },
    { type: "separator" as const },
    { id: `${prefix}-middle`, label: "Middle" },
    { type: "separator" as const },
    { id: `${prefix}-right`, label: "Right" },
  ];
  const wait = async (
    read: () => Promise<boolean> | boolean,
    label: string,
  ) => {
    const until = Date.now() + 8000;
    while (!await read()) {
      if (Date.now() > until) throw new Error(`Timed out: ${label}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };
  return {
    async run() {
      await masterDetail();
      while (true) {
        const event = await callScreen({
          id: "toolbar-fixture",
          title: "Toolbar fixture",
          model,
          schema,
          controls: [{ id: "implicit-rows", bind: "rows" }],
          header: { elements: split("header") },
          actions: [{ id: "modal", label: "Open modal" }],
        });
        events.push(event.action);
        if (event.action === "modal") {
          await presentModal(() =>
            callScreen({
              id: "split-modal",
              title: "Split modal",
              model: new Model({}),
              schema: z.object({}),
              header: { elements: split("modal-header") },
              layout: {
                schema: 1,
                id: "split",
                root: { type: "actions", elements: split("modal-body") },
              },
            })
          );
        }
      }
    },
    async verify(page: Browser) {
      const idle = async () => {
        await wait(
          () =>
            page.evaluate<boolean>(
              `!!document.querySelector('.data-list') && !document.querySelector('#screen-back')?.disabled`,
            ),
          "interactive list",
        );
        await new Promise((resolve) => setTimeout(resolve, 100));
        await wait(
          () =>
            page.evaluate<boolean>(
              `!document.querySelector('#screen-back')?.disabled`,
            ),
          "measured list",
        );
      };
      const click = async (selector: string) => {
        await idle();
        assert(
          await page.evaluate<boolean>(
            `!!document.querySelector(${JSON.stringify(selector)})`,
          ),
          selector,
        );
        await page.evaluate(
          `document.querySelector(${JSON.stringify(selector)}).click()`,
        );
        await idle();
      };
      const input = async (selector: string, value: string) => {
        await page.evaluate(
          `{const input=document.querySelector(${
            JSON.stringify(selector)
          });input.value=${
            JSON.stringify(value)
          };input.dispatchEvent(new Event('input',{bubbles:true}));}`,
        );
      };
      const selected = async (count: number, total = 60) => {
        await idle();
        await wait(
          () =>
            page.evaluate<boolean>(
              `document.querySelector('.data-list-page-summary')?.textContent.includes('(${count} of ${total} selected)')`,
            ),
          `${count} selected of ${total}`,
        );
      };
      const checkGaps = async (selector: string) => {
        const geometry = await page.evaluate<
          Array<{ x: number; width: number }>
        >(`Array.from(document.querySelector(${
          JSON.stringify(selector)
        }).children).map(e=>{const r=e.getBoundingClientRect();return {x:r.x,width:r.width}})`);
        assertEquals(geometry.length, 5);
        assert(
          geometry[1]!.width > 10 && geometry[3]!.width > 10,
          JSON.stringify(geometry),
        );
        assert(
          Math.abs(geometry[1]!.width - geometry[3]!.width) < 1,
          "equal flexible gaps",
        );
        assert(
          geometry[4]!.x > geometry[2]!.x && geometry[2]!.x > geometry[0]!.x,
        );
      };
      await page.command("Emulation.setDeviceMetricsOverride", {
        width: 1800,
        height: 1000,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await selected(0);
      const toolbarGaps = await page.evaluate<number[]>(
        `Array.from(document.querySelectorAll('.data-list-custom-toolbar > .uui-separator')).map(e=>e.getBoundingClientRect().width)`,
      );
      assertEquals(toolbarGaps.length, 2);
      assert(
        toolbarGaps[0]! > 10 && Math.abs(toolbarGaps[0]! - toolbarGaps[1]!) < 1,
        "list toolbar distributes flexible gaps",
      );
      assert(
        await page.evaluate<boolean>(
          `!!document.querySelector('thead th:first-child input[type=checkbox]') && document.querySelector('.data-list-toolbar').hidden && !!document.querySelector('.data-list-custom-toolbar [data-bind=newCustomer]')`,
        ),
      );
      await click('tbody tr[data-row-index="1"] .data-list-selection input');
      await selected(1);
      assert(
        await page.evaluate<boolean>(
          `document.querySelector('thead input').indeterminate`,
        ),
      );
      // Shift range from row 2 through row 5; navigation clicks still open details.
      await page.evaluate(
        `document.querySelector('tbody tr[data-row-index="4"] .data-list-selection input').dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}))`,
      );
      await selected(4);
      await click('[data-element-id="confirm-selected"]');
      assert(
        await page.evaluate<boolean>(
          `Array.from(document.querySelectorAll('tbody tr')).slice(1,5).every(r=>r.textContent.includes('confirmed'))`,
        ),
      );
      await click("thead th:first-child");
      await selected(60);
      await click("thead th:first-child");
      await selected(0);
      // Real pointer drag: one range committed on release, without activating a row.
      const point = (index: number) =>
        page.evaluate<{ x: number; y: number }>(
          `{const e=document.querySelector('tbody tr[data-row-index="${index}"] .data-list-selection');const r=e.getBoundingClientRect();({x:r.x+r.width/2,y:r.y+r.height/2})}`,
        );
      await page.evaluate(
        `document.querySelector('tbody tr[data-row-index="1"]').scrollIntoView({block:'center'})`,
      );
      const from = await point(1), to = await point(5);
      await page.command("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        ...from,
      });
      await page.command("Input.dispatchMouseEvent", {
        type: "mousePressed",
        ...from,
        button: "left",
        buttons: 1,
        clickCount: 1,
      });
      await page.command("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        ...to,
        buttons: 1,
      });
      await page.command("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        ...to,
        button: "left",
        clickCount: 1,
      });
      await selected(5);
      await click("thead input");
      await click("thead input");
      await selected(0);
      // A shift range spans UUI pages in displayed order.
      const capacity = await page.evaluate<number>(
        `document.querySelectorAll('tbody tr[data-row-index]').length`,
      );
      await click('tbody tr[data-row-index="1"] .data-list-selection input');
      await click('button[aria-label="Page 2"]');
      await page.evaluate(
        `document.querySelector('tbody tr[data-row-index="1"] .data-list-selection input').dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}))`,
      );
      await selected(capacity + 1);
      await page.command("Page.reload");
      await selected(capacity + 1);
      await click(".data-list-tools-toggle");
      assert(
        await page.evaluate<boolean>(
          `!!document.querySelector('.data-list-custom-toolbar [data-element-id=add-row]') && !document.querySelector('.data-list-toolbar').hidden`,
        ),
      );
      await input(".data-list-search", "ORD-1001");
      await page.evaluate(
        `document.querySelector('.data-list-search').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`,
      );
      await idle();
      await wait(
        () =>
          page.evaluate<boolean>(
            `document.querySelectorAll('tbody tr[data-row-index]').length===1`,
          ),
        "filtered row",
      );
      await click("thead input");
      await selected(60);
      await click("thead input");
      await selected(0);
      // Toolbar edits use ordinary dirty binding validation and add a real demo row.
      await input("[data-bind=newCustomer]", "Toolbar customer");
      await click("[data-element-id=add-row]");
      await selected(0, 61);
      await input(".data-list-search", "Toolbar customer");
      await page.evaluate(
        `document.querySelector('.data-list-search').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`,
      );
      await idle();
      await wait(
        () =>
          page.evaluate<boolean>(
            `document.querySelector('tbody')?.textContent.includes('Toolbar customer')`,
          ),
        "added row",
      );
      await click("tbody .data-list-selection input");
      await selected(1, 61);
      await click("tbody td:nth-child(2)");
      assertEquals(
        await page.evaluate<string>(
          `document.querySelector('[data-bind="selectedOrder.customer"]').value`,
        ),
        "Toolbar customer",
      );
      await click("[data-element-id=delete-selected]");
      await wait(
        () =>
          page.evaluate<boolean>(
            `!!document.querySelector('dialog[open] [data-element-id=confirm-delete]')`,
          ),
        "delete confirmation",
      );
      assert(
        await page.evaluate<boolean>(
          `document.querySelector('dialog[open] .uui-separator').getBoundingClientRect().width>20`,
        ),
      );
      await page.evaluate(
        `document.querySelector('[data-element-id=cancel-delete]').click()`,
      );
      await selected(1, 61);
      await click("[data-element-id=delete-selected]");
      await page.evaluate(
        `document.querySelector('[data-element-id=confirm-delete]').click()`,
      );
      await selected(0, 60);
      await click('[aria-label="Clear all filters"]');
      await click("thead input");
      await selected(60);
      await click("[data-element-id=delete-selected]");
      await page.evaluate(
        `document.querySelector('[data-element-id=confirm-delete]').click()`,
      );
      await selected(0, 0);
      assert(
        await page.evaluate<boolean>(
          `document.querySelector('thead input').disabled && document.querySelector('tbody').textContent.includes('No items')`,
        ),
      );
      await click("[data-element-id=add-row]");
      await selected(0, 1);
      await click("#screen-back");
      await wait(
        () =>
          page.evaluate<boolean>(
            `document.querySelector('.screen-title')?.textContent==='Toolbar fixture'`,
          ),
        "generic toolbar fixture",
      );
      await idle();
      await checkGaps(".program-header-visible");
      await input("[data-element-id=toolbar-note] input", "Saved");
      await click("[data-element-id=toolbar-enabled] input");
      await input("[data-element-id=toolbar-count] input", "7");
      await wait(
        () =>
          page.evaluate<boolean>(
            `!!document.querySelector('#custom-toolbar-input')`,
          ),
        "custom control mounted",
      );
      await input("#custom-toolbar-input", "Custom saved");
      for (const type of ["keyDown", "keyUp"]) {
        await page.command("Input.dispatchKeyEvent", {
          type,
          key: "F8",
          code: "F8",
          windowsVirtualKeyCode: 119,
        });
      }
      await wait(() => events.includes("save-toolbar"), "toolbar shortcut");
      await idle();
      assertEquals(model.data, {
        note: "Saved",
        enabled: true,
        count: 7,
        custom: "Custom saved",
        rows: [{ id: 1, selected: false }],
      });
      assert(events.includes("save-toolbar"));
      await input("[data-element-id=toolbar-note] input", "");
      await click("thead input");
      assertEquals(model.data.rows[0]!.selected, false);
      assertEquals(
        await page.evaluate<boolean>(
          `document.querySelector('thead input').checked`,
        ),
        false,
      );
      await input("[data-element-id=toolbar-note] input", "Saved");
      await page.evaluate(
        `document.querySelector('tbody .data-list-selection input').focus()`,
      );
      await page.command("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: " ",
        code: "Space",
        windowsVirtualKeyCode: 32,
      });
      await page.command("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: " ",
        code: "Space",
        windowsVirtualKeyCode: 32,
      });
      await selected(1, 1);
      assert(
        await page.evaluate<boolean>(
          `document.activeElement===document.querySelector('tbody .data-list-selection input')`,
        ),
        "selection retains keyboard focus",
      );
      for (const type of ["keyDown", "keyUp"]) {
        await page.command("Input.dispatchKeyEvent", {
          type,
          key: " ",
          code: "Space",
          windowsVirtualKeyCode: 32,
        });
      }
      await selected(0, 1);
      for (const type of ["keyDown", "keyUp"]) {
        await page.command("Input.dispatchKeyEvent", {
          type,
          key: " ",
          code: "Space",
          windowsVirtualKeyCode: 32,
        });
      }
      await selected(1, 1);
      await click("[data-element-id=modal]");
      await wait(
        () =>
          page.evaluate<boolean>(
            `!!document.querySelector('dialog[open] [data-element-id=modal-body-left]')`,
          ),
        "split modal",
      );
      await checkGaps("dialog[open] .presentation-modal-header");
      await checkGaps("dialog[open] .uui-elements");
      await page.evaluate(
        `document.querySelector('[data-element-id=modal-body-left]').click()`,
      );
      await idle();
      await page.command("Emulation.setDeviceMetricsOverride", {
        width: 390,
        height: 844,
        deviceScaleFactor: 1,
        mobile: true,
      });
      await idle();
      assert(
        await page.evaluate<boolean>(
          `document.documentElement.scrollWidth<=innerWidth && document.querySelector('.data-list-custom-toolbar').getBoundingClientRect().right<=innerWidth`,
        ),
      );
      await click("thead input");
      await selected(0, 1);
      await page.command("Emulation.setDeviceMetricsOverride", {
        width: 1800,
        height: 1000,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await idle();
      await checkGaps(".program-header-visible");
    },
    serve(request: Request) {
      return Promise.resolve(
        new URL(request.url).pathname === "/toolbar-custom.js"
          ? new Response(
            `export default function(ctx){const input=document.createElement('input');input.id='custom-toolbar-input';input.value=ctx.value;input.oninput=()=>ctx.setValue(input.value);ctx.host.append(input);return {dispose(){input.remove()}}}`,
            { headers: { "content-type": "text/javascript" } },
          )
          : undefined,
      );
    },
    close() {
      return Promise.resolve();
    },
  };
}
