import { z } from "@the8020/http";
import { field, fieldMetadata } from "./fields.ts";
import { Model } from "./model.ts";
import { BACK_EVENT, type ControlDescriptor } from "./protocol.ts";
import { callScreen, presentPage, sendMessage } from "./session.ts";
import type { ValueHelpItem, ValueHelpRequest } from "/p/the8020/db/fields.ts";
import { initialListState, screenElement } from "./screen_state.ts";

/** An isolated draft: only Done commits through the caller's complete schema. */
export async function runFieldHelp(
  schema: z.ZodType,
  control: ControlDescriptor,
  binding: { get(): unknown; set(value: unknown): void },
): Promise<void> {
  const metadata = fieldMetadata(schema);
  const valueHelp = control.readOnly ? undefined : metadata?.valueHelp ??
    (control.options === undefined
      ? undefined
      : (request: ValueHelpRequest) => {
        const matches = control.options!.filter((option) =>
          option.label.toLocaleLowerCase().includes(
            request.query.toLocaleLowerCase(),
          )
        );
        return {
          items: matches.slice(request.offset, request.offset + request.limit),
          more: matches.length > request.offset + request.limit,
        };
      });
  const Help = z.object({
    // Invalid drafts must remain searchable and cancellable. Validate on Done.
    value: z.unknown(),
    choices: z.array(z.object({
      index: z.number(),
      label: field(z.string(), { label: "Value" }),
      description: field(z.string(), { label: "Description" }),
    })),
  });
  const model = new Model({
    value: structuredClone(binding.get()),
    choices: [] as z.infer<typeof Help>["choices"],
  });
  const element = screenElement(model.screen, "choices");
  element.toolbarOpen = true;
  const listState = element.list = initialListState();
  let choices: ValueHelpItem<unknown>[] = [];
  let more = false;
  const load = async (): Promise<void> => {
    if (valueHelp === undefined) return;
    choices = [];
    more = false;
    try {
      const page = await valueHelp({
        query: listState.query.search,
        offset: (listState.page - 1) * listState.pageSize,
        limit: listState.pageSize,
      });
      if (page.items.length > listState.pageSize) {
        throw new TypeError(
          "Value help returned more than the requested limit",
        );
      }
      choices = page.items;
      more = page.more;
    } catch (error) {
      sendMessage(
        error instanceof Error ? error.message : "Could not load the choices.",
        "error",
      );
    }
    model.data.choices = choices.map((item, index) => ({
      index,
      label: item.label,
      description: item.description ?? "",
    }));
  };
  await load();
  while (true) {
    const event = await callScreen({
      id: "uui-field-help",
      title: control.label ?? control.bind,
      description: control.description,
      schema: Help,
      model,
      listReaders: valueHelp === undefined ? undefined : {
        choices: async ({ query, offset, limit }) => {
          const page = await valueHelp({ query: query.search, offset, limit });
          return {
            rows: page.items.map((item, index) => ({
              index: offset + index,
              label: item.label,
              description: "description" in item ? item.description ?? "" : "",
            })),
            more: page.more,
          };
        },
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
              key: "index",
              display: ["label", "description"],
              pageSource: { more, searchOnly: true },
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
      event.action === "select" && typeof event.value === "number" &&
      !control.readOnly
    ) {
      const selected = choices[event.value];
      if (selected !== undefined) {
        model.data.value = structuredClone(selected.value);
      }
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
