/** Lines of values the compact bar shows before it summarizes the rest. */
export const SUMMARY_LINES = 3;

/**
 * A modal's compact copy of its `summary` field group, shown under the dialog
 * toolbar (outside the scrolling body, so nothing passes beneath it) once the
 * group's value has scrolled out of view. Values come from the rendered group:
 * removing one here removes it there. A search mirrors the list's search.
 */
export class SummaryBar {
  readonly element = document.createElement("div");
  readonly #label = document.createElement("span");
  readonly #values = document.createElement("div");
  readonly #search = document.createElement("input");
  readonly #resize: ResizeObserver;
  #intersection: IntersectionObserver | undefined;
  #mutation: MutationObserver | undefined;
  #source: HTMLElement | undefined;
  #away = false;

  constructor(private readonly body: HTMLElement) {
    this.element.className = "uui-summary-bar";
    this.element.hidden = true;
    this.#label.className = "uui-summary-label";
    this.#values.className = "uui-summary-values";
    this.#search.type = "search";
    this.#search.className = "uui-summary-search";
    this.#search.placeholder = "Search…";
    this.#search.setAttribute("aria-label", "Search list");
    // The list's own search owns the query; this one only types into it.
    this.#search.addEventListener("input", () => {
      const list = this.listSearch();
      if (list === null) return;
      list.value = this.#search.value;
      list.dispatchEvent(new Event("input", { bubbles: true }));
    });
    this.#search.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.isComposing) return;
      event.preventDefault();
      this.listSearch()?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    const values = document.createElement("div");
    values.className = "uui-summary-field";
    values.append(this.#label, this.#values);
    this.element.append(values, this.#search);
    body.before(this.element);
    this.#resize = new ResizeObserver(() => this.cap());
    this.#resize.observe(this.element);
  }

  /** Follow the current render: the group is replaced on every redraw. */
  update(): void {
    this.#intersection?.disconnect();
    this.#mutation?.disconnect();
    this.#source = this.body.querySelector<HTMLElement>(
      '[data-summary="true"]',
    ) ?? undefined;
    if (this.#source === undefined) {
      this.#away = false;
      this.render();
      return;
    }
    const target = this.#source.querySelector<HTMLElement>(
      ".field-input-shell",
    ) ?? this.#source;
    this.#intersection = new IntersectionObserver((entries) => {
      this.#away = !entries.at(-1)!.isIntersecting;
      this.render();
    }, { root: this.body });
    this.#intersection.observe(target);
    this.#mutation = new MutationObserver(() => this.render());
    this.#mutation.observe(this.#source, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    this.#source.addEventListener("input", () => this.render());
    this.render();
  }

  dispose(): void {
    this.#intersection?.disconnect();
    this.#mutation?.disconnect();
    this.#resize.disconnect();
    this.element.remove();
  }

  private listSearch(): HTMLInputElement | null {
    return this.body.querySelector<HTMLInputElement>(".data-list-search");
  }

  private render(): void {
    const source = this.#source;
    this.element.hidden = source === undefined || !this.#away;
    if (source === undefined || !this.#away) return;
    this.#label.textContent =
      source.querySelector(".field label, .field legend")?.textContent ?? "";
    const tags = source.querySelector(".field-tags");
    if (tags === null) {
      const input = source.querySelector<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >("input, textarea, select");
      const value = document.createElement("span");
      value.className = "uui-summary-value";
      value.textContent = input?.value ?? "";
      this.#values.replaceChildren(value);
    } else {
      this.#values.replaceChildren(
        ...[...tags.querySelectorAll<HTMLElement>(".field-tag")].map((tag) => {
          const chip = document.createElement("span");
          chip.className = `uui-summary-tag ${
            tag.classList.contains("is-expression") ? "is-expression" : ""
          }`;
          chip.title = tag.title;
          chip.textContent =
            tag.querySelector(".field-tag-text")?.textContent ?? "";
          const remove = tag.querySelector<HTMLButtonElement>(
            ".field-tag-remove",
          );
          if (remove !== null) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "uui-summary-tag-remove";
            button.textContent = "×";
            button.setAttribute(
              "aria-label",
              remove.getAttribute("aria-label") ?? "Remove",
            );
            // The field's own button edits the model and redraws both.
            button.addEventListener("click", () => remove.click());
            chip.append(button);
          }
          return chip;
        }),
      );
    }
    if (document.activeElement !== this.#search) {
      this.#search.value = this.listSearch()?.value ?? "";
    }
    this.#search.hidden = this.listSearch() === null;
    this.cap();
  }

  /** Show at most three lines of values; the rest become "+N more". */
  private cap(): void {
    if (this.element.hidden) return;
    this.#values.querySelector(".uui-summary-more")?.remove();
    const chips = [
      ...this.#values.querySelectorAll<HTMLElement>(".uui-summary-tag"),
    ];
    for (const chip of chips) chip.hidden = false;
    const lines = () =>
      [
        ...new Set(
          chips.filter((chip) => !chip.hidden)
            .map((chip) => chip.offsetTop),
        ),
      ].sort((a, b) => a - b);
    const all = lines();
    if (all.length <= SUMMARY_LINES) return;
    const last = all[SUMMARY_LINES - 1]!;
    for (const chip of chips) if (chip.offsetTop > last) chip.hidden = true;
    const more = document.createElement("button");
    more.type = "button";
    more.className = "uui-summary-more";
    more.title = "Show all values";
    more.addEventListener("click", () => {
      this.body.scrollTo({ top: 0, behavior: "smooth" });
    });
    this.#values.append(more);
    const label = () =>
      more.textContent = `+${chips.filter((chip) => chip.hidden).length} more`;
    label();
    // Make room on the last line for the summary itself.
    const visible = chips.filter((chip) => !chip.hidden);
    while (more.offsetTop > last && visible.length > 0) {
      visible.pop()!.hidden = true;
      label();
    }
  }
}
