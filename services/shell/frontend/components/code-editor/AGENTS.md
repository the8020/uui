Parent DOX: [shell frontend](../../AGENTS.md).

# Purpose

- Provide the optional, model-bound UUI code editor through the ordinary custom
  component host.

# Ownership

- `mod.ts` owns the program-facing descriptor and options. `editor.ts` and
  `editor.css` own browser editing, local syntax checks, line markers, and
  tools.
- `library.ts` pins CodeMirror and language dependencies. `vendor/` contains
  their browser bundles and licenses; `vendor.sh` rebuilds them.

# Local Contracts

- Use `field(schema, { custom: codeEditor(options), ... })`. Ordinary field
  metadata owns labels, read-only mode, reactivity, length, and rowSpan.
- `codeEditor()` declares one multiline fallback input named `value`, bound to
  the complete text. Agent commands use `<control ID>/value`; consumers do not
  repeat this declaration. Read-only mode applies to the fallback too.
- Load the editor and its selected language only when rendered. No editor
  dependency belongs in `main.js`.
- Serve the checked-in browser bundles directly. Dependency installation and
  `vendor.sh` belong only to development updates, never runtime startup.
- Match UUI light/dark surface tokens. Use existing buttons and icon markup for
  Copy all and content fullscreen; release fullscreen when deactivated.
- Store scroll and selection in the host's screen element state. Synchronize
  only with ordinary interactions; reset with the owning Model.
- Mount and initial line reveal scroll only the editor's own viewport. Never
  scroll the surrounding page or modal into view; retained scroll takes
  precedence over the initial reveal line.
- A program-owned extension may set `data.selection.reveal = true` with its
  target anchor/head before update. This one-shot line reveal overrides retained
  vertical scroll through the same editor-only restoration path, then captures
  ordinary scroll/selection state; consumers must not race restoration with
  delayed scroll writes.
- Syntax checks report bounded local parser errors, never resolve imports or
  external symbols. Text, Markdown, SQL, and legacy stream modes have no
  structural checker. Disable checks for partial source snippets.
- Optional one-based line markers show added/removed/error backgrounds and
  gutter labels or breakpoint indicators. They present caller-supplied data;
  they do not compute diffs or implement a debugger.

# Work Guidance

- Extend through ordinary CodeMirror extensions and the custom mount contract.
  Keep the public descriptor serializable and vendor licenses with the library.
- Browser mount returns its native `editor` for program-owned extensions. Use
  the vendored state/view primitives to share the same CodeMirror instance.

# Verification

- Run UUI check/test, rebuild the shell, and run
  `deno task test:code-editor-browser`. The browser fixture checks page position
  on mount, Demo form, and Program terminated alongside retained editor state.

# Child DOX Index
