const language = document.querySelector('select[name="language"]');
language.addEventListener("change", async () => {
  const selected = language.value;
  const url = new URL(location.href);
  url.searchParams.set("language", selected);
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Could not load the selected language");
    const page = new DOMParser().parseFromString(
      await response.text(),
      "text/html",
    );
    if (language.value !== selected) return;
    for (const element of document.querySelectorAll("[data-i18n]")) {
      element.textContent = page.querySelector(
        `[data-i18n="${element.dataset.i18n}"]`,
      ).textContent;
    }
    document.title = page.title;
    document.documentElement.lang = page.documentElement.lang;
    document.documentElement.dir = page.documentElement.dir;
  } catch (error) {
    console.error(error);
  }
});
