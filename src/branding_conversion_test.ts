import { assertEquals, assertRejects } from "@std/assert";
// @deno-types="../vendor/imagescript/dist/index.d.ts"
import { Image } from "../vendor/imagescript/dist/index.js";
import { convertBrandingImage } from "./branding_conversion.ts";
import { MAX_IMAGE_UPLOAD } from "./branding_images.ts";
import { validateBrandingImage } from "../branding.ts";

Deno.test("backend branding conversion preserves supported ratios and crops only the longer side", async () => {
  for (
    const [width, height, expected] of [
      [100, 100, [128, 128]],
      [160, 90, [228, 128]],
      [300, 100, [384, 128]],
      [600, 100, [384, 128]],
      [100, 300, [128, 128]],
    ] as const
  ) {
    const source = new Image(width, height).fill((x, y) =>
      (width > 300 && (x < 100 || x >= 500)) ||
        (height > 100 && (y < 100 || y >= 200))
        ? 0xff0000ff
        : 0x00ff00ff
    );
    const bytes = await convertBrandingImage("logo", await source.encodePNG());
    validateBrandingImage("logo", bytes);
    const result = await Image.decode(bytes);
    assertEquals<readonly number[]>([result.width, result.height], expected);
    assertEquals([...result.getRGBAAt(10, 10)], [0, 255, 0, 255]);
  }
  const transparent = new Image(160, 90);
  const png = await convertBrandingImage("logo", await transparent.encodePNG());
  assertEquals((await Image.decode(png)).getRGBAAt(10, 10)[3], 0);
  const source = new Image(300, 100).fill(0x00ff00ff);
  for (
    const data of [
      await source.encodeJPEG(),
      await source.encodeWebP({ threads: 1 }),
    ]
  ) {
    validateBrandingImage("logo", await convertBrandingImage("logo", data));
  }
  for (const kind of ["favicon", "social"] as const) {
    validateBrandingImage(
      kind,
      await convertBrandingImage(kind, await source.encodePNG()),
    );
  }
  await assertRejects(() =>
    convertBrandingImage("logo", new Uint8Array(MAX_IMAGE_UPLOAD + 1))
  );
  await assertRejects(() =>
    convertBrandingImage("logo", new TextEncoder().encode("not an image"))
  );
});
