import { localizedText as resolveMessage } from "/p/the8020/i18n/mod.ts";
import { msg as messageSymbol } from "/p/the8020/uui/i18n/messages.ts";
import { context } from "@the8020/context";
import { kernel } from "@the8020/kernel";
import { text } from "/p/the8020/i18n/mod.ts";
import { getSystemProfile } from "/p/the8020/system/profile.ts";
import { user } from "/p/the8020/users/src/admin.ts";
import { packageVersion } from "/p/the8020/packages/version.ts";
import { statusFields } from "../../src/status_fields.ts";
import { msg } from "../../i18n/messages.ts";
import { fieldMetadata } from "../../fields.ts";
import {
  BACK_EVENT,
  callScreen,
  copyText,
  field,
  Model,
  packageAssetURL,
  UUI_PROTOCOL_VERSION,
  z,
} from "../../mod.ts";
import type { BrowserContext } from "../../protocol.ts";

export interface StatusScreen {
  programId?: string;
  screenId: string;
  title?: string;
  screenCall?: string;
  sessionId: string;
  startedAt?: string;
  connectionState?: string;
  browser?: BrowserContext;
}

const primary = [
  "username",
  "fullName",
  "systemName",
  "systemId",
  "systemRole",
  "address",
  "programName",
  "programId",
  "screenTitle",
  "screenId",
  "packageVersion",
  "kernelVersion",
  "uuiVersion",
  "language",
  "timeZone",
] as const;
const technical = [
  "sessionId",
  "startedAt",
  "nodeId",
  "executionId",
  "workerId",
  "sandboxId",
  "screenCall",
  "connectionState",
  "protocol",
] as const;
const schema = z.object(Object.fromEntries(
  Object.entries(statusFields.shape).map(([key, value]) => [
    key,
    field(value, {
      readOnly: true,
      length: "long",
      fieldHelp: false,
      description: "",
    }),
  ]),
));

async function available<T>(read: Promise<T>): Promise<T | undefined> {
  try {
    return await read;
  } catch (error) {
    console.error(
      await resolveMessage(
        messageSymbol("errors.status_information_unavailable"),
      ),
      error,
    );
  }
}

function version(
  value: Awaited<ReturnType<typeof packageVersion>> | undefined,
) {
  if (!value?.commit) return text(msg("program.unavailable"));
  return [
    value.commit.slice(0, 12),
    value.modified ? text(msg("status.modified")) : "",
  ].filter(Boolean).join(" · ");
}

export async function readStatus(screen: StatusScreen) {
  const packageId = screen.programId?.split("/").slice(0, 2).join("/");
  const uuiVersion = available(packageVersion("the8020/uui"));
  const [profile, account, build, uui, owner] = await Promise.all([
    available(getSystemProfile()),
    available(user(context.username)),
    available(kernel.admin.execute<{ build_id: string }>("kernel.status")),
    uuiVersion,
    packageId === "the8020/uui"
      ? uuiVersion
      : packageId
      ? available(packageVersion(packageId))
      : undefined,
  ]);
  return {
    username: context.username,
    fullName: account?.full_name,
    systemName: profile?.name,
    systemRole: profile?.role,
    systemId: profile?.id,
    address: screen.browser?.origin ?? "",
    programId: screen.programId,
    programName: screen.programId?.split("/").at(-1),
    screenId: screen.screenId,
    screenTitle: screen.title ?? screen.screenId,
    packageVersion: version(owner),
    kernelVersion: build?.build_id ?? text(msg("program.unavailable")),
    uuiVersion: version(uui),
    language: context.language,
    timeZone: screen.browser?.timeZone ?? "",
    sessionId: screen.sessionId,
    startedAt: screen.startedAt,
    nodeId: context.nodeId,
    executionId: context.persistentExecutionId,
    workerId: context.workerId,
    sandboxId: context.sandboxId,
    screenCall: screen.screenCall,
    connectionState: screen.connectionState,
    protocol: UUI_PROTOCOL_VERSION,
  };
}

export default async function status(screen: StatusScreen): Promise<void> {
  const values = await readStatus(screen);
  const model = new Model(values);
  let expanded = false;
  while (true) {
    const event = await callScreen({
      id: "status",
      title: msg("shell.status"),
      class: "uui-status",
      model,
      schema,
      header: {
        actions: [
          { id: "copy", label: msg("status.copy_diagnostics") },
          { id: "close", label: msg("shell.close") },
        ],
      },
      controls: [...primary, ...technical].map((bind) => ({ id: bind, bind })),
      actions: [{
        id: "technical",
        label: text(msg("status.technical_details")) +
          (expanded ? " [[icon=expand_less]]" : " [[icon=expand_more]]"),
      }],
      customElements: [{
        id: "brand",
        module: packageAssetURL("the8020/uui", "status-brand.js"),
        styles: [packageAssetURL("the8020/uui", "status-brand.css")],
        config: { credit: text(msg("status.credit")) },
        preserve: true,
      }],
      layout: {
        schema: 1,
        id: "status",
        root: {
          type: "stack",
          children: [
            { type: "custom", customElement: "brand" },
            { type: "field-group", controls: [...primary] },
            { type: "actions", actions: ["technical"] },
            ...(expanded
              ? [{ type: "field-group" as const, controls: [...technical] }]
              : []),
          ],
        },
      },
    });
    if (event.action === BACK_EVENT || event.action === "close") return;
    if (event.action === "technical") expanded = !expanded;
    if (event.action === "copy") {
      copyText([
        "80|20 — https://github.com/the8020",
        ...[...primary, ...technical].map((key) =>
          `${text(fieldMetadata(statusFields.shape[key])?.label) ?? key}: ${
            values[key] ?? text(msg("program.unavailable"))
          }`
        ),
      ].join("\n"));
    }
  }
}
