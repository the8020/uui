import { assertEquals } from "@std/assert";
import {
  callScreen,
  Model,
  presentModal,
  presentPage,
  SESSION_RESTART_EVENT,
  z,
} from "./mod.ts";

interface Browser {
  evaluate<T>(expression: string): Promise<T>;
  command(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

export default function fixture() {
  const model = new Model({ value: "original" });
  let lastAction = "";
  async function child(title: string) {
    await callScreen({
      id: title,
      title,
      model: new Model({}),
      schema: z.object({}),
    });
  }
  return {
    async run() {
      while (true) {
        const event = await callScreen({
          id: "system-buttons",
          title: "System buttons",
          model,
          schema: z.object({ value: z.string() }),
          systemButtons: {
            exit: { id: SESSION_RESTART_EVENT, label: "[[icon=refresh]]" },
            new: null,
            help: {
              label: "Help",
              class: "custom-help",
              style: "color: rgb(1, 2, 3);",
            },
          },
          actions: [{ id: "modal", label: "Modal" }, {
            id: "page",
            label: "Page",
          }],
        });
        lastAction = event.action;
        if (event.action === "modal") {
          await presentModal(() => child("Modal child"));
        }
        if (event.action === "page") {
          await presentPage(() => child("Page child"));
        }
      }
    },
    async verify(page: Browser) {
      await page.command("Emulation.setDeviceMetricsOverride", {
        width: 1280,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      });
      const wait = async (expression: string) => {
        const deadline = Date.now() + 8000;
        while (!await page.evaluate(expression)) {
          if (Date.now() > deadline) {
            throw new Error(`Timed out: ${expression}`);
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      };
      const click = async (selector: string) => {
        const position = await page.evaluate<{ x: number; y: number }>(
          `(() => { const r = document.querySelector(${
            JSON.stringify(selector)
          }).getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`,
        );
        await page.command("Input.dispatchMouseEvent", {
          type: "mousePressed",
          ...position,
          button: "left",
          clickCount: 1,
        });
        await page.command("Input.dispatchMouseEvent", {
          type: "mouseReleased",
          ...position,
          button: "left",
          clickCount: 1,
        });
      };
      const rootReady =
        "document.querySelector('#system-help') && !document.querySelector('#system-help').disabled";
      await wait(rootReady);
      assertEquals(
        await page.evaluate(
          "Array.from(document.querySelectorAll('.session-navigation > *')).map(n=>n.dataset.systemSlot)",
        ),
        ["back", "exit", "fullscreen", "help"],
      );
      assertEquals(
        await page.evaluate(
          "document.querySelector('#session-exit .material-icon').dataset.materialIcon",
        ),
        "refresh",
      );
      await page.evaluate(
        "const input = document.querySelector('[data-bind=value]'); input.value = 'edited'; input.dispatchEvent(new Event('input',{bubbles:true}));",
      );
      await click("#system-help");
      await wait(rootReady);
      assertEquals(lastAction, "help");
      assertEquals(model.data.value, "edited");
      for (const kind of ["modal", "page"]) {
        await click(`[data-element-id=${kind}]`);
        await wait(
          "document.querySelector('#session-new') && !document.querySelector('#screen-back').disabled",
        );
        assertEquals(
          await page.evaluate("document.querySelector('#system-help')"),
          null,
        );
        assertEquals(
          await page.evaluate(
            "document.querySelector('#session-exit .material-icon').dataset.materialIcon",
          ),
          "arrow_upward",
        );
        await click("#screen-back");
        await wait(rootReady);
        assertEquals(
          await page.evaluate(
            "document.querySelector('#session-exit .material-icon').dataset.materialIcon",
          ),
          "refresh",
        );
      }
      await click("#app-fullscreen");
      assertEquals(
        await page.evaluate(
          "document.documentElement.classList.contains('uui-app-fullscreen')",
        ),
        true,
      );
      await click("#app-fullscreen");
      assertEquals(
        await page.evaluate(
          "document.documentElement.classList.contains('uui-app-fullscreen')",
        ),
        false,
      );
    },
    serve: () => Promise.resolve(undefined),
    close: () => Promise.resolve(),
  };
}
