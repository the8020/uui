import { assertEquals } from "@std/assert";
import { callScreen, field, Model, z } from "./mod.ts";

interface Browser {
  evaluate<T>(expression: string): Promise<T>;
}

export default function fixture() {
  let phase = 0;
  const model = new Model({
    note: "Before",
    choice: "A" as "A" | "B",
    rows: [{ id: 1 }],
  });
  return {
    async run() {
      while (true) {
        const appearance = phase === 0
          ? { class: "marked\t extra marked", style: "border: 2px solid red;" }
          : phase === 1
          ? {
            class: "updated custom-element-host",
            style: "border: 3px solid blue; color: red !important;",
          }
          : phase === 2
          ? {}
          : { class: "", style: "" };
        await callScreen({
          id: "component-style",
          ...appearance,
          title: `Style phase ${phase}`,
          schema: z.object({
            note: field(z.string(), appearance),
            choice: z.enum(["A", "B"]),
            rows: z.array(z.object({ id: z.number() })),
          }),
          model,
          controls: [
            { id: "note", bind: "note" },
            { id: "radio", bind: "choice", control: "radio", ...appearance },
            { id: "inferred-list", bind: "rows", ...appearance },
            {
              id: "custom-field",
              bind: "note",
              ...appearance,
              custom: {
                module: "/style-widget.js",
                config: {},
                preserve: true,
              },
            },
          ],
          actions: [{ id: "advance", label: "Advance", ...appearance }],
          header: {
            controls: [{ id: "header-field", bind: "note", ...appearance }],
            elements: [
              { id: "header-gap", type: "separator", ...appearance },
              { id: "header-button", label: "Header", ...appearance },
            ],
          },
          customElements: [{
            id: "widget",
            module: "/style-widget.js",
            config: {},
            preserve: true,
            ...appearance,
          }],
          layout: {
            schema: 1,
            id: "style-layout",
            root: {
              id: "stack",
              type: "stack",
              ...appearance,
              children: [
                {
                  id: "group",
                  type: "field-group",
                  title: "Group",
                  controls: ["note", "radio", "custom-field"],
                  ...appearance,
                },
                { id: "implicit", type: "stack", controls: ["inferred-list"] },
                {
                  id: "list",
                  type: "list",
                  bind: "rows",
                  ...appearance,
                  toolbar: [
                    { id: "toolbar-field", bind: "note", ...appearance },
                    { id: "toolbar-gap", type: "separator", ...appearance },
                    { id: "toolbar-button", label: "Toolbar", ...appearance },
                  ],
                },
                {
                  id: "custom",
                  type: "custom",
                  customElement: "widget",
                  ...appearance,
                },
              ],
            },
          },
        });
        phase++;
      }
    },
    async verify(page: Browser) {
      const wait = async (expression: string) => {
        const until = Date.now() + 8000;
        while (!await page.evaluate(expression)) {
          if (Date.now() > until) throw new Error(`Timed out: ${expression}`);
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      };
      const selectors = [
        ".screen",
        "[data-custom-element-id=widget]",
        ...[
          "note",
          "radio",
          "inferred-list",
          "custom-field",
          "advance",
          "header-field",
          "header-gap",
          "header-button",
          "stack",
          "group",
          "list",
          "toolbar-field",
          "toolbar-gap",
          "toolbar-button",
          "custom",
        ].map((id) => `[data-element-id=${id}]`),
      ];
      for (let current = 0; current < 4; current++) {
        await wait(
          `document.querySelector('.screen-title')?.textContent === 'Style phase ${current}' && document.querySelectorAll('.widget-ready').length === 2 && !document.querySelector('#screen-back').disabled`,
        );
        const actual = await page.evaluate(
          `(${JSON.stringify(selectors)}).map(selector => {
          const root = document.querySelector(selector);
          const css = getComputedStyle(root);
          return [root.classList.contains('marked'), root.classList.contains('updated'),
            root.style.border, css.borderTopColor];
        })`,
        );
        if (current < 2) {
          assertEquals(
            actual,
            selectors.map(() =>
              current === 0
                ? [true, false, "2px solid red", "rgb(255, 0, 0)"]
                : [false, true, "3px solid blue", "rgb(0, 0, 255)"]
            ),
          );
        } else {
          assertEquals(
            (actual as unknown[][]).map((row) => row.slice(0, 3)),
            selectors.map(() => [false, false, ""]),
          );
          assertEquals(
            await page.evaluate(`(() => {
            const host = document.querySelector('[data-custom-element-id=widget]');
            return [host.classList.contains('custom-element-host'), host.classList.contains('widget-ready'), host.style.color];
          })()`),
            [true, true, "rgb(1, 2, 3)"],
          );
        }
        if (current === 0) {
          await page.evaluate(
            `window.retainedWidget = document.querySelector('[data-custom-element-id=widget]');
            const input = document.querySelector('[data-element-id=note] input');
            input.value = 'Edited'; input.dispatchEvent(new Event('input', {bubbles:true}));`,
          );
        } else {
          assertEquals(model.data.note, "Edited");
          assertEquals(
            await page.evaluate(
              `window.retainedWidget === document.querySelector('[data-custom-element-id=widget]') && window.styleMounts === 2`,
            ),
            true,
          );
        }
        if (current < 3) {
          await page.evaluate(
            "document.querySelector('[data-element-id=advance]').click()",
          );
        }
      }
    },
    serve(request: Request) {
      return Promise.resolve(
        new URL(request.url).pathname === "/style-widget.js"
          ? new Response(
            `export default function({host}) {
          window.styleMounts = (window.styleMounts || 0) + 1;
          host.classList.add('widget-ready'); host.style.color = 'rgb(1, 2, 3)';
          host.textContent = 'Widget'; return {};
        }`,
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
