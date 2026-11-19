import { text } from "/p/the8020/i18n/mod.ts";
import { msg } from "../i18n/messages.ts";
import { type BrandingImage, brandingImage } from "./branding_images.ts";

// @deno-types="../vendor/imagescript/dist/index.d.ts"
import { Image } from "../vendor/imagescript/dist/index.js";
import { MAX_IMAGE_UPLOAD } from "./branding_images.ts";

/** Decode and publish only a bounded raster, with no uploaded metadata. */
export async function convertBrandingImage(
  kind: BrandingImage,
  bytes: Uint8Array,
): Promise<Uint8Array> {
  if (bytes.length > MAX_IMAGE_UPLOAD) {
    throw new Error(text(msg("frontend.choose_an_image_no_larger_than_10")));
  }
  let image;
  try {
    image = await Image.decode(bytes, { maxPixels: 40_000_000, threads: 1 });
  } catch {
    throw new Error(text(msg("frontend.image_conversion_failed")));
  }
  const target = brandingImage[kind];
  const ratio = kind === "logo"
    ? Math.min(
      brandingImage.logo.maximumRatio,
      Math.max(brandingImage.logo.minimumRatio, image.width / image.height),
    )
    : target.width / target.height;
  const width = Math.max(
    1,
    Math.round(Math.min(image.width, image.height * ratio)),
  );
  const height = Math.max(
    1,
    Math.round(Math.min(image.height, image.width / ratio)),
  );
  image.crop(
    Math.floor((image.width - width) / 2),
    Math.floor((image.height - height) / 2),
    width,
    height,
  );
  const scale = Math.min(
    target.width / image.width,
    target.height / image.height,
  );
  image.resize(
    kind === "logo"
      ? Math.max(1, Math.round(image.width * scale))
      : target.width,
    kind === "logo"
      ? Math.max(1, Math.round(image.height * scale))
      : target.height,
  );
  if (kind === "social") {
    image = new Image(image.width, image.height).fill(0x10121dff).composite(
      image,
    );
  }
  const output = kind === "social"
    ? await image.encodeJPEG({ quality: 85, metadata: {}, gainMap: false })
    : await image.encodePNG({ compression: 9, metadata: {} });
  if (output.length > target.maximumBytes) {
    throw new Error(text(msg("errors.converted_image_is_too_large")));
  }
  return output;
}
