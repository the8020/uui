import {
  type Bundle,
  direction,
  format,
  type Message,
} from "/p/the8020/i18n/messages.ts";
import english from "../../../i18n/locales/en.json" with { type: "json" };
const bundleKey = Symbol.for("the8020.uui.localization");
const shared = globalThis as typeof globalThis & { [bundleKey]?: Bundle };
export function t(key: string, vars?: Message["vars"]): string {
  return format(shared[bundleKey]?.texts ?? english.texts, key, vars);
}
export function setLocalization(bundle: Bundle | undefined): void {
  if (!bundle) return;
  shared[bundleKey] = bundle;
  document.documentElement.lang = bundle.language;
  document.documentElement.dir = direction(bundle.language);
  for (const element of document.querySelectorAll<HTMLElement>("[data-i18n]")) {
    element.textContent = t(element.dataset.i18n!);
  }
  for (
    const element of document.querySelectorAll<HTMLElement>("[data-i18n-title]")
  ) {
    element.title = t(element.dataset.i18nTitle!);
    element.setAttribute("aria-label", element.title);
  }
  for (
    const element of document.querySelectorAll<HTMLElement>("[data-i18n-aria]")
  ) {
    element.setAttribute("aria-label", t(element.dataset.i18nAria!));
  }
}
