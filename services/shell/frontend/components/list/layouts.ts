import { t } from "../../i18n.ts";
import {
  emptyListQuery,
  MAX_LIST_QUERY_LENGTH,
  type ScreenListSnapshot,
} from "../../../../../screen_state.ts";
import {
  type LayoutCatalog,
  type LayoutCommand,
  type ListLayout,
} from "../../../../../list_layout.ts";
import { iconButton } from "./tools.ts";

export interface LayoutCallbacks {
  layout(id: string, layout: ListLayout): boolean;
  layouts(
    id: string,
    command: LayoutCommand,
    signal: AbortSignal,
  ): Promise<LayoutCatalog>;
}

/** Edits only the columns offered by this list; query syntax stays list-owned. */
export async function layoutEditor(
  snapshot: ScreenListSnapshot,
  callbacks: LayoutCallbacks,
  body: HTMLElement,
  dialog: HTMLDialogElement,
  signal: AbortSignal,
): Promise<void> {
  const available = snapshot.availableColumns ?? snapshot.columns;
  let draft: ListLayout = {
    columns: snapshot.columns.map((column) => column.key),
    query: structuredClone(snapshot.state.query),
  };
  let order = [
    ...draft.columns,
    ...available.map((column) => column.key).filter((key) =>
      !draft.columns.includes(key)
    ),
  ];
  let catalog: LayoutCatalog | undefined;
  const saved = document.createElement("select");
  saved.setAttribute("aria-label", t("layouts.saved"));
  const name = document.createElement("input");
  name.maxLength = 80;
  name.setAttribute("aria-label", t("layouts.name"));
  name.placeholder = t("layouts.name");
  const shared = document.createElement("input");
  shared.type = "checkbox";
  shared.setAttribute("aria-label", t("layouts.shared"));
  const stored = document.createElement("div");
  const editor = document.createElement("div");
  const actions = document.createElement("div");
  actions.className = "data-list-layout-actions";
  const status = document.createElement("output");
  status.setAttribute("role", "status");
  body.append(stored, editor, actions, status);
  const button = (label: string, run: () => void) => {
    const control = document.createElement("button");
    control.type = "button";
    control.className = "btn btn-sm";
    control.textContent = label;
    control.addEventListener("click", run);
    return control;
  };
  const apply = button(t("layouts.apply"), () => {
    if (callbacks.layout(snapshot.id, draft)) dialog.close();
  });
  const draw = () => {
    editor.replaceChildren();
    apply.disabled = draft.columns.length === 0;
    const search = document.createElement("input");
    search.type = "search";
    search.maxLength = MAX_LIST_QUERY_LENGTH;
    search.setAttribute("aria-label", t("shell.searchList"));
    search.placeholder = t("lists.search");
    search.value = draft.query.search;
    search.addEventListener("input", () => draft.query.search = search.value);
    const sort = document.createElement("select");
    sort.setAttribute("aria-label", t("lists.sort"));
    sort.append(new Option(t("layouts.noSort"), ""));
    const sorts = available.flatMap((column) =>
      ["asc", "desc"].map((direction) => ({
        column,
        direction: direction as "asc" | "desc",
      }))
    );
    sorts.forEach(({ column, direction }, i) => {
      sort.append(
        new Option(
          `${column.heading} · ${
            t(direction === "asc" ? "lists.ascending" : "lists.descending")
          }`,
          String(i),
        ),
      );
      if (
        draft.query.sort?.column === column.key &&
        draft.query.sort.direction === direction
      ) sort.value = String(i);
    });
    sort.addEventListener("change", () => {
      const selected = sort.value === ""
        ? undefined
        : sorts[Number(sort.value)];
      draft.query.sort = selected
        ? { column: selected.column.key, direction: selected.direction }
        : null;
    });
    editor.append(search);
    if (!snapshot.source?.searchOnly) editor.append(sort);
    const columns = document.createElement("div");
    columns.className = "data-list-layout-columns";
    order.forEach((key, index) => {
      const column = available.find((column) => column.key === key)!;
      const row = document.createElement("div");
      row.className = "data-list-layout-column";
      const label = document.createElement("label");
      const visible = document.createElement("input");
      visible.type = "checkbox";
      visible.checked = draft.columns.includes(key);
      visible.setAttribute(
        "aria-label",
        `${t("layouts.visible")}: ${column.heading}`,
      );
      visible.addEventListener("change", () => {
        draft.columns = order.filter((key) =>
          key === column.key ? visible.checked : draft.columns.includes(key)
        );
        apply.disabled = draft.columns.length === 0;
      });
      label.append(visible, document.createTextNode(column.heading));
      row.append(label);
      for (
        const [delta, icon, key] of [[-1, "arrow_upward", "layouts.up"], [
          1,
          "arrow_downward",
          "layouts.down",
        ]] as const
      ) {
        const move = iconButton(`${t(key)}: ${column.heading}`, icon, () => {
          [order[index], order[index + delta]] = [
            order[index + delta]!,
            order[index]!,
          ];
          draft.columns = order.filter((key) => draft.columns.includes(key));
          draw();
          columns.querySelector<HTMLElement>(
            `[data-position="${index + delta}"] button`,
          )?.focus();
        });
        move.disabled = index + delta < 0 || index + delta >= order.length;
        row.append(move);
      }
      row.dataset.position = String(index);
      if (!snapshot.source?.searchOnly) {
        const filter = document.createElement("input");
        filter.maxLength = MAX_LIST_QUERY_LENGTH;
        filter.setAttribute(
          "aria-label",
          t("lists.filter_column", { column: column.heading }),
        );
        filter.placeholder = t("lists.filter_column", {
          column: column.heading,
        });
        filter.value = draft.query.filters[key] ?? "";
        filter.addEventListener("input", () => {
          if (filter.value) draft.query.filters[key] = filter.value;
          else delete draft.query.filters[key];
        });
        row.append(filter);
      }
      columns.append(row);
    });
    editor.append(columns);
  };
  const selected = () => {
    if (!catalog || !saved.value) return undefined;
    const [scope, ...rest] = JSON.parse(saved.value) as [
      "personal" | "global",
      string,
    ];
    const name = rest[0]!;
    return {
      global: scope === "global",
      name,
      layout: catalog[scope].variants[name]!,
    };
  };
  let updatePermissions = () => {};
  const refresh = (value: LayoutCatalog) => {
    catalog = value;
    const previous = saved.value;
    saved.replaceChildren(new Option(t("layouts.saved"), ""));
    for (const scope of ["personal", "global"] as const) {
      for (const name of Object.keys(value[scope].variants).sort()) {
        const suffix = value[scope].defaultName === name
          ? ` · ${t("layouts.default")}`
          : "";
        saved.append(
          new Option(
            `${name} · ${
              t(scope === "global" ? "layouts.shared" : "layouts.personal")
            }${suffix}`,
            JSON.stringify([scope, name]),
          ),
        );
      }
    }
    saved.value = previous;
    shared.disabled = !value.canManageGlobal;
    updatePermissions();
  };
  const command = async (value: LayoutCommand) => {
    stored.inert = true;
    try {
      refresh(await callbacks.layouts(snapshot.id, value, signal));
    } finally {
      stored.inert = false;
    }
  };
  const execute = (run: () => Promise<void>) => {
    void run().catch((error) => {
      if (!signal.aborted) {
        status.textContent = error instanceof Error
          ? error.message
          : String(error);
      }
    });
  };
  actions.append(
    apply,
    button(t("layouts.builtin"), () => {
      draft = {
        columns: available.map((column) => column.key),
        query: structuredClone(snapshot.state.builtInQuery ?? emptyListQuery()),
      };
      order = [...draft.columns];
      draw();
    }),
  );
  draw();
  if (snapshot.layouts) {
    const sharedLabel = document.createElement("label");
    sharedLabel.append(shared, document.createTextNode(t("layouts.shared")));
    saved.addEventListener("change", () => {
      const item = selected();
      if (!item) return;
      draft = structuredClone(item.layout);
      order = [
        ...draft.columns,
        ...available.map((column) => column.key).filter((key) =>
          !draft.columns.includes(key)
        ),
      ];
      name.value = item.name;
      shared.checked = item.global && !!catalog?.canManageGlobal;
      draw();
    });
    const save = button(t("layouts.save"), () =>
      execute(async () => {
        await command({
          operation: "save",
          global: shared.checked,
          name: name.value.trim(),
          layout: draft,
        });
        saved.value = JSON.stringify([
          shared.checked ? "global" : "personal",
          name.value.trim(),
        ]);
        updatePermissions();
      }));
    const defaultButton = button(
      t("layouts.setDefault"),
      () =>
        execute(async () => {
          const item = selected();
          if (item) {
            await command({
              operation: "default",
              global: item.global,
              name: item.name,
            });
          }
        }),
    );
    const remove = button(t("layouts.delete"), () =>
      execute(async () => {
        const item = selected();
        if (item) {
          await command({
            operation: "delete",
            global: item.global,
            name: item.name,
          });
        }
      }));
    updatePermissions = () => {
      const item = selected();
      const allowed = !!item && (!item.global || !!catalog?.canManageGlobal);
      defaultButton.disabled = remove.disabled = !allowed;
    };
    saved.addEventListener("change", updatePermissions);
    const clear = button(
      t("layouts.clearPersonalDefault"),
      () =>
        execute(() =>
          command({ operation: "default", global: false, name: null })
        ),
    );
    stored.append(saved, defaultButton, remove, name, sharedLabel, save, clear);
    await command({ operation: "list" });
    updatePermissions();
    if (catalog?.canManageGlobal) {
      stored.append(
        button(
          t("layouts.clearGlobalDefault"),
          () =>
            execute(() =>
              command({ operation: "default", global: true, name: null })
            ),
        ),
      );
    }
  }
}
