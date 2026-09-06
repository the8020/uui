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
const records = Array.from({ length: 251 }, (_, id) => ({
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
                created: {
                  semanticType: "date",
                  length: "short",
                  heading: "Original record creation date and time",
                  shortHeading: "Created",
                },
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
  const idle = async () => {
    const ready = () =>
      wait(
        page,
        `document.querySelector('.presentation-page-layer:not([hidden]) .screen-title')?.textContent === 'List browser' && !document.documentElement.hasAttribute('data-interaction-pending') && !document.querySelector('dialog.presentation-modal[open]') && !document.querySelector('.presentation-page-layer:not([hidden])')?.inert && document.querySelector('${primary} tbody tr')`,
        "interactive list",
      );
    await ready();
    await page.evaluate(
      "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
    );
    await ready();
  };
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
  await paginationVisibility(page, primary, true);
  assert(
    desktopCapacity > 3 && desktopCapacity < 25,
    `measured desktop capacity ${desktopCapacity}`,
  );
  await geometry(page, primary);
  await noHorizontalOverflow(page, primary);
  await noHorizontalOverflow(page, secondary);
  await toolsOverlay(page, primary);
  await fullWidthRows(page, primary);
  // Fractional card widths must fit without rounding the table beyond its viewport.
  await page.evaluate(
    `document.querySelector('${secondary}').style.width = '701.75px'`,
  );
  await delay(100);
  await noHorizontalOverflow(page, secondary);
  await page.evaluate(
    `document.querySelector('${secondary}').style.removeProperty('width')`,
  );
  await delay(100);
  await screenshot(page, "desktop");
  assert(
    listBrowserProbe.model.screen.elements.delayed!.list!.measured === false,
    "hidden list waits for visibility",
  );
  const original = JSON.stringify(listBrowserProbe.model.data.records);

  // Source-sized bodies retain the card and footer on a short last page and reload.
  const fullPage = await listFrame(page, primary);
  const lastPage = Math.ceil(records.length / state().pageSize);
  await click(page, `${primary} button[aria-label="Page ${lastPage}"]`);
  await until(() => state().page === lastPage, "last page");
  await idle();
  assert(
    await page.evaluate<number>(
      `document.querySelectorAll('${primary} tr[data-row-index]').length`,
    ) < state().pageSize,
    "last page has fewer rows",
  );
  await sameListFrame(page, primary, fullPage, "last page");
  await page.command("Page.reload");
  await idle();
  await delay(120);
  assert(state().page === lastPage, "reload retains last page");
  await sameListFrame(page, primary, fullPage, "last page after reload");
  await click(page, `${primary} button[aria-label="Page 1"]`);
  await idle();

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
  await pointerClick(page, `${primary} [aria-label="List tools"]`);
  await idle();
  await delay(100);
  await toolbarGeometry(page, primary);
  await toolsOverlay(page, primary);
  await toolActions(page, primary, false, false);
  const expandedFrame = await listFrame(page, primary);
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
    ) === "0–0 of 0 (filtered, total 251)",
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
  await sameListFrame(page, primary, expandedFrame, "empty search");
  await paginationVisibility(page, primary, false);
  await noHorizontalOverflow(page, primary);
  await toolActions(page, primary, false, true);
  await page.command("Page.reload");
  await idle();
  await delay(120);
  await sameListFrame(
    page,
    primary,
    expandedFrame,
    "empty search after reload",
  );
  await button(page, "Clear all filters", primary);
  await until(() => state().query.search === "", "clear all search filters");
  await idle();
  await toolActions(page, primary, false, false);
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

  // Header popovers, numeric comparisons, sort bars, and fixed-size rows.
  await click(page, `${primary} th:nth-child(3) button`);
  await popoverControls(page, primary, false, false);
  await input(page, `${primary} .data-list-popover input`, ">= 10");
  await page.evaluate(
    `document.querySelector('${primary} .data-list-popover input').setSelectionRange(1, 4)`,
  );
  await until(() => state().query.filters.amount === ">= 10", "numeric filter");
  await idle();
  await delay(60);
  assert(
    await page.evaluate<boolean>(
      `(() => { const e=document.activeElement; return e?.matches('${primary} .data-list-popover input') && e.selectionStart === 1 && e.selectionEnd === 4; })()`,
    ),
    "filter input remains focused and open",
  );
  await popoverControls(page, primary, false, true);
  await button(page, "Sort descending", `${primary} .data-list-popover`);
  await until(
    () => state().query.sort?.direction === "desc",
    "descending sort",
  );
  await idle();
  await popoverClosed(page, primary);
  await toolActions(page, primary, true, true);
  assert(
    await page.evaluate<boolean>(
      `document.querySelector('${primary} th:nth-child(3)').getAttribute('aria-sort') === 'descending' && document.querySelector('${primary} th:nth-child(3) .data-list-sort-icon[data-direction="desc"] [data-material-icon="sort"]') !== null`,
    ),
    "sort/filter indicators",
  );
  await click(page, `${primary} th:nth-child(3) button`);
  await popoverControls(page, primary, true, true);
  await screenshot(page, "popover");
  await button(page, "Clear sort", `${primary} .data-list-popover`);
  await until(() => state().query.sort === null, "inline clear sort");
  await idle();
  await popoverClosed(page, primary);
  await toolActions(page, primary, false, true);
  assert(
    state().query.filters.amount === ">= 10",
    "clear sort preserves filter",
  );
  await click(page, `${primary} th:nth-child(3) button`);
  await button(page, "Sort ascending", `${primary} .data-list-popover`);
  await until(() => state().query.sort?.direction === "asc", "ascending sort");
  await idle();
  await popoverClosed(page, primary);
  assert(
    await page.evaluate<boolean>(
      `document.querySelector('${primary} th:nth-child(3) .data-list-sort-icon[data-direction="asc"] [data-material-icon="sort"]') !== null`,
    ),
    "ascending sort bars in header",
  );
  await button(page, "Clear all sorts", primary);
  await until(() => state().query.sort === null, "clear all sorts");
  await idle();
  assert(
    state().query.filters.amount === ">= 10",
    "clear all sorts preserves filters",
  );
  await click(page, `${primary} th:nth-child(3) button`);
  const beforeClear = interactions();
  await typeInput(page, `${primary} .data-list-popover input`, ">= 15");
  await pointerClick(
    page,
    `${primary} .data-list-filter [aria-label="Clear filter"]`,
  );
  await until(
    () => state().query.filters.amount === undefined,
    "inline clear filter",
  );
  await idle();
  assert(
    interactions() === beforeClear + 1,
    "clear filter confirms once without first applying its draft",
  );
  await popoverClosed(page, primary);
  await toolActions(page, primary, false, false);

  // Enter confirms a pending filter; its source total reserves space after reload.
  await click(page, `${primary} th:nth-child(1) button`);
  await input(page, `${primary} .data-list-popover input`, ">= 248");
  await enter(page);
  await until(
    () => state().query.filters.id === ">= 248",
    "Enter applies filter",
  );
  await idle();
  await popoverClosed(page, primary);
  assert(
    await page.evaluate<number>(
      `document.querySelectorAll('${primary} tr[data-row-index]').length`,
    ) === 3,
    "filter shows three rows",
  );
  await sameListFrame(page, primary, expandedFrame, "three filtered rows");
  await paginationVisibility(page, primary, false);
  await page.command("Page.reload");
  await idle();
  await delay(120);
  await sameListFrame(
    page,
    primary,
    expandedFrame,
    "three filtered rows after reload",
  );
  await click(page, `${primary} th:nth-child(3) button`);
  await input(page, `${primary} .data-list-popover input`, ">= 10");
  await enter(page);
  await until(
    () => state().query.filters.amount === ">= 10",
    "second column filter",
  );
  await idle();
  await input(page, `${primary} input[type="search"]`, "Record");
  await until(
    () => state().query.search === "Record",
    "search with column filters",
  );
  await idle();
  await click(page, `${primary} th:nth-child(3) button`);
  await button(page, "Sort descending", `${primary} .data-list-popover`);
  await until(
    () => state().query.sort?.direction === "desc",
    "sort filtered results",
  );
  await idle();
  const beforeClearAll = interactions();
  await typeInput(page, `${primary} input[type="search"]`, "Record 25");
  await pointerClick(
    page,
    `${primary} .data-list-tools-actions [aria-label="Clear all filters"]`,
  );
  await until(
    () =>
      state().query.search === "" &&
      Object.keys(state().query.filters).length === 0,
    "clear all column and search filters",
  );
  await idle();
  assert(
    interactions() === beforeClearAll + 1,
    "clear all filters confirms once without a blur-triggered draft query",
  );
  await toolActions(page, primary, true, false);
  assert(
    state().query.sort?.direction === "desc",
    "clear all filters preserves sort",
  );
  await sameListFrame(page, primary, expandedFrame, "cleared filters");
  await click(page, `${primary} th:nth-child(3) button`);
  await input(page, `${primary} .data-list-popover input`, ">= 10");
  await until(
    () => state().query.filters.amount === ">= 10",
    "restored numeric filter",
  );
  await idle();
  await wait(
    page,
    `document.activeElement?.matches('${primary} .data-list-popover input') === true`,
    "restored filter focus",
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
  await toolsOverlay(page, primary);
  await toolbarGeometry(page, primary);
  await toolActions(page, primary, true, true);
  await click(page, `${primary} th:nth-child(3) button`);
  await popoverControls(page, primary, true, true);
  await escape(page);
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
  await toolsOverlay(page, primary);
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
    "document.querySelector('.presentation-page-layer:not([hidden]) .screen-title')?.textContent === 'Nested page' && document.querySelector('.presentation-page-layer:not([hidden]) [data-list-id] tbody tr:nth-child(2)') !== null && !document.documentElement.hasAttribute('data-interaction-pending')",
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

  // A genuinely small source reserves only its own rows, including after filtering.
  listBrowserProbe.model.data.records = records.slice(0, 7);
  listBrowserProbe.channel.redraw();
  await wait(
    page,
    `document.querySelector('${primary} .data-list-page-summary').textContent === '1–7 of 7'`,
    "small source",
  );
  await idle();
  await click(page, `${primary} [aria-label="List tools"]`);
  await idle();
  await delay(100);
  const smallFrame = await listFrame(page, primary);
  await paginationVisibility(page, primary, false, false);
  assert(
    smallFrame.viewport < expandedFrame.viewport,
    "small sources do not reserve a full page",
  );
  await click(page, `${primary} th:nth-child(1) button`);
  await input(page, `${primary} .data-list-popover input`, ">= 4");
  await enter(page);
  await until(() => state().query.filters.id === ">= 4", "small source filter");
  await idle();
  await sameListFrame(page, primary, smallFrame, "small filtered source");
  await page.command("Page.reload");
  await idle();
  await delay(120);
  await sameListFrame(
    page,
    primary,
    smallFrame,
    "small filtered source after reload",
  );
  await paginationVisibility(page, primary, false, false);

  // At the boundary, the footer must not force an otherwise unnecessary page.
  await button(page, "Clear all filters", primary);
  await until(
    () => state().query.filters.id === undefined,
    "clear small source filter",
  );
  await idle();
  const boundaryRows = state().pageSize;
  listBrowserProbe.model.data.records = records.slice(0, boundaryRows);
  listBrowserProbe.channel.redraw();
  await wait(
    page,
    `document.querySelectorAll('${primary} tbody tr[data-row-index]').length === ${boundaryRows}`,
    "single-page boundary capacity",
  );
  await idle();
  await paginationVisibility(page, primary, false, false);
  const settledInteractions = interactions();
  await delay(250);
  assert(interactions() === settledInteractions, "footer capacity settles");

  listBrowserProbe.model.data.records = [];
  listBrowserProbe.channel.redraw();
  await wait(
    page,
    `document.querySelector('${primary} .data-list-empty')?.textContent === 'No items'`,
    "empty source",
  );
  await idle();
  await paginationVisibility(page, primary, false, false);
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

async function toolsOverlay(
  page: BrowserDriver,
  selector: string,
): Promise<void> {
  const layout = await page.evaluate<
    {
      headerOnly: boolean;
      rightGap: number;
      width: number;
      fitsHeader: boolean;
      padding: string;
    }
  >(`(() => { const h=document.querySelector(${
    JSON.stringify(selector)
  }); const t=h.querySelector('[aria-label="List tools"]'); const r=t.getBoundingClientRect(); const s=h.querySelector('.data-list-scroll').getBoundingClientRect(); const head=h.querySelector('thead').getBoundingClientRect(); return { headerOnly:!t.closest('table'), rightGap:s.right-r.right, width:r.width, fitsHeader:r.top>=head.top && r.bottom<=head.bottom, padding:getComputedStyle(t).padding }; })()`);
  assert(
    layout.headerOnly && Math.abs(layout.rightGap) < 1 && layout.width <= 24 &&
      layout.fitsHeader && layout.padding === "0px",
    `tools overlay uses only the header's right edge: ${
      JSON.stringify(layout)
    }`,
  );
}

async function fullWidthRows(
  page: BrowserDriver,
  selector: string,
): Promise<void> {
  const layout = await page.evaluate<
    {
      columns: number;
      cells: number[];
      dataAtEnd: boolean;
      rightGap: number;
      x: number;
      y: number;
    }
  >(`(() => { const h=document.querySelector(${
    JSON.stringify(selector)
  }); const table=h.querySelector('table'); const rows=[...table.querySelectorAll('tbody tr[data-row-index]')]; const row=rows[0]; const end=row.lastElementChild; const r=row.getBoundingClientRect(); return { columns:table.querySelectorAll('th[data-column-id]').length, cells:rows.map(r=>r.cells.length), dataAtEnd:end.querySelector('.data-list-cell-text')!==null, rightGap:table.getBoundingClientRect().right-end.getBoundingClientRect().right, x:r.right-2, y:r.top+r.height/2 }; })()`);
  assert(
    layout.cells.every((count) => count === layout.columns) &&
      layout.dataAtEnd && Math.abs(layout.rightGap) < 1,
    `rows contain only data columns through the right edge: ${
      JSON.stringify(layout)
    }`,
  );
  await page.command("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: layout.x,
    y: layout.y,
  });
  await delay(150);
  assert(
    await page.evaluate<boolean>(
      `(() => { const row=document.querySelector(${
        JSON.stringify(selector + ' tbody tr[data-row-index="0"]')
      }); const cell=row.lastElementChild; return row.matches(':hover') && cell.contains(document.elementFromPoint(${layout.x},${layout.y})) && getComputedStyle(cell).backgroundColor==='rgba(0, 0, 0, 0)' && getComputedStyle(row).backgroundColor!=='rgba(0, 0, 0, 0)'; })()`,
    ),
    "row highlight reaches the rightmost data cell without an opaque tools strip",
  );
}

interface ListFrame {
  host: number;
  card: number;
  pagination: number;
  viewport: number;
}
function listFrame(page: BrowserDriver, selector: string): Promise<ListFrame> {
  return page.evaluate(
    `(() => { const h=document.querySelector(${
      JSON.stringify(selector)
    }); const scroll=h.querySelector('.data-list-scroll').getBoundingClientRect(); return { host:h.getBoundingClientRect().height, card:h.closest('.layout-list').getBoundingClientRect().height, pagination:scroll.bottom+scrollY, viewport:scroll.height }; })()`,
  );
}
async function paginationVisibility(
  page: BrowserDriver,
  selector: string,
  visible: boolean,
  reservesSpace = true,
): Promise<void> {
  const geometry = await page.evaluate<{ visible: boolean; footer: number }>(
    `(() => { const host=document.querySelector(${
      JSON.stringify(selector)
    }); const footer=host.querySelector('.data-list-pagination'); return { visible:footer.getClientRects().length>0, footer:host.getBoundingClientRect().bottom-host.querySelector('.data-list-scroll').getBoundingClientRect().bottom }; })()`,
  );
  assert(
    geometry.visible === visible,
    "pagination only appears for multiple pages",
  );
  if (!reservesSpace) {
    assert(
      Math.abs(geometry.footer) < 0.5,
      "single-page source has no footer space",
    );
  }
}
async function sameListFrame(
  page: BrowserDriver,
  selector: string,
  expected: ListFrame,
  name: string,
): Promise<void> {
  const actual = await listFrame(page, selector);
  assert(
    Object.keys(expected).every((key) =>
      Math.abs(
        actual[key as keyof ListFrame] - expected[key as keyof ListFrame],
      ) < 1
    ),
    `${name} retains list/card height and pagination position: ${
      JSON.stringify({ expected, actual })
    }`,
  );
}
async function toolbarGeometry(
  page: BrowserDriver,
  selector: string,
): Promise<void> {
  assert(
    await page.evaluate<boolean>(
      `(() => { const h=document.querySelector(${
        JSON.stringify(selector)
      }); const t=h.querySelector('.data-list-toolbar'); const input=t.querySelector('input'); return Math.abs(t.getBoundingClientRect().height-h.querySelector('thead').getBoundingClientRect().height)<1 && getComputedStyle(input).paddingTop==='0px' && getComputedStyle(input).paddingBottom==='0px' && t.scrollWidth<=t.clientWidth; })()`,
    ),
    "toolbar matches column header height without search padding or overflow",
  );
}
async function toolActions(
  page: BrowserDriver,
  selector: string,
  sorts: boolean,
  filters: boolean,
): Promise<void> {
  const actions = await page.evaluate<
    Array<{ label: string; title: string; icon: string; text: string }>
  >(`(() => { const h=document.querySelector(${
    JSON.stringify(selector)
  }); return [...h.querySelectorAll('.data-list-tools-actions button')].map(b=>({label:b.getAttribute('aria-label'),title:b.title,icon:b.querySelector('.material-icon')?.dataset.materialIcon,text:b.textContent})); })()`);
  assert(
    actions.length === Number(sorts) + Number(filters) &&
      actions.every((action) =>
        action.text === "" && action.title === action.label
      ) &&
      actions.some((a) =>
          a.label === "Clear all sorts" && a.icon === "filter_list_off"
        ) === sorts &&
      actions.some((a) =>
          a.label === "Clear all filters" && a.icon === "filter_alt_off"
        ) === filters,
    `conditional icon-only toolbar actions with tooltips: ${
      JSON.stringify(actions)
    }`,
  );
}
async function popoverControls(
  page: BrowserDriver,
  selector: string,
  sorted: boolean,
  filtered: boolean,
): Promise<void> {
  const controls = await page.evaluate<
    {
      row: boolean;
      filter: boolean;
      clearSort: number;
      clearFilter: boolean;
      inline: boolean;
    }
  >(`(() => { const p=document.querySelector(${
    JSON.stringify(selector + " .data-list-popover:popover-open")
  }); const sorts=[...p.querySelectorAll('.data-list-sort-option > button:first-child')]; const input=p.querySelector('input'); const clear=p.querySelector('.data-list-filter button'); const field=input.getBoundingClientRect(); const x=clear.getBoundingClientRect(); return { row:sorts.length===2 && sorts.every(b=>b.textContent==='Sort' && b.querySelector('[data-material-icon="sort"]')) && Math.abs(sorts[0].getBoundingClientRect().top-sorts[1].getBoundingClientRect().top)<1 && sorts[0].getBoundingClientRect().right<=sorts[1].getBoundingClientRect().left, filter:p.querySelector('label')===null && input.placeholder.startsWith('Filter') && input.getAttribute('aria-label').startsWith('Filter'), clearSort:p.querySelectorAll('.data-list-sort-option.is-selected button[aria-label="Clear sort"]').length, clearFilter:!clear.hidden, inline:clear.hidden || (x.left>=field.left && x.right<=field.right && x.top>=field.top && x.bottom<=field.bottom) }; })()`);
  assert(
    controls.row && controls.filter && controls.clearSort === Number(sorted) &&
      controls.clearFilter === filtered && controls.inline,
    `inline popover controls: ${JSON.stringify(controls)}`,
  );
}
async function popoverClosed(
  page: BrowserDriver,
  selector: string,
): Promise<void> {
  assert(
    await page.evaluate<boolean>(
      `document.querySelector(${
        JSON.stringify(selector + " .data-list-popover:popover-open")
      }) === null`,
    ),
    "confirming sort/filter closes the popover",
  );
}
async function enter(page: BrowserDriver): Promise<void> {
  for (const type of ["keyDown", "keyUp"]) {
    await page.command("Input.dispatchKeyEvent", {
      type,
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
    });
  }
}
async function pointerClick(
  page: BrowserDriver,
  selector: string,
): Promise<void> {
  const point = await page.evaluate<{ x: number; y: number }>(
    `(() => { const e=document.querySelector(${
      JSON.stringify(selector)
    }); e.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'}); const r=e.getBoundingClientRect(); const point={ x:(r.left+r.right)/2, y:(r.top+r.bottom)/2 }; if (!e.contains(document.elementFromPoint(point.x,point.y))) throw new Error('Pointer target is covered'); return point; })()`,
  );
  for (const type of ["mousePressed", "mouseReleased"]) {
    await page.command("Input.dispatchMouseEvent", {
      type,
      ...point,
      button: "left",
      clickCount: 1,
    });
  }
}
async function typeInput(
  page: BrowserDriver,
  selector: string,
  value: string,
): Promise<void> {
  await page.evaluate(
    `(() => { const input=document.querySelector(${
      JSON.stringify(selector)
    }); input.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'}); input.focus({preventScroll:true}); input.select(); })()`,
  );
  await page.command("Input.insertText", { text: value });
}
async function noHorizontalOverflow(
  page: BrowserDriver,
  selector: string,
): Promise<void> {
  const widths = await page.evaluate<
    {
      viewport: number;
      content: number;
      table: number;
      available: number;
      headings: number[];
    }
  >(
    `(() => { const s=document.querySelector(${
      JSON.stringify(selector + " .data-list-scroll")
    }); return { viewport:s.clientWidth, content:s.scrollWidth, table:s.querySelector('table').getBoundingClientRect().width, available:s.getBoundingClientRect().width, headings:[...s.querySelectorAll('.data-list-heading-measure')].map(e=>e.getBoundingClientRect().right-s.getBoundingClientRect().left) }; })()`,
  );
  assert(
    widths.content <= widths.viewport && widths.table <= widths.available,
    `fitting columns have no horizontal scrollbar: ${JSON.stringify(widths)}`,
  );
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
