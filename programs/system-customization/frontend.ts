import type { CustomElementContext } from "../../custom_element.ts";
import mountFile from "../../services/shell/frontend/components/file-upload/input.ts";
import {
  type BrandingImage,
  brandingImage,
} from "../../src/branding_images.ts";

export async function convertImage(
  file: Blob,
  kind: BrandingImage,
): Promise<Blob> {
  if (file.size > 10 * 1024 * 1024) {
    throw new Error("Choose an image no larger than 10 MiB.");
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Choose an image your browser can open.");
  }
  try {
    if (bitmap.width * bitmap.height > 40_000_000) {
      throw new Error("Choose an image with at most 40 million pixels.");
    }
    const { width, height, type, maximumBytes } = brandingImage[kind];
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d")!;
    if (kind === "social") {
      context.fillStyle = "#10121d";
      context.fillRect(0, 0, width, height);
    }
    const scale = Math.max(width / bitmap.width, height / bitmap.height);
    const cropWidth = width / scale, cropHeight = height / scale;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      bitmap,
      (bitmap.width - cropWidth) / 2,
      (bitmap.height - cropHeight) / 2,
      cropWidth,
      cropHeight,
      0,
      0,
      width,
      height,
    );
    const result = await canvas.convertToBlob({ type, quality: 0.85 });
    if (result.size > maximumBytes) {
      throw new Error("Converted image is too large. Choose a simpler image.");
    }
    return result;
  } finally {
    bitmap.close();
  }
}

export default function mount(context: CustomElementContext) {
  const kind = context.config.kind as BrandingImage;
  const preview = document.createElement("img");
  preview.alt = kind === "favicon" ? "Favicon preview" : "Social preview";
  preview.style.cssText = `display:block;max-width:100%;height:${
    kind === "favicon" ? "48px" : "150px"
  };object-fit:contain;object-position:left;margin-bottom:8px`;
  let objectURL: string | undefined;
  const show = (blob: Blob) => {
    if (objectURL) URL.revokeObjectURL(objectURL);
    preview.src = objectURL = URL.createObjectURL(blob);
  };
  preview.src = context.config.useDefault
    ? `/the8020/uui/shell/default-${brandingImage[kind].file}`
    : String(context.config.preview);
  const channel = context.channel;
  const subscription = channel.subscribe("preview", async (_id, source) => {
    if (!(source instanceof ReadableStream)) return;
    const blob = await new Response(source).blob();
    if (!context.signal.aborted) {
      show(new Blob([blob], { type: brandingImage[kind].type }));
    }
  });
  void channel.send("preview", null);
  const input = mountFile(context, async (file) => {
    try {
      const result = await convertImage(file, kind);
      context.signal.throwIfAborted();
      show(result);
      return result;
    } catch (error) {
      if (!context.signal.aborted) {
        channel.send(
          "image-error",
          error instanceof Error ? error.message : "Image conversion failed.",
        );
      }
      throw error;
    }
  });
  context.host.prepend(preview);
  return {
    ...input,
    dispose() {
      subscription.unsubscribe();
      if (objectURL) URL.revokeObjectURL(objectURL);
    },
  };
}
