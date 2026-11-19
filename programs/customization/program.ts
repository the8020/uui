import { text as localizedText } from "/p/the8020/i18n/mod.ts";
import { msg } from "/p/the8020/uui/i18n/messages.ts";
import {
  BACK_EVENT,
  callScreen,
  describeError,
  field,
  Model,
  presentModal,
  sendMessage,
  z,
} from "../../mod.ts";
import {
  fetchUserPreferences,
  fetchUserShortcuts,
  saveUserPreferences,
} from "../../preferences.ts";
import { userPreferences } from "../../src/preference_fields.ts";
import { shortcutFields } from "../../shortcuts.ts";
import { fieldMetadata } from "../../fields.ts";
import { personalShortcuts } from "../../src/shortcut_fields.ts";
import { validationError } from "/p/the8020/i18n/validation.ts";

export default async function customization(): Promise<void> {
  const fields = shortcutFields();
  const Customization = z.object({
    accentColor: field(userPreferences.shape.accentColor, { control: "color" }),
    shortcuts: z.object({
      selected: z.boolean(),
      shortcut: field(z.string(), fieldMetadata(fields.shortcut)!),
      program: field(z.string(), fieldMetadata(fields.program)!),
    }).array().max(100),
  });
  const read = async () => ({
    ...await fetchUserPreferences(),
    shortcuts: (await fetchUserShortcuts()).map((row) => ({
      ...row,
      selected: false,
    })),
  });
  const model = new Model(await read());
  const edit = async (index?: number) => {
    const draft = new Model(
      index === undefined
        ? { shortcut: "", program: "" }
        : { ...model.data.shortcuts[index]! },
    );
    await presentModal(async () => {
      while (true) {
        const event = await callScreen({
          id: "shortcut-entry",
          title: fieldMetadata(fields.shortcut)!.label!,
          model: draft,
          schema: Customization.shape.shortcuts.element.omit({
            selected: true,
          }),
          controls: [{ bind: "shortcut" }, { bind: "program" }],
          header: {
            actions: [{
              id: "done",
              label: msg("field_help.done"),
              kind: "primary",
            }],
          },
        });
        if (event.action === BACK_EVENT) return;
        if (event.action !== "done") continue;
        const rows = [...model.data.shortcuts];
        const row = {
          shortcut: draft.data.shortcut.trim().toUpperCase(),
          program: draft.data.program.trim(),
          selected: false,
        };
        if (index === undefined) rows.push(row);
        else rows[index] = row;
        try {
          personalShortcuts.parse(rows, { error: validationError });
          model.data.shortcuts = rows;
          return;
        } catch (error) {
          sendMessage(describeError(error), "error");
        }
      }
    });
  };
  let defaultColor: string | undefined;
  while (true) {
    const event = await callScreen({
      id: "customization",
      title: msg("shell.customization"),
      schema: Customization,
      model,
      controls: [{ id: "accent-color", bind: "accentColor" }, {
        id: "shortcuts",
        bind: "shortcuts",
      }],
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
          type: "stack",
          children: [
            {
              type: "field-group",
              title: msg("program.appearance"),
              controls: ["accent-color"],
            },
            {
              type: "list",
              id: "shortcut-list",
              title: msg("shortcuts.title"),
              bind: "shortcuts",
              display: ["shortcut", "program"],
              selection: "selected",
              toolbar: [
                { id: "add-shortcut", label: msg("selection.add") },
                {
                  id: "delete-shortcuts",
                  label: msg("layouts.delete"),
                  kind: "danger",
                  requiresSelection: true,
                },
              ],
            },
          ],
        },
      },
    });
    if (event.action === BACK_EVENT) return;
    if (event.action === "add-shortcut") {
      await edit();
    }
    if (
      event.action === "select" && typeof event.value === "number" &&
      model.data.shortcuts[event.value]
    ) {
      await edit(event.value);
    }
    if (event.action === "delete-shortcuts") {
      model.data.shortcuts = model.data.shortcuts.filter((row) =>
        !row.selected
      );
    }
    if (event.action === "use-default") {
      model.data.accentColor = (await fetchUserPreferences("")).accentColor;
      defaultColor = model.data.accentColor;
    } else if (event.action === "save") {
      try {
        await saveUserPreferences({
          accentColor: model.data.accentColor === defaultColor
            ? null
            : model.data.accentColor,
          shortcuts: model.data.shortcuts.map((row) => ({
            shortcut: row.shortcut.trim(),
            program: row.program.trim(),
          })),
        });
      } catch (error) {
        sendMessage(describeError(error, Customization), "error");
        continue;
      }
      sendMessage(localizedText(msg("program.customization_saved")), "success");
      return;
    }
  }
}
