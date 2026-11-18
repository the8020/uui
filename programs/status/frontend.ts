import type { CustomElementContext } from "../../custom_element.ts";

export default function mount({ host, config }: CustomElementContext) {
  const brand = document.createElement("div");
  brand.className = "brand";
  brand.dir = "ltr";
  brand.setAttribute("role", "img");
  brand.setAttribute("aria-label", "80|20");
  brand.style.cssText =
    "display:flex;justify-content:center;font-size:3rem;line-height:1.2;";
  for (
    const [content, className] of [["80", "brand-gold"], ["|", "brand-pipe"], [
      "20",
      "",
    ]] as const
  ) {
    const part = document.createElement("span");
    part.textContent = content;
    part.className = className;
    part.setAttribute("aria-hidden", "true");
    brand.append(part);
  }
  const credit = document.createElement("p");
  credit.textContent = String(config.credit);
  credit.style.color = "var(--muted)";
  const link = document.createElement("a");
  link.href = "https://github.com/the8020";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "GitHub";
  link.style.color = "var(--primary)";
  credit.append(" · ", link);
  host.style.cssText = "text-align:center;padding:1rem 0;";
  host.replaceChildren(brand, credit);
  return {};
}
