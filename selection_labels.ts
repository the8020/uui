import type { SelectionOption } from "/p/the8020/db/selection.ts";
import { msg } from "./i18n/messages.ts";

/** Shared presentation meaning for semantic fields, criteria rows and tokens. */
export const selectionOperators = {
  EQ: msg("selection.equals"),
  NE: msg("selection.notEqual"),
  GT: msg("selection.greater"),
  GE: msg("selection.greaterEqual"),
  LT: msg("selection.less"),
  LE: msg("selection.lessEqual"),
  BT: msg("selection.between"),
  CP: msg("selection.pattern"),
} satisfies Record<SelectionOption, ReturnType<typeof msg>>;

export const selectionSigns = {
  I: msg("selection.include"),
  E: msg("selection.exclude"),
};
