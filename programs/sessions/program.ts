import { kernel, WorkerInvokeError } from "@the8020/kernel";
import {
  BACK_EVENT,
  callScreen,
  field,
  showNotification,
  z,
} from "@packages/the8020/uui/mod.ts";
import detailLayout from "./layouts/detail.json" with { type: "json" };
import listLayout from "./layouts/list.json" with { type: "json" };

const metadataRoot = "/state/package-data/the8020/uui/sessions";
const maximumSessions = 200;
const maximumDirectoryEntries = 1_000;
const maximumMetadataBytes = 64 * 1024;

export interface SessionMetadata {
  schema: 1;
  session_id: string;
  service_id: string;
  persistent_execution_id: string;
  node_id: string;
  runtime_group_id: string;
  sandbox_id: string;
  worker_id: string;
  authenticated_user_id: string;
  authenticated_user: string;
  state: string;
  created_at: string;
  updated_at: string;
  last_connection_at: string;
  current_screen_id?: string;
  termination_failure?: string;
}

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
  serviceId: field(z.string(), { label: "Service", readOnly: true }),
  persistentExecutionId: field(z.string(), {
    label: "Persistent execution",
    readOnly: true,
  }),
  nodeId: field(z.string(), { label: "Node", readOnly: true }),
  runtimeGroupId: field(z.string(), { label: "Runtime group", readOnly: true }),
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
  while (true) {
    const sessions = await readSessionMetadata();
    const event = await callScreen({
      id: "uui-sessions",
      title: "UUI sessions",
      schema: ListScreen,
      model: {
        sessions: sessions.map((item) => ({
          navigation: item.session_id,
          sessionId: item.session_id,
          user: item.authenticated_user,
          state: item.state,
          screen: item.current_screen_id ?? "",
          nodeId: item.node_id,
          updatedAt: item.updated_at,
        })),
      },
      layout: listLayout,
      header: { actions: [{ id: "refresh", label: "Refresh" }] },
    });
    if (event.action === BACK_EVENT) return;
    if (event.action === "select" && typeof event.value === "string") {
      const selected = sessions.find((item) => item.session_id === event.value);
      if (selected !== undefined) await sessionDetail(selected);
    }
  }
}

async function sessionDetail(metadata: SessionMetadata): Promise<void> {
  while (true) {
    const live = await invoke(metadata, "uui.session.inspect", {
      sessionId: metadata.session_id,
    });
    const messages = live.ok
      ? await invoke(metadata, "uui.session.message-log", {
        sessionId: metadata.session_id,
      })
      : live;
    const event = await callScreen({
      id: "uui-session-detail",
      title: `UUI session ${metadata.session_id}`,
      schema: DetailScreen,
      model: {
        sessionId: metadata.session_id,
        state: metadata.state,
        authenticatedUser: metadata.authenticated_user,
        authenticatedUserId: metadata.authenticated_user_id,
        serviceId: metadata.service_id,
        persistentExecutionId: metadata.persistent_execution_id,
        nodeId: metadata.node_id,
        runtimeGroupId: metadata.runtime_group_id,
        sandboxId: metadata.sandbox_id,
        workerId: metadata.worker_id,
        currentScreen: metadata.current_screen_id ?? "",
        createdAt: metadata.created_at,
        updatedAt: metadata.updated_at,
        lastConnectionAt: metadata.last_connection_at,
        liveState: live.ok ? "LIVE" : `STALE: ${live.message}`,
        messageLog: messages.ok
          ? JSON.stringify(messages.output, null, 2)
          : "Unavailable",
      },
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
      await removeMetadata(metadata.session_id);
      showNotification("Stale session metadata removed", "success");
      return;
    }
    if (event.action === "terminate") {
      const result = await invoke(metadata, "uui.session.terminate", {
        sessionId: metadata.session_id,
      });
      showNotification(
        result.ok ? "Session terminated" : result.message,
        result.ok ? "success" : "error",
      );
      if (result.ok) return;
    }
    const refreshed = (await readSessionMetadata()).find((item) =>
      item.session_id === metadata.session_id
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
        nodeId: metadata.node_id,
        sandboxId: metadata.sandbox_id,
        workerId: metadata.worker_id,
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
  const names: string[] = [];
  let visited = 0;
  try {
    for await (const entry of Deno.readDir(metadataRoot)) {
      if (++visited > maximumDirectoryEntries) break;
      if (entry.isFile && /^uis-[a-z0-9]{8}\.json$/.test(entry.name)) {
        names.push(entry.name);
        if (names.length >= maximumSessions) break;
      }
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return [];
    throw error;
  }
  names.sort();
  const result: SessionMetadata[] = [];
  for (const name of names) {
    try {
      const data = await readBoundedFile(
        `${metadataRoot}/${name}`,
        maximumMetadataBytes,
      );
      if (data === undefined) continue;
      const value = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(data),
      );
      if (validMetadata(value)) result.push(value);
    } catch {
      // One malformed package-owned record cannot hide other sessions.
    }
  }
  return result.sort((left, right) =>
    right.updated_at.localeCompare(left.updated_at)
  );
}

async function readBoundedFile(
  path: string,
  maximumBytes: number,
): Promise<Uint8Array | undefined> {
  const file = await Deno.open(path, { read: true });
  try {
    const buffer = new Uint8Array(maximumBytes + 1);
    let length = 0;
    while (length < buffer.byteLength) {
      const count = await file.read(buffer.subarray(length));
      if (count === null) break;
      if (count === 0) break;
      length += count;
    }
    return length > maximumBytes ? undefined : buffer.subarray(0, length);
  } finally {
    file.close();
  }
}

function validMetadata(value: unknown): value is SessionMetadata {
  if (value === null || typeof value !== "object") return false;
  const item = value as Partial<SessionMetadata>;
  return item.schema === 1 &&
    typeof item.session_id === "string" &&
    typeof item.service_id === "string" &&
    typeof item.persistent_execution_id === "string" &&
    typeof item.node_id === "string" &&
    typeof item.runtime_group_id === "string" &&
    typeof item.sandbox_id === "string" &&
    typeof item.worker_id === "string" &&
    typeof item.authenticated_user_id === "string" &&
    typeof item.authenticated_user === "string" &&
    typeof item.state === "string" &&
    typeof item.created_at === "string" &&
    typeof item.updated_at === "string" &&
    typeof item.last_connection_at === "string";
}

async function removeMetadata(sessionId: string): Promise<void> {
  if (!/^uis-[a-z0-9]{8}$/.test(sessionId)) {
    throw new TypeError("invalid session ID");
  }
  try {
    await Deno.remove(`${metadataRoot}/${sessionId}.json`);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
}
