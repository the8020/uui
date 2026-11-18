import { field, z } from "/p/the8020/db/fields.ts";
import { systemProfile } from "/p/the8020/system/profile.ts";
import { username, userProfile } from "/p/the8020/users/types/user.ts";
import { programId, programInfo } from "/p/the8020/packages/types/program.ts";
import { sandboxId, workerId } from "/p/the8020/admin-core/types/runtime.ts";
import { language } from "/p/the8020/i18n/fields.ts";
import { sessionInfo } from "./session_fields.ts";
import { msg } from "../i18n/messages.ts";

export const statusFields = z.object({
  username,
  fullName: userProfile.shape.fullName.optional(),
  systemName: systemProfile.shape.name.optional(),
  systemRole: systemProfile.shape.role.optional(),
  systemId: systemProfile.shape.id.optional(),
  address: field(z.string(), { label: msg("status.address") }),
  programId: field(programId.optional(), { label: msg("status.program_id") }),
  programName: field(programInfo.shape.name.optional(), {
    label: msg("status.program_name"),
  }),
  screenId: sessionInfo.shape.currentScreenId,
  screenTitle: sessionInfo.shape.currentScreen,
  packageVersion: field(z.string(), { label: msg("status.package_version") }),
  kernelVersion: field(z.string(), { label: msg("status.kernel_version") }),
  uuiVersion: field(z.string(), { label: msg("status.uui_version") }),
  language: language.optional(),
  timeZone: field(z.string(), { label: msg("status.time_zone") }),
  sessionId: sessionInfo.shape.sessionId,
  startedAt: sessionInfo.shape.createdAt.optional(),
  nodeId: sessionInfo.shape.nodeId,
  executionId: sessionInfo.shape.persistentExecutionId.optional(),
  workerId,
  sandboxId,
  screenCall: field(z.string().optional(), { label: msg("status.source") }),
  connectionState: sessionInfo.shape.state.optional(),
  protocol: field(z.number().int(), { label: msg("status.protocol") }),
});
