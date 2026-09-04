import { db } from "/p/the8020/db/mod.ts";
import type {
  SessionMetadata,
  SessionMetadataStore,
} from "./session_metadata.ts";
import Sessions from "./tables/sessions.ts";

class DatabaseSessionMetadataStore implements SessionMetadataStore {
  async put(metadata: SessionMetadata): Promise<void> {
    await db.insertInto(Sessions.table).values(metadata).onConflict((
      conflict,
    ) =>
      conflict.column("sessionId").doUpdateSet({
        serviceId: metadata.serviceId,
        persistentExecutionId: metadata.persistentExecutionId,
        nodeId: metadata.nodeId,
        runtimeGroupId: metadata.runtimeGroupId,
        sandboxId: metadata.sandboxId,
        workerId: metadata.workerId,
        authenticatedUserId: metadata.authenticatedUserId,
        authenticatedUser: metadata.authenticatedUser,
        latestIpAddress: metadata.latestIpAddress,
        latestNetworkScope: metadata.latestNetworkScope,
        state: metadata.state,
        updatedAt: metadata.updatedAt,
        lastConnectionAt: metadata.lastConnectionAt,
        currentScreenId: metadata.currentScreenId,
        terminationFailure: metadata.terminationFailure,
      })
    ).execute();
  }

  async remove(sessionId: string): Promise<void> {
    await Sessions.delete().where(Sessions.sessionId, "=", sessionId).execute();
  }
}

export const sessionMetadataStore: SessionMetadataStore =
  new DatabaseSessionMetadataStore();
