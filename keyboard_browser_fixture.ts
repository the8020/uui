import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  callScreen,
  field,
  Model,
  presentModal,
  type ScreenEvent,
  z,
} from "./mod.ts";
import { buildControls, buildFieldCatalog } from "./fields.ts";
import { type KeyboardShortcut, validateShortcut } from "./protocol.ts";
import type { LayoutDeclaration } from "./layout.ts";

interface Browser {
  evaluate<T>(expression: string): Promise<T>;
  command(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

export default function fixture() {
  const model = new Model({
    value: "",
    plain: "",
    multiline: "",
    choice: false,
  });
  const events: ScreenEvent[] = [];
  const keys = Array.from(
    { length: 8 },
    (_, i) => `F${i + 5}` as KeyboardShortcut["key"],
  );
  const actions = keys.flatMap((key) =>
    Array.from({ length: 8 }, (_, mask) => ({
      id: `${key}-${mask}`,
      label: `${key} ${mask}`,
      shortcut: {
        key,
        control: Boolean(mask & 1),
        alt: Boolean(mask & 2),
        shift: Boolean(mask & 4),
      },
    }))
  );
  const schema = z.object({
    value: field(z.string(), {
      enterEvent: "save-draft",
      shortcut: { key: "F5" },
    }),
    plain: z.string(),
    multiline: field(z.string(), { control: "textarea", enterEvent: "submit" }),
    choice: field(z.boolean(), { shortcut: { key: "F6" } }),
  });
  const listSchema = z.object({
    plain: z.string(),
    rows: field(z.array(z.object({ name: z.string() })), {
      shortcut: { key: "F10" },
    }),
  });
  const listLayout: LayoutDeclaration = {
    schema: 1,
    id: "lists",
    root: {
      type: "stack",
      children: [
        { type: "detail", controls: ["plain"] },
        { id: "rows-list", type: "list", bind: "rows" },
      ],
    },
  };
  const wait = async (
    check: () => Promise<boolean> | boolean,
    label: string,
  ) => {
    const end = Date.now() + 5000;
    while (!await check()) {
      if (Date.now() > end) throw new Error(label);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
  return {
    async run() {
      for (const key of ["F1", "F2", "F3", "F4", "F13"]) {
        assertThrows(() => validateShortcut({ key, shift: true }));
        assertThrows(() =>
          field(z.string(), { shortcut: { key } as KeyboardShortcut })
        );
        assertThrows(() =>
          buildControls(buildFieldCatalog(schema), [{
            bind: "value",
            shortcut: { key } as KeyboardShortcut,
          }])
        );
        await assertRejects(() =>
          callScreen({
            id: "invalid",
            model,
            schema,
            actions: [{
              label: "Invalid",
              shortcut: { key } as KeyboardShortcut,
            }],
          })
        );
      }
      assertThrows(() =>
        field(z.string(), { enterEvent: true as unknown as string })
      );
      for (const enterEvent of ["", " ", "back", "uui.account"]) {
        assertThrows(() => field(z.string(), { enterEvent }));
      }
      assertThrows(() => validateShortcut({ key: "F5", shift: "true" }));
      await assertRejects(
        () =>
          callScreen({
            id: "collision",
            model,
            schema,
            header: {
              actions: [{
                label: "Duplicate",
                shortcut: { key: "F5", shift: false },
              }],
            },
          }),
        TypeError,
        "duplicate screen shortcut",
      );
      while (true) {
        const event = await callScreen({
          id: "keyboard",
          title: "Keyboard fixture",
          model,
          schema,
          actions: [
            { id: "submit", label: "Submit", shortcut: { key: "F7" } },
            { id: "modal", label: "Modal", shortcut: { key: "F8" } },
            { id: "lists", label: "Lists" },
          ],
          header: {
            actions: [{
              id: "header",
              label: "Header",
              shortcut: { key: "F9", control: true, alt: true, shift: true },
            }],
          },
        });
        events.push(event);
        if (event.action === "lists") {
          for (const explicit of [false, true]) {
            await callScreen({
              id: "list-keyboard",
              title: explicit ? "Explicit list" : "Implicit list",
              model: new Model({
                plain: "",
                rows: [{ name: "Avery" }, { name: "Blair" }],
              }),
              schema: listSchema,
              layout: explicit ? listLayout : undefined,
              actions: [{ id: "next", label: "Next" }],
            });
          }
        }
        if (event.action === "modal") {
          const modalEvent = await presentModal(() =>
            callScreen({
              id: "modal",
              title: "Shortcut modal",
              model: new Model({}),
              schema: z.object({}),
              actions,
            })
          );
          events.push(modalEvent);
        }
      }
    },
    async verify(page: Browser) {
      const ready = () =>
        wait(
          () =>
            page.evaluate<boolean>(
              `!!document.querySelector('[data-bind=value]') && !document.querySelector('#screen-back')?.disabled`,
            ),
          "screen ready",
        );
      const settled = (count: number) =>
        wait(
          async () =>
            events.length === count &&
            await page.evaluate<boolean>(
              `!document.querySelector('#screen-back')?.disabled`,
            ),
          "event roundtrip",
        );
      const focus = (bind: string) =>
        page.evaluate(`document.querySelector('[data-bind=${bind}]').focus()`);
      const key = async (key: string, modifiers = 0) => {
        for (const type of ["keyDown", "keyUp"]) {
          await page.command("Input.dispatchKeyEvent", {
            type,
            key,
            code: key,
            windowsVirtualKeyCode: key === "Enter"
              ? 13
              : 111 + Number(key.slice(1)),
            modifiers,
            ...(key === "Enter" && type === "keyDown" ? { text: "\r" } : {}),
          });
        }
      };
      const synthetic = (key: string, options: Record<string, unknown> = {}) =>
        page.evaluate<boolean>(
          `document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key:${
            JSON.stringify(key)
          }, bubbles:true, cancelable:true, ...${JSON.stringify(options)}}))`,
        );
      await ready();
      await focus("plain");
      assertEquals(await synthetic("Enter"), true);
      await focus("multiline");
      assertEquals(await synthetic("Enter"), true);
      await key("Enter");
      assertEquals(
        await page.evaluate(
          `JSON.stringify(document.querySelector('textarea').value)`,
        ),
        JSON.stringify("\n"),
      );
      await focus("value");
      for (
        const options of [
          { isComposing: true },
          { ctrlKey: true },
          { shiftKey: true },
          { altKey: true },
          { metaKey: true },
        ]
      ) assertEquals(await synthetic("Enter", options), true);
      assertEquals(await synthetic("Enter", { repeat: true }), false);
      assertEquals(events.length, 0);
      await page.evaluate(
        `(() => { const input=document.querySelector('[data-bind=value]'); input.value='current draft'; input.dispatchEvent(new Event('input',{bubbles:true})); globalThis.oldKeyboardInput=input; })()`,
      );
      await key("Enter");
      await settled(1);
      assertEquals(events[0]?.action, "save-draft");
      assertEquals(events[0]?.eventType, "action");
      assertEquals(
        events[0] && "value" in events[0] ? events[0].value : undefined,
        "current draft",
      );
      assertEquals(model.data.value, "current draft");
      assertEquals(model.data.multiline, "\n");
      assertEquals(await page.evaluate(`oldKeyboardInput.isConnected`), false);
      await page.evaluate(
        `oldKeyboardInput.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))`,
      );
      await focus("plain");
      await key("F5");
      assertEquals(
        await page.evaluate(`document.activeElement.dataset.bind`),
        "value",
      );
      await key("F6");
      assertEquals(
        await page.evaluate(`document.activeElement.dataset.bind`),
        "choice",
      );
      assertEquals(model.data.choice, false);
      assertEquals(await synthetic("F5", { shiftKey: true }), true);
      for (const attribute of ["disabled", "hidden", "inert"]) {
        await page.evaluate(
          `document.querySelector('[data-bind=value]').setAttribute('${attribute}','')`,
        );
        assertEquals(await synthetic("F5"), true);
        await page.evaluate(
          `document.querySelector('[data-bind=value]').removeAttribute('${attribute}')`,
        );
      }
      await page.evaluate(
        `document.activeElement.addEventListener('keydown', event => event.preventDefault(), {once:true})`,
      );
      await synthetic("F7");
      assertEquals(events.length, 1);
      assertEquals(await synthetic("F7", { repeat: true }), false);
      await key("F7");
      await settled(2);
      assertEquals(events[1]?.action, "submit");
      await key("F9", 1 | 2 | 8);
      await settled(3);
      assertEquals(events[2]?.action, "header");
      // Exercise every allowed combination through the actual rendered screen contract.
      for (const action of actions) {
        await key("F8");
        await wait(
          () =>
            page.evaluate<boolean>(
              `document.querySelector('dialog:modal .screen-title')?.textContent==='Shortcut modal' && !document.querySelector('dialog:modal [inert]')`,
            ),
          "modal ready",
        );
        const before = events.length;
        const s = action.shortcut;
        assertEquals(
          await synthetic(s.key, {
            ctrlKey: s.control,
            altKey: s.alt,
            shiftKey: s.shift,
          }),
          false,
        );
        await settled(before + 1);
        assertEquals(events.at(-1)?.action, action.id);
        await wait(
          () =>
            page.evaluate<boolean>(`!document.querySelector('dialog:modal')`),
          "modal closed",
        );
      }
      // A shell-owned native modal excludes screen shortcuts entirely.
      await page.evaluate(
        `const dialog=document.createElement('dialog'); dialog.id='keyboard-native'; dialog.innerHTML='<input>'; document.body.append(dialog); dialog.showModal()`,
      );
      const count = events.length;
      assertEquals(await synthetic("F7"), true);
      await page.evaluate(
        `document.querySelector('#keyboard-native').close(); document.querySelector('#keyboard-native').remove()`,
      );
      assertEquals(events.length, count);
      await ready();
      await page.evaluate(
        `document.querySelector('[data-element-id=lists]').click()`,
      );
      for (const title of ["Implicit list", "Explicit list"]) {
        await wait(
          () =>
            page.evaluate<boolean>(
              `document.querySelector('.screen-title')?.textContent === '${title}' && !document.querySelector('#screen-back').disabled && document.querySelectorAll('.data-list tbody tr[data-row-index]').length === 2`,
            ),
          `${title} ready`,
        );
        await focus("plain");
        await key("F10");
        assertEquals(
          await page.evaluate(`({
            bindings: document.querySelectorAll('[data-shortcut=F10]').length,
            focusedList: !!document.activeElement.closest('.layout-list'),
            aria: document.querySelector('[data-shortcut=F10]').getAttribute('aria-keyshortcuts'),
          })`),
          { bindings: 1, focusedList: true, aria: "F10" },
        );
        await page.evaluate(
          `document.querySelector('[data-element-id=next]').click()`,
        );
      }
      await ready();
      console.log(
        "Keyboard schema, native Chromium input, all shortcut modifiers, active modal scope, implicit/explicit list focus, and backend submit checks passed",
      );
    },
    serve: () => Promise.resolve(undefined),
    close: () => Promise.resolve(),
  };
}
