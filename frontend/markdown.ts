import MarkdownIt from "markdown-it";

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
});

// Rendered Markdown is intentionally textual. Remote images would add
// tracking, unpredictable loading, and unbounded layout geometry.
markdown.disable("image");

export function renderMarkdownHTML(source: string): string {
  return markdown.render(source);
}

export function renderMarkdown(target: HTMLElement, source: string): void {
  target.classList.add("markdown");
  target.innerHTML = renderMarkdownHTML(source);
  for (const link of target.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }
}
