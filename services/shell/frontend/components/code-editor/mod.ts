import type { CustomElementOptions } from "../../../../../protocol.ts";

export type CodeLanguage =
  | "text"
  | "javascript"
  | "typescript"
  | "jsx"
  | "tsx"
  | "json"
  | "html"
  | "css"
  | "sql"
  | "python"
  | "markdown"
  | "yaml"
  | "go"
  | "shell"
  | "toml";

export interface CodeLineMarker {
  /** One-based source line, including firstLine's offset. */
  line: number;
  kind?: "added" | "removed" | "error" | "breakpoint";
  label?: string;
}

export interface CodeEditorOptions {
  language?: CodeLanguage;
  syntaxCheck?: boolean;
  wrap?: boolean;
  /** First displayed line number for a source excerpt; defaults to 1. */
  firstLine?: number;
  /** Initial reveal only; retained screen scroll takes precedence. */
  revealLine?: number;
  markers?: CodeLineMarker[];
}

/** Prebuilt custom field. Labels, sizing, readOnly and reactive stay on the field. */
export function codeEditor(
  options: CodeEditorOptions = {},
): CustomElementOptions {
  for (
    const line of [
      options.firstLine,
      options.revealLine,
      ...(options.markers ?? []).map((marker) => marker.line),
    ]
  ) {
    if (line !== undefined && (!Number.isSafeInteger(line) || line < 1)) {
      throw new TypeError("code editor lines must be positive integers");
    }
  }
  const base = "/the8020/uui/shell/components/code-editor/";
  return {
    module: `${base}editor.js`,
    styles: [`${base}editor.css`],
    preserve: true,
    fallback: {
      inputs: [{ name: "value", path: "", label: "Code", multiline: true }],
    },
    config: Object.fromEntries(
      Object.entries(options).filter(([, value]) => value !== undefined),
    ),
  };
}
