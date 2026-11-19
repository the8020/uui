import { text as formatMessage } from "/p/the8020/i18n/mod.ts";
import { msg as messageSymbol } from "/p/the8020/uui/i18n/messages.ts";
import { DEFAULT_SERVER_TITLE, serverTitle } from "./src/branding_fields.ts";
import { type BrandingImage, brandingImage } from "./src/branding_images.ts";

export const BRANDING_PERMISSION = "the8020.uui.branding.edit";
export const PUBLIC_BRANDING_PATH = "/the8020/uui/login/branding/";

export async function fetchBranding() {
  const { default: Branding } = await import("./tables/branding.ts");
  const row = await Branding.select([Branding.title, Branding.revision])
    .select((eb) => eb(Branding.logo, "is not", null).as("hasLogo"))
    .where(Branding.id, "=", 1).executeTakeFirst();
  return {
    title: row?.title ?? DEFAULT_SERVER_TITLE,
    revision: row?.revision ?? "default",
    logo: row?.hasLogo
      ? `${PUBLIC_BRANDING_PATH}logo.png?v=${row.revision}`
      : null,
  };
}

export async function fetchBrandingImage(
  kind: BrandingImage,
): Promise<Uint8Array | null> {
  const { default: Branding } = await import("./tables/branding.ts");
  const row = await Branding.select([Branding[kind]])
    .where(Branding.id, "=", 1).executeTakeFirst();
  return row?.[kind] ?? null;
}

/** Only bounded, passive PNG/JPEG representations may be published. */
export function validateBrandingImage(
  kind: BrandingImage,
  bytes: Uint8Array,
): void {
  const expected = brandingImage[kind];
  let width = 0, height = 0;
  if (bytes.byteLength > expected.maximumBytes) {
    throw new Error(
      formatMessage(messageSymbol("errors.converted_image_is_too_large")),
    );
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (expected.type === "image/png") {
    if (
      bytes.length >= 45 && view.getUint32(0) === 0x89504e47 &&
      view.getUint32(4) === 0x0d0a1a0a && view.getUint32(8) === 13 &&
      view.getUint32(12) === 0x49484452 &&
      view.getUint32(bytes.length - 8) === 0x49454e44
    ) {
      width = view.getUint32(16);
      height = view.getUint32(20);
    }
  } else if (
    bytes.length >= 4 && view.getUint16(0) === 0xffd8 &&
    view.getUint16(bytes.length - 2) === 0xffd9
  ) {
    for (let offset = 2; offset + 4 <= bytes.length;) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1];
      const length = view.getUint16(offset + 2);
      if (length < 2 || offset + 2 + length > bytes.length) break;
      if ((marker === 0xc0 || marker === 0xc2) && length >= 8) {
        height = view.getUint16(offset + 5);
        width = view.getUint16(offset + 7);
        break;
      }
      offset += length + 2;
    }
  }
  const validSize = kind === "logo"
    ? width > 0 && height > 0 && width <= expected.width &&
      height <= expected.height &&
      width / height >= brandingImage.logo.minimumRatio &&
      width / height <= brandingImage.logo.maximumRatio
    : width === expected.width && height === expected.height;
  if (!validSize) {
    throw new Error(
      formatMessage(
        messageSymbol("errors.select_a_valid_image", {
          value1: String(expected.width),
          value2: String(expected.height),
          kind: String(kind),
        }),
      ),
    );
  }
}

export async function saveBranding(input: {
  title: string;
  logo?: Uint8Array | null;
  favicon?: Uint8Array | null;
  social?: Uint8Array | null;
}): Promise<void> {
  const { requirePermission } = await import("/p/the8020/auth/mod.ts");
  await requirePermission(BRANDING_PERMISSION, "");
  const title = serverTitle.parse(input.title);
  for (const kind of ["logo", "favicon", "social"] as const) {
    if (input[kind] != null) validateBrandingImage(kind, input[kind]);
  }
  const { db } = await import("/p/the8020/db/mod.ts");
  const { default: Branding } = await import("./tables/branding.ts");
  const changes = {
    title,
    revision: crypto.randomUUID(),
    ...(input.logo !== undefined ? { logo: input.logo } : {}),
    ...(input.favicon !== undefined ? { favicon: input.favicon } : {}),
    ...(input.social !== undefined ? { social: input.social } : {}),
  };
  await db.insertInto(Branding.table).values({
    id: 1,
    logo: null,
    favicon: null,
    social: null,
    ...changes,
  })
    .onConflict((conflict) => conflict.column("id").doUpdateSet(changes))
    .execute();
}
