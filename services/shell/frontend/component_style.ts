import type { ComponentStyle } from "/p/the8020/uui/protocol.ts";

const restore = new WeakMap<HTMLElement, () => void>();

/** Replace authored styling without erasing framework or custom-host styling. */
export function applyComponentStyle(
  root: HTMLElement,
  descriptor: ComponentStyle,
): void {
  restore.get(root)?.();
  restore.delete(root);
  if (!descriptor.class && !descriptor.style) return;
  const classes = (descriptor.class?.match(/[^\t\n\f\r ]+/g) ?? [])
    .filter((name) => !root.classList.contains(name));
  root.classList.add(...classes);
  const css = document.createElement("div").style;
  css.cssText = descriptor.style ?? "";
  const previous = [...css].map((name) => ({
    name,
    value: root.style.getPropertyValue(name),
    priority: root.style.getPropertyPriority(name),
  }));
  for (const name of css) {
    root.style.setProperty(
      name,
      css.getPropertyValue(name),
      css.getPropertyPriority(name),
    );
  }
  if (classes.length || previous.length) {
    restore.set(root, () => {
      root.classList.remove(...classes);
      for (const { name, value, priority } of previous) {
        root.style.setProperty(name, value, priority);
      }
    });
  }
}
