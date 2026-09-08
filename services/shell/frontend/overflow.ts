import { renderMarkdown } from "../../../frontend/mod.ts";
import { renderIconText } from "./icon_text.ts";
import { AnchoredPopover } from "./popover.ts";

interface OverflowController {
  host: HTMLElement;
  text: HTMLElement;
  button: HTMLButtonElement;
  shortened: boolean;
  popover: AnchoredPopover;
}

const controllers = new WeakMap<HTMLElement, OverflowController>();
const pending = new Set<HTMLElement>();
let frame: number | undefined;
let sequence = 0;
const observer = typeof ResizeObserver === "undefined"
  ? undefined
  : new ResizeObserver((entries) => {
    for (const entry of entries) schedule(entry.target as HTMLElement);
  });

/** Reusable selectable preview with a separate, font-sized ellipsis button. */
export function createOverflowText(
  content: string,
  options: {
    label: string;
    preview?: "text" | "markdown";
    maxCharacters?: number;
    className?: string;
  },
): HTMLElement {
  const host = document.createElement("div");
  host.className = "overflow-text";
  if (options.className) host.classList.add(options.className);
  const text = document.createElement("span");
  text.className = "overflow-text-content";
  let preview = content;
  if (options.preview === "markdown") {
    const rendered = document.createElement("div");
    renderMarkdown(rendered, content);
    preview = rendered.textContent?.replace(/\s+/g, " ").trim() ?? "";
  }
  const characters = Array.from(preview);
  const shortened = options.maxCharacters !== undefined &&
    characters.length > options.maxCharacters;
  renderIconText(
    text,
    shortened
      ? characters.slice(0, options.maxCharacters).join("").trimEnd()
      : preview,
  );
  const button = document.createElement("button");
  button.type = "button";
  button.className = "overflow-reveal";
  button.tabIndex = -1;
  button.textContent = "…";
  button.hidden = true;
  button.title = options.label;
  button.setAttribute("aria-label", options.label);
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-expanded", "false");
  const popover = new AnchoredPopover(button, options.label, {
    bounds: () => {
      const anchor = button.getBoundingClientRect();
      const row = host.getBoundingClientRect();
      return {
        left: anchor.left,
        right: anchor.right,
        top: row.top,
        bottom: row.bottom,
      };
    },
  });
  popover.element.classList.add("overflow-popover");
  popover.element.id = `overflow-popover-${++sequence}`;
  button.setAttribute("aria-controls", popover.element.id);
  let rendered = false;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (popover.element.matches(":popover-open")) {
      popover.hide();
      return;
    }
    if (!rendered) {
      renderMarkdown(popover.element, content);
      // Preserve UUI icon placeholders within Markdown text without flattening it.
      const walker = document.createTreeWalker(
        popover.element,
        NodeFilter.SHOW_TEXT,
      );
      const nodes: Text[] = [];
      while (walker.nextNode()) nodes.push(walker.currentNode as Text);
      for (const node of nodes) {
        if (
          !node.textContent?.includes("[[icon=") ||
          node.parentElement?.closest("code, pre")
        ) continue;
        const span = document.createElement("span");
        renderIconText(span, node.textContent);
        node.replaceWith(span);
      }
      rendered = true;
    }
    popover.show();
  });
  // Keep interactions inside cell popovers separate from row activation.
  popover.element.addEventListener("click", (event) => event.stopPropagation());
  popover.element.addEventListener(
    "keydown",
    (event) => event.stopPropagation(),
  );
  host.append(text, button, popover.element);
  controllers.set(host, { host, text, button, shortened, popover });
  observer?.observe(host);
  schedule(host);
  return host;
}

function schedule(host: HTMLElement): void {
  pending.add(host);
  if (frame !== undefined) return;
  frame = requestAnimationFrame(() => {
    frame = undefined;
    refresh([...pending]);
    pending.clear();
  });
}

function refresh(hosts: HTMLElement[]): void {
  const items = hosts.flatMap((host) => {
    const controller = controllers.get(host);
    return controller && host.isConnected ? [controller] : [];
  });
  // Measure without button space, keeping visible buttons focusable throughout.
  // Temporarily hiding a focused button would drop focus during a resize pass.
  for (const { host } of items) host.dataset.overflowMeasuring = "";
  const overflow = items.map(({ shortened, text }) =>
    text.clientWidth > 0 &&
    (shortened || text.scrollWidth > text.clientWidth + 0.5 ||
      text.scrollHeight > text.clientHeight + 0.5)
  );
  items.forEach(({ host, button, popover }, index) => {
    delete host.dataset.overflowMeasuring;
    button.hidden = !overflow[index];
    host.dataset.overflow = String(overflow[index]);
    if (button.hidden) popover.hide();
    else popover.position();
  });
}

function hostsIn(root: ParentNode): HTMLElement[] {
  return [
    ...(root instanceof HTMLElement && root.matches(".overflow-text")
      ? [root]
      : []),
    ...root.querySelectorAll<HTMLElement>(".overflow-text"),
  ];
}

export function refreshOverflowText(root: ParentNode): void {
  refresh(hostsIn(root));
}

export function disposeOverflowText(root: ParentNode): void {
  for (const host of hostsIn(root)) {
    controllers.get(host)?.popover.dispose();
    controllers.delete(host);
    observer?.unobserve(host);
    pending.delete(host);
  }
}
