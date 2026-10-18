import { assertEquals, assertThrows } from "@std/assert";
import {
  callScreen,
  fileUpload,
  Model,
  sendMessage,
  z,
} from "../../../../../mod.ts";

interface Browser {
  evaluate<T>(expression: string): Promise<T>;
}

export default function fixture() {
  const model = new Model({ filename: "", result: "" });
  let received: Uint8Array | undefined;
  let round = 0;
  return {
    serve() {
      return Promise.resolve(undefined);
    },
    close() {
      return Promise.resolve();
    },
    async run() {
      while (true) {
        model.data.filename = "";
        const upload = fileUpload({ maximumBytes: 65536, accept: ".pem,.der" });
        const event = await callScreen({
          id: "upload-test",
          title: `Upload ${round}`,
          model,
          schema: z.object({ filename: z.string(), result: z.string() }),
          controls: [
            {
              id: "file",
              bind: "filename",
              label: "Certificate",
              custom: upload.custom,
              fieldHelp: false,
            },
            { id: "result", bind: "result", readOnly: true },
          ],
          header: {
            actions: [
              { id: "save", label: "Save" },
              { id: "cancel", label: "Cancel" },
            ],
          },
        });
        if (event.action === "save") {
          try {
            received = upload.take();
            model.data.result = `${model.data.filename}: ${received.length}`;
            assertThrows(() => upload.take());
          } catch (error) {
            sendMessage((error as Error).message, "error");
          }
        }
        round++;
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
      const ready = (expected = round) =>
        wait(
          `document.querySelector('.screen-title')?.textContent === 'Upload ${expected}' && document.querySelector('input[type=file]') && !document.querySelector('#screen-back').disabled`,
        );
      const select = async (name: string, content: number[]) => {
        await page.evaluate(`(() => {
          const input = document.querySelector('input[type=file]');
          const files = new DataTransfer();
          files.items.add(new File([new Uint8Array(${
          JSON.stringify(content)
        })], ${JSON.stringify(name)}));
          input.files = files.files;
          input.dispatchEvent(new Event('change', { bubbles: true }));
        })()`);
        await wait(`!document.querySelector('input[type=file]')?.disabled`);
      };
      const save = async () => {
        const next = round + 1;
        await page.evaluate(
          `document.querySelector('[data-element-id=save]').click()`,
        );
        await ready(next);
      };
      await ready();
      const secret = Array.from(
        new TextEncoder().encode("PRIVATE FILE CONTENT"),
      );
      await select("certificate.pem", secret);
      assertEquals(
        await page.evaluate(
          `document.body.textContent.includes('PRIVATE FILE CONTENT')`,
        ),
        false,
      );
      await save();
      assertEquals(received, new Uint8Array(secret));
      assertEquals(model.data.result, "certificate.pem: 20");
      assertEquals(
        JSON.stringify(model.data).includes("PRIVATE FILE CONTENT"),
        false,
      );

      // A replacement invalidates the old file even when the replacement fails.
      await select("old.der", [1, 2, 3]);
      await select("oversize.der", Array(65537).fill(42));
      await wait(
        `document.body.textContent.includes('File must not exceed 65536 bytes')`,
      );
      await save();
      await wait(
        `document.body.textContent.includes('Select a file and wait')`,
      );
      assertEquals(received, new Uint8Array(secret));

      await select("valid.der", [0, 255, 128, 1]);
      await save();
      assertEquals(received, new Uint8Array([0, 255, 128, 1]));
      assertEquals(model.data.result, "valid.der: 4");
      await save();
      await wait(
        `document.body.textContent.includes('Select a file and wait')`,
      );
      // Cancelling the screen stops a partial producer without publishing it.
      await page.evaluate(`(() => {
        globalThis.uploadCancelled = false;
        const files = new DataTransfer();
        const file = new File(['partial'], 'partial.pem');
        file.stream = () => new ReadableStream({
          start(controller) { controller.enqueue(new Uint8Array([99])); },
          cancel() { globalThis.uploadCancelled = true; },
        });
        files.items.add(file);
        const input = document.querySelector('input[type=file]');
        input.files = files.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
      await wait(`document.querySelector('input[type=file]')?.disabled`);
      const next = round + 1;
      await page.evaluate(
        `document.querySelector('[data-element-id=cancel]').click()`,
      );
      await ready(next);
      await wait("globalThis.uploadCancelled === true");
      await save();
      await wait(
        `document.body.textContent.includes('Select a file and wait')`,
      );
      assertEquals(received, new Uint8Array([0, 255, 128, 1]));
    },
  };
}
