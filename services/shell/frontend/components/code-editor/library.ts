// deno-lint-ignore-file no-import-prefix
// Vendoring entry point: keep pinned dependencies local to this optional component.
export type { Extension } from "npm:@codemirror/state@6.7.4";
export type { Diagnostic } from "npm:@codemirror/lint@6.9.7";
export {
  Compartment,
  EditorState,
  StateEffect,
  StateField,
  Transaction,
} from "npm:@codemirror/state@6.7.4";
export {
  Decoration,
  drawSelection,
  EditorView,
  gutter,
  GutterMarker,
  keymap,
  lineNumbers,
  ViewPlugin,
} from "npm:@codemirror/view@6.43.11";
export {
  bracketMatching,
  ensureSyntaxTree,
  HighlightStyle,
  indentOnInput,
  StreamLanguage,
  syntaxHighlighting,
  syntaxTree,
} from "npm:@codemirror/language@6.12.4";
export {
  defaultKeymap,
  history,
  historyKeymap,
} from "npm:@codemirror/commands@6.11.0";
export { linter, lintGutter } from "npm:@codemirror/lint@6.9.7";
export { tags } from "npm:@lezer/highlight@1.2.3";

export const languages = {
  javascript: () => import("npm:@codemirror/lang-javascript@6.2.5"),
  json: () => import("npm:@codemirror/lang-json@6.0.2"),
  html: () => import("npm:@codemirror/lang-html@6.4.12"),
  css: () => import("npm:@codemirror/lang-css@6.3.1"),
  python: () => import("npm:@codemirror/lang-python@6.2.1"),
  sql: () => import("npm:@codemirror/lang-sql@6.10.0"),
  markdown: () => import("npm:@codemirror/lang-markdown@6.5.2"),
  yaml: () => import("npm:@codemirror/lang-yaml@6.1.3"),
  go: () => import("npm:@codemirror/legacy-modes@6.5.4/mode/go"),
  shell: () => import("npm:@codemirror/legacy-modes@6.5.4/mode/shell"),
  toml: () => import("npm:@codemirror/legacy-modes@6.5.4/mode/toml"),
};
