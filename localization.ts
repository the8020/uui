import { getSystemProfile } from "/p/the8020/system/profile.ts";
import { currentLocalization, Localization } from "/p/the8020/i18n/mod.ts";

async function cookieName(): Promise<string> {
  return `the8020_language_${(await getSystemProfile()).id}`;
}

/** The browser choice is presentation only; service callers use their header. */
export async function browserLocalization(
  request: Request,
): Promise<Localization> {
  const current = currentLocalization()!;
  if (request.headers.has("the8020-language")) return current;
  if (!request.headers.get("cookie")?.includes("the8020_language_")) {
    return current;
  }
  const prefix = `${await cookieName()}=`;
  const selected = (request.headers.get("cookie") ?? "").split(";")
    .map((value) => value.trim()).find((value) => value.startsWith(prefix))
    ?.slice(prefix.length);
  return selected &&
      current.configuration.languages.some((item) => item.code === selected)
    ? new Localization(selected, current.configuration, current.loader)
    : current;
}

export async function languageCookie(
  request: Request,
  selected: string,
): Promise<string> {
  return `${await cookieName()}=${selected}; Path=/; HttpOnly; SameSite=Lax${
    selected ? "; Max-Age=31536000" : "; Max-Age=0"
  }${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
}
