import { humanize } from "../../../humanize.ts";

const MATERIAL_ICON_ASSETS = {
  arrow_back: "./assets/material-arrow-back-24-e083cc60.svg",
  arrow_drop_down: "./assets/material-arrow-drop-down-24-e083cc60.svg",
  close: "./assets/material-close-24-84ccef28.svg",
  dark_mode: "./assets/material-dark-mode-24-bab57d17.svg",
  edit: "./assets/material-edit-24-a4b3c9f6.svg",
  error: "./assets/material-error-24-e083cc60.svg",
  light_mode: "./assets/material-light-mode-24-e5b6e132.svg",
  logout: "./assets/material-logout-24-84ccef28.svg",
  menu: "./assets/material-menu-24-e083cc60.svg",
  more_vert: "./assets/material-more-vert-24-e083cc60.svg",
  refresh: "./assets/material-refresh-24-e083cc60.svg",
  save: "./assets/material-save-24-e083cc60.svg",
  tab_close: "./assets/material-tab-close-24-84ccef28.svg",
} as const;

const SEMANTIC_COLORS = new Set([
  "text",
  "muted",
  "primary",
  "success",
  "warning",
  "danger",
  "error",
  "info",
  "brand",
]);
const ICON_PLACEHOLDER =
  /\[\[icon=([a-z][a-z0-9_]*)(?:\s+color=([^\]\s]+))?\]\]/g;
const HEX_COLOR =
  /^(?:#[0-9a-fA-F]{3}|#[0-9a-fA-F]{4}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8})$/;

export type MaterialIconName = keyof typeof MATERIAL_ICON_ASSETS;

export type IconTextToken =
  | { type: "text"; text: string }
  | { type: "icon"; name: MaterialIconName; color?: string };

export interface IconRenderOptions {
  decorativeIcons?: boolean;
}

export function parseIconText(value: string): IconTextToken[] {
  const tokens: IconTextToken[] = [];
  let offset = 0;
  for (const match of value.matchAll(ICON_PLACEHOLDER)) {
    const index = match.index ?? 0;
    if (index > offset) pushText(tokens, value.slice(offset, index));
    const placeholder = match[0];
    const name = match[1]!;
    const color = match[2];
    if (isMaterialIconName(name) && isIconColor(color)) {
      tokens.push({
        type: "icon",
        name,
        ...(color === undefined ? {} : { color }),
      });
    } else {
      pushText(tokens, placeholder);
    }
    offset = index + placeholder.length;
  }
  if (offset < value.length) pushText(tokens, value.slice(offset));
  return tokens;
}

export function renderIconText(
  target: HTMLElement,
  value: string,
  options: IconRenderOptions = {},
): void {
  target.replaceChildren(
    ...parseIconText(value).map((token) =>
      token.type === "text"
        ? document.createTextNode(token.text)
        : createMaterialIcon(token.name, token.color, options)
    ),
  );
}

export function createMaterialIcon(
  name: MaterialIconName,
  color?: string,
  options: IconRenderOptions = {},
): HTMLSpanElement {
  const icon = document.createElement("span");
  icon.className = "material-icon";
  icon.dataset.materialIcon = name;
  icon.style.setProperty(
    "--material-icon-url",
    `url("${MATERIAL_ICON_ASSETS[name]}")`,
  );
  if (color !== undefined) {
    if (SEMANTIC_COLORS.has(color)) {
      icon.classList.add(
        `material-icon-color-${color === "error" ? "danger" : color}`,
      );
    } else {
      icon.style.color = color;
    }
  }
  if (options.decorativeIcons) {
    icon.setAttribute("aria-hidden", "true");
  } else {
    icon.setAttribute("role", "img");
    icon.setAttribute("aria-label", humanize(name));
  }
  return icon;
}

function isMaterialIconName(value: string): value is MaterialIconName {
  return Object.hasOwn(MATERIAL_ICON_ASSETS, value);
}

function isIconColor(value: string | undefined): boolean {
  return value === undefined || SEMANTIC_COLORS.has(value) ||
    HEX_COLOR.test(value);
}

function pushText(tokens: IconTextToken[], text: string): void {
  const previous = tokens.at(-1);
  if (previous?.type === "text") previous.text += text;
  else tokens.push({ type: "text", text });
}
