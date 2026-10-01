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
      title: "Customization",
      schema: Customization,
      model,
      controls: [{ id: "accent-color", bind: "accentColor" }],
      header: {
        actions: [
          { id: "save", label: "[[icon=save]] Save", kind: "primary" },
          { id: "use-default", label: "Use system default" },
        ],
      },
      layout: {
        schema: 1,
        id: "customization",
        root: {
          type: "field-group",
          title: "Appearance",
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
      sendMessage("Customization saved.", "success");
    }
  }
}
