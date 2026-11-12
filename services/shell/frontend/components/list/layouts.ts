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
  type RenderCallbacks,
  renderControl,
  renderElements,
  renderScreen,
} from "../../renderer.ts";
import { createOverflowText, disposeOverflowText } from "../../overflow.ts";
import { ResponsiveProgramHeader } from "../../responsive_header.ts";
import { renderIconText } from "../../icon_text.ts";
import { iconButton } from "./tools.ts";

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
        const key = available[Number(position)]!.key;
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
      const identity = available.indexOf(column);
      const bind = `columns.${identity}`;
      (model.columns as Record<string, unknown>)[identity] = {
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
              placeholder: column.semanticType === "number" ||
                  column.semanticType === "decimal"
                ? t("lists.filter_number")
                : column.semanticType === "boolean"
                ? t("lists.filter_boolean")
                : column.semanticType === "date" ||
                    column.semanticType === "datetime"
                ? t("lists.filter_date")
                : t("lists.filter_text"),
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
      return {
        key,
        heading: column.heading,
        fields,
        elements: [
          {
            id: `up:${index}`,
            label: "[[icon=arrow_upward]]",
            class: `data-list-icon-button ${
              index === 0 ? "is-unavailable" : ""
            }`,
          },
          {
            id: `down:${index}`,
            label: "[[icon=arrow_downward]]",
            class: `data-list-icon-button ${
              index === order.length - 1 ? "is-unavailable" : ""
            }`,
          },
        ],
      };
    });
    disposeOverflowText(body);
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
            ],
          },
        },
      },
      model,
      renderCallbacks,
      { render: () => document.createElement("div") },
    );
    const card = document.createElement("div");
    card.className = "layout-list layout-fields";
    const container = document.createElement("div");
    container.className = "data-list-container";
    const scroll = document.createElement("div");
    scroll.className = "data-list-scroll";
    const table = document.createElement("table");
    table.className = "data-list layout-fields-table";
    table.setAttribute("aria-label", t("field_help.label"));
    const head = table.createTHead().insertRow();
    const labels = [
      t("field_help.label"),
      t("layouts.visible"),
      "",
      ...(!snapshot.source?.searchOnly
        ? [t("lists.filter_column", { column: "" }), t("lists.sort")]
        : []),
    ];
    for (const label of labels) {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = label;
      head.append(th);
    }
    head.cells[2]!.setAttribute("aria-label", t("shell.screenActions"));
    const rows = table.createTBody();
    for (const column of columns) {
      const row = rows.insertRow();
      row.dataset.columnKey = column.key;
      row.insertCell().append(createOverflowText(column.heading, {
        label: t("shell.completeValue"),
        className: "data-list-cell-value",
      }));
      for (const [index, field] of column.fields.entries()) {
        const rendered = renderControl(field, model, renderCallbacks)!;
        rendered.querySelector("label")?.classList.add("visually-hidden");
        rendered.querySelector(".field-message")?.remove();
        row.insertCell().append(rendered);
        if (index === 0) {
          row.insertCell().append(
            ...renderElements(column.elements, {}, renderCallbacks),
          );
        }
      }
    }
    scroll.append(table);
    container.append(scroll);
    card.append(container);
    body.querySelector('[data-layout-id="layout-editor"]')!.append(card);
    body.querySelector(".screen-title")?.remove();
    for (
      const button of body.querySelectorAll<HTMLButtonElement>(
        ".data-list-icon-button",
      )
    ) {
      const [direction, position] = button.dataset.elementId!.split(":");
      const label = `${
        t(direction === "up" ? "layouts.up" : "layouts.down")
      }: ${
        available.find((column) => column.key === order[Number(position)])!
          .heading
      }`;
      button.setAttribute("aria-label", label);
      button.title = label;
    }

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
    disposeOverflowText(body);
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
      const text = document.createElement("span");
      text.className = "data-list-heading";
      text.textContent = label;
      edit.title = label;
      edit.append(text);
      edit.addEventListener("click", () => open(layout, item));
      first.replaceChildren(edit);
      const scope = item
        ? t(item.global ? "layouts.shared" : "layouts.personal")
        : "";
      const defaultLabel = item &&
          catalog[item.global ? "global" : "personal"].defaultName === label
        ? t(item.global ? "layouts.forEveryone" : "layouts.forMe")
        : "";
      cell(scope);
      cell(defaultLabel);
      const metadata = document.createElement("span");
      metadata.className = "layout-row-meta";
      metadata.textContent = [scope, defaultLabel].filter(Boolean).join(" · ");
      first.append(metadata);
      tr.addEventListener("click", (event) => {
        if (
          !(event.target instanceof Element) || event.target.closest("button")
        ) return;
        open(layout, item);
      });
      const buttons = tr.insertCell();
      buttons.append(
        iconButton(
          `${t("layouts.apply")}: ${label}`,
          "play_arrow",
          () => apply(layout),
        ),
      );
      if (item && (!item.global || catalog.canManageGlobal)) {
        buttons.append(
          iconButton(
            `${t("layouts.delete")}: ${label}`,
            "delete",
            () =>
              execute(async () => {
                await command({
                  operation: "delete",
                  global: item.global,
                  name: item.name,
                });
                drawList();
              }),
          ),
        );
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
    disposeOverflowText(body);
  }, { once: true });
  if (snapshot.layouts) await command({ operation: "list" });
  drawList();
}
