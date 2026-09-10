import { choiceHelp, field, z } from "/p/the8020/db/fields.ts";
import { accountInfo } from "/p/the8020/users/types/user.ts";
import { runtimeInfo } from "/p/the8020/admin-core/types/runtime.ts";

export const sessionInfo = z.object({
  sessionId: field(z.string(), {
    label: "Session ID",
    description:
      "Identifies this UUI session and its interactive work, independently of the account sign-in.",
  }),
  state: field(z.string(), {
    label: "Status",
    description:
      "The latest connection or lifecycle status of this UUI session. Unavailable means the live execution could not be reached.",
    valueHelp: choiceHelp(z.string(), [
      "CONNECTED",
      "DISCONNECTED",
      "ENDED",
      "STALE",
      "Unavailable",
    ]),
  }),
  latestIpAddress: field(z.string(), {
    label: "Latest IP address",
    description: "The client address observed at the most recent connection.",
  }),
  latestNetworkScope: field(z.string(), {
    label: "Network scope",
    description:
      "Whether the most recent client address is loopback, private, link-local, public, or special-use.",
    valueHelp: choiceHelp(z.string(), [
      "loopback",
      "private",
      "link_local",
      "public",
      "special",
    ]),
  }),
  persistentExecutionId: field(z.string(), {
    label: "Persistent execution",
    description:
      "The live execution that owns this session. This identity stays the same when the browser reconnects.",
  }),
  currentScreen: field(z.string(), {
    label: "Current screen",
    description:
      "The title of the screen currently open in this session, when its execution is reachable.",
  }),
  currentScreenId: field(z.string(), {
    label: "Screen ID",
    description: "The program-defined identifier of the last reported screen.",
  }),
  createdAt: field(z.string(), {
    label: "Started (UTC)",
    description: "When this UUI session started, in UTC.",
  }),
  updatedAt: field(z.string(), {
    label: "Last activity (UTC)",
    description: "When this session last reported activity, in UTC.",
  }),
  lastConnectionAt: field(z.string(), {
    label: "Last connection (UTC)",
    description: "When a browser last connected to this session, in UTC.",
  }),
  liveState: field(z.string(), {
    label: "Live validation",
    description:
      "Whether the exact session execution can be reached. A stale entry has metadata but no reachable execution.",
  }),
  messageLog: field(z.string(), {
    label: "Message log",
    description:
      "The bounded recent diagnostic message log for this session. Available only while its execution can be reached.",
  }),
  authenticatedUserId: accountInfo.shape.userId,
  nodeId: runtimeInfo.shape.nodeId,
});
