import { resolveTexts } from "/p/the8020/i18n/mod.ts";
import {
  DEFAULT_SYSTEM_BUTTONS,
  type ScreenAction,
  type SystemButtons,
  validateComponentStyle,
  validateShortcut,
} from "./protocol.ts";

export function resolveSystemButtons(
  overrides: SystemButtons = {},
): Record<string, ScreenAction> {
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    throw new TypeError("systemButtons must be a map of button slots");
  }
  const buttons = new Map(Object.entries(DEFAULT_SYSTEM_BUTTONS));
  for (const [slot, change] of Object.entries(overrides)) {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(slot)) {
      throw new TypeError(`invalid system button slot ${slot}`);
    }
    if (change === null) {
      buttons.delete(slot);
      continue;
    }
    if (typeof change !== "object" || Array.isArray(change)) {
      throw new TypeError(`invalid system button ${slot}`);
    }
    const button = resolveTexts({
      id: slot,
      ...buttons.get(slot),
      ...Object.fromEntries(
        Object.entries(change).filter(([, value]) => value !== undefined),
      ),
    }) as ScreenAction;
    if (
      typeof button.id !== "string" || !button.id.trim() ||
      typeof button.label !== "string" || !button.label.trim() ||
      button.kind !== undefined &&
        !["primary", "secondary", "danger"].includes(button.kind)
    ) {
      throw new TypeError(
        `system button ${slot} requires a valid action and label`,
      );
    }
    validateComponentStyle(button);
    validateShortcut(button.shortcut);
    buttons.set(slot, button);
  }
  return Object.fromEntries(buttons);
}
