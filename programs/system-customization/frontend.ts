import type { CustomElementContext } from "../../custom_element.ts";
import mountFile from "../../services/shell/frontend/components/file-upload/input.ts";
import {
  type BrandingImage,
  brandingImage,
} from "../../src/branding_images.ts";

export default function mount(context: CustomElementContext) {
  const kind = context.config.kind as BrandingImage;
  const preview = document.createElement("img");
  const chooser = document.createElement("button");
  chooser.type = "button";
  chooser.className = "branding-preview";
  chooser.setAttribute("aria-label", context.control?.label ?? kind);
  const wordmark = document.createElement("span");
  wordmark.textContent = "80|20";
  wordmark.className = "brand";
  chooser.append(preview, wordmark);
  context.host.classList.add("branding-image-picker");
  preview.alt = "";
  preview.style.maxHeight = kind === "social" ? "150px" : "48px";
  let objectURL: string | undefined;
  const show = (blob: Blob) => {
    if (objectURL) URL.revokeObjectURL(objectURL);
    preview.hidden = false;
    wordmark.hidden = true;
    preview.src = objectURL = URL.createObjectURL(blob);
  };
  const refresh = () => {
    const source = kind === "logo"
      ? context.config.useDefault ? null : context.config.preview
      : context.config.useDefault
      ? `/the8020/uui/shell/default-${brandingImage[kind].file}`
      : context.config.preview;
    preview.hidden = !source;
    wordmark.hidden = Boolean(source);
    if (source) preview.src = String(source);
  };
  refresh();
  const channel = context.channel;
  const subscription = channel.subscribe("preview", async (_id, source) => {
    if (!(source instanceof ReadableStream)) return;
    const blob = await new Response(source).blob();
    if (!context.signal.aborted) {
      show(new Blob([blob], { type: brandingImage[kind].type }));
    }
  });
  void channel.send("preview", null);
  const input = mountFile(context, (file) => {
    show(file);
    return Promise.resolve(file);
  });
  context.host.prepend(chooser);
  chooser.addEventListener("click", () => {
    context.host.querySelector<HTMLInputElement>('input[type="file"]')?.click();
  });
  return {
    ...input,
    update(config: Record<string, unknown>) {
      input.update?.(config);
      refresh();
      void context.channel.send("preview", null);
    },
    dispose() {
      subscription.unsubscribe();
      if (objectURL) URL.revokeObjectURL(objectURL);
    },
  };
}
