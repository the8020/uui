import { type Row, t, table, type TableDatabase } from "@the8020/db";

const Sessions = table("the8020__uui__sessions", {
  sessionId: t.text().primaryKey(),
  serviceId: t.text(),
  persistentExecutionId: t.text(),
  nodeId: t.text(),
  runtimeGroupId: t.text(),
  sandboxId: t.text(),
  workerId: t.text(),
  authenticatedUserId: t.text(),
  authenticatedUser: t.text(),
  latestIpAddress: t.text(),
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
  currentScreenId: t.text().nullable(),
  terminationFailure: t.text().nullable(),
}, {
  indexes: [
    { columns: ["authenticatedUserId"] },
    { columns: ["state", "updatedAt"] },
    { columns: ["workerId"] },
  ],
});

declare module "@the8020/db/types" {
  interface Database extends TableDatabase<typeof Sessions> {}
}

export type UISessionRow = Row<typeof Sessions>;
export default Sessions;
