import {
  BACK_EVENT,
  callScreen,
  field,
  Model,
  presentModal,
  presentPage,
  ScreenChannel,
  type ScreenEvent,
  type UUIClientMessage,
  z,
} from "./mod.ts";

interface BrowserDriver {
  evaluate<T>(expression: string): Promise<T>;
  command<T = Record<string, unknown>>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T>;
}
const Row = z.object({
  id: z.number(),
  name: z.string(),
  amount: z.number(),
  active: z.boolean(),
  created: z.string(),
  navigation: z.string(),
});
const Schema = z.object({
  note: field(z.string(), { label: "Note" }),
  records: z.array(Row),
});
const records = Array.from({ length: 250 }, (_, id) => ({
  id,
  name: `Record ${String(id).padStart(3, "0")} — ${
    "Complete descriptive text ".repeat(5)
  }`,
  amount: id % 17,
  active: id % 2 === 0,
  created: `2026-09-${String(id % 28 + 1).padStart(2, "0")}`,
  navigation: `hidden-navigation-${id}`,
}));
export const listBrowserProbe = {
  model: new Model({ note: "Initial note", records }),
  channel: new ScreenChannel(),
  messages: [] as UUIClientMessage[],
  events: [] as ScreenEvent[],
  redraws: 0,
};

export async function runListsProgram(): Promise<void> {
  const { model, channel } = listBrowserProbe;
  while (true) {
    const event = await callScreen({
      id: "list-browser",
      title: "List browser",
      schema: Schema,
      model,
      channel,
      layout: {
        schema: 1,
        id: "lists",
        root: {
          type: "stack",
          children: [
            { type: "field-group", title: "Context", controls: ["note"] },
            {
              id: "primary",
              type: "list",
              title: "Primary list",
              bind: "records",
              key: "id",
              display: ["id", "name", "amount", "active", "created"],
              columnOptions: {
                id: {
                  heading: "Original record number",
                  shortHeading: "#",
                  length: "compact",
                },
                name: {
                  heading: "Descriptive record name",
                  shortHeading: "Name",
                  length: "long",
                },
                amount: {
                  heading: "Total number of available items",
                  shortHeading: "N",
                  length: "compact",
                },
                active: { shortHeading: "Y/N", length: "compact" },
                created: { semanticType: "date", length: "short" },
              },
            },
            {
              id: "secondary",
              type: "list",
              title: "Independent list",
              bind: "records",
              key: "id",
              display: ["id", "name"],
              triggerFilterEvents: true,
            },
            {
              type: "tabs",
              children: [
                { type: "section", title: "Overview" },
                {
                  type: "section",
                  title: "Delayed list",
                  children: [
                    {
                      id: "delayed",
                      type: "list",
                      bind: "records",
                      display: ["id", "name"],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
      header: {
        actions: [{ id: "refresh", label: "Refresh" }, {
          id: "modal",
          label: "Modal list",
        }, { id: "page", label: "Nested page" }],
      },
    });
    listBrowserProbe.events.push(event);
    if (event.action === "select") await leaf("Selected row");
    if (event.action === "refresh") {
      model.data = structuredClone(model.data);
      await delay(350);
    }
    if (event.action === "modal") await presentModal(modalList);
    if (event.action === "page") {
      await presentPage(async () => {
        const nestedModel = new Model({
          note: "Nested page",
          records: structuredClone(records),
        });
        while (true) {
          const event = await callScreen({
            id: "nested",
            title: "Nested page",
            schema: Schema,
            model: nestedModel,
            header: { actions: [{ id: "modal", label: "Modal list" }] },
          });
          if (event.action === BACK_EVENT) return;
          if (event.action === "modal") await presentModal(modalList);
        }
      });
    }
  }
}
async function leaf(title: string): Promise<void> {
  await callScreen({
    id: "leaf",
    title,
    schema: z.object({ value: z.string() }),
    model: new Model({ value: title }),
  });
}
async function modalList(): Promise<void> {
  const model = new Model({ records: structuredClone(records) });
  while (true) {
    const event = await callScreen({
      id: "modal-list",
      title: "Modal list",
      schema: z.object({ records: z.array(Row) }),
      model,
      layout: {
        schema: 1,
        id: "modal-layout",
        root: {
          id: "modal-records",
          type: "list",
          bind: "records",
          display: ["id", "name", "amount"],
        },
      },
    });
    if (event.action === BACK_EVENT) return;
  }
}

export async function verifyListsFlow(
  page: BrowserDriver,
  reconnect: () => void,
): Promise<void> {
  const primary = '[data-list-id="primary"]';
  const secondary = '[data-list-id="secondary"]';
  const state = () => listBrowserProbe.model.screen.elements.primary!.list!;
  const idle = () =>
    wait(
      page,
      `document.querySelector('.screen-title')?.textContent === 'List browser' && !document.documentElement.hasAttribute('data-interaction-pending') && !document.querySelector('dialog.presentation-modal[open]') && !document.querySelector('.presentation-page-layer:not([hidden])')?.inert && document.querySelector('${primary} tbody tr')`,
      "interactive list",
    );
  await page.command("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 960,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await until(() => state()?.measured === true, "initial capacity");
  await idle();
  await delay(120);
  const desktopCapacity = state().pageSize;
  assert(
    desktopCapacity > 3 && desktopCapacity < 25,
    `measured desktop capacity ${desktopCapacity}`,
  );
  await geometry(page, primary);
  await screenshot(page, "desktop");
  assert(
    listBrowserProbe.model.screen.elements.delayed!.list!.measured === false,
    "hidden list waits for visibility",
  );
  const original = JSON.stringify(listBrowserProbe.model.data.records);

  // Real page controls, mapped selection, direct same-surface return, and data replacement.
  await click(page, `${primary} button[aria-label="Page 3"]`);
  await idle();
  await click(page, `${primary} button[aria-label="Page 5"]`);
  await until(() => state().page === 5, "page five");
  await idle();
  const offset = (state().page - 1) * state().pageSize;
  await page.evaluate("scrollTo({ top: 260, behavior: 'instant' })");
  const scrollBefore = await page.evaluate<number>("scrollY");
  await click(page, `${primary} tr[data-row-index="2"]`);
  await wait(
    page,
    "document.querySelector('.screen-title')?.textContent === 'Selected row'",
    "selected row screen",
  );
  assert(
    await page.evaluate<number>("scrollY") === 0,
    "new instance starts at the top",
  );
  const selection = listBrowserProbe.events.at(-1)!;
  assert(
    selection.eventType === "select" && selection.value === offset + 2,
    "selection resolves source row",
  );
  await click(page, "#screen-back");
  await idle();
  assert(state().page === 5, "page five survives selection return");
  assert(
    Math.abs(await page.evaluate<number>("scrollY") - scrollBefore) < 2,
    "same-surface scroll restored",
  );
  const oldData = listBrowserProbe.model.data;
  await button(page, "Refresh");
  await idle();
  assert(
    listBrowserProbe.model.data !== oldData && state().page === 5,
    "refresh preserves page and replaces data",
  );

  // No scrolling-only traffic, including background redraw and horizontal scrolling.
  await delay(160);
  const count = interactions();
  await page.evaluate("scrollTo({ top: 340, behavior: 'instant' })");
  const localScroll = await page.evaluate<number>("scrollY");
  await delay(350);
  assert(interactions() === count, "scroll sends no independent interaction");
  listBrowserProbe.channel.redraw();
  await delay(160);
  assert(
    Math.abs(await page.evaluate<number>("scrollY") - localScroll) < 2,
    "redraw retains unsynchronized scroll",
  );
  assert(
    interactions() === count,
    "redraw does not trigger repeated capacity updates",
  );

  // Search coalescing, dirty edits, no-match recovery, focus, caret, and toolbar state.
  await click(page, `${primary} [aria-label="List tools"]`);
  await idle();
  await input(page, '[data-bind="note"]', "Saved with search");
  const eventCount = listBrowserProbe.events.length;
  await input(page, `${primary} input[type="search"]`, "not");
  await input(page, `${primary} input[type="search"]`, "not found");
  await page.evaluate(
    `(() => { const input=document.querySelector('${primary} input[type="search"]'); input.focus(); input.setSelectionRange(2, 5); })()`,
  );
  await until(() => state().query.search === "not found", "coalesced search");
  await idle();
  assert(
    listBrowserProbe.events.length === eventCount,
    "default queries stay inside callScreen",
  );
  assert(
    listBrowserProbe.model.data.note === "Saved with search",
    "dirty data merged before query",
  );
  assert(state().page === 1, "search resets page");
  assert(
    await page.evaluate<string>(
      `document.querySelector('${primary} .data-list-page-summary').textContent`,
    ) === "0–0 of 0 (filtered, total 250)",
    "empty counts",
  );
  assert(
    await page.evaluate<boolean>(
      `(() => { const e=document.activeElement; return e?.matches('${primary} input[type="search"]') && e.selectionStart===2 && e.selectionEnd===5; })()`,
    ),
    "search focus and caret survive query",
  );
  assert(
    await page.evaluate<boolean>(
      `document.querySelector('${primary} thead') !== null && !document.querySelector('${primary} .data-list-toolbar').hidden`,
    ),
    "empty query keeps controls open",
  );
  await input(page, `${primary} input[type="search"]`, "hidden-navigation");
  await until(
    () => state().query.search === "hidden-navigation",
    "hidden value search",
  );
  await idle();
  assert(
    await page.evaluate<boolean>(
      `document.querySelector('${primary} .data-list-empty') !== null`,
    ),
    "search excludes navigation metadata",
  );
  await input(page, `${primary} input[type="search"]`, "");
  await until(() => state().query.search === "", "clear search");
  await idle();
  await input(page, `${primary} input[type="search"]`, "Record 00");
  await button(page, "Refresh");
  await until(
    () => state().query.search === "Record 00",
    "draft query resumes after a pending action",
  );
  await idle();
  await input(page, `${primary} input[type="search"]`, "");
  await until(() => state().query.search === "", "clear resumed query");
  await idle();

  // Keyboard header popover, numeric comparisons, sort arrows, and fixed-size rows.
  await click(page, `${primary} th:nth-child(3) button`);
  await input(page, `${primary} .data-list-popover input`, ">= 10");
  await until(() => state().query.filters.amount === ">= 10", "numeric filter");
  await idle();
  await delay(60);
  assert(
    await page.evaluate<boolean>(
      `document.activeElement?.matches('${primary} .data-list-popover input') === true`,
    ),
    "filter input remains focused and open",
  );
  await button(page, "Descending", `${primary} .data-list-popover`);
  await until(
    () => state().query.sort?.direction === "desc",
    "descending sort",
  );
  await idle();
  assert(
    await page.evaluate<boolean>(
      `document.querySelector('${primary} th:nth-child(3)').getAttribute('aria-sort') === 'descending' && document.querySelector('${primary} th:nth-child(3) .material-icon') !== null`,
    ),
    "sort/filter indicators",
  );
  await escape(page);
  await delay(60);
  assert(
    await page.evaluate<boolean>(
      `document.querySelector('${primary} .data-list-popover:popover-open') === null`,
    ),
    "Escape closes only the list popover",
  );
  assert(
    JSON.stringify(listBrowserProbe.model.data.records) === original,
    "query operations preserve source collection",
  );
  assert(
    listBrowserProbe.model.screen.elements.secondary!.list!.query.filters
      .amount === undefined,
    "duplicate binding has independent query",
  );
  await geometry(page, primary);

  // Optional query events carry the complete query and retain the wrapper on return.
  await click(page, `${secondary} [aria-label="List tools"]`);
  await idle();
  await input(page, `${secondary} input[type="search"]`, "Record 00");
  await until(
    () =>
      listBrowserProbe.events.some((e) =>
        e.eventType === "list-query" && e.listId === "secondary" &&
        e.query.search === "Record 00"
      ),
    "opt-in query event",
  );
  await idle();
  assert(
    state().query.filters.amount === ">= 10",
    "another list's event preserves primary query",
  );

  // Narrow viewport: overflow, short headings, complete values, toolbar and scroll retention.
  await page.command("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await delay(250);
  await idle();
  await geometry(page, primary);
  await screenshot(page, "mobile");
  assert(
    await page.evaluate<boolean>(
      "document.documentElement.scrollWidth <= innerWidth",
    ),
    "horizontal overflow stays inside lists",
  );
  assert(
    await page.evaluate<boolean>(
      `(() => { const s=document.querySelector('${primary} .data-list-scroll'); return s.scrollWidth > s.clientWidth && getComputedStyle(s).overscrollBehaviorY === 'auto'; })()`,
    ),
    "horizontal overflow retains vertical scroll chaining",
  );
  assert(
    await page.evaluate<boolean>(
      `document.querySelector('${primary} th:nth-child(3) .data-list-short-heading').hidden === false`,
    ),
    "compact heading uses short variant",
  );
  await page.evaluate(
    `document.querySelector('${primary} .data-list-scroll').scrollLeft = 120`,
  );
  await delay(50);
  listBrowserProbe.channel.redraw();
  await delay(100);
  assert(
    await page.evaluate<number>(
      `document.querySelector('${primary} .data-list-scroll').scrollLeft`,
    ) > 100,
    "horizontal scroll survives redraw",
  );
  await click(page, `${primary} tr[data-row-index="0"] td:nth-child(2)`);
  await wait(
    page,
    `document.querySelector('${primary} .data-list-complete-value')?.textContent?.includes('Complete descriptive text')`,
    "complete truncated value",
  );
  await escape(page);
  await delay(100);
  const stable = interactions();
  await delay(400);
  assert(
    interactions() === stable,
    "measurement settles without feedback traffic",
  );

  // Synchronize, reload, then reconnect: query/toolbar and last-synced scroll are retained.
  await page.evaluate("scrollTo({ top: 140, behavior: 'instant' })");
  await button(page, "Refresh");
  await idle();
  const syncedScroll = listBrowserProbe.model.screen.scroll.y;
  await page.command("Page.reload");
  await idle();
  await delay(160);
  assert(
    Math.abs(await page.evaluate<number>("scrollY") - syncedScroll) < 2,
    "reload restores last-synchronized scroll",
  );
  assert(
    await page.evaluate<boolean>(
      `!document.querySelector('${primary} .data-list-toolbar').hidden`,
    ),
    "reload restores toolbar",
  );
  reconnect();
  await delay(300);
  await idle();
  assert(state().query.filters.amount === ">= 10", "reconnect retains query");

  // Modal and nested page inferred lists use the same capacity and identity path.
  await page.command("Emulation.setDeviceMetricsOverride", {
    width: 1100,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await delay(200);
  await idle();
  await button(page, "Modal list");
  await wait(
    page,
    "document.querySelector('dialog[open] [data-list-id=" + '"modal-records"' +
      "] tbody tr:nth-child(2)') !== null",
    "modal capacity",
  );
  await geometry(page, 'dialog[open] [data-list-id="modal-records"]');
  assert(
    await page.evaluate<boolean>(
      "(() => { const d=document.querySelector('dialog[open]'); return d.getBoundingClientRect().bottom <= innerHeight; })()",
    ),
    "modal stays inside viewport",
  );
  await escape(page);
  await idle();
  await button(page, "Nested page");
  await wait(
    page,
    "document.querySelector('.presentation-page-layer:not([hidden]) .screen-title')?.textContent === 'Nested page' && document.querySelector('[data-list-id] tbody tr:nth-child(2)') !== null",
    "inferred nested list",
  );
  await button(page, "Modal list");
  await wait(
    page,
    "document.querySelector('dialog[open]') !== null",
    "nested modal",
  );
  assert(
    await page.evaluate<boolean>(
      "(() => { const ids=[...document.querySelectorAll('[id]')].map(e=>e.id); return new Set(ids).size===ids.length; })()",
    ),
    "simultaneous screens have unique DOM IDs",
  );
  await escape(page);
  await delay(80);
  await click(page, "#screen-back");
  await idle();
  assert(
    state().query.filters.amount === ">= 10",
    "nested return retains original model state",
  );
  await button(page, "Delayed list");
  await until(
    () => listBrowserProbe.model.screen.elements.delayed!.list!.measured,
    "revealed list capacity",
  );
  await idle();
  await geometry(page, '[data-list-id="delayed"]');
  listBrowserProbe.model.resetScreen();
  listBrowserProbe.channel.redraw();
  await until(
    () =>
      listBrowserProbe.model.screen.elements.primary?.list?.measured === true,
    "reset measurement",
  );
  await idle();
  assert(
    state().page === 1 && state().query.sort === null,
    "explicit reset clears list state",
  );
  assert(
    await page.evaluate<number>("scrollY") === 0,
    "explicit reset starts at the top",
  );
  assert(
    await page.evaluate<boolean>(
      `document.querySelector('${primary} .data-list-toolbar').hidden`,
    ),
    "explicit reset closes tools",
  );
}

async function screenshot(page: BrowserDriver, name: string): Promise<void> {
  if (!Deno.args.includes("--screenshots")) return;
  const { data } = await page.command<{ data: string }>(
    "Page.captureScreenshot",
    { format: "png" },
  );
  await Deno.writeFile(
    `/tmp/uui-lists-${name}.png`,
    Uint8Array.from(atob(data), (value) => value.charCodeAt(0)),
  );
}

function interactions(): number {
  return listBrowserProbe.messages.filter((m) =>
    m.type === "screen.event" || m.type === "screen.list"
  ).length;
}
async function geometry(page: BrowserDriver, selector: string): Promise<void> {
  const result = await page.evaluate<
    { heights: number[]; wraps: string[]; table: number; host: number }
  >(`(() => { const h=document.querySelector(${
    JSON.stringify(selector)
  }); return { heights:[...h.querySelectorAll('tbody tr[data-row-index]')].map(r=>r.getBoundingClientRect().height), wraps:[...h.querySelectorAll('.data-list-cell-text')].map(c=>getComputedStyle(c).whiteSpace), table:h.querySelector('table').getBoundingClientRect().width, host:h.clientWidth }; })()`);
  assert(
    result.heights.length > 0 &&
      result.heights.every((h) => Math.abs(h - 36) < 1),
    `fixed row heights: ${JSON.stringify(result)}`,
  );
  assert(result.wraps.every((value) => value === "nowrap"), "rows do not wrap");
}
async function input(
  page: BrowserDriver,
  selector: string,
  value: string,
): Promise<void> {
  assert(
    await page.evaluate<boolean>(
      `(() => { const input=document.querySelector(${
        JSON.stringify(selector)
      }); if (!(input instanceof HTMLInputElement)) return false; input.focus({preventScroll:true}); input.value=${
        JSON.stringify(value)
      }; input.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`,
    ),
    `input ${selector}`,
  );
}
async function click(page: BrowserDriver, selector: string): Promise<void> {
  assert(
    await page.evaluate<boolean>(
      `(() => { const e=document.querySelector(${
        JSON.stringify(selector)
      }); if (!(e instanceof HTMLElement)) return false; e.click(); return true; })()`,
    ),
    `click ${selector}`,
  );
}
async function button(
  page: BrowserDriver,
  label: string,
  root = "body",
): Promise<void> {
  assert(
    await page.evaluate<boolean>(
      `(() => { const b=[...document.querySelectorAll(${
        JSON.stringify(root + " button")
      })].find(e=>!e.closest('[hidden]') && (e.textContent.trim()===${
        JSON.stringify(label)
      } || e.getAttribute('aria-label')===${
        JSON.stringify(label)
      })); if (!b) return false; b.click(); return true; })()`,
    ),
    `button ${label}`,
  );
}
async function escape(page: BrowserDriver): Promise<void> {
  await page.command("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await page.command("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
}
async function wait(
  page: BrowserDriver,
  expression: string,
  name: string,
): Promise<void> {
  await until(
    () => page.evaluate<boolean>(expression).catch(() => false),
    name,
  );
}
async function until(
  predicate: () => boolean | Promise<boolean>,
  name: string,
): Promise<void> {
  for (let i = 0; i < 150; i++) {
    if (await predicate()) return;
    await delay(40);
  }
  throw new Error(`Timed out: ${name}`);
}
function assert(value: boolean, name: string): asserts value {
  if (!value) throw new Error(name);
}
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
