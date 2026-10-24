export const GENERIC_WINDOW_TITLE = "80|20";

export function windowTitleForHeading(
  heading: string | null | undefined,
  serverTitle = GENERIC_WINDOW_TITLE,
): string {
  const title = heading?.replace(/\s+/g, " ").trim() ?? "";
  return title === "" ? serverTitle : `${serverTitle} ${title}`;
}
