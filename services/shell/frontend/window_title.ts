export const GENERIC_WINDOW_TITLE = "80|20";

export function windowTitleForHeading(
  heading: string | null | undefined,
): string {
  const title = heading?.replace(/\s+/g, " ").trim() ?? "";
  return title === ""
    ? GENERIC_WINDOW_TITLE
    : `${GENERIC_WINDOW_TITLE} ${title}`;
}
