import type { Middleware } from "/p/the8020/services/http.ts";

const CACHE_MS = 30_000;

type InterfaceUserCheck = (username: string) => Promise<boolean>;

let defaultCheck: InterfaceUserCheck = async (username) =>
  (await import("/p/the8020/users/mod.ts")).interfaceUser(username);

/** Tests without a users database replace the account check. */
export function setInterfaceUserCheck(check: InterfaceUserCheck): void {
  defaultCheck = check;
}

/**
 * Technical accounts serve services, jobs and checks; they may authenticate
 * with certificates or HTTP Basic but never reach the shell or UUI sessions.
 * Answers are cached per Worker for 30 seconds, so a change applies to new
 * requests within that time.
 */
export function technicalGuard(
  interfaceUser: InterfaceUserCheck = (username) => defaultCheck(username),
  now: () => number = Date.now,
): Middleware {
  const cache = new Map<string, { allowed: boolean; until: number }>();
  return async ({ meta }, next) => {
    if (!meta.auth.authenticated) return await next();
    let entry = cache.get(meta.user.username);
    if (entry === undefined || entry.until <= now()) {
      if (cache.size > 1000) cache.clear();
      entry = {
        allowed: await interfaceUser(meta.user.username),
        until: now() + CACHE_MS,
      };
      cache.set(meta.user.username, entry);
    }
    if (entry.allowed) return await next();
    return new Response("Technical accounts cannot use the user interface.", {
      status: 403,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  };
}
