import { assertEquals } from "@std/assert";
import { callScreen, field, Model, z } from "./mod.ts";

interface Browser {
  evaluate<T>(expression: string): Promise<T>;
  command(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

export default function fixture() {
  const model = new Model({
    instant: "2026-10-18T10:20:30.123Z",
    offset: "2026-10-18T12:20:30.123+02:00",
    local: "2026-10-18T08:00",
  });
  return {
    async run() {
      await callScreen({
        id: "datetime-start",
        schema: z.object({}),
        model: new Model({}),
        actions: [{ id: "start", label: "Start" }],
      });
      await callScreen({
        id: "datetime-fields",
        schema: z.object({
          instant: field(z.string(), { semanticType: "datetime" }),
          offset: field(z.string(), { semanticType: "datetime" }),
          local: field(z.string(), { semanticType: "datetime" }),
        }),
        model,
        controls: [
          { id: "instant", bind: "instant" },
          { id: "mirror", bind: "instant", readOnly: true },
          { id: "offset", bind: "offset", readOnly: true },
          { id: "local", bind: "local" },
        ],
        actions: [{ id: "save", label: "Save" }],
      });
      assertEquals(model.data, {
        instant: "2026-10-18T11:10:11.456Z",
        offset: "2026-10-18T12:20:30.123+02:00",
        local: "2026-10-19T08:00",
      });
      await callScreen({
        id: "datetime-done",
        schema: z.object({}),
        model: new Model({}),
        actions: [{ id: "done", label: "Done" }],
      });
    },
    async verify(page: Browser) {
      const wait = async (selector: string) => {
        const deadline = Date.now() + 5000;
        while (
          !await page.evaluate(`!!document.querySelector('${selector}')`)
        ) {
          if (Date.now() > deadline) throw new Error(`Missing ${selector}`);
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      };
      await wait("[data-element-id=start]");
      await page.command("Emulation.setTimezoneOverride", {
        timezoneId: "America/New_York",
      });
      await page.evaluate(
        "document.querySelector('[data-element-id=start]').click()",
      );
      await wait("[data-element-id=instant] input");
      const value = (id: string) =>
        page.evaluate<string>(
          `document.querySelector('[data-element-id=${id}] input').value`,
        );
      assertEquals(await value("instant"), "2026-10-18T06:20:30.123");
      assertEquals(await value("mirror"), "2026-10-18T06:20:30.123");
      assertEquals(await value("offset"), "2026-10-18T06:20:30.123");
      assertEquals(await value("local"), "2026-10-18T08:00");
      const edit = (id: string, value: string) =>
        page.evaluate(`(() => {
          const input = document.querySelector('[data-element-id=${id}] input');
          input.value = ${JSON.stringify(value)};
          input.dispatchEvent(new Event('input', { bubbles: true }));
        })()`);
      await edit("instant", "");
      assertEquals(await value("mirror"), "");
      await edit("instant", "2026-10-18T07:10:11.456");
      assertEquals(await value("mirror"), "2026-10-18T07:10:11.456");
      await edit("local", "2026-10-19T08:00");
      assertEquals(
        await page.evaluate(
          "document.querySelector('[data-element-id=instant] input').validity.valid",
        ),
        true,
      );
      await page.evaluate(
        "document.querySelector('[data-element-id=save]').click()",
      );
      await wait("[data-element-id=done]");
    },
    serve: () => Promise.resolve(undefined),
    close: () => Promise.resolve(),
  };
}
