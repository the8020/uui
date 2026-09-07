import { resolveElementIDs } from "./identifiers.ts";
import { validateListOptions } from "./list_options.ts";
import { z } from "@the8020/http";
import {
  field as defineField,
  type FieldMetadata as SharedFieldMetadata,
  fieldMetadata as sharedFieldMetadata,
  fieldSchemas,
} from "/p/the8020/db/fields.ts";
import { humanize } from "./humanize.ts";
import type {
  ControlDeclaration,
  ControlDescriptor,
  ControlKind,
  FieldDescriptor,
  FieldLength,
  FieldOption,
  ListOptions,
} from "./protocol.ts";
import { MAX_FIELD_ROW_SPAN } from "./protocol.ts";

export interface FieldMetadata<Value = unknown>
  extends SharedFieldMetadata<Value> {
  control?: ControlKind;
  group?: string;
  length?: FieldLength;
  rowSpan?: number;
  list?: ListOptions;
  order?: number;
  readOnly?: boolean;
  hidden?: boolean;
  required?: boolean;
  placeholder?: string;
  reactive?: boolean;
  minimum?: number;
  maximum?: number;
  step?: number;
  valueSuffix?: string;
  options?: FieldOption[];
  fieldHelp?: boolean;
  semanticType?: "long-string" | "date" | "datetime" | "email" | string;
}

const metadata = z.registry<
  Omit<FieldMetadata, "valueHelp" | "open" | "storage">
>();

export function field<T extends z.ZodType>(
  schema: T,
  options: FieldMetadata<z.output<T>>,
): T {
  normalizeRowSpan(options.rowSpan);
  const { valueHelp, open, storage, ...presentation } = {
    ...fieldMetadata(schema),
    ...options,
  };
  const configured = structuredClone(presentation);
  if (configured.list !== undefined) validateListOptions(configured.list);
  normalizeRangeMetadata(
    configured,
    unwrap(schema).schema.type === "number",
  );
  const result = defineField(schema, {
    storage,
    label: configured.label,
    description: configured.description,
    valueHelp,
    open,
  });
  metadata.add(result, configured);
  return result;
}

export function fieldMetadata<T extends z.ZodType>(
  schema: T,
): FieldMetadata<z.output<T>> | undefined {
  let result: FieldMetadata<z.output<T>> | undefined;
  for (const current of fieldSchemas(schema).reverse()) {
    const own = metadata.get(current);
    if (own !== undefined) result = { ...result, ...structuredClone(own) };
  }
  const shared = sharedFieldMetadata(schema);
  return result === undefined && shared === undefined
    ? undefined
    : { ...result, ...shared };
}

export function buildFieldCatalog(
  schema: z.ZodObject<z.ZodRawShape>,
): FieldDescriptor[] {
  const result: FieldDescriptor[] = [];
  visitShape(schema.shape, "", result);
  return result.sort((left, right) =>
    (left.order ?? Number.MAX_SAFE_INTEGER) -
      (right.order ?? Number.MAX_SAFE_INTEGER) ||
    left.bind.localeCompare(right.bind)
  );
}

export function buildControls(
  fields: FieldDescriptor[],
  overrides: ControlDeclaration[] = [],
  reserved: ReadonlySet<string> = new Set(),
): ControlDescriptor[] {
  const byBind = new Map(fields.map((item) => [item.bind, item]));
  const declarations: ControlDeclaration[] = overrides.length === 0
    ? fields.map((item) => ({ ...item, bind: item.bind }))
    : overrides.map((item) => {
      const base = byBind.get(item.bind);
      if (base === undefined) {
        throw new TypeError(`unknown control binding ${item.bind}`);
      }
      return {
        ...base,
        ...structuredClone(item),
        id: item.id,
        bind: item.bind,
      };
    });
  const controls = resolveElementIDs(
    declarations,
    (item) => ({
      bind: item.bind,
      control: item.control,
      label: item.label,
      group: item.group,
    }),
    "control",
    reserved,
  );
  const ids = new Set<string>();
  for (const control of controls) {
    if (control.list !== undefined) validateListOptions(control.list);
    if (control.id.length === 0 || ids.has(control.id)) {
      throw new TypeError(`duplicate or empty control ID ${control.id}`);
    }
    control.rowSpan = normalizeRowSpan(control.rowSpan);
    const base = byBind.get(control.bind)!;
    normalizeRangeMetadata(
      control,
      base.control === "number" || base.control === "range",
    );
    ids.add(control.id);
  }
  return controls;
}

export function schemaAtPath(
  root: z.ZodObject<z.ZodRawShape>,
  path: string,
): z.ZodType | undefined {
  const parts = path.split(".");
  let current: z.ZodType = root;
  for (const part of parts) {
    current = unwrap(current).schema;
    if (!(current instanceof z.ZodObject)) return undefined;
    const next = current.shape[part];
    if (!(next instanceof z.ZodType)) return undefined;
    current = next;
  }
  return current;
}

function visitShape(
  shape: z.ZodRawShape,
  prefix: string,
  output: FieldDescriptor[],
): void {
  for (const [name, declared] of Object.entries(shape)) {
    const declaredSchema = declared as z.ZodType;
    const bind = prefix.length === 0 ? name : `${prefix}.${name}`;
    const unwrapped = unwrap(declaredSchema);
    if (unwrapped.schema instanceof z.ZodObject) {
      visitShape(unwrapped.schema.shape, bind, output);
      continue;
    }
    const configured = fieldMetadata(declaredSchema) ?? {};
    output.push({
      bind,
      label: configured.label ?? humanize(name),
      description: configured.description,
      control: configured.control ?? inferControl(unwrapped.schema, configured),
      group: configured.group,
      length: configured.length ?? "medium",
      rowSpan: normalizeRowSpan(configured.rowSpan),
      order: configured.order,
      readOnly: configured.readOnly ??
        (fieldSchemas(declaredSchema).some((item) =>
            item instanceof z.ZodReadonly
          )
          ? true
          : undefined),
      hidden: configured.hidden,
      required: configured.required ?? !unwrapped.optional,
      placeholder: configured.placeholder,
      reactive: configured.reactive,
      minimum: configured.minimum,
      maximum: configured.maximum,
      step: configured.step,
      valueSuffix: configured.valueSuffix,
      options: configured.options ?? inferredOptions(unwrapped.schema),
      fieldHelp: configured.fieldHelp,
      semanticType: configured.semanticType ??
        (configured.storage?.type === "decimal" ? "decimal" : undefined),
      list: configured.list,
    });
  }
}

function normalizeRangeMetadata(
  configured: FieldMetadata | ControlDescriptor,
  numeric: boolean,
): void {
  const hasRangeMetadata = configured.minimum !== undefined ||
    configured.maximum !== undefined || configured.step !== undefined ||
    configured.valueSuffix !== undefined;
  if (configured.control !== "range") {
    if (hasRangeMetadata) {
      throw new TypeError("range metadata requires the range control");
    }
    return;
  }
  if (!numeric) {
    throw new TypeError("range controls require a number field");
  }
  configured.minimum ??= 0;
  configured.maximum ??= 100;
  configured.step ??= 1;
  configured.valueSuffix ??= "";
  if (
    !Number.isFinite(configured.minimum) ||
    !Number.isFinite(configured.maximum) ||
    configured.minimum >= configured.maximum
  ) {
    throw new TypeError("range minimum must be less than its maximum");
  }
  if (!Number.isFinite(configured.step) || configured.step <= 0) {
    throw new TypeError("range step must be greater than zero");
  }
  if (configured.valueSuffix.length > 32) {
    throw new TypeError("range valueSuffix must be at most 32 characters");
  }
}

function normalizeRowSpan(value: number | undefined): number {
  const rowSpan = value ?? 1;
  if (
    !Number.isSafeInteger(rowSpan) || rowSpan < 1 ||
    rowSpan > MAX_FIELD_ROW_SPAN
  ) {
    throw new TypeError(
      `field rowSpan must be an integer from 1 through ${MAX_FIELD_ROW_SPAN}`,
    );
  }
  return rowSpan;
}

export function unwrap(
  schema: z.ZodType,
): { schema: z.ZodType; optional: boolean } {
  const schemas = fieldSchemas(schema);
  return {
    schema: schemas.at(-1)!,
    optional: schemas.some((item) =>
      item instanceof z.ZodOptional || item instanceof z.ZodNullable
    ),
  };
}

function inferControl(
  schema: z.ZodType,
  configured: FieldMetadata,
): ControlKind {
  if (configured.semanticType === "long-string") return "textarea";
  if (configured.semanticType === "date") return "date";
  if (configured.semanticType === "datetime") return "datetime";
  if (configured.semanticType === "email") return "email";
  if (schema.type === "number" || schema.type === "bigint") {
    return "number";
  }
  if (schema instanceof z.ZodBoolean) return "checkbox";
  if (schema instanceof z.ZodEnum) return "select";
  if (schema instanceof z.ZodArray) return "list";
  return "text";
}

function inferredOptions(schema: z.ZodType): FieldOption[] | undefined {
  if (!(schema instanceof z.ZodEnum)) return undefined;
  return schema.options.map((value) => ({
    value,
    label: humanize(String(value)),
  }));
}
