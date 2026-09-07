const segment = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
export const PACKAGE_ASSET_PREFIX = "/the8020/uui/shell/package-assets/";

/** URL for a file explicitly published in an installed package's public/. */
export function packageAssetURL(packageId: string, path: string): string {
  const owner = packageId.split("/");
  const parts = path.split("/");
  if (
    owner.length !== 2 || !owner.every((part) => segment.test(part)) ||
    !parts.every((part) => segment.test(part))
  ) throw new TypeError("invalid package asset path");
  return `${PACKAGE_ASSET_PREFIX}${packageId}/${path}`;
}

/** Program code is trusted; executable URLs are restricted to this origin. */
export function validBrowserAssetURL(
  value: unknown,
  kind: "module" | "style",
): value is string {
  if (
    typeof value !== "string" || value.length > 2048 ||
    !value.startsWith("/") || value.startsWith("//") ||
    /[\\\s#]/.test(value)
  ) return false;
  const url = new URL(value, "https://asset.invalid");
  return url.origin === "https://asset.invalid" &&
    (kind === "module"
      ? /\.m?js$/.test(url.pathname)
      : url.pathname.endsWith(".css"));
}
