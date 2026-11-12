import { t } from "../../i18n.ts";
import {
  emptyListQuery,
  initialElementState,
  MAX_LIST_QUERY_LENGTH,
  type ScreenListSnapshot,
} from "../../../../../screen_state.ts";
import {
  emptyLayouts,
  type LayoutCatalog,
  type LayoutCommand,
  type ListLayout,
} from "../../../../../list_layout.ts";
import type {
  ControlDescriptor,
  ScreenAction,
} from "../../../../../protocol.ts";
import {
  disposeFieldMessages,
  type RenderCallbacks,
  renderElements,
  renderScreen,
} from "../../renderer.ts";
import { ResponsiveProgramHeader } from "../../responsive_header.ts";
import { renderIconText } from "../../icon_text.ts";

export interface LayoutCallbacks {
  layout(id: string, layout: ListLayout): boolean;
  layouts(
    id: string,
    command: LayoutCommand,
    signal: AbortSignal,
  ): Promise<LayoutCatalog>;
}

/** A catalog first, then an isolated draft using the ordinary UUI renderer. */
export async function layoutEditor(
  snapshot: ScreenListSnapshot,
  callbacks: LayoutCallbacks,
  body: HTMLElement,
  dialog: HTMLDialogElement,
  signal: AbortSignal,
): Promise<void> {
  const available = snapshot.availableColumns ?? snapshot.columns;
  const current = {
    columns: snapshot.columns.map((column) => column.key),
    query: structuredClone(snapshot.state.query),
  };
  const builtin = {
    columns: available.map((column) => column.key),
    query: structuredClone(snapshot.state.builtInQuery ?? emptyListQuery()),
  };
  let catalog: LayoutCatalog = {
    personal: emptyLayouts(),
    global: emptyLayouts(),
    canManageGlobal: false,
  };
  let detail = false;
  let draft: ListLayout;
  let order: string[];
  let name = "";
  let shared = false;
  let isDefault = false;
  let original: { name: string; global: boolean } | undefined;
  const toolbar = dialog.querySelector<HTMLElement>(".uui-dialog-toolbar")!;
  const heading = toolbar.querySelector<HTMLElement>(".uui-dialog-title")!;
  const header = document.createElement("div");
  header.className = "program-header";
  const visible = document.createElement("div");
  visible.className = "program-header-visible";
  const overflow = document.createElement("details");
  overflow.className = "program-header-overflow";
  const toggle = document.createElement("summary");
  toggle.className = "btn btn-ghost btn-sm program-header-overflow-toggle";
  toggle.setAttribute("aria-label", t("shell.moreListControls"));
  renderIconText(toggle, "[[icon=more_vert]]");
  const items = document.createElement("div");
  items.className = "program-header-overflow-items";
  overflow.append(toggle, items);
  header.append(visible, overflow);
  toolbar.insertBefore(header, toolbar.lastElementChild);
  const responsive = new ResponsiveProgramHeader(
    header,
    visible,
    overflow,
    items,
  );
  const status = dialog.querySelector<HTMLElement>(".data-list-status")!;
  const renderCallbacks: RenderCallbacks = {
    changed(bind, value) {
      if (bind === "name") name = String(value);
      else if (bind === "shared") {
        shared = Boolean(value);
        isDefault =
          catalog[shared ? "global" : "personal"].defaultName === name;
        drawDetail();
        body.querySelector<HTMLInputElement>('[data-bind="shared"]')?.focus();
      } else if (bind === "default") isDefault = Boolean(value);
      else if (bind === "search") {
        draft.query.search = String(value);
      } else {
        const [, position, property] = bind.split(".");
        const key = order[Number(position)]!;
        if (property === "visible") {
          draft.columns = order.filter((column) =>
            column === key ? value : draft.columns.includes(column)
          );
          updateApply();
        } else if (property === "filter") {
          if (value) {
            draft.query.filters[key] = String(value).slice(
              0,
              MAX_LIST_QUERY_LENGTH,
            );
          } else delete draft.query.filters[key];
        } else if (property === "sort") {
          if (value === "") {
            if (draft.query.sort?.column === key) draft.query.sort = null;
          } else {draft.query.sort = {
              column: key,
              direction: value as "asc" | "desc",
            };}
          drawDetail();
          Array.from(body.querySelectorAll<HTMLElement>("[data-bind]")).find((
            field,
          ) => field.dataset.bind === bind)?.focus();
        }
      }
    },
    help() {},
    action(id) {
      if (id === "back" || id === "cancel") drawList();
      else if (id === "new") open(current);
      else if (id === "apply") apply(draft);
      else if (id === "save") execute(save);
      else {
        const [direction, position] = id.split(":");
        const index = Number(position);
        const next = index + (direction === "up" ? -1 : 1);
        if (next < 0 || next >= order.length) return;
        [order[index], order[next]] = [order[next]!, order[index]!];
        draft.columns = order.filter((key) => draft.columns.includes(key));
        drawDetail();
        body.querySelector<HTMLElement>(
          `[data-element-id="${direction}:${next}"]`,
        )?.focus();
      }
    },
    list: () => document.createElement("div"),
    custom: () => document.createElement("div"),
    elementState: initialElementState,
  };
  const actions = (values: ScreenAction[]) => {
    const controls = renderElements(values, {}, renderCallbacks);
    controls.forEach((control) => control.classList.add("program-header-item"));
    responsive.render(controls);
  };
  const execute = (run: () => Promise<void>) => {
    if (body.inert) return;
    body.inert = header.inert = true;
    status.hidden = true;
    void run().catch((error) => {
      if (!signal.aborted) {
        status.textContent = error instanceof Error
          ? error.message
          : String(error);
        status.hidden = false;
      }
    }).finally(() => body.inert = header.inert = false);
  };
  const command = async (value: LayoutCommand) => {
    catalog = await callbacks.layouts(snapshot.id, value, signal);
  };
  const apply = (layout: ListLayout) => {
    if (callbacks.layout(snapshot.id, layout)) dialog.close();
  };
  const updateApply = () => {
    header.querySelectorAll<HTMLButtonElement>(
      '[data-element-id="apply"], [data-element-id="save"]',
    ).forEach((button) => button.disabled = draft.columns.length === 0);
  };
  const save = async () => {
    const trimmed = name.trim();
    await command({
      operation: "save",
      name: trimmed,
      global: shared,
      layout: draft,
    });
    const scope = shared ? "global" : "personal";
    if (isDefault || catalog[scope].defaultName === trimmed) {
      await command({
        operation: "default",
        global: shared,
        name: isDefault ? trimmed : null,
      });
    }
    drawList();
    Array.from(body.querySelectorAll<HTMLElement>("[data-layout-name]")).find((
      row,
    ) =>
      row.dataset.layoutName === trimmed &&
      row.dataset.global === String(shared)
    )?.querySelector<HTMLElement>("button")?.focus();
  };
  const open = (
    layout: ListLayout,
    item?: { name: string; global: boolean },
  ) => {
    detail = true;
    original = item;
    draft = structuredClone(layout);
    order = [
      ...draft.columns,
      ...available.map((column) => column.key).filter((key) =>
        !draft.columns.includes(key)
      ),
    ];
    name = item?.name ?? "";
    shared = !!item?.global && catalog.canManageGlobal;
    isDefault = !!item && item.global === shared &&
      catalog[shared ? "global" : "personal"].defaultName === name;
    drawDetail();
    body.scrollTop = 0;
    body.querySelector<HTMLInputElement>('input[data-bind="name"]')?.focus({
      preventScroll: true,
    });
  };
  const drawDetail = () => {
    detail = true;
    heading.textContent = original
      ? `${original.name} · ${
        t(original.global ? "layouts.shared" : "layouts.personal")
      }`
      : t("shell.new");
    actions([
      { id: "back", label: `[[icon=arrow_back]] ${t("shell.back")}` },
      ...(snapshot.layouts
        ? [{ id: "save", label: t("layouts.save"), kind: "primary" as const }]
        : []),
      {
        id: "apply",
        label: t("layouts.apply"),
        kind: snapshot.layouts ? "secondary" : "primary",
      },
      { id: "cancel", label: t("layouts.cancel") },
    ]);
    const model: Record<string, unknown> = {
      name,
      shared,
      default: isDefault,
      search: draft.query.search,
      columns: {},
    };
    const controls: ControlDescriptor[] = [
      {
        id: "name",
        bind: "name",
        label: t("layouts.name"),
        control: "text",
        length: "long",
        fieldHelp: false,
        required: true,
      },
      {
        id: "shared",
        bind: "shared",
        label: t("layouts.shared"),
        control: "checkbox",
        length: "short",
        fieldHelp: false,
        readOnly: !catalog.canManageGlobal,
      },
      {
        id: "default",
        bind: "default",
        label: t(shared ? "layouts.defaultEveryone" : "layouts.defaultMe"),
        control: "checkbox",
        length: "full",
        fieldHelp: false,
      },
      {
        id: "search",
        bind: "search",
        label: t("shell.searchList"),
        control: "text",
        length: "full",
        fieldHelp: false,
      },
    ];
    const columns = order.map((key, index) => {
      const column = available.find((column) => column.key === key)!;
      const bind = `columns.${index}`;
      (model.columns as Record<string, unknown>)[index] = {
        visible: draft.columns.includes(key),
        filter: draft.query.filters[key] ?? "",
        sort: draft.query.sort?.column === key
          ? draft.query.sort.direction
          : "",
      };
      const fields: ControlDescriptor[] = [
        {
          id: `${bind}.visible`,
          bind: `${bind}.visible`,
          control: "checkbox",
          label: `${t("layouts.visible")}: ${column.heading}`,
          length: "full",
          fieldHelp: false,
        },
        ...(!snapshot.source?.searchOnly
          ? [
            {
              id: `${bind}.filter`,
              bind: `${bind}.filter`,
              control: "text" as const,
              label: t("lists.filter_column", { column: column.heading }),
              length: "full" as const,
              fieldHelp: false,
            },
            {
              id: `${bind}.sort`,
              bind: `${bind}.sort`,
              control: "select" as const,
              label: `${t("lists.sort")}: ${column.heading}`,
              length: "full" as const,
              fieldHelp: false,
              options: [{ value: "", label: t("layouts.noSort") }, {
                value: "asc",
                label: t("lists.ascending"),
              }, { value: "desc", label: t("lists.descending") }],
            },
          ]
          : []),
      ];
      controls.push(...fields);
      return {
        id: `column-${index}`,
        type: "field-group" as const,
        title: column.heading,
        controls: fields.map((field) => field.id),
        elements: [
          {
            id: `up:${index}`,
            label: `[[icon=arrow_upward]] ${
              t("layouts.up")
            }: ${column.heading}`,
            class: index === 0 ? "is-unavailable" : undefined,
          },
          {
            id: `down:${index}`,
            label: `[[icon=arrow_downward]] ${
              t("layouts.down")
            }: ${column.heading}`,
            class: index === order.length - 1 ? "is-unavailable" : undefined,
          },
        ],
      };
    });
    renderScreen(
      body,
      {
        id: "layout-detail",
        title: "",
        controls,
        actions: [],
        customElements: [],
        layout: {
          schema: 1,
          id: "layout-detail",
          root: {
            id: "layout-editor",
            type: "stack",
            children: [
              {
                id: "settings",
                type: "field-group",
                title: t("layouts.title"),
                controls: [
                  ...(snapshot.layouts ? ["name", "shared", "default"] : []),
                  "search",
                ],
              },
              { id: "columns", type: "grid", columns: 2, children: columns },
            ],
          },
        },
      },
      model,
      renderCallbacks,
      { render: () => document.createElement("div") },
    );
    body.querySelector(".screen-title")?.remove();
    body.querySelector<HTMLInputElement>('[data-bind="name"]')?.setAttribute(
      "maxlength",
      "80",
    );
    body.querySelectorAll<HTMLButtonElement>(".is-unavailable").forEach((
      button,
    ) => button.disabled = true);
    for (const input of body.querySelectorAll<HTMLInputElement>("input")) {
      if (input.type !== "checkbox") {
        input.maxLength = input.dataset.bind === "name"
          ? 80
          : MAX_LIST_QUERY_LENGTH;
      }
      input.id = `layout-${snapshot.id}-${input.id}`;
      const label = input.closest(".field")?.querySelector("label");
      if (label) label.htmlFor = input.id;
    }
    for (const input of body.querySelectorAll<HTMLSelectElement>("select")) {
      input.id = `layout-${snapshot.id}-${input.id}`;
      const label = input.closest(".field")?.querySelector("label");
      if (label) label.htmlFor = input.id;
    }
    updateApply();
  };
  const drawList = () => {
    detail = false;
    heading.textContent = t("layouts.title");
    disposeFieldMessages(body);
    body.replaceChildren();
    status.hidden = true;
    actions([{
      id: "new",
      label: `[[icon=add]] ${t("shell.new")}`,
      kind: "primary",
    }]);
    const card = document.createElement("div");
    card.className = "layout-list has-group-title";
    const title = document.createElement("h2");
    title.className = "group-title";
    title.textContent = t("layouts.saved");
    const container = document.createElement("div");
    container.className = "data-list-container";
    const scroll = document.createElement("div");
    scroll.className = "data-list-scroll";
    const table = document.createElement("table");
    table.className = "data-list";
    table.setAttribute("aria-label", t("layouts.saved"));
    const head = table.createTHead().insertRow();
    for (
      const label of [
        "layouts.name",
        "layouts.scope",
        "layouts.default",
        "shell.screenActions",
      ]
    ) {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = t(label);
      head.append(th);
    }
    const rows = table.createTBody();
    const row = (
      label: string,
      layout: ListLayout,
      item?: { name: string; global: boolean },
    ) => {
      const tr = rows.insertRow();
      tr.dataset.layoutName = label;
      tr.dataset.global = String(item?.global ?? false);
      const cell = (text: string) => {
        const td = tr.insertCell();
        const value = document.createElement("div");
        value.className = "data-list-cell-value";
        value.textContent = text;
        td.append(value);
        return td;
      };
      const first = cell("");
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "data-list-column-button";
      edit.textContent = label;
      edit.addEventListener("click", () => open(layout, item));
      first.replaceChildren(edit);
      cell(item ? t(item.global ? "layouts.shared" : "layouts.personal") : "");
      cell(
        item &&
          catalog[item.global ? "global" : "personal"].defaultName === label
          ? t(item.global ? "layouts.forEveryone" : "layouts.forMe")
          : "",
      );
      const buttons = tr.insertCell();
      const applyButton = document.createElement("button");
      applyButton.type = "button";
      applyButton.className = "button button-secondary";
      applyButton.textContent = t("layouts.apply");
      applyButton.addEventListener("click", () => apply(layout));
      buttons.append(applyButton);
      if (item && (!item.global || catalog.canManageGlobal)) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "button button-danger";
        remove.textContent = t("layouts.delete");
        remove.addEventListener("click", () =>
          execute(async () => {
            await command({
              operation: "delete",
              global: item.global,
              name: item.name,
            });
            drawList();
          }));
        buttons.append(remove);
      }
    };
    row(t("layouts.builtin"), builtin);
    for (const scope of ["personal", "global"] as const) {
      for (const name of Object.keys(catalog[scope].variants).sort()) {
        row(name, catalog[scope].variants[name]!, {
          name,
          global: scope === "global",
        });
      }
    }
    scroll.append(table);
    container.append(scroll);
    card.append(title, container);
    body.append(card);
    body.scrollTop = 0;
    body.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
  };
  dialog.addEventListener("cancel", (event) => {
    if (!detail || body.inert) return;
    event.preventDefault();
    drawList();
  }, { signal });
  signal.addEventListener("abort", () => {
    responsive.dispose();
    disposeFieldMessages(body);
  }, { once: true });
  if (snapshot.layouts) await command({ operation: "list" });
  drawList();
}
