import type {
  CustomElementContext,
  CustomElementInstance,
} from "/p/the8020/uui/custom_element.ts";
import type { HomeNode } from "./tree.ts";

const WIDTH_KEY = "the8020.home.tree-width";
const DEFAULT_WIDTH = 280;
const MIN_WIDTH = 180;
const KEYBOARD_STEP = 16;
/** A request without an answer may be repeated after this long. */
const PENDING_RETRY_MS = 20_000;
const DATA_TICK_MS = 5_000;

interface TileValue {
  value?: string;
  detail?: string;
  status?: string;
  error?: boolean;
  /** When it arrived; 0 marks it stale after a Home redraw. */
  at: number;
}

interface NavigatorState {
  selected: string;
  expanded: string[];
}

/** Home program navigator: folder tree, resizable divider, and tiles. */
export default function mount(
  context: CustomElementContext,
): CustomElementInstance {
  const { host } = context;
  let root = context.config.tree as HomeNode;
  const saved = context.state.data as Partial<NavigatorState> | undefined;
  let selected = typeof saved?.selected === "string" ? saved.selected : root.id;
  const expanded = new Set<string>(
    Array.isArray(saved?.expanded) ? saved.expanded : [],
  );
  let focused = selected;

  const frame = element("div", "home-navigator");
  const treePane = element("nav", "home-navigator-tree");
  treePane.setAttribute("aria-label", "Programs");
  const tree = element("ul", "home-tree");
  tree.setAttribute("role", "tree");
  tree.setAttribute("aria-label", "Programs");
  treePane.append(tree);
  const divider = element("div", "home-navigator-divider");
  divider.setAttribute("role", "separator");
  divider.setAttribute("aria-orientation", "vertical");
  divider.setAttribute("aria-label", "Resize program tree");
  divider.title = "Drag to resize, double-click to reset";
  divider.tabIndex = 0;
  const content = element("section", "home-navigator-content");
  const heading = element("nav", "home-navigator-path");
  heading.setAttribute("aria-label", "Current folder");
  const tiles = element("div", "home-tiles");
  content.append(heading, tiles);
  frame.append(treePane, divider, content);
  host.replaceChildren(frame);

  const lookup = new Map<string, { node: HomeNode; parent?: HomeNode }>();
  const values = new Map<string, TileValue>();
  const pending = new Map<string, number>();
  const index = (node: HomeNode, parent?: HomeNode) => {
    lookup.set(node.id, { node, parent });
    for (const child of node.children ?? []) index(child, node);
  };

  const path = (id: string): HomeNode[] => {
    const nodes: HomeNode[] = [];
    for (
      let entry = lookup.get(id);
      entry !== undefined;
      entry = entry.parent ? lookup.get(entry.parent.id) : undefined
    ) nodes.unshift(entry.node);
    return nodes;
  };

  const persist = () => {
    context.state.data = { selected, expanded: [...expanded] };
  };

  const open = (node: HomeNode) => {
    if (node.tile !== undefined) {
      context.send("select", node.tile);
      return;
    }
    selected = node.id;
    focused = node.id;
    for (const ancestor of path(node.id)) expanded.add(ancestor.id);
    persist();
    render();
  };

  const toggle = (node: HomeNode, open?: boolean) => {
    const next = open ?? !expanded.has(node.id);
    if (next) expanded.add(node.id);
    else expanded.delete(node.id);
    persist();
    render();
  };

  const visibleItems = (): HomeNode[] => {
    const items: HomeNode[] = [];
    const walk = (node: HomeNode) => {
      items.push(node);
      if (node.tile === undefined && expanded.has(node.id)) {
        for (const child of node.children ?? []) walk(child);
      }
    };
    walk(root);
    return items;
  };

  const treeItem = (node: HomeNode, level: number): HTMLLIElement => {
    const item = element("li", "home-tree-item");
    item.setAttribute("role", "treeitem");
    item.setAttribute("aria-level", String(level));
    item.dataset.nodeId = node.id;
    item.tabIndex = node.id === focused ? 0 : -1;
    const folder = node.tile === undefined;
    if (folder) {
      item.setAttribute("aria-expanded", String(expanded.has(node.id)));
      item.setAttribute("aria-selected", String(node.id === selected));
    }
    const row = element("div", "home-tree-row");
    row.style.setProperty("--home-tree-level", String(level - 1));
    const twisty = element("span", "home-tree-twisty");
    if (folder && (node.children?.length ?? 0) > 0) {
      context.renderText(
        twisty,
        expanded.has(node.id)
          ? "[[icon=expand_more]]"
          : "[[icon=chevron_right]]",
      );
      twisty.addEventListener("click", (event) => {
        event.stopPropagation();
        toggle(node);
      });
    }
    const icon = element("span", "home-tree-icon");
    context.renderText(icon, iconFor(node, expanded.has(node.id)));
    const label = element("span", "home-tree-label");
    label.textContent = node.label;
    row.title = node.description ?? node.label;
    row.append(twisty, icon, label);
    row.addEventListener("click", () => {
      focused = node.id;
      open(node);
    });
    item.append(row);
    if (folder && expanded.has(node.id) && node.children?.length) {
      const group = element("ul", "home-tree-group");
      group.setAttribute("role", "group");
      for (const child of node.children) {
        group.append(treeItem(child, level + 1));
      }
      item.append(group);
    }
    return item;
  };

  const tile = (node: HomeNode): HTMLButtonElement => {
    const button = element("button", "home-tile");
    button.type = "button";
    button.dataset.nodeId = node.id;
    if (node.tile !== undefined) button.dataset.tileId = node.tile;
    const icon = element("span", "home-tile-icon");
    context.renderText(icon, iconFor(node, false));
    const label = element("span", "home-tile-label");
    label.textContent = node.label;
    const detail = element("span", "home-tile-detail");
    detail.textContent = node.tile === undefined
      ? countLabel(node)
      : node.description ?? "";
    button.title = node.description ?? node.label;
    button.append(icon, label, detail);
    if (node.tile !== undefined && node.data !== undefined) {
      const live = element("span", "home-tile-data");
      live.append(
        element("span", "home-tile-value"),
        element("span", "home-tile-status-detail"),
      );
      button.append(live);
      showValue(button, values.get(node.tile));
    }
    button.addEventListener("click", () => open(node));
    return button;
  };

  const render = () => {
    lookup.clear();
    index(root);
    if (!lookup.has(selected) || lookup.get(selected)!.node.tile) {
      selected = root.id;
    }
    if (!lookup.has(focused)) focused = selected;
    expanded.add(root.id);
    const hadFocus = tree.contains(document.activeElement);
    tree.replaceChildren(treeItem(root, 1));
    if (hadFocus) focusItem(focused);

    heading.replaceChildren();
    path(selected).forEach((node, position, nodes) => {
      if (position > 0) {
        const separator = element("span", "home-navigator-separator");
        context.renderText(separator, "[[icon=chevron_right]]");
        heading.append(separator);
      }
      const crumb = element("button", "home-navigator-crumb");
      crumb.type = "button";
      crumb.textContent = node.label;
      if (position === nodes.length - 1) {
        crumb.setAttribute("aria-current", "location");
        crumb.disabled = true;
      }
      crumb.addEventListener("click", () => open(node));
      heading.append(crumb);
    });
    const children = lookup.get(selected)!.node.children ?? [];
    tiles.replaceChildren(...children.map(tile));
    loadVisible(false);
    if (children.length === 0) {
      const empty = element("p", "home-tiles-empty");
      empty.textContent = "No programs";
      tiles.append(empty);
    }
  };

  /** Ask for visible live tiles that are missing, stale, or due to refresh. */
  const loadVisible = (refreshing: boolean) => {
    const now = Date.now();
    const due = (lookup.get(selected)?.node.children ?? []).filter((node) => {
      if (node.tile === undefined || node.data === undefined) return false;
      const since = pending.get(node.tile);
      if (since !== undefined && now - since < PENDING_RETRY_MS) return false;
      const value = values.get(node.tile);
      if (value === undefined || value.at === 0) return true;
      const refresh = node.data.refresh;
      return refreshing && refresh !== undefined &&
        now - value.at >= refresh * 1000;
    }).map((node) => node.tile!);
    if (due.length === 0) return;
    for (const id of due) pending.set(id, now);
    try {
      context.channel.send("load", { tiles: due });
    } catch (error) {
      for (const id of due) pending.delete(id);
      console.error("tile data request failed", error);
    }
  };

  const showValue = (button: HTMLElement, value: TileValue | undefined) => {
    const valueText = button.querySelector<HTMLElement>(".home-tile-value");
    const detailText = button.querySelector<HTMLElement>(
      ".home-tile-status-detail",
    );
    if (valueText === null || detailText === null) return;
    button.dataset.status = value?.error ? "unavailable" : value?.status ?? "";
    valueText.textContent = value === undefined
      ? "…"
      : value.error
      ? "—"
      : value.value ?? "";
    valueText.title = value?.error ? "Data unavailable" : "";
    detailText.textContent = value?.error ? "" : value?.detail ?? "";
  };

  const receiving = context.channel.subscribe("data", (_id, message) => {
    if (typeof message !== "object" || message === null) return;
    const { tile: id, ...rest } = message as { tile?: unknown };
    if (typeof id !== "string") return;
    pending.delete(id);
    const value: TileValue = {
      ...rest as Omit<TileValue, "at">,
      at: Date.now(),
    };
    values.set(id, value);
    const button = tiles.querySelector<HTMLElement>(
      `.home-tile[data-tile-id="${CSS.escape(id)}"]`,
    );
    if (button !== null) showValue(button, value);
  });
  const ticker = setInterval(() => loadVisible(true), DATA_TICK_MS);

  const focusItem = (id: string) => {
    focused = id;
    for (const item of tree.querySelectorAll<HTMLElement>("[role=treeitem]")) {
      item.tabIndex = item.dataset.nodeId === id ? 0 : -1;
      if (item.dataset.nodeId === id) item.focus({ preventScroll: false });
    }
  };

  tree.addEventListener("keydown", (event) => {
    const items = visibleItems();
    const position = items.findIndex((node) => node.id === focused);
    const node = items[position];
    if (node === undefined) return;
    const folder = node.tile === undefined;
    let handled = true;
    switch (event.key) {
      case "ArrowDown":
        focusItem(items[Math.min(items.length - 1, position + 1)]!.id);
        break;
      case "ArrowUp":
        focusItem(items[Math.max(0, position - 1)]!.id);
        break;
      case "Home":
        focusItem(items[0]!.id);
        break;
      case "End":
        focusItem(items.at(-1)!.id);
        break;
      case "ArrowRight":
        if (folder && !expanded.has(node.id)) toggle(node, true);
        else if (folder && node.children?.length) {
          focusItem(node.children[0]!.id);
        }
        break;
      case "ArrowLeft":
        if (folder && expanded.has(node.id) && node.id !== root.id) {
          toggle(node, false);
        } else {
          const parent = lookup.get(node.id)?.parent;
          if (parent) focusItem(parent.id);
        }
        break;
      case "Enter":
      case " ":
        open(node);
        break;
      default:
        handled = false;
    }
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  });

  // Tree width is a per-browser preference; the default fits typical labels.
  const maximumWidth = () =>
    Math.max(MIN_WIDTH, Math.floor(frame.clientWidth * 0.6));
  const applyWidth = (width: number, save: boolean) => {
    const clamped = Math.round(
      Math.min(maximumWidth(), Math.max(MIN_WIDTH, width)),
    );
    frame.style.setProperty("--home-tree-width", `${clamped}px`);
    divider.setAttribute("aria-valuemin", String(MIN_WIDTH));
    divider.setAttribute("aria-valuemax", String(maximumWidth()));
    divider.setAttribute("aria-valuenow", String(clamped));
    if (save) {
      try {
        if (clamped === DEFAULT_WIDTH) localStorage.removeItem(WIDTH_KEY);
        else localStorage.setItem(WIDTH_KEY, String(clamped));
      } catch (error) {
        console.error("program tree width could not be saved", error);
      }
    }
    return clamped;
  };
  const storedWidth = (): number => {
    try {
      const width = Number(localStorage.getItem(WIDTH_KEY));
      return Number.isFinite(width) && width > 0 ? width : DEFAULT_WIDTH;
    } catch {
      return DEFAULT_WIDTH;
    }
  };
  let width = applyWidth(storedWidth(), false);

  divider.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    divider.setPointerCapture(event.pointerId);
    const start = event.clientX;
    const initial = width;
    frame.classList.add("is-resizing");
    const move = (moved: PointerEvent) => {
      width = applyWidth(initial + moved.clientX - start, false);
    };
    const finish = () => {
      frame.classList.remove("is-resizing");
      divider.removeEventListener("pointermove", move);
      width = applyWidth(width, true);
    };
    divider.addEventListener("pointermove", move);
    divider.addEventListener("pointerup", finish, { once: true });
    divider.addEventListener("pointercancel", finish, { once: true });
  });
  divider.addEventListener("dblclick", () => {
    width = applyWidth(DEFAULT_WIDTH, true);
  });
  divider.addEventListener("keydown", (event) => {
    const next = event.key === "ArrowLeft"
      ? width - KEYBOARD_STEP
      : event.key === "ArrowRight"
      ? width + KEYBOARD_STEP
      : event.key === "Home"
      ? DEFAULT_WIDTH
      : undefined;
    if (next === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    width = applyWidth(next, true);
  });
  const resize = new ResizeObserver(() => {
    width = applyWidth(storedWidth(), false);
  });
  resize.observe(frame);

  render();
  return {
    update(config) {
      root = config.tree as HomeNode;
      // A redraw follows a program return or Refresh; reload shown values.
      for (const value of values.values()) value.at = 0;
      pending.clear();
      render();
    },
    captureState: persist,
    dispose() {
      resize.disconnect();
      clearInterval(ticker);
      receiving.unsubscribe();
    },
  };
}

function iconFor(node: HomeNode, open: boolean): string {
  if (node.icon !== undefined && /^[a-z0-9_]+$/.test(node.icon)) {
    return `[[icon=${node.icon}]]`;
  }
  if (node.tile !== undefined) return "[[icon=widgets]]";
  return open ? "[[icon=folder_open]]" : "[[icon=folder]]";
}

function countLabel(node: HomeNode): string {
  let count = 0;
  const walk = (item: HomeNode) => {
    if (item.tile !== undefined) count++;
    for (const child of item.children ?? []) walk(child);
  };
  walk(node);
  return count === 1 ? "1 program" : `${count} programs`;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}
