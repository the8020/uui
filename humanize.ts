export function humanize(value: string): string {
  const words = value
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .map((word) => /^[A-Z0-9]{2,}$/.test(word) ? word : word.toLowerCase());
  const text = words.join(" ");
  return text.length === 0 ? value : text[0]!.toUpperCase() + text.slice(1);
}
