import { text as localizedText } from "/p/the8020/i18n/mod.ts";
import { msg } from "/p/the8020/uui/i18n/messages.ts";
import {
  BACK_EVENT,
  callScreen,
  field,
  Model,
  sendMessage,
  z,
} from "../../mod.ts";
import {
  fetchUserPreferences,
  saveUserPreferences,
} from "../../preferences.ts";
import { userPreferences } from "../../src/preference_fields.ts";

const Customization = z.object({
  accentColor: field(userPreferences.shape.accentColor, { control: "color" }),
});

export default async function customization(): Promise<void> {
  const model = new Model(await fetchUserPreferences());
  let defaultColor: string | undefined;
  while (true) {
    const event = await callScreen({
      id: "customization",
      title: msg("shell.customization"),
      schema: Customization,
      model,
      controls: [{ id: "accent-color", bind: "accentColor" }],
      header: {
        actions: [
          { id: "save", label: msg("program.save"), kind: "primary" },
          { id: "use-default", label: msg("program.use_system_default") },
        ],
      },
      layout: {
        schema: 1,
        id: "customization",
        root: {
          type: "field-group",
          title: msg("program.appearance"),
          controls: ["accent-color"],
        },
      },
    });
    if (event.action === BACK_EVENT) return;
    if (event.action === "use-default") {
      model.data = await fetchUserPreferences("");
      defaultColor = model.data.accentColor;
    } else if (event.action === "save") {
      await saveUserPreferences({
        accentColor: model.data.accentColor === defaultColor
          ? null
          : model.data.accentColor,
      });
      model.data = await fetchUserPreferences();
      defaultColor = undefined;
      sendMessage(localizedText(msg("program.customization_saved")), "success");
    }
  }
}
