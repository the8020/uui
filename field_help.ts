import {
  escapeMultiple,
  joinMultiple,
  multipleLiteral,
  type MultipleValues,
  multipleValues,
  splitMultiple,
  z,
} from "/p/the8020/db/fields.ts";
import { field, fieldMetadata } from "./fields.ts";
import { queryValueHelp, setListSource } from "./lists.ts";
import { Model } from "./model.ts";
import { BACK_EVENT, type ControlDescriptor } from "./protocol.ts";
import { callScreen, presentPage, sendMessage } from "./session.ts";
import type { ValueHelpPage, ValueHelpRequest } from "/p/the8020/db/fields.ts";
import { emptyListQuery } from "./screen_state.ts";

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

/** Choices for "Select all matching"; the platform never loads more. */
export const SELECT_ALL_LIMITS = [100, 500, 1000, 5000] as const;
const DEFAULT_SELECT_ALL_LIMIT = 500;
/** Provider pages are bounded; select-all reads in chunks of this size. */
const SELECT_ALL_CHUNK = 500;

/**
 * The draft of a field holding several values: an array of values, or the
 * written values of a separated text. Values not offered by help (ranges,
 * patterns) stay as written.
 */
class MultipleDraft {
  constructor(
    private readonly multiple: MultipleValues,
    private readonly read: () => unknown,
    private readonly write: (value: unknown) => void,
  ) {}

  entries(): unknown[] {
    const value = this.read();
    if (this.multiple.kind === "array") {
      return Array.isArray(value) ? [...value] : [];
    }
    return typeof value === "string" ? splitMultiple(value, this.multiple) : [];
  }

  /** Whether a help key is among the values, as itself or a written literal. */
  has(key: unknown): boolean {
    return this.entries().some((entry) => this.matches(entry, key));
  }

  set(keys: readonly unknown[], selected: boolean): void {
    let entries = this.entries();
    if (selected) {
      for (const key of keys) {
        if (!entries.some((entry) => this.matches(entry, key))) {
          entries.push(
            this.multiple.kind === "array"
              ? key
              : escapeMultiple(String(key), this.multiple),
          );
        }
      }
    } else {
      entries = entries.filter((entry) =>
        !keys.some((key) => this.matches(entry, key))
      );
    }
    this.write(
      this.multiple.kind === "array"
        ? entries
        : joinMultiple(entries as string[], this.multiple),
    );
  }

  private matches(entry: unknown, key: unknown): boolean {
    if (this.multiple.kind === "array") return Object.is(entry, key);
    return typeof entry === "string" &&
      multipleLiteral(entry, this.multiple) === String(key);
  }
}

/** An isolated draft: only Done commits through the caller's complete schema. */
export async function runFieldHelp(
  schema: z.ZodType,
  control: ControlDescriptor,
  binding: { get(): unknown; set(value: unknown): void },
): Promise<void> {
  const metadata = fieldMetadata(schema);
  const multiple = multipleValues(schema);
  // An array's values come from its element's help.
  const valueHelp = valueHelpFor(
    multiple?.kind === "array" ? multiple.element : schema,
    control,
  );
  // Discover the fixed columns once; subsequent pages belong to ScreenLists.
  const page = valueHelp === undefined
    ? undefined
    : await readValueHelp(valueHelp, {
      query: emptyListQuery(),
      offset: 0,
      limit: 1,
    });
  const rowSchema: z.ZodObject = page?.schema ?? z.object({});
  const key = Object.keys(rowSchema.shape)[0];
  const keyOf = (row: unknown) =>
    key === undefined ? undefined : (row as Record<string, unknown>)[key];
  const editable = !control.readOnly;
  const model = new Model({
    value: structuredClone(binding.get()),
    choices: [] as Record<string, unknown>[],
    limit: DEFAULT_SELECT_ALL_LIMIT as number,
  });
  const draft = multiple === undefined ? undefined : new MultipleDraft(
    multiple,
    () => model.data.value,
    (value) => model.data.value = value,
  );
  // The query whose matches were all selected, until a row is deselected.
  let allQuery: string | undefined;
  let initial = page;
  if (valueHelp) {
    setListSource(model, "choices", (request) => {
      if (initial) {
        const result = initial;
        initial = undefined;
        return result;
      }
      return readValueHelp(valueHelp, request);
    }, {
      selection: draft === undefined
        ? {
          mode: "single",
          isSelected: (row) =>
            model.data.value != null && Object.is(keyOf(row), model.data.value),
          count: () => model.data.value == null ? 0 : 1,
          set: () => {},
        }
        : {
          mode: "multiple",
          isSelected: (row) => draft.has(keyOf(row)),
          count: () => draft.entries().length,
          validate: (rows, selected) => {
            if (!editable) throw new TypeError("This field is read-only.");
            const maximum = control.multiple?.maximum;
            if (
              selected && maximum !== undefined &&
              new Set([...draft.entries(), ...rows.map(keyOf)]).size > maximum
            ) {
              throw new TypeError(`Select at most ${maximum} values.`);
            }
          },
          set: (rows, selected) => {
            draft.set(rows.map(keyOf), selected);
            if (!selected) allQuery = undefined;
          },
          matching: async (query, signal) => {
            const limit = model.data.limit;
            const rows: unknown[] = [];
            for (let offset = 0;; offset += SELECT_ALL_CHUNK) {
              signal.throwIfAborted();
              const chunk = await readValueHelp(valueHelp, {
                query,
                offset,
                limit: Math.min(SELECT_ALL_CHUNK, limit + 1 - rows.length),
              });
              rows.push(...chunk.rows);
              if (rows.length > limit) {
                throw new TypeError(
                  `The search matches more than ${limit} values. Narrow the search or raise the limit.`,
                );
              }
              if (!chunk.more || chunk.rows.length === 0) break;
            }
            allQuery = JSON.stringify(query);
            return rows;
          },
          allSelected: (query) => allQuery === JSON.stringify(query),
        },
    });
  }
  const limitField = field(
    z.number().int().min(1).max(SELECT_ALL_LIMITS.at(-1)!),
    {
      label: "Select all up to",
      description: "How many matching values Select all may load at most.",
      control: "select",
      options: SELECT_ALL_LIMITS.map((value) => ({
        value,
        label: String(value),
      })),
    },
  );
  while (true) {
    const event = await callScreen({
      id: "uui-field-help",
      class: "uui-field-help",
      title: control.label ?? control.bind,
      description: control.description,
      schema: z.object({
        // Invalid drafts must remain searchable and cancellable. Validate on Done.
        value: z.unknown(),
        choices: z.array(rowSchema),
        limit: limitField,
      }),
      model,
      controls: [{
        ...control,
        id: "value",
        bind: "value",
        description: undefined,
        group: undefined,
        length: "long",
        fieldHelp: false,
        reactive: false,
      }, { id: "limit", bind: "limit", length: "short" }],
      layout: {
        schema: 1,
        id: "field-help",
        root: {
          type: "stack",
          children: [
            { type: "field-group", controls: ["value"], summary: true },
            ...(valueHelp === undefined ? [] : [{
              id: "choices",
              type: "list",
              title: "Value help",
              bind: "choices",
              key,
              focusSearch: true,
              ...(draft === undefined || !editable
                ? {}
                : { toolbar: [{ bind: "limit" }] }),
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
    // One value: a click selects, a double-click selects and finishes.
    const chosen = event.action === "select" && draft === undefined &&
      editable &&
      (event.eventType === "select" || event.eventType === "activate");
    if (chosen) model.data.value = structuredClone(event.value);
    if (
      (event.action === "done" ||
        chosen && event.eventType === "activate") && editable
    ) {
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
