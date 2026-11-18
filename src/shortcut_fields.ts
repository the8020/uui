import { z } from "/p/the8020/db/fields.ts";
import {
  programId,
  programShortcut,
} from "/p/the8020/packages/types/program.ts";
import { validProgramID } from "../programs.ts";
import { msg } from "../i18n/messages.ts";

export const shortcutEntry = z.object({
  shortcut: programShortcut,
  program: programId.refine(validProgramID),
});

export const personalShortcuts = shortcutEntry.array().max(100).superRefine(
  (rows, context) => {
    const codes = new Set<string>();
    rows.forEach((row, index) => {
      const code = row.shortcut.toUpperCase();
      if (codes.has(code)) {
        context.addIssue({
          code: "custom",
          params: { text: msg("shortcuts.duplicate") },
          path: [index, "shortcut"],
        });
      }
      codes.add(code);
    });
  },
);

export type PersonalShortcut = z.infer<typeof shortcutEntry>;
