import { assertEquals } from "@std/assert";
import { callScreen, field, Model, z } from "./mod.ts";

interface Browser {
  evaluate<T>(expression: string): Promise<T>;
}

const status = "[[icon=error color=danger]] missing since 2026-10-23";

/** Read-only values and descriptions render icon placeholders like lists. */
export default function fixture() {
  const model = new Model({
    status,
    notes: `${status}\nsecond line`,
    draft: status,
  });
  const schema = z.object({
    status: field(z.string(), { label: "Status" }),
    notes: field(z.string(), { label: "Notes", control: "textarea" }),
    draft: field(z.string(), { label: "Draft" }),
  });
  const screen = () =>
    callScreen({
      id: "icon-values",
      title: "Icon values",
      description: "Health [[icon=check_circle color=success]] reported",
      schema,
      model,
      controls: [
        { id: "status", bind: "status", readOnly: true },
        { id: "notes", bind: "notes", readOnly: true, rowSpan: 2 },
        { id: "draft", bind: "draft" },
      ],
      actions: [{ id: "clear", label: "Clear" }, { id: "done", label: "Done" }],
    });
  return {
    async run() {
      assertEquals((await screen()).action, "clear");
      model.data.status = "reported";
      assertEquals((await screen()).action, "done");
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
      const field = (id: string) =>
        `document.querySelector('[data-element-id=${id}]')`;
      await wait(`!!${field("status")}`);
      assertEquals(
        await page.evaluate(`(() => {
          const status = ${field("status")};
          const notes = ${field("notes")};
          const draft = ${field("draft")};
          const layer = (host) => host.querySelector('.field-icon-value');
          return {
            statusIcon: layer(status)?.querySelector('.material-icon')?.dataset.materialIcon,
            statusText: layer(status)?.textContent.trim(),
            statusInput: status.querySelector('input').value,
            statusColor: getComputedStyle(status.querySelector('input')).webkitTextFillColor,
            notesIcon: layer(notes)?.querySelector('.material-icon')?.dataset.materialIcon,
            notesInput: notes.querySelector('textarea').value,
            draftLayer: layer(draft) !== null,
            draftInput: draft.querySelector('input').value,
            description: document.querySelector('.screen-description .material-icon')?.dataset.materialIcon,
          };
        })()`),
        {
          statusIcon: "error",
          statusText: "missing since 2026-10-23",
          statusInput: "missing since 2026-10-23",
          statusColor: "rgba(0, 0, 0, 0)",
          notesIcon: "error",
          notesInput: " missing since 2026-10-23\nsecond line",
          draftLayer: false,
          draftInput: status,
          description: "check_circle",
        },
      );
      await page.evaluate(
        "document.querySelector('[data-element-id=clear]').click()",
      );
      await wait(
        `${field("status")}?.querySelector('input').value === 'reported'`,
      );
      assertEquals(
        await page.evaluate(
          `${field("status")}.querySelector('.field-icon-value') === null`,
        ),
        true,
      );
      await page.evaluate(
        "document.querySelector('[data-element-id=done]').click()",
      );
    },
    serve: () => Promise.resolve(undefined),
    close: () => Promise.resolve(),
  };
}
