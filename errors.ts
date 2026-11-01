import { text as localizedText } from "/p/the8020/i18n/mod.ts";
import { msg } from "/p/the8020/uui/i18n/messages.ts";
import { text } from "/p/the8020/i18n/mod.ts";
import { validationError } from "/p/the8020/i18n/validation.ts";
import { z } from "/p/the8020/db/fields.ts";
import { fieldMetadata, schemaAtPath } from "./fields.ts";
import { humanize } from "./humanize.ts";

/**
 * An error as a user reads it. Validation errors become the field's label and
 * a plain message ("Role: Enter a value."); others keep their message.
 * Programs pass their screen schema to name fields by their labels.
 */
export function describeError(
  error: unknown,
  schema?: z.ZodObject<z.ZodRawShape>,
  bind?: string,
): string {
  if (!(error instanceof z.ZodError)) {
    return error instanceof Error && error.message
      ? error.message
      : localizedText(msg("errors.the_action_could_not_be_completed"));
  }
  const issue = error.issues[0];
  if (issue === undefined) {
    return localizedText(msg("errors.the_entered_values_are_invalid"));
  }
  const path = [
    ...(bind === undefined ? [] : [bind]),
    ...issue.path.map(String),
  ];
  const field = schema === undefined || path.length === 0
    ? undefined
    : schemaAtPath(schema, path.join("."));
  const label =
    (field === undefined ? undefined : fieldMetadata(field)?.label) ??
      (path.length === 0 ? undefined : humanize(path.at(-1)!));
  // Empty or missing required values are the common case; say so plainly.
  const missing = issue.code === "too_small" &&
      (issue as { origin?: string }).origin === "string" &&
      (issue as { minimum?: unknown }).minimum === 1 ||
    issue.code === "invalid_type" && /received undefined$/.test(issue.message);
  const message = missing
    ? validationError({
      code: "invalid_type",
      expected: "string",
      input: undefined,
    }) as string
    : issue.message;
  return label === undefined ? message : `${text(label)}: ${message}`;
}
