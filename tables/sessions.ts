import { type Row, t, table, type TableDatabase } from "/p/the8020/db/mod.ts";
import { sessionInfo } from "../src/session_fields.ts";
import { username } from "/p/the8020/users/types/user.ts";

import { serviceId } from "/p/the8020/services/types/service.ts";
import { sandboxId, workerId } from "/p/the8020/admin-core/types/runtime.ts";

const Sessions = table("the8020__uui__sessions", {
  sessionId: t.from(sessionInfo.shape.sessionId).primaryKey(),
  serviceId: t.from(serviceId),
  persistentExecutionId: t.from(sessionInfo.shape.persistentExecutionId),
  nodeId: t.from(sessionInfo.shape.nodeId),

  sandboxId: t.from(sandboxId),
  workerId: t.from(workerId),
  authenticatedUserId: t.from(sessionInfo.shape.authenticatedUserId),
  authenticatedUser: t.from(username),
  latestIpAddress: t.from(sessionInfo.shape.latestIpAddress),
  latestNetworkScope: t.enum(
    [
      "loopback",
      "private",
      "link_local",
      "public",
      "special",
    ] as const,
  ),
  state: t.enum(["CONNECTED", "DISCONNECTED", "ENDED", "STALE"] as const),
  createdAt: t.datetime(),
  updatedAt: t.datetime(),
  lastConnectionAt: t.datetime(),
  currentScreenId: t.from(sessionInfo.shape.currentScreenId).nullable(),
  terminationFailure: t.text().nullable(),
}, {
  indexes: [
    { columns: ["authenticatedUserId"] },
    { columns: ["state", "updatedAt"] },
    { columns: ["workerId"] },
  ],
});

declare module "/p/the8020/db/types.ts" {
  interface Database extends TableDatabase<typeof Sessions> {}
}

export type UISessionRow = Row<typeof Sessions>;
export default Sessions;
