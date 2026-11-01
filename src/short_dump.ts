import { text as localizedText } from "/p/the8020/i18n/mod.ts";
import { msg } from "/p/the8020/uui/i18n/messages.ts";
import { field, z } from "/p/the8020/db/fields.ts";
import { programId } from "/p/the8020/packages/types/program.ts";
import { sourceInfo } from "/p/the8020/packages/types/source.ts";
import type { TerminatedProgramInput } from "/p/the8020/uui/mod.ts";

export const shortDumpFields = z.object({
  exceptionType: field(z.string(), {
    label: msg("short_dump.type"),
    description: msg("short_dump.the_type_of_the_exception_that_stopped"),
  }),
  message: field(z.string(), {
    label: msg("short_dump.message"),
    description: msg("short_dump.the_message_reported_by_the_exception"),
  }),
  properties: field(z.string(), {
    label: msg("short_dump.properties"),
    description: msg(
      "short_dump.additional_details_attached_to_the_exception_shortened",
    ),
  }),
  location: field(z.string(), {
    label: msg("short_dump.raised_at"),
    description: msg("short_dump.the_source_file_line_and_column_associated"),
  }),
  occurredAt: field(z.string(), {
    label: msg("short_dump.time"),
    description: msg(
      "short_dump.when_the_uncaught_exception_stopped_the_program",
    ),
  }),
  stack: field(z.string(), {
    label: msg("short_dump.call_stack"),
    description: msg("short_dump.the_chain_of_calls_reported_by_the"),
  }),
  source: field(z.string(), {
    label: msg("short_dump.source_context"),
    description: msg(
      "short_dump.lines_around_the_reported_failure_location_when",
    ),
  }),
  dumpText: field(z.string(), {
    label: msg("short_dump.short_dump"),
    description: msg("short_dump.the_combined_exception_call_stack_and_source"),
  }),
  programId,
  entrypoint: sourceInfo.shape.entrypoint,
});
export type ShortDump = z.infer<typeof shortDumpFields> & {
  sourceDocument?: {
    text: string;
    firstLine: number;
    line: number;
    column: number;
    path: string;
  };
};

export const copyStatus = field(z.string(), {
  label: msg("short_dump.copy_status"),
  description: msg("short_dump.the_time_at_which_copy_short_dump"),
});

interface SourceLocation {
  path: string;
  line: number;
  column: number;
}

const maximumText = 200_000;

export async function buildShortDump(
  input: TerminatedProgramInput,
): Promise<ShortDump> {
  const exceptionType = exceptionName(input.exception);
  const message = exceptionMessage(input.exception);
  const stack = bounded(
    exceptionStack(input.exception) ||
      localizedText(msg("short_dump.no_call_stack_was_provided")),
  );
  const sourceLocation = locationFromStack(stack) ??
    locationFromEntrypoint(input.entrypoint);
  const location = sourceLocation === undefined
    ? displayPath(input.entrypoint) || input.programId
    : `${
      displayPath(sourceLocation.path)
    }:${sourceLocation.line}:${sourceLocation.column}`;
  const context = sourceLocation === undefined
    ? localizedText(msg("short_dump.source_location_is_unavailable"))
    : await sourceContext(sourceLocation);
  const source = typeof context === "string" ? context : context.formatted;
  const properties = bounded(inspectException(input.exception));
  const entrypoint = displayPath(input.entrypoint) ||
    localizedText(msg("program.unavailable"));
  const dumpText = bounded([
    "PROGRAM TERMINATED",
    localizedText(
      msg("short_dump.exception_type_exceptiontype", {
        exceptionType: exceptionType,
      }),
    ),
    `Message: ${message}`,
    `Program: ${input.programId}`,
    `Entrypoint: ${entrypoint}`,
    localizedText(msg("short_dump.raised_at_location", { location: location })),
    localizedText(
      msg("short_dump.occurred_at_value1", { value1: input.occurredAt }),
    ),
    "",
    "EXCEPTION PROPERTIES",
    properties,
    "",
    "CALL STACK",
    stack,
    "",
    "SOURCE CONTEXT",
    source,
  ].join("\n"));
  return {
    exceptionType,
    message: bounded(message),
    properties,
    programId: input.programId,
    entrypoint,
    location,
    occurredAt: input.occurredAt,
    stack,
    source,
    dumpText,
    ...(typeof context === "string"
      ? {}
      : { sourceDocument: context.document }),
  };
}

export function exceptionName(value: unknown): string {
  if (value instanceof Error && value.name.trim() !== "") return value.name;
  if (value !== null && typeof value === "object") {
    const constructor = Object.getPrototypeOf(value)?.constructor;
    if (typeof constructor?.name === "string" && constructor.name !== "") {
      return constructor.name;
    }
  }
  return typeof value;
}

function exceptionMessage(value: unknown): string {
  if (value instanceof Error) return value.message || String(value);
  return formatValue(value, 0, new WeakSet());
}

function exceptionStack(value: unknown): string {
  if (value instanceof Error && typeof value.stack === "string") {
    return value.stack;
  }
  return "";
}

function inspectException(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return localizedText(
      msg("short_dump.thrown_value_value1", {
        value1: formatValue(value, 0, new WeakSet()),
      }),
    );
  }
  const lines = [
    localizedText(
      msg("short_dump.runtime_type_value1", { value1: exceptionName(value) }),
    ),
  ];
  for (const key of Reflect.ownKeys(value)) {
    if (key === "stack" || key === "message" || key === "name") continue;
    const label = typeof key === "symbol" ? key.toString() : key;
    try {
      lines.push(
        `${label}: ${formatValue(Reflect.get(value, key), 0, new WeakSet())}`,
      );
    } catch (error) {
      lines.push(`${label}: <unreadable: ${exceptionMessage(error)}>`);
    }
  }
  return lines.join("\n");
}

function formatValue(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
): string {
  if (typeof value === "string") return JSON.stringify(bounded(value, 16_000));
  if (
    value === null || typeof value === "number" || typeof value === "boolean" ||
    typeof value === "undefined" || typeof value === "bigint"
  ) return String(value);
  if (typeof value === "symbol" || typeof value === "function") {
    return String(value);
  }
  if (seen.has(value)) return "<circular>";
  if (depth >= 4) return `<${exceptionName(value)}>`;
  seen.add(value);
  const entries: string[] = [];
  for (const key of Reflect.ownKeys(value).slice(0, 30)) {
    const label = typeof key === "symbol" ? `[${key.toString()}]` : key;
    try {
      entries.push(
        `${label}: ${formatValue(Reflect.get(value, key), depth + 1, seen)}`,
      );
    } catch (error) {
      entries.push(`${label}: <unreadable: ${exceptionMessage(error)}>`);
    }
  }
  if (Reflect.ownKeys(value).length > 30) entries.push("…");
  seen.delete(value);
  return `{ ${entries.join(", ")} }`;
}

export function locationFromStack(stack: string): SourceLocation | undefined {
  const pattern = /((?:file:\/\/)?\/[^\s()]+):(\d+):(\d+)/g;
  for (const match of stack.matchAll(pattern)) {
    const path = filePath(match[1]!);
    const line = Number(match[2]);
    const column = Number(match[3]);
    if (path !== "" && line > 0 && column > 0) return { path, line, column };
  }
  return undefined;
}

function locationFromEntrypoint(
  entrypoint: string,
): SourceLocation | undefined {
  const path = filePath(entrypoint);
  return path === "" ? undefined : { path, line: 1, column: 1 };
}

function filePath(value: string): string {
  if (value.startsWith("file://")) {
    try {
      return decodeURIComponent(new URL(value).pathname);
    } catch {
      return "";
    }
  }
  return value.startsWith("/") ? value : "";
}

export function displayPath(value: string): string {
  const path = filePath(value);
  const prefix = "/workspace/packages/";
  if (path.startsWith(prefix)) return path.slice(prefix.length);
  return path;
}

async function sourceContext(location: SourceLocation): Promise<
  string | {
    formatted: string;
    document: NonNullable<ShortDump["sourceDocument"]>;
  }
> {
  try {
    const source = await Deno.readTextFile(location.path);
    const lines = source.split("\n");
    const first = Math.max(1, location.line - 5);
    const last = Math.min(lines.length, location.line + 5);
    if (first > last) {
      return localizedText(
        msg("short_dump.source_location_is_outside_the_file"),
      );
    }
    const width = String(last).length;
    const excerpt = lines.slice(first - 1, last).map((line) =>
      line.slice(0, 1_000) + (line.length > 1_000 ? " … truncated …" : "")
    );
    const formatted = excerpt.map((text, offset) => {
      const number = first + offset;
      const marker = number === location.line ? ">" : " ";
      return `${marker} ${String(number).padStart(width)} | ${text}`;
    }).join("\n");
    return {
      formatted,
      document: {
        text: excerpt.join("\n"),
        firstLine: first,
        line: location.line,
        column: location.column,
        path: location.path,
      },
    };
  } catch (error) {
    return localizedText(
      msg("short_dump.source_could_not_be_read_value1", {
        value1: exceptionMessage(error),
      }),
    );
  }
}

function bounded(value: string, maximum = maximumText): string {
  if (value.length <= maximum) return value;
  return `${value.slice(0, maximum)}\n… truncated …`;
}
