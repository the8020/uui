import { z } from "@the8020/http";
import { field, fieldMetadata } from "./fields.ts";
import { queryValueHelp } from "./lists.ts";
import { Model } from "./model.ts";
import { BACK_EVENT, type ControlDescriptor } from "./protocol.ts";
import { callScreen, presentPage, sendMessage } from "./session.ts";
import type { ValueHelpPage, ValueHelpRequest } from "/p/the8020/db/fields.ts";
import { initialListState, screenElement } from "./screen_state.ts";

/** Shared provider selection for field help and direct agent value-help queries. */
export function valueHelpFor(schema: z.ZodType, control: ControlDescriptor) {
  const metadata = fieldMetadata(schema);
  return metadata?.valueHelp ??
    (control.options === undefined
      ? undefined
      : (request: ValueHelpRequest) =>
        queryValueHelp(
          z.object({
            value: field(schema, { label: "Value" }),
            label: field(z.string(), {
              label: "Label",
              description: "The displayed name of this choice.",
            }),
          }),
          control.options!.map(({ value, label }) => ({ value, label })),
          request,
        ));
}

export async function readValueHelp(
  provider: NonNullable<ReturnType<typeof valueHelpFor>>,
  request: ValueHelpRequest,
): Promise<ValueHelpPage> {
  const result = await provider(request);
  if (
    !(result.schema instanceof z.ZodObject) ||
    Object.keys(result.schema.shape).length === 0
  ) {
    throw new TypeError(
      "Value help requires a row schema with a selection key first",
    );
  }
  if (
    !Array.isArray(result.rows) || result.rows.length > request.limit ||
    typeof result.more !== "boolean"
  ) {
    throw new TypeError(
      "Value help returned an invalid page or more than the requested limit",
    );
  }
  return { ...result, rows: result.schema.array().parse(result.rows) };
}

/** An isolated draft: only Done commits through the caller's complete schema. */
export async function runFieldHelp(
  schema: z.ZodType,
  control: ControlDescriptor,
  binding: { get(): unknown; set(value: unknown): void },
): Promise<void> {
  const metadata = fieldMetadata(schema);
  const valueHelp = valueHelpFor(schema, control);
  let rowSchema: z.ZodObject = z.object({});
  const model = new Model({
    value: structuredClone(binding.get()),
    choices: [] as Record<string, unknown>[],
  });
  const element = screenElement(model.screen, "choices");
  element.toolbarOpen = true;
  const listState = element.list = initialListState();
  let page: ValueHelpPage | undefined;
  const load = async (): Promise<void> => {
    if (valueHelp === undefined) return;
    page = undefined;
    model.data.choices = [];
    try {
      page = await read({
        query: listState.query,
        offset: (listState.page - 1) * listState.pageSize,
        limit: listState.pageSize,
      });
      rowSchema = page.schema;
      model.data.choices = page.rows;
    } catch (error) {
      sendMessage(
        error instanceof Error ? error.message : "Could not load the choices.",
        "error",
      );
    }
  };
  const read = (request: ValueHelpRequest) =>
    readValueHelp(valueHelp!, request);
  await load();
  while (true) {
    const event = await callScreen({
      id: "uui-field-help",
      title: control.label ?? control.bind,
      description: control.description,
      schema: z.object({
        // Invalid drafts must remain searchable and cancellable. Validate on Done.
        value: z.unknown(),
        choices: z.array(rowSchema),
      }),
      model,
      listReaders: valueHelp === undefined ? undefined : {
        choices: read,
      },
      controls: [{
        ...control,
        id: "value",
        bind: "value",
        description: undefined,
        group: undefined,
        length: "long",
        fieldHelp: false,
        reactive: false,
      }],
      layout: {
        schema: 1,
        id: "field-help",
        root: {
          type: "stack",
          children: [
            { type: "field-group", controls: ["value"] },
            ...(valueHelp === undefined ? [] : [{
              id: "choices",
              type: "list",
              title: "Value help",
              bind: "choices",
              key: Object.keys(rowSchema.shape)[0],
              pageSource: {
                more: page?.more ?? false,
                totalItems: page?.totalItems,
                totalSourceItems: page?.totalSourceItems,
              },
            }]),
          ],
        },
      },
      header: {
        actions: [
          ...(control.readOnly
            ? []
            : [{ id: "done", label: "Done", kind: "primary" as const }]),
          ...(metadata?.open === undefined || model.data.value == null ||
              model.data.value === ""
            ? []
            : [{ id: "open", label: "Navigate" }]),
        ],
      },
    });
    if (event.action === BACK_EVENT) return;
    if (event.eventType === "list-query" || event.eventType === "list-page") {
      await load();
    }
    if (
      event.action === "select" && event.eventType === "select" &&
      !control.readOnly
    ) {
      model.data.value = structuredClone(event.value);
    }
    if (event.action === "done" && !control.readOnly) {
      try {
        binding.set(model.data.value);
        return;
      } catch (error) {
        sendMessage(
          error instanceof Error ? error.message : "Invalid value.",
          "error",
        );
      }
    }
    if (event.action === "open" && metadata?.open !== undefined) {
      try {
        const value = schema.parse(model.data.value);
        await presentPage(() => metadata.open!(value));
      } catch (error) {
        sendMessage(
          error instanceof Error ? error.message : "Could not navigate.",
          "error",
        );
      }
    }
  }
}
