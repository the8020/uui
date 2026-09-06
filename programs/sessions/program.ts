import { isId, kernel, WorkerInvokeError } from "@the8020/kernel";
import {
  BACK_EVENT,
  callScreen,
  field,
  Model,
  sendMessage,
  z,
} from "/p/the8020/uui/mod.ts";
import detailLayout from "./layouts/detail.json" with { type: "json" };
import listLayout from "./layouts/list.json" with { type: "json" };
import type { SessionMetadata } from "../../session_metadata.ts";
import Sessions from "../../tables/sessions.ts";

const maximumSessions = 200;

const ListScreen = z.object({
  sessions: z.array(z.object({
    navigation: z.string(),
    sessionId: z.string(),
    user: z.string(),
    state: z.string(),
    screen: z.string(),
    nodeId: z.string(),
    updatedAt: z.string(),
  })),
});

const DetailScreen = z.object({
  sessionId: field(z.string(), { label: "Session ID", readOnly: true }),
  state: field(z.string(), { label: "Metadata state", readOnly: true }),
  authenticatedUser: field(z.string(), { label: "User", readOnly: true }),
  authenticatedUserId: field(z.string(), { label: "User ID", readOnly: true }),
  latestIpAddress: field(z.string(), {
    label: "Latest IP address",
    readOnly: true,
  }),
  latestNetworkScope: field(z.string(), {
    label: "Network scope",
    readOnly: true,
  }),
  serviceId: field(z.string(), { label: "Service", readOnly: true }),
  persistentExecutionId: field(z.string(), {
    label: "Persistent execution",
    readOnly: true,
  }),
  nodeId: field(z.string(), { label: "Node", readOnly: true }),

  sandboxId: field(z.string(), { label: "Sandbox", readOnly: true }),
  workerId: field(z.string(), { label: "Worker", readOnly: true }),
  currentScreen: field(z.string(), { label: "Current screen", readOnly: true }),
  createdAt: field(z.string(), { label: "Created", readOnly: true }),
  updatedAt: field(z.string(), { label: "Updated", readOnly: true }),
  lastConnectionAt: field(z.string(), {
    label: "Last connection",
    readOnly: true,
  }),
  liveState: field(z.string(), { label: "Live validation", readOnly: true }),
  messageLog: field(z.string(), {
    label: "Bounded message log",
    control: "textarea",
    length: "long",
    readOnly: true,
  }),
});

export default async function sessionsProgram(): Promise<void> {
  let screenModel: Model<z.infer<typeof ListScreen>> | undefined;
  while (true) {
    const sessions = await readSessionMetadata();
    const screenModelData = {
      sessions: sessions.map((item) => ({
        navigation: item.sessionId,
        sessionId: item.sessionId,
        user: item.authenticatedUser,
        state: item.state,
        screen: item.currentScreenId ?? "",
        nodeId: item.nodeId,
        updatedAt: item.updatedAt.toISOString(),
      })),
    };
    screenModel ??= new Model(screenModelData);
    screenModel.data = screenModelData;
    const event = await callScreen({
      id: "uui-sessions",
      title: "UUI sessions",
      schema: ListScreen,
      model: screenModel,
      layout: listLayout,
      header: { actions: [{ id: "refresh", label: "Refresh" }] },
    });
    if (event.action === BACK_EVENT) return;
    if (event.action === "select" && typeof event.value === "string") {
      const selected = sessions.find((item) => item.sessionId === event.value);
      if (selected !== undefined) await sessionDetail(selected);
    }
  }
}

async function sessionDetail(metadata: SessionMetadata): Promise<void> {
  let screenModel1: Model<z.infer<typeof DetailScreen>> | undefined;
  while (true) {
    const live = await invoke(metadata, "uui.session.inspect", {
      sessionId: metadata.sessionId,
    });
    const messages = live.ok
      ? await invoke(metadata, "uui.session.message-log", {
        sessionId: metadata.sessionId,
      })
      : live;
    const screenModel1Data = {
      sessionId: metadata.sessionId,
      state: metadata.state,
      authenticatedUser: metadata.authenticatedUser,
      authenticatedUserId: metadata.authenticatedUserId,
      latestIpAddress: metadata.latestIpAddress,
      latestNetworkScope: formatNetworkScope(metadata.latestNetworkScope),
      serviceId: metadata.serviceId,
      persistentExecutionId: metadata.persistentExecutionId,
      nodeId: metadata.nodeId,

      sandboxId: metadata.sandboxId,
      workerId: metadata.workerId,
      currentScreen: metadata.currentScreenId ?? "",
      createdAt: metadata.createdAt.toISOString(),
      updatedAt: metadata.updatedAt.toISOString(),
      lastConnectionAt: metadata.lastConnectionAt.toISOString(),
      liveState: live.ok ? "LIVE" : `STALE: ${live.message}`,
      messageLog: messages.ok
        ? JSON.stringify(messages.output, null, 2)
        : "Unavailable",
    };
    screenModel1 ??= new Model(screenModel1Data);
    screenModel1.data = screenModel1Data;
    const event = await callScreen({
      id: "uui-session-detail",
      title: `UUI session ${metadata.sessionId}`,
      schema: DetailScreen,
      model: screenModel1,
      layout: detailLayout,
      header: {
        actions: [
          { id: "refresh", label: "Refresh" },
          ...(live.ok
            ? [{ id: "terminate", label: "Terminate", kind: "danger" as const }]
            : []),
          ...(!live.ok
            ? [{
              id: "clean",
              label: "Clean stale metadata",
              kind: "danger" as const,
            }]
            : []),
        ],
      },
    });
    if (event.action === BACK_EVENT) return;
    if (event.action === "clean") {
      await removeMetadata(metadata.sessionId);
      sendMessage("Stale session metadata removed", "success");
      return;
    }
    if (event.action === "terminate") {
      const result = await invoke(metadata, "uui.session.terminate", {
        sessionId: metadata.sessionId,
      });
      sendMessage(
        result.ok ? "Session terminated" : result.message,
        result.ok ? "success" : "error",
      );
      if (result.ok) return;
    }
    const refreshed = (await readSessionMetadata()).find((item) =>
      item.sessionId === metadata.sessionId
    );
    if (refreshed !== undefined) metadata = refreshed;
  }
}

async function invoke(
  metadata: SessionMetadata,
  functionName: string,
  input: unknown,
): Promise<{ ok: true; output: unknown } | { ok: false; message: string }> {
  try {
    return {
      ok: true,
      output: await kernel.worker.invoke({
        nodeId: metadata.nodeId,
        sandboxId: metadata.sandboxId,
        workerId: metadata.workerId,
        persistentExecutionId: metadata.persistentExecutionId,
        function: functionName,
        input,
      }),
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof WorkerInvokeError
        ? `${error.code}: ${error.message}`
        : error instanceof Error
        ? error.message
        : "Worker invocation failed",
    };
  }
}

export async function readSessionMetadata(): Promise<SessionMetadata[]> {
  return await Sessions.selectAll().orderBy(Sessions.updatedAt, "desc").limit(
    maximumSessions,
  ).execute() as SessionMetadata[];
}

function formatNetworkScope(
  scope: SessionMetadata["latestNetworkScope"],
): string {
  return scope === "link_local"
    ? "Link-local"
    : scope.charAt(0).toUpperCase() + scope.slice(1);
}

async function removeMetadata(sessionId: string): Promise<void> {
  if (!isId(sessionId, "uis")) {
    throw new TypeError("invalid session ID");
  }
  await Sessions.delete().where(Sessions.sessionId, "=", sessionId).execute();
}
