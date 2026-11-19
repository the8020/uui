import { text as localizedText } from "/p/the8020/i18n/mod.ts";
import { msg } from "/p/the8020/uui/i18n/messages.ts";
import { requirePermission } from "/p/the8020/auth/mod.ts";
import {
  BACK_EVENT,
  callScreen,
  describeError,
  field,
  fileUpload,
  Model,
  sendMessage,
  z,
} from "../../mod.ts";
import {
  BRANDING_PERMISSION,
  fetchBranding,
  PUBLIC_BRANDING_PATH,
  saveBranding,
  validateBrandingImage,
} from "../../branding.ts";
import {
  DEFAULT_SERVER_TITLE,
  serverTitle,
} from "../../src/branding_fields.ts";
import {
  type BrandingImage,
  brandingImage,
  MAX_IMAGE_UPLOAD,
} from "../../src/branding_images.ts";

const schema = z.object({
  title: field(serverTitle, { length: "full" }),
  logo: field(z.string(), {
    label: msg("program.system_logo"),
    description: msg("program.logo_help"),
    fieldHelp: false,
    rowSpan: 2,
  }),
  favicon: field(z.string(), {
    label: msg("program.favicon"),
    description: msg("program.square_png_cropped_and_resized_to_64"),
    fieldHelp: false,
    rowSpan: 2,
  }),
  social: field(z.string(), {
    label: msg("program.social_preview"),
    description: msg("program.centered_crop_to_1200_630_pixels_saved"),
    fieldHelp: false,
    rowSpan: 4,
    length: "long",
  }),
});

export default async function systemCustomization(): Promise<void> {
  try {
    await requirePermission(BRANDING_PERMISSION, "");
  } catch (error) {
    sendMessage(describeError(error), "error");
    return;
  }
  let saved = await fetchBranding();
  const model = new Model({
    title: saved.title,
    logo: "",
    favicon: "",
    social: "",
  });
  const draft: Partial<Record<BrandingImage, Uint8Array | null>> = {};
  while (true) {
    const controls = (["favicon", "logo", "social"] as const).map((kind) => {
      const upload = fileUpload({
        maximumBytes: MAX_IMAGE_UPLOAD,
        accept: "image/*",
      });
      upload.custom.channel!.subscribe("preview", async () => {
        const bytes = draft[kind];
        if (bytes) {
          await upload.custom.channel!.send(
            "preview",
            new Blob([new Uint8Array(bytes)]).stream(),
          ).done;
        }
      });
      return {
        kind,
        upload,
        control: {
          id: kind,
          bind: kind,
          custom: {
            ...upload.custom,
            module: "/the8020/uui/shell/system-customization.js",
            styles: ["/the8020/uui/shell/system-customization.css"],
            config: {
              kind,
              accept: "image/*",
              preview: kind === "logo"
                ? saved.logo
                : `${PUBLIC_BRANDING_PATH}${
                  brandingImage[kind].file
                }?v=${saved.revision}`,
              useDefault: draft[kind] === null,
            },
          },
        },
      };
    });
    const event = await callScreen({
      id: "system-customization",
      title: msg("program.system_customization"),
      schema,
      model,
      controls: [
        { id: "title", bind: "title" },
        ...controls.map(({ control }) => control),
      ],
      header: {
        actions: [{ id: "save", label: msg("program.save"), kind: "primary" }],
      },
      actions: [{
        id: "default-favicon",
        label: msg("program.use_default_favicon"),
      }, {
        id: "default-social",
        label: msg("program.use_default_preview"),
      }, {
        id: "default-logo",
        label: msg("program.use_default_logo"),
      }, { id: "default-title", label: msg("program.use_default_title") }],
      layout: {
        schema: 1,
        id: "system-customization",
        root: {
          type: "stack",
          children: [
            {
              type: "field-group",
              title: msg("program.browser"),
              controls: ["title", "logo", "favicon"],
              actions: ["default-title", "default-logo", "default-favicon"],
            },
            {
              type: "field-group",
              title: msg("program.social_preview"),
              controls: ["social"],
              actions: ["default-social"],
            },
          ],
        },
      },
    });
    if (event.action === BACK_EVENT) return;
    try {
      for (const { kind, upload } of controls) {
        if (model.data[kind]) {
          const { convertBrandingImage } = await import(
            "../../src/branding_conversion.ts"
          );
          const bytes = await convertBrandingImage(kind, upload.take());
          validateBrandingImage(kind, bytes);
          draft[kind] = bytes;
        }
      }
      if (event.action === "default-title") {
        model.data.title = DEFAULT_SERVER_TITLE;
      }
      if (event.action === "default-logo") draft.logo = null;
      if (event.action === "default-favicon") draft.favicon = null;
      if (event.action === "default-social") draft.social = null;
      if (event.action === "save") {
        await saveBranding({ title: model.data.title, ...draft });
        saved = await fetchBranding();
        delete draft.logo;
        delete draft.favicon;
        delete draft.social;
        sendMessage(
          localizedText(msg("program.system_customization_saved")),
          "success",
        );
      }
    } catch (error) {
      sendMessage(describeError(error), "error");
    }
    model.data.logo = "";
    model.data.favicon = "";
    model.data.social = "";
  }
}
