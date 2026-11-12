import { z } from "/p/the8020/db/fields.ts";
import {
  type Selection,
  selectionOptions,
  selectionSchema,
} from "/p/the8020/db/selection.ts";
import { buildFieldCatalog, field } from "./fields.ts";
import { runFieldHelp, valueHelpFor } from "./field_help.ts";
import { Model } from "./model.ts";
import { BACK_EVENT, type ControlDescriptor } from "./protocol.ts";
import { callScreen, presentModal, sendMessage } from "./session.ts";
import { msg } from "./i18n/messages.ts";

/** All criteria stay in the draft; ordinary lists project only their visible page. */
export async function runSelectionHelp(
  schema: z.ZodType,
  element: z.ZodType,
  control: ControlDescriptor,
  binding: { get(): unknown; set(value: unknown): void },
  layoutKey?: string,
): Promise<void> {
  let criteria = structuredClone(binding.get() ?? []) as Selection[];
  const editable = !control.readOnly;
  const valueSchema = field(element, {
    valueHelp: valueHelpFor(schema, control),
  });
  const valueControl: ControlDescriptor = {
    ...buildFieldCatalog(z.object({ value: valueSchema }))[0]!,
    id: "value",
  };
  valueControl.options = control.options ?? valueControl.options;
  const row = z.object({
    index: field(z.number(), { hidden: true }),
    sign: field(z.enum(["I", "E"]), { label: msg("selection.sign") }),
    option: field(z.enum(selectionOptions), {
      label: msg("selection.operator"),
    }),
    low: field(z.unknown(), { label: msg("selection.low") }),
    high: field(z.unknown().optional(), { label: msg("selection.high") }),
  });
  const model = new Model({ rows: [] as z.output<typeof row>[] });
  let index: number | undefined;
  const edit = async (current?: number) => {
    const entry = new Model<Selection & { nullValue: boolean }>({
      ...structuredClone(
        current === undefined
          ? {
            sign: "I",
            option: "EQ",
            low: valueControl.control === "checkbox"
              ? false
              : valueControl.options?.[0]?.value ?? "",
          }
          : criteria[current]!,
      ),
      nullValue: current !== undefined && criteria[current]!.low === null,
    });
    await presentModal(async () => {
      while (true) {
        const pattern = entry.data.option === "CP";
        const fields = z.object({
          sign: field(z.enum(["I", "E"]), {
            label: msg("selection.sign"),
            options: [{ value: "I", label: msg("selection.include") }, {
              value: "E",
              label: msg("selection.exclude"),
            }],
          }),
          option: field(z.enum(selectionOptions), {
            label: msg("selection.operator"),
            reactive: true,
          }),
          // Validate the complete entry on Save; invalid drafts remain cancellable.
          low: z.unknown(),
          high: z.unknown().optional(),
          nullValue: z.boolean(),
        });
        const event = await callScreen({
          id: "uui-selection-entry",
          title: msg("selection.criteria"),
          schema: fields,
          model: entry,
          controls: [
            { bind: "sign" },
            { bind: "option" },
            {
              bind: "nullValue",
              label: "∅",
              reactive: true,
              hidden: !element.isNullable() ||
                !["EQ", "NE"].includes(entry.data.option),
            },
            {
              ...valueControl,
              id: "low",
              bind: "low",
              label: msg("selection.low"),
              control: pattern ? "text" : valueControl.control,
              options: pattern ? undefined : valueControl.options,
              fieldHelp: false,
              hidden: entry.data.nullValue &&
                ["EQ", "NE"].includes(entry.data.option),
              required: true,
            },
            {
              ...valueControl,
              id: "high",
              bind: "high",
              label: msg("selection.high"),
              fieldHelp: false,
              hidden: entry.data.option !== "BT",
            },
          ],
          header: {
            actions: [{
              id: "save",
              label: msg("layouts.save"),
              kind: "primary",
            }],
          },
        });
        if (event.action === BACK_EVENT) return;
        if (entry.data.option !== "BT") delete entry.data.high;
        if (event.action !== "save") continue;
        try {
          const { nullValue, ...item } = entry.data;
          if (nullValue && ["EQ", "NE"].includes(item.option)) item.low = null;
          const parsed = selectionSchema(element).parse([item])[0]!;
          if (current === undefined) {
            criteria.push(parsed);
            index = criteria.length - 1;
          } else criteria[current] = parsed;
          return;
        } catch (error) {
          sendMessage(
            error instanceof Error ? error.message : "Invalid selection",
            "error",
          );
        }
      }
    });
  };
  while (true) {
    model.data.rows = criteria.map((item, index) => ({ ...item, index }));
    const event = await callScreen({
      id: "uui-selection-help",
      title: control.label ?? control.bind,
      description: control.description,
      schema: z.object({ rows: row.array() }),
      model,
      controls: [{ id: "criteria-field", bind: "rows", readOnly: true }],
      layout: {
        schema: 1,
        id: "selection-help",
        root: {
          type: "list",
          id: "criteria",
          bind: "rows",
          key: "index",
          display: ["sign", "option", "low", "high"],
          title: msg("selection.criteria"),
          layoutKey,
          toolbar: editable
            ? [
              { id: "add", label: msg("selection.add") },
              ...(index === undefined
                ? []
                : [{ id: "edit", label: msg("renderer.edit") }, {
                  id: "delete",
                  label: msg("layouts.delete"),
                }]),
              ...(valueHelpFor(valueSchema, valueControl)
                ? [{ id: "values", label: msg("field_help.value_help") }]
                : []),
            ]
            : [],
        },
      },
      header: {
        actions: editable
          ? [{ id: "done", label: msg("field_help.done"), kind: "primary" }]
          : [],
      },
    });
    if (event.action === BACK_EVENT) return;
    if (event.action === "select") {
      index = typeof event.value === "number" ? event.value : undefined;
      if (event.eventType === "activate" && editable && index !== undefined) {
        await edit(index);
      }
    }
    if (!editable) continue;
    if (event.action === "add") await edit();
    if (event.action === "edit" && index !== undefined) await edit(index);
    if (event.action === "delete" && index !== undefined) {
      criteria.splice(index, 1);
      index = undefined;
    }
    if (event.action === "values") {
      const values = criteria.filter((item) =>
        item.sign === "I" && item.option === "EQ"
      ).map((item) => item.low);
      await presentModal(() =>
        runFieldHelp(valueSchema.array(), {
          ...valueControl,
          id: "values",
          bind: "value",
          control: "tags",
          multiple: {},
          hidden: true,
        }, {
          get: () => values,
          set: (value) => {
            const entries = (value as unknown[]).map((low): Selection => ({
              sign: "I",
              option: "EQ",
              low,
            }));
            criteria = selectionSchema(element).parse([
              ...criteria.filter((item) =>
                item.sign !== "I" || item.option !== "EQ"
              ),
              ...entries,
            ]);
            index = undefined;
          },
        }, layoutKey)
      );
    }
    if (event.action === "done") {
      try {
        binding.set(schema.parse(criteria));
        return;
      } catch (error) {
        sendMessage(
          error instanceof Error ? error.message : "Invalid selection",
          "error",
        );
      }
    }
  }
}
