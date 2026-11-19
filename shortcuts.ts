import { z } from "/p/the8020/db/fields.ts";
import { field } from "./fields.ts";
import { presentModal } from "./session.ts";
import { msg } from "./i18n/messages.ts";
import {
  programId,
  programInfo,
  programShortcut,
} from "/p/the8020/packages/types/program.ts";
import { queryValueHelp } from "./lists.ts";
import type { DiscoveredProgram } from "./programs.ts";
import { listPrograms } from "/p/the8020/packages/programs.ts";
import { fetchUserShortcuts } from "./preferences.ts";
import type { PersonalShortcut } from "./src/shortcut_fields.ts";

/** Personal codes replace every default with the same case-insensitive code. */
export function effectiveShortcuts(
  programs: readonly DiscoveredProgram[],
  personal: readonly PersonalShortcut[],
) {
  const overrides = new Map(
    personal.map((row) => [row.shortcut.toUpperCase(), row.program]),
  );
  const rows = programs.flatMap((program) =>
    program.shortcut && !overrides.has(program.shortcut.toUpperCase())
      ? [{
        shortcut: program.shortcut.toUpperCase(),
        program: program.id,
        description: program.description,
      }]
      : []
  );
  const byId = new Map(programs.map((program) => [program.id, program]));
  for (const [shortcut, id] of overrides) {
    const program = byId.get(id);
    if (program) {
      rows.push({ shortcut, program: id, description: program.description });
    }
  }
  return rows.sort((a, b) =>
    a.shortcut.localeCompare(b.shortcut) || a.program.localeCompare(b.program)
  );
}

export function shortcutFields(
  programs: () => Promise<DiscoveredProgram[]> = async () =>
    (await listPrograms()).filter((program) => program.uui).map((program) => ({
      id: program.program_id,
      description: program.description,
      shortcut: program.shortcut,
    })),
) {
  const shortcut = field(programShortcut, {
    helpActions: [{
      label: msg("shortcuts.customize"),
      async run() {
        const { default: customization } = await import(
          "./programs/customization/program.ts"
        );
        await presentModal(customization);
      },
    }],
    valueHelp: async (request) =>
      queryValueHelp(
        z.object({
          shortcut: programShortcut,
          program: programId,
          description: programInfo.shape.description,
        }),
        effectiveShortcuts(await programs(), await fetchUserShortcuts()),
        request,
      ),
  });
  const program = field(programId, {
    valueHelp: async (request) =>
      queryValueHelp(
        z.object({
          program: programId,
          description: programInfo.shape.description,
        }),
        (await programs()).map((item) => ({
          program: item.id,
          description: item.description,
        })),
        request,
      ),
  });
  return { shortcut, program };
}
