import { msg } from "/p/the8020/uui/i18n/messages.ts";
import { choiceHelp, field, z } from "/p/the8020/db/fields.ts";
import { accountInfo } from "/p/the8020/users/types/user.ts";
import { runtimeInfo } from "/p/the8020/admin-core/types/runtime.ts";

export const sessionInfo = z.object({
  sessionId: field(z.string(), {
    label: msg("session_fields.session_id"),
    description: msg(
      "session_fields.identifies_this_uui_session_and_its_interactive",
    ),
  }),
  state: field(z.string(), {
    label: msg("session_fields.status"),
    description: msg(
      "session_fields.the_latest_connection_or_lifecycle_status_of",
    ),
    valueHelp: choiceHelp(z.string(), [
      "CONNECTED",
      "DISCONNECTED",
      "ENDED",
      "STALE",
      { value: "Unavailable", label: msg("program.unavailable") },
    ]),
  }),
  latestIpAddress: field(z.string(), {
    label: msg("session_fields.latest_ip_address"),
    description: msg("session_fields.the_client_address_observed_at_the_most"),
  }),
  latestNetworkScope: field(z.string(), {
    label: msg("session_fields.network_scope"),
    description: msg(
      "session_fields.whether_the_most_recent_client_address_is",
    ),
    valueHelp: choiceHelp(z.string(), [
      "loopback",
      "private",
      "link_local",
      "public",
      "special",
    ]),
  }),
  persistentExecutionId: field(z.string(), {
    label: msg("session_fields.persistent_execution"),
    description: msg(
      "session_fields.the_live_execution_that_owns_this_session",
    ),
  }),
  currentScreen: field(z.string(), {
    label: msg("session_fields.current_screen"),
    description: msg("session_fields.the_title_of_the_screen_currently_open"),
  }),
  currentScreenId: field(z.string(), {
    label: msg("session_fields.screen_id"),
    description: msg(
      "session_fields.the_program_defined_identifier_of_the_last",
    ),
  }),
  createdAt: field(z.string(), {
    label: msg("session_fields.started_utc"),
    description: msg("session_fields.when_this_uui_session_started_in_utc"),
  }),
  updatedAt: field(z.string(), {
    label: msg("session_fields.last_activity_utc"),
    description: msg(
      "session_fields.when_this_session_last_reported_activity_in",
    ),
  }),
  lastConnectionAt: field(z.string(), {
    label: msg("session_fields.last_connection_utc"),
    description: msg("session_fields.when_a_browser_last_connected_to_this"),
  }),
  liveState: field(z.string(), {
    label: msg("session_fields.live_validation"),
    description: msg(
      "session_fields.whether_the_exact_session_execution_can_be",
    ),
  }),
  messageLog: field(z.string(), {
    label: msg("session_fields.message_log"),
    description: msg(
      "session_fields.the_bounded_recent_diagnostic_message_log_for",
    ),
  }),
  authenticatedUserId: accountInfo.shape.userId,
  nodeId: runtimeInfo.shape.nodeId,
});
