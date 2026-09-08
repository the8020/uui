import {
  BACK_EVENT,
  callScreen,
  copyText,
  endSession,
  field,
  Model,
  type TerminatedProgramInput,
  z,
} from "/p/the8020/uui/mod.ts";
import {
  buildShortDump,
  copyStatus,
  shortDumpFields,
} from "../../src/short_dump.ts";
import layout from "./layouts/main.json" with { type: "json" };

const TerminationScreen = z.object({
  exceptionType: field(shortDumpFields.shape.exceptionType, {
    length: "short",
    readOnly: true,
  }),
  message: field(shortDumpFields.shape.message, {
    length: "long",
    control: "textarea",
    readOnly: true,
  }),
  properties: field(shortDumpFields.shape.properties, {
    length: "long",
    control: "textarea",
    readOnly: true,
  }),
  programId: field(shortDumpFields.shape.programId, {
    length: "long",
    readOnly: true,
  }),
  entrypoint: field(shortDumpFields.shape.entrypoint, {
    length: "long",
    readOnly: true,
  }),
  location: field(shortDumpFields.shape.location, {
    length: "long",
    readOnly: true,
  }),
  occurredAt: field(shortDumpFields.shape.occurredAt, { readOnly: true }),
  copyStatus: field(copyStatus, { readOnly: true }),
  stack: field(shortDumpFields.shape.stack, {
    length: "long",
    control: "textarea",
    readOnly: true,
  }),
  source: field(shortDumpFields.shape.source, {
    length: "long",
    control: "textarea",
    readOnly: true,
  }),
  dumpText: field(shortDumpFields.shape.dumpText, {
    length: "long",
    control: "textarea",
    readOnly: true,
  }),
});

export default async function programTerminated(
  input: TerminatedProgramInput,
): Promise<"home" | "end"> {
  assertInput(input);
  const dump = await buildShortDump(input);
  const model = { ...dump, copyStatus: "" };
  const screenModel = new Model(model);
  while (true) {
    screenModel.data = model;
    const event = await callScreen({
      id: "program-terminated",
      title: "[[icon=error color=error]] Program terminated",
      description:
        `Uncaught exception of type '${model.exceptionType}' was raised in '${model.location}' and terminated the current program.`,
      schema: TerminationScreen,
      model: screenModel,
      layout,
      controls: [
        { id: "exception-type", bind: "exceptionType" },
        { id: "message", bind: "message" },
        { id: "properties", bind: "properties" },
        { id: "program-id", bind: "programId" },
        { id: "entrypoint", bind: "entrypoint" },
        { id: "location", bind: "location" },
        { id: "occurred-at", bind: "occurredAt" },
        { id: "copy-status", bind: "copyStatus" },
        { id: "stack", bind: "stack" },
        { id: "source", bind: "source" },
        { id: "dump-text", bind: "dumpText" },
      ],
      header: {
        actions: [
          { id: "home", label: "Home", kind: "primary" },
          { id: "copy", label: "Copy short dump" },
          { id: "end", label: "End session", kind: "danger" },
        ],
      },
    });
    if (event.action === BACK_EVENT) return "home";
    if (event.action === "home") return "home";
    if (event.action === "end") {
      endSession("Session ended after a program exception.");
      return "end";
    }
    if (event.action === "copy") {
      copyText(model.dumpText);
      model.copyStatus = `Copied ${new Date().toISOString()}`;
    }
  }
}

function assertInput(value: unknown): asserts value is TerminatedProgramInput {
  if (
    value === null || typeof value !== "object" ||
    typeof (value as { programId?: unknown }).programId !== "string" ||
    typeof (value as { entrypoint?: unknown }).entrypoint !== "string" ||
    typeof (value as { occurredAt?: unknown }).occurredAt !== "string"
  ) throw new TypeError("program termination input is required");
}
