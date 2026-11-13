import { assert, assertEquals } from "@std/assert";
import { callScreen, field, Model, z } from "./mod.ts";

interface Browser {
  evaluate<T>(expression: string): Promise<T>;
  command(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

const Row = z.object({
  channel: field(z.string(), { label: "Channel" }),
  state: field(z.string(), { label: "State" }),
  reference: field(z.string(), { label: "Reference" }),
});

/** Dragging a heading edge resizes its column and survives a redraw. */
export default function fixture() {
  const model = new Model({
    rows: Array.from({ length: 3 }, (_, index) => ({
      channel: "SK",
      state: "CONFIRMED",
      reference: `ref-${index}`,
    })),
  });
  const screen = () =>
    callScreen({
      id: "column-resize",
      title: "Column resize",
      schema: z.object({ rows: z.array(Row) }),
      model,
      layout: {
        schema: 1,
        id: "column-resize",
        root: {
          type: "list",
          id: "rows",
          bind: "rows",
          key: "reference",
          display: ["channel", "state", "reference"],
          toolbar: [{ id: "redraw", label: "Redraw" }, {
            id: "done",
            label: "Done",
          }],
        },
      },
    });
  return {
    async run() {
      while ((await screen()).action === "redraw");
    },
    async verify(page: Browser) {
      const wait = async (expression: string) => {
        const deadline = Date.now() + 5000;
        while (!await page.evaluate<boolean>(expression)) {
          if (Date.now() > deadline) {
            throw new Error(`Timed out: ${expression}`);
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      };
      const widths = () =>
        page.evaluate<number[]>(
          "[...document.querySelectorAll('.data-list th[data-column-id]')].map((cell) => Math.round(cell.getBoundingClientRect().width))",
        );
      const mouse = (type: string, x: number, y: number, clickCount = 1) =>
        page.command("Input.dispatchMouseEvent", {
          type,
          x,
          y,
          button: "left",
          buttons: type === "mouseReleased" ? 0 : 1,
          clickCount,
        });
      await wait("!!document.querySelector('.data-list-column-resizer')");
      await new Promise((resolve) => setTimeout(resolve, 200));
      const before = await widths();
      const handle = await page.evaluate<{ x: number; y: number }>(
        "(() => { const r = document.querySelectorAll('.data-list-column-resizer')[0].getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()",
      );
      await mouse("mousePressed", handle.x, handle.y);
      for (let step = 1; step <= 5; step++) {
        await mouse("mouseMoved", handle.x + step * 20, handle.y);
      }
      await mouse("mouseReleased", handle.x + 100, handle.y);
      await new Promise((resolve) => setTimeout(resolve, 200));
      const dragged = await widths();
      assertEquals(dragged[0], before[0]! + 100);
      // The other columns share the rest of the width, so the total is kept.
      assert(
        Math.abs(
          dragged.reduce((a, b) => a + b, 0) -
            before.reduce((a, b) => a + b, 0),
        ) <= 2,
        `total width kept: ${before} -> ${dragged}`,
      );
      // Dragging never opened the column menu.
      assertEquals(
        await page.evaluate(
          "!!document.querySelector('.data-list-popover:popover-open')",
        ),
        false,
      );
      // The width is element state and survives a redraw by the program.
      await page.evaluate(
        "document.querySelector('[data-element-id=redraw]').click()",
      );
      await new Promise((resolve) => setTimeout(resolve, 400));
      await wait("!!document.querySelector('.data-list-column-resizer')");
      assertEquals((await widths())[0], dragged[0]);
      // Double-click resets the column.
      await mouse("mousePressed", handle.x + 100, handle.y, 1);
      await mouse("mouseReleased", handle.x + 100, handle.y, 1);
      await mouse("mousePressed", handle.x + 100, handle.y, 2);
      await mouse("mouseReleased", handle.x + 100, handle.y, 2);
      await new Promise((resolve) => setTimeout(resolve, 200));
      assertEquals((await widths())[0], before[0]);
      await page.evaluate(
        "document.querySelector('[data-element-id=done]').click()",
      );
    },
    serve: () => Promise.resolve(undefined),
    close: () => Promise.resolve(),
  };
}
