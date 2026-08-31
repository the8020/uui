import { z } from "@the8020/http";
import type {
  ControlDescriptor,
  ControlKind,
  FieldDescriptor,
  FieldLength,
  FieldOption,
} from "./protocol.ts";
import { MAX_FIELD_ROW_SPAN } from "./protocol.ts";

export interface FieldMetadata {
  label?: string;
  description?: string;
  control?: ControlKind;
  group?: string;
  length?: FieldLength;
  rowSpan?: number;
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
  searchHelp?: string;
  semanticType?: "long-string" | "date" | "datetime" | "email" | string;
}

const metadata = new WeakMap<z.ZodType, FieldMetadata>();

export function field<T extends z.ZodType>(
  schema: T,
  options: FieldMetadata,
): T {
  normalizeRowSpan(options.rowSpan);
  const configured = structuredClone(options);
  normalizeRangeMetadata(
    configured,
    unwrap(schema).schema instanceof z.ZodNumber,
  );
  metadata.set(schema, configured);
  return schema;
}

export function fieldMetadata(schema: z.ZodType): FieldMetadata | undefined {
  const value = metadata.get(schema);
  return value === undefined ? undefined : structuredClone(value);
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
  overrides: ControlDescriptor[] = [],
): ControlDescriptor[] {
  const byBind = new Map(fields.map((item) => [item.bind, item]));
  const controls: ControlDescriptor[] = overrides.length === 0
    ? fields.map((item) => ({ ...item, id: item.bind, bind: item.bind }))
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
  const ids = new Set<string>();
  for (const control of controls) {
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
    const configured = metadata.get(declaredSchema) ??
      metadata.get(unwrapped.schema) ?? {};
    output.push({
      bind,
      label: configured.label ?? humanize(name),
      description: configured.description,
      control: configured.control ?? inferControl(unwrapped.schema, configured),
      group: configured.group,
      length: configured.length ?? "medium",
      rowSpan: normalizeRowSpan(configured.rowSpan),
      order: configured.order,
      readOnly: configured.readOnly,
      hidden: configured.hidden,
      required: configured.required ?? !unwrapped.optional,
      placeholder: configured.placeholder,
      reactive: configured.reactive,
      minimum: configured.minimum,
      maximum: configured.maximum,
      step: configured.step,
      valueSuffix: configured.valueSuffix,
      options: configured.options ?? inferredOptions(unwrapped.schema),
      searchHelp: configured.searchHelp,
      semanticType: configured.semanticType,
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

function unwrap(schema: z.ZodType): { schema: z.ZodType; optional: boolean } {
  let current = schema;
  let optional = false;
  while (
    current instanceof z.ZodOptional || current instanceof z.ZodNullable ||
    current instanceof z.ZodDefault || current instanceof z.ZodCatch ||
    current instanceof z.ZodReadonly
  ) {
    optional ||= current instanceof z.ZodOptional ||
      current instanceof z.ZodNullable;
    current = current.unwrap() as z.ZodType;
  }
  return { schema: current, optional };
}

function inferControl(
  schema: z.ZodType,
  configured: FieldMetadata,
): ControlKind {
  if (configured.semanticType === "long-string") return "textarea";
  if (configured.semanticType === "date") return "date";
  if (configured.semanticType === "datetime") return "datetime";
  if (configured.semanticType === "email") return "email";
  if (schema instanceof z.ZodNumber || schema instanceof z.ZodBigInt) {
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

function humanize(value: string): string {
  const spaced = value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(
    /[-_]+/g,
    " ",
  );
  return spaced.length === 0
    ? value
    : spaced[0]!.toUpperCase() + spaced.slice(1);
}
