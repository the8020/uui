import { isId, kernel, WorkerInvokeError } from "@the8020/kernel";
import {
  BACK_EVENT,
  callScreen,
  field,
  Model,
  openSession,
  presentModal,
  presentPage,
  sendMessage,
  z,
} from "/p/the8020/uui/mod.ts";
import detailLayout from "./layouts/detail.json" with { type: "json" };
import listLayout from "./layouts/list.json" with { type: "json" };
import { sessionInfo } from "../../src/session_fields.ts";
import type { SessionMetadata } from "../../session_metadata.ts";
import Sessions from "../../tables/sessions.ts";
import { username } from "/p/the8020/users/types/user.ts";
import { currentUser } from "/p/the8020/users/mod.ts";
import { serviceId } from "/p/the8020/services/types/service.ts";
import { sandboxId, workerId } from "/p/the8020/admin-core/types/runtime.ts";

const maximumSessions = 200;

const ListScreen = z.object({
  sessions: z.array(z.object({
    navigation: z.string(),
    sessionId: sessionInfo.shape.sessionId,
    user: username,
    state: sessionInfo.shape.state,
    screen: sessionInfo.shape.currentScreenId,
    nodeId: sessionInfo.shape.nodeId,
    updatedAt: sessionInfo.shape.updatedAt,
  })),
});

const DetailScreen = z.object({
  sessionId: field(sessionInfo.shape.sessionId, { readOnly: true }),
  state: field(sessionInfo.shape.state, { readOnly: true }),
  authenticatedUser: field(username, { readOnly: true }),
  authenticatedUserId: field(sessionInfo.shape.authenticatedUserId, {
    readOnly: true,
  }),
  latestIpAddress: field(sessionInfo.shape.latestIpAddress, {
    readOnly: true,
  }),
  latestNetworkScope: field(sessionInfo.shape.latestNetworkScope, {
    readOnly: true,
  }),
  serviceId: field(serviceId, { readOnly: true }),
  persistentExecutionId: field(sessionInfo.shape.persistentExecutionId, {
    readOnly: true,
  }),
  nodeId: field(sessionInfo.shape.nodeId, { readOnly: true }),

  sandboxId: field(sandboxId, { readOnly: true }),
  workerId: field(workerId, { readOnly: true }),
  currentScreen: field(sessionInfo.shape.currentScreen, { readOnly: true }),
  currentScreenId: field(sessionInfo.shape.currentScreenId, { readOnly: true }),
  createdAt: field(sessionInfo.shape.createdAt, { readOnly: true }),
  updatedAt: field(sessionInfo.shape.updatedAt, {
    readOnly: true,
  }),
  lastConnectionAt: field(sessionInfo.shape.lastConnectionAt, {
    readOnly: true,
  }),
  liveState: field(sessionInfo.shape.liveState, { readOnly: true }),
  messageLog: field(sessionInfo.shape.messageLog, {
    control: "textarea",
    length: "long",
    readOnly: true,
    rowSpan: 8,
  }),
});

export default async function sessionsProgram(
  username?: string,
): Promise<void> {
  let screenModel: Model<z.infer<typeof ListScreen>> | undefined;
  let offset = 0;
  while (true) {
    const page = await readSessionMetadata(
      username,
      offset,
      maximumSessions + 1,
    );
    const sessions = page.slice(0, maximumSessions);
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
      title: username === undefined
        ? "UUI sessions"
        : `Sessions for ${username}`,
      schema: ListScreen,
      model: screenModel,
      layout: listLayout,
      header: {
        actions: [
          { id: "refresh", label: "[[icon=refresh]] Refresh" },
          ...(offset > 0 ? [{ id: "newer", label: "Newer sessions" }] : []),
          ...(page.length > maximumSessions
            ? [{ id: "older", label: "Older sessions" }]
            : []),
        ],
      },
    });
    if (event.action === BACK_EVENT) return;
    if (event.action === "older" && page.length > maximumSessions) {
      offset += maximumSessions;
    }
    if (event.action === "newer") {
      offset = Math.max(0, offset - maximumSessions);
    }
    if (event.action === "refresh") offset = 0;
    if (event.action === "select" && typeof event.value === "string") {
      const selected = sessions.find((item) => item.sessionId === event.value);
      if (selected !== undefined) await sessionDetail(selected);
    }
  }
}

async function sessionDetail(
  metadata: SessionMetadata,
  advanced = false,
): Promise<void> {
  let screenModel1: Model<z.infer<typeof DetailScreen>> | undefined;
  while (true) {
    const live = await invoke(metadata, "uui.session.inspect", {
      sessionId: metadata.sessionId,
    });
    const messages = advanced && live.ok
      ? await invoke(metadata, "uui.session.message-log", {
        sessionId: metadata.sessionId,
      })
      : undefined;
    const status = live.ok
      ? live.output as { current_screen_title?: string; state?: string }
      : undefined;
    const screenModel1Data = {
      sessionId: metadata.sessionId,
      state: live.ok ? status?.state ?? metadata.state : "Unavailable",
      authenticatedUser: metadata.authenticatedUser,
      authenticatedUserId: metadata.authenticatedUserId,
      latestIpAddress: metadata.latestIpAddress,
      latestNetworkScope: formatNetworkScope(metadata.latestNetworkScope),
      serviceId: metadata.serviceId,
      persistentExecutionId: metadata.persistentExecutionId,
      nodeId: metadata.nodeId,

      sandboxId: metadata.sandboxId,
      workerId: metadata.workerId,
      currentScreen: status?.current_screen_title ?? "",
      currentScreenId: metadata.currentScreenId ?? "",
      createdAt: metadata.createdAt.toISOString(),
      updatedAt: metadata.updatedAt.toISOString(),
      lastConnectionAt: metadata.lastConnectionAt.toISOString(),
      liveState: live.ok ? "LIVE" : `STALE: ${live.message}`,
      messageLog: messages?.ok
        ? JSON.stringify(messages.output, null, 2)
        : "Unavailable",
    };
    screenModel1 ??= new Model(screenModel1Data);
    screenModel1.data = screenModel1Data;
    const event = await callScreen({
      id: advanced ? "uui-session-advanced" : "uui-session-detail",
      title: advanced
        ? `Advanced · ${metadata.sessionId}`
        : `Session for ${metadata.authenticatedUser}`,
      schema: DetailScreen,
      model: screenModel1,
      controls: (advanced
        ? [
          "sessionId",
          "authenticatedUserId",
          "latestNetworkScope",
          "serviceId",
          "persistentExecutionId",
          "nodeId",
          "sandboxId",
          "workerId",
          "currentScreenId",
          "liveState",
          "messageLog",
        ]
        : detailLayout.root.controls).map((bind) => ({ bind })),
      layout: advanced ? undefined : detailLayout,
      header: {
        actions: [
          { id: "refresh", label: "[[icon=refresh]] Refresh" },
          ...(!advanced ? [{ id: "advanced", label: "Advanced" }] : []),
          ...(live.ok && !advanced &&
              currentUser()?.id === metadata.authenticatedUserId
            ? [{ id: "connect", label: "Connect" }]
            : []),
          ...(live.ok && !advanced
            ? [{
              id: "terminate",
              label: "End session",
              kind: "danger" as const,
            }]
            : []),
          ...(!live.ok && !advanced
            ? [{
              id: "clean",
              label: "Remove stale session",
              kind: "danger" as const,
            }]
            : []),
        ],
      },
    });
    if (event.action === BACK_EVENT) return;
    if (event.action === "advanced") {
      await presentPage(() => sessionDetail(metadata, true));
    }
    if (
      event.action === "connect" &&
      currentUser()?.id === metadata.authenticatedUserId
    ) openSession(metadata.sessionId);
    if (event.action === "clean") {
      await removeMetadata(metadata.sessionId);
      sendMessage("Stale session metadata removed", "success");
      return;
    }
    if (event.action === "terminate") {
      const confirmed = await presentModal(() =>
        callScreen({
          id: "uui-session-end",
          title: `End ${metadata.authenticatedUser}'s session?`,
          description: "Any interactive work in this session will stop.",
          schema: z.object({}),
          model: new Model({}),
          header: {
            actions: [{ id: "end", label: "End session", kind: "danger" }, {
              id: "keep",
              label: "Keep session",
            }],
          },
        })
      );
      if (confirmed.action !== "end") continue;
      const result = await invoke(metadata, "uui.session.terminate", {
        sessionId: metadata.sessionId,
      });
      sendMessage(
        result.ok ? "Session terminated" : result.message,
        result.ok ? "success" : "error",
      );
      if (result.ok) return;
    }
    const refreshed = await readSession(metadata.sessionId);
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

export async function readSessionMetadata(
  username?: string,
  offset = 0,
  limit = maximumSessions,
): Promise<SessionMetadata[]> {
  return await Sessions.selectAll().$if(
    username !== undefined,
    (query) => query.where(Sessions.authenticatedUser, "=", username!),
  ).orderBy(Sessions.updatedAt, "desc").orderBy(Sessions.sessionId).offset(
    offset,
  ).limit(
    limit,
  ).execute() as SessionMetadata[];
}

export async function readSession(
  sessionId: string,
): Promise<SessionMetadata | undefined> {
  return await Sessions.selectAll().where(Sessions.sessionId, "=", sessionId)
    .executeTakeFirst() as SessionMetadata | undefined;
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
