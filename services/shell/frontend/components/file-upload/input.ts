import type {
  CustomElementContext,
  CustomElementInstance,
} from "../../../../../custom_element.ts";

export default function mount(
  context: CustomElementContext,
  prepare?: (file: File) => Promise<Blob>,
): CustomElementInstance {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = String(context.config.accept ?? "");
  input.setAttribute("aria-label", context.control?.label ?? "File");
  input.style.width = "100%";
  input.style.color = "inherit";
  let active = true;
  let uploading = false;
  const update = () => {
    input.disabled = !active || uploading || Boolean(context.control?.readOnly);
  };
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file || uploading || context.control?.readOnly) return;
    const channel = context.channel;
    uploading = true;
    context.setValue("");
    input.setAttribute("aria-busy", "true");
    update();
    try {
      const content = prepare ? await prepare(file) : file;
      await channel.send("file", content.stream(), { signal: context.signal })
        .done;
      if (!context.signal.aborted) context.setValue(file.name);
    } catch {
      input.value = "";
    } finally {
      uploading = false;
      input.removeAttribute("aria-busy");
      update();
    }
  });
  context.host.replaceChildren(input);
  update();
  return {
    update,
    setActive(value) {
      active = value;
      update();
    },
  };
}
