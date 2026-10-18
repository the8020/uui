import { kernel, WorkerInvokeError } from "@the8020/kernel";
import Sessions from "./tables/sessions.ts";
import config from "./ui-config.json" with { type: "json" };

/** Old timestamps select candidates; only confirmed missing executions are removed. */
export async function cleanupSessions(now = new Date()) {
  const cutoff = new Date(now.getTime() - config.disconnectGraceMilliseconds);
  const deadline = Date.now() + 240_000;
  let after: { updatedAt: Date; sessionId: string } | undefined;
  const result = { scanned: 0, removed: 0, unavailable: 0, complete: false };
  while (Date.now() < deadline) {
    let query = Sessions.selectAll().where(Sessions.updatedAt, "<=", cutoff);
    if (after) {
      const cursor = after;
      query = query.where((eb) =>
        eb.or([
          eb(Sessions.updatedAt, ">", cursor.updatedAt),
          eb.and([
            eb(Sessions.updatedAt, "=", cursor.updatedAt),
            eb(Sessions.sessionId, ">", cursor.sessionId),
          ]),
        ])
      );
    }
    const rows = await query.orderBy(Sessions.updatedAt).orderBy(
      Sessions.sessionId,
    ).limit(100).execute();
    for (const row of rows) {
      if (Date.now() >= deadline) return result;
      result.scanned++;
      try {
        await kernel.worker.invoke({
          nodeId: row.nodeId,
          sandboxId: row.sandboxId,
          workerId: row.workerId,
          persistentExecutionId: row.persistentExecutionId,
          function: "uui.session.inspect",
          input: { sessionId: row.sessionId },
        });
      } catch (error) {
        if (
          !(error instanceof WorkerInvokeError) ||
          error.code !== "target_not_found"
        ) {
          result.unavailable++;
          continue;
        }
        const deleted = await Sessions.delete()
          .where(Sessions.sessionId, "=", row.sessionId)
          .where(Sessions.updatedAt, "=", row.updatedAt)
          .where(Sessions.nodeId, "=", row.nodeId)
          .where(Sessions.sandboxId, "=", row.sandboxId)
          .where(Sessions.workerId, "=", row.workerId)
          .where(Sessions.persistentExecutionId, "=", row.persistentExecutionId)
          .executeTakeFirst();
        result.removed += Number(deleted.numDeletedRows);
      }
    }
    if (rows.length < 100) return { ...result, complete: true };
    after = rows.at(-1)!;
  }
  return result;
}
