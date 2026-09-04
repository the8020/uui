export type SessionMetadataState =
  | "CONNECTED"
  | "DISCONNECTED"
  | "ENDED"
  | "STALE";

export interface SessionMetadata {
  sessionId: string;
  serviceId: string;
  persistentExecutionId: string;
  nodeId: string;
  runtimeGroupId: string;
  sandboxId: string;
  workerId: string;
  authenticatedUserId: string;
  authenticatedUser: string;
  latestIpAddress: string;
  latestNetworkScope:
    | "loopback"
    | "private"
    | "link_local"
    | "public"
    | "special";
  state: SessionMetadataState;
  createdAt: Date;
  updatedAt: Date;
  lastConnectionAt: Date;
  currentScreenId: string | null;
  terminationFailure: string | null;
}

export interface SessionMetadataStore {
  put(metadata: SessionMetadata): Promise<void>;
  remove(sessionId: string): Promise<void>;
}
