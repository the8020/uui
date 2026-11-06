import {
  defaultConfiguration,
  Localization,
  withLocalization,
} from "/p/the8020/i18n/mod.ts";
import validation from "/p/the8020/i18n/i18n/locales/en.json" with {
  type: "json",
};
import ui from "./i18n/locales/en.json" with { type: "json" };
import { setInterfaceUserCheck } from "./technical_guard.ts";

// UUI tests run without the users database; every test user may use the UI.
setInterfaceUserCheck(() => Promise.resolve(true));

export function withTestLocalization<T>(run: () => T): T {
  return withLocalization(
    new Localization(
      "en",
      defaultConfiguration,
      (packageId, chain) =>
        Promise.resolve({
          package: packageId,
          language: chain[0]!,
          texts: packageId === "the8020/uui" ? ui.texts : validation.texts,
        }),
    ),
    run,
  );
}
export function test(name: string, run: () => void | Promise<void>): void {
  Deno.test(name, () => withTestLocalization(run));
}
