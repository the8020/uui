import type {
  CustomElementContext,
  CustomElementInstance,
} from "../../../../../custom_element.ts";
import type { CodeEditorOptions, CodeLanguage, CodeLineMarker } from "./mod.ts";
import { writeClipboard } from "../../clipboard.ts";
// @ts-types="./library.ts"
import {
  bracketMatching,
  Compartment,
  Decoration,
  defaultKeymap,
  type Diagnostic,
  drawSelection,
  EditorState,
  EditorView,
  ensureSyntaxTree,
  type Extension,
  gutter,
  GutterMarker,
  HighlightStyle,
  history,
  historyKeymap,
  indentOnInput,
  keymap,
  languages,
  lineNumbers,
  linter,
  lintGutter,
  StreamLanguage,
  syntaxHighlighting,
  syntaxTree,
  tags,
  Transaction,
} from "./vendor/library.js";

const highlighting = syntaxHighlighting(HighlightStyle.define([
  { tag: tags.keyword, class: "uui-code-keyword" },
  { tag: [tags.string, tags.regexp], class: "uui-code-string" },
  { tag: [tags.number, tags.bool, tags.null], class: "uui-code-number" },
  { tag: tags.comment, class: "uui-code-comment" },
  {
    tag: [tags.typeName, tags.className, tags.tagName],
    class: "uui-code-type",
  },
  {
    tag: [tags.definition(tags.variableName), tags.function(tags.variableName)],
    class: "uui-code-function",
  },
  { tag: [tags.invalid], class: "uui-code-invalid" },
]));

async function languageMode(language: CodeLanguage): Promise<Extension> {
  switch (language) {
    case "javascript":
    case "typescript":
    case "jsx":
    case "tsx": {
      const modes = await languages.javascript();
      // The language objects supply parsing/highlighting without completion engines.
      return ({
        javascript: modes.javascriptLanguage,
        typescript: modes.typescriptLanguage,
        jsx: modes.jsxLanguage,
        tsx: modes.tsxLanguage,
      })[language];
    }
    case "json":
      return (await languages.json()).jsonLanguage;
    case "html":
      return (await languages.html()).htmlLanguage;
    case "css":
      return (await languages.css()).cssLanguage;
    case "python":
      return (await languages.python()).pythonLanguage;
    case "sql":
      return (await languages.sql()).sql();
    case "markdown":
      return (await languages.markdown()).markdownLanguage;
    case "yaml":
      return (await languages.yaml()).yamlLanguage;
    case "go":
      return StreamLanguage.define((await languages.go()).go);
    case "shell":
      return StreamLanguage.define((await languages.shell()).shell);
    case "toml":
      return StreamLanguage.define((await languages.toml()).toml);
    case "text":
      return [];
    default:
      throw new TypeError(`Unsupported code language: ${language}`);
  }
}

function syntaxDiagnostics(view: EditorView): Diagnostic[] {
  const tree = ensureSyntaxTree(view.state, view.state.doc.length, 30) ??
    syntaxTree(view.state);
  const diagnostics: Diagnostic[] = [];
  tree.iterate({
    enter(node) {
      if (diagnostics.length >= 100) return false;
      if (node.type.isError) {
        diagnostics.push({
          from: node.from,
          to: node.to,
          severity: "error",
          message: "Unexpected or incomplete syntax.",
        });
        return false;
      }
    },
  });
  return diagnostics;
}

function markerExtensions(
  options: CodeEditorOptions,
  context: CustomElementContext,
): Extension {
  const first = options.firstLine ?? 1;
  const markers = new Map(
    (options.markers ?? []).map((marker) => [marker.line, marker]),
  );
  class Marker extends GutterMarker {
    constructor(readonly marker: CodeLineMarker) {
      super();
    }
    override eq(other: Marker): boolean {
      return other.marker === this.marker;
    }
    override toDOM(): HTMLElement {
      const span = document.createElement("span");
      span.className = `uui-code-marker uui-code-${
        this.marker.kind ?? "label"
      }`;
      span.title = this.marker.label ?? this.marker.kind ?? "Line marker";
      span.setAttribute("aria-label", span.title);
      context.renderText(
        span,
        this.marker.label ??
          (this.marker.kind === "breakpoint"
            ? "[[icon=radio_button_checked]]"
            : "[[icon=chevron_right]]"),
      );
      return span;
    }
  }
  return [
    EditorView.decorations.of((view) =>
      Decoration.set(
        [...markers.values()]
          .filter((marker) =>
            marker.line >= first && marker.line - first < view.state.doc.lines
          )
          .map((marker) =>
            Decoration.line({
              class: `uui-code-line-${marker.kind ?? "label"}`,
            })
              .range(view.state.doc.line(marker.line - first + 1).from)
          ),
        true,
      )
    ),
    ...(markers.size
      ? [gutter({
        class: "uui-code-markers",
        lineMarker: (view, line) => {
          const marker = markers.get(
            view.state.doc.lineAt(line.from).number + first - 1,
          );
          return marker ? new Marker(marker) : null;
        },
      })]
      : []),
  ];
}

export interface CodeEditorInstance extends CustomElementInstance {
  /** Native CodeMirror API for program-owned commands and extensions. */
  readonly editor: EditorView;
}

/** May also be mounted by another program-owned module using this same context. */
export default function mount(
  context: CustomElementContext,
): CodeEditorInstance {
  const { host, signal } = context;
  host.classList.add("uui-code-editor");
  const toolbar = document.createElement("div");
  toolbar.className = "uui-code-toolbar";
  const status = document.createElement("span");
  status.className = "uui-code-status";
  status.setAttribute("role", "status");
  const body = document.createElement("div");
  body.className = "uui-code-body";
  host.append(toolbar, body);
  const configuration = new Compartment();
  const mode = new Compartment();
  let generation = 0;
  let signature = "";
  let applyingValue = false;
  let restored = false;
  let restoreFrame = 0;
  const value = (): string => {
    if (context.value == null) return "";
    if (typeof context.value !== "string") {
      throw new TypeError("code editor requires a string field");
    }
    return context.value;
  };
  const view = new EditorView({
    parent: body,
    doc: value(),
    extensions: [
      EditorView.cspNonce.of(
        document.querySelector<HTMLScriptElement>("script[nonce]")?.nonce ?? "",
      ),
      history(),
      drawSelection(),
      bracketMatching(),
      indentOnInput(),
      highlighting,
      keymap.of([...defaultKeymap, ...historyKeymap]),
      configuration.of([]),
      mode.of([]),
      EditorView.updateListener.of((update) => {
        if (!restored && update.geometryChanged) restore();
        if (update.docChanged && !applyingValue) {
          context.setValue(update.state.doc.toString());
        }
        if (update.selectionSet || update.docChanged) remember();
      }),
    ],
  });

  function remember(): void {
    if (!restored || !host.checkVisibility() || !host.isConnected) return;
    context.state.scroll = {
      x: view.scrollDOM.scrollLeft,
      y: view.scrollDOM.scrollTop,
    };
    const { anchor, head } = view.state.selection.main;
    context.state.data = { ...context.state.data, selection: { anchor, head } };
  }
  view.scrollDOM.addEventListener("scroll", remember, { signal });

  function restore(): void {
    cancelAnimationFrame(restoreFrame);
    if (signal.aborted) return;
    restored = false;
    const saved = context.state.data?.selection as {
      anchor?: number;
      head?: number;
    } | undefined;
    const scroll = { ...context.state.scroll };
    // The host can move during redraw. Restore after shell focus and DOM placement.
    restoreFrame = requestAnimationFrame(() => {
      if (signal.aborted || !host.checkVisibility()) return;
      const clamp = (position: number | undefined) =>
        Math.max(
          0,
          Math.min(
            Number.isSafeInteger(position) ? position! : 0,
            view.state.doc.length,
          ),
        );
      if (saved) {
        view.dispatch({
          selection: { anchor: clamp(saved.anchor), head: clamp(saved.head) },
        });
      } else {
        const options = context.config as CodeEditorOptions;
        const line = (options.revealLine ?? options.firstLine ?? 1) -
          (options.firstLine ?? 1) + 1;
        view.dispatch({
          effects: EditorView.scrollIntoView(
            view.state.doc.line(
              Math.max(1, Math.min(line, view.state.doc.lines)),
            ).from,
            { y: "center" },
          ),
        });
      }
      view.requestMeasure({
        read() {},
        write() {
          if (saved) {
            view.scrollDOM.scrollLeft = scroll.x;
            view.scrollDOM.scrollTop = scroll.y;
          }
          restored = true;
          remember();
        },
      });
    });
  }

  function fullscreen(expanded: boolean): void {
    remember();
    host.classList.toggle("uui-content-fullscreen", expanded);
    const label = expanded ? "Exit fullscreen" : "Fullscreen";
    expand.title = label;
    expand.setAttribute("aria-label", label);
    expand.setAttribute("aria-pressed", String(expanded));
    context.renderText(
      expand,
      `[[icon=${expanded ? "fullscreen_exit" : "fullscreen"}]]`,
    );
    if (expanded) expand.focus({ preventScroll: true });
    restore();
  }
  const button = (label: string, icon: string, click: () => void) => {
    const result = document.createElement("button");
    result.type = "button";
    result.className = "button button-secondary";
    result.title = label;
    result.setAttribute("aria-label", label);
    context.renderText(result, `[[icon=${icon}]]`);
    result.addEventListener("click", click, { signal });
    toolbar.append(result);
    return result;
  };
  button("Copy all", "content_copy", () => {
    void writeClipboard(view.state.doc.toString()).then(() => {
      status.textContent = "Copied";
    }, () => {
      status.textContent = "Copy failed. Select the text and copy it.";
    });
  });
  const expand = button("Fullscreen", "fullscreen", () => {
    fullscreen(!host.classList.contains("uui-content-fullscreen"));
  });
  expand.setAttribute("aria-pressed", "false");
  toolbar.append(status);
  host.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      host.classList.contains("uui-content-fullscreen")
    ) {
      event.preventDefault();
      event.stopPropagation();
      fullscreen(false);
      expand.focus();
    }
  }, { signal });

  async function configure(options: CodeEditorOptions): Promise<void> {
    const current = ++generation;
    const language = options.language ?? "text";
    status.textContent = "Loading…";
    const languageExtension = await languageMode(language);
    if (signal.aborted || current !== generation) return;
    const check = options.syntaxCheck !== false &&
      !["text", "markdown", "sql", "go", "shell", "toml"].includes(language);
    view.dispatch({
      effects: mode.reconfigure([
        languageExtension,
        ...(check
          ? [
            lintGutter(),
            linter(syntaxDiagnostics, {
              delay: 350,
              needsRefresh: (update) =>
                syntaxTree(update.startState) !== syntaxTree(update.state),
            }),
          ]
          : []),
      ]),
    });
    host.dataset.language = language;
    status.textContent = "";
  }

  function update(): void {
    restore();
    const text = value();
    if (text !== view.state.doc.toString()) {
      applyingValue = true;
      try {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: text },
          annotations: Transaction.addToHistory.of(false),
        });
      } finally {
        applyingValue = false;
      }
    }
    const options = context.config as CodeEditorOptions;
    const next = JSON.stringify([options, context.control]);
    if (next === signature) return;
    signature = next;
    view.dispatch({
      effects: configuration.reconfigure([
        EditorState.readOnly.of(context.control?.readOnly ?? false),
        EditorView.editable.of(!context.control?.readOnly),
        EditorView.contentAttributes.of({
          "aria-label": context.control?.label ?? "Code",
          "aria-readonly": String(context.control?.readOnly ?? false),
          "aria-multiline": "true",
          "tabindex": "0",
          "data-bind": context.control?.bind ?? "",
        }),
        lineNumbers({
          formatNumber: (line) => String(line + (options.firstLine ?? 1) - 1),
        }),
        markerExtensions(options, context),
        ...(options.wrap ? [EditorView.lineWrapping] : []),
      ]),
    });
    void configure(options).catch((error) => {
      if (!signal.aborted) {
        status.textContent = "Language could not be loaded.";
        console.error(error);
      }
    });
  }
  update();
  restore();
  return {
    editor: view,
    update,
    captureState: remember,
    setActive(value) {
      if (!value) fullscreen(false);
      else restore();
    },
    dispose() {
      generation++;
      fullscreen(false);
      view.destroy();
    },
  };
}
