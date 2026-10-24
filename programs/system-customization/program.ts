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
} from "../../src/branding_images.ts";

const schema = z.object({
  title: serverTitle,
  favicon: field(z.string(), {
    label: "Favicon",
    description:
      "Square PNG, cropped and resized to 64×64 pixels. Images up to 10 MiB.",
    fieldHelp: false,
    rowSpan: 2,
  }),
  social: field(z.string(), {
    label: "Social preview",
    description:
      "Centered crop to 1200×630 pixels, saved as JPEG. Images up to 10 MiB.",
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
  const model = new Model({ title: saved.title, favicon: "", social: "" });
  const draft: Partial<Record<BrandingImage, Uint8Array | null>> = {};
  while (true) {
    const controls = (["favicon", "social"] as const).map((kind) => {
      const upload = fileUpload({
        maximumBytes: brandingImage[kind].maximumBytes,
        accept: "image/*",
      });
      upload.custom.channel!.subscribe("image-error", (_id, message) => {
        if (typeof message === "string") {
          sendMessage(message.slice(0, 200), "error");
        }
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
            config: {
              kind,
              accept: "image/*",
              preview: `${PUBLIC_BRANDING_PATH}${
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
      title: "System customization",
      schema,
      model,
      controls: [
        { id: "title", bind: "title" },
        ...controls.map(({ control }) => control),
      ],
      header: {
        actions: [{ id: "save", label: "[[icon=save]] Save", kind: "primary" }],
      },
      actions: [{ id: "default-favicon", label: "Use default favicon" }, {
        id: "default-social",
        label: "Use default preview",
      }, { id: "default-title", label: "Use default title" }],
      layout: {
        schema: 1,
        id: "system-customization",
        root: {
          type: "stack",
          children: [
            {
              type: "field-group",
              title: "Browser",
              controls: ["title", "favicon"],
              actions: ["default-title", "default-favicon"],
            },
            {
              type: "field-group",
              title: "Social preview",
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
          const bytes = upload.take();
          validateBrandingImage(kind, bytes);
          draft[kind] = bytes;
        }
      }
      if (event.action === "default-title") {
        model.data.title = DEFAULT_SERVER_TITLE;
      }
      if (event.action === "default-favicon") draft.favicon = null;
      if (event.action === "default-social") draft.social = null;
      if (event.action === "save") {
        await saveBranding({ title: model.data.title, ...draft });
        saved = await fetchBranding();
        delete draft.favicon;
        delete draft.social;
        sendMessage("System customization saved.", "success");
      }
    } catch (error) {
      sendMessage(describeError(error), "error");
    }
    model.data.favicon = "";
    model.data.social = "";
  }
}
