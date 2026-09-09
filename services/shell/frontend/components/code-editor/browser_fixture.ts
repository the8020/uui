import { assertEquals } from "@std/assert";
import {
  callScreen,
  codeEditor,
  field,
  Model,
  presentModal,
  presentPage,
  ScreenChannel,
  z,
} from "../../../../../mod.ts";
import programTerminated from "../../../../../programs/program-terminated/program.ts";

interface Browser {
  evaluate<T>(expression: string): Promise<T>;
  command<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T>;
}

const longCode = Array.from(
  { length: 250 },
  (_, index) => `const value${index}: string = "${"wide source ".repeat(20)}";`,
).join("\n");
const languages = [
  "text",
  "typescript",
  "javascript",
  "jsx",
  "tsx",
  "json",
  "css",
  "html",
  "python",
  "yaml",
  "sql",
  "markdown",
  "go",
  "shell",
  "toml",
] as const;

export default function fixture() {
  const model = new Model({
    code: longCode,
    language: "typescript" as typeof languages[number],
    readOnly: false,
    reactive: false,
    note: "",
  });
  const channel = new ScreenChannel();
  let saved = "";
  let lastEvent = "";
  let count = 0;
  return {
    async run() {
      await callScreen({
        id: "editor-start",
        title: "Editor loading check",
        schema: z.object({}),
        model: new Model({}),
        actions: [{ id: "open", label: "Open editor" }],
      });
      while (true) {
        const event = await callScreen({
          id: "editor-test",
          title: "Code editor",
          model,
          channel,
          schema: z.object({
            code: field(z.string(), {
              custom: codeEditor(),
              length: "long",
              rowSpan: 5,
            }),
            language: field(z.enum(languages), { reactive: true }),
            readOnly: field(z.boolean(), {
              label: "Read only",
              reactive: true,
            }),
            reactive: field(z.boolean(), { reactive: true }),
            note: z.string(),
          }),
          controls: [
            {
              id: "code",
              bind: "code",
              readOnly: model.data.readOnly,
              reactive: model.data.reactive,
              custom: codeEditor({
                language: model.data.language,
                markers: [
                  { line: 2, kind: "added" },
                  { line: 3, kind: "removed" },
                  { line: 4, kind: "breakpoint" },
                  { line: 5, label: "Note" },
                ],
              }),
            },
            {
              id: "mirror",
              bind: "code",
              label: "Plain text",
              custom: undefined,
              control: "textarea",
              readOnly: model.data.readOnly,
              reactive: model.data.reactive,
              rowSpan: 1,
            },
            { id: "language", bind: "language" },
            { id: "readonly", bind: "readOnly" },
            { id: "reactive", bind: "reactive" },
            { id: "note", bind: "note" },
          ],
          header: {
            actions: [
              { id: "save", label: "Save" },
              { id: "long", label: "Long code" },
              { id: "reset", label: "Reset state" },
              { id: "page", label: "Other page" },
              { id: "modal", label: "Modal editor" },
              { id: "terminate", label: "Terminate" },
            ],
          },
        });
        lastEvent = event.eventType;
        count++;
        if (event.action === "save") saved = model.data.code;
        if (event.action === "long") model.data.code = longCode;
        if (event.action === "reset") model.resetScreen();
        if (event.action === "page") {
          await presentPage(() =>
            callScreen({
              id: "other",
              title: "Other page",
              schema: z.object({}),
              model: new Model({}),
            })
          );
        }
        if (event.action === "modal") {
          await presentModal(() =>
            callScreen({
              id: "modal-editor",
              title: "Modal editor",
              schema: z.object({
                code: field(z.string(), {
                  custom: codeEditor({ language: "json" }),
                  rowSpan: 4,
                  length: "long",
                }),
              }),
              model: new Model({ code: '{"modal": true}' }),
            })
          );
        }
        if (event.action === "terminate") {
          const error = new TypeError("Editor source test");
          const path = new URL("browser_fixture.ts", import.meta.url).pathname;
          error.stack =
            `TypeError: Editor source test\n    at fixture (file://${path}:10:3)`;
          await programTerminated({
            exception: error,
            programId: "the8020/uui/test",
            entrypoint: path,
            occurredAt: new Date().toISOString(),
            homeProgram: "the8020/uui/home",
            terminatedProgram: "the8020/uui/program-terminated",
          });
        }
      }
    },
    serve(request: Request): Promise<Response | undefined> {
      const path = new URL(request.url).pathname;
      if (path === "/editor-probe") {
        return Promise.resolve(Response.json({
          code: model.data.code,
          saved,
          lastEvent,
          count,
          screen: model.screen,
        }));
      }
      if (path === "/editor-redraw") {
        channel.redraw();
        return Promise.resolve(new Response("ok"));
      }
      return Promise.resolve(undefined);
    },
    close() {
      return Promise.resolve();
    },
    verify,
  };
}

async function wait(page: Browser, expression: string): Promise<void> {
  const until = Date.now() + 15_000;
  while (Date.now() < until) {
    if (await page.evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Editor browser check timed out: ${expression}`);
}

async function click(page: Browser, label: string): Promise<void> {
  await wait(
    page,
    `(() => {
    const button = [...document.querySelectorAll('button,label')].find(button =>
      !button.disabled && !button.closest('[inert],[hidden]') &&
      (button.textContent.trim() === ${
      JSON.stringify(label)
    } || button.getAttribute('aria-label') === ${JSON.stringify(label)}));
    if (!button) return false;
    if (!button.checkVisibility()) {
      const details = button.closest('details');
      if (!details) return false;
      details.open = true;
    }
    button.click(); return true;
  })()`,
  );
  await wait(
    page,
    "!document.querySelector('[data-interaction-pending]')",
  );
}

const host = "document.querySelector('[data-custom-element-id=code]')";
const content = `${host}.querySelector('.cm-content')`;

async function editor(page: Browser): Promise<void> {
  await wait(page, `${host}?.dataset.language !== undefined`);
  await page.evaluate(`(async () => {
    const {EditorView} = await import('/the8020/uui/shell/components/code-editor/vendor/library.js');
    window.editor = EditorView.findFromDOM(${content});
  })()`);
  // Allow the editor's layout and retained scroll restoration to finish.
  await page.evaluate(
    "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
  );
}

async function type(page: Browser, text: string): Promise<void> {
  await page.evaluate(
    "editor.focus(); editor.dispatch({selection: {anchor: 0, head: editor.state.doc.length}})",
  );
  await page.command("Input.insertText", { text });
  await wait(page, `editor.state.doc.toString() === ${JSON.stringify(text)}`);
}

async function verify(page: Browser): Promise<void> {
  await page.command("Emulation.setDeviceMetricsOverride", {
    width: 1200,
    height: 850,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await wait(
    page,
    "document.querySelector('.screen-title')?.textContent === 'Editor loading check'",
  );
  assertEquals(
    await page.evaluate(
      "performance.getEntriesByType('resource').some(r => r.name.includes('code-editor'))",
    ),
    false,
  );
  await page.evaluate(`(() => {
    const policy = document.createElement('meta');
    policy.httpEquiv = 'Content-Security-Policy';
    policy.content = "script-src 'self' 'nonce-e2e'; style-src 'self' 'nonce-e2e'";
    document.head.append(policy);
  })()`);
  await click(page, "Open editor");
  await editor(page);
  await wait(page, `${host}.querySelector('.uui-code-keyword') !== null`);
  assertEquals(
    await page.evaluate(
      `${host}.querySelector('.uui-code-line-added') !== null && ${host}.querySelector('.uui-code-line-removed') !== null && ${host}.querySelector('.uui-code-breakpoint .material-icon') !== null && ${host}.textContent.includes('Note')`,
    ),
    true,
  );
  for (const theme of ["light", "dark"]) {
    await page.evaluate(`document.documentElement.dataset.theme = '${theme}'`);
    assertEquals(
      await page.evaluate(
        `getComputedStyle(${host}.querySelector('.cm-editor')).backgroundColor === getComputedStyle(${host}.closest('.layout-field-group')).backgroundColor`,
      ),
      true,
    );
  }
  await type(
    page,
    'import { external } from "not-installed";\nconst value: MissingType = external();',
  );
  await page.evaluate("new Promise(resolve => setTimeout(resolve, 600))");
  assertEquals(
    await page.evaluate(
      `${host}.querySelector('.cm-lintRange-error') === null`,
    ),
    true,
  );
  assertEquals(
    await page.evaluate(
      "document.querySelector('textarea[data-bind=code]').value === editor.state.doc.toString()",
    ),
    true,
  );
  await type(page, "const broken: = ;");
  await wait(
    page,
    `${host}.querySelector('.cm-lintRange-error, .cm-lintPoint-error') !== null`,
  );
  await type(page, "const saved = 42;");
  await click(page, "Save");
  assertEquals(
    await page.evaluate(
      "fetch('/editor-probe').then(r => r.json()).then(v => v.saved)",
    ),
    "const saved = 42;",
  );
  await page.evaluate(
    "navigator.clipboard.writeText = async text => { window.copied = text; }",
  );
  await click(page, "Copy all");
  assertEquals(await page.evaluate("window.copied"), "const saved = 42;");
  await page.evaluate(`(() => {
    window.originalCopy = document.execCommand.bind(document);
    navigator.clipboard.writeText = async () => { throw new Error('denied'); };
    document.execCommand = command => {
      if (command === 'copy') { window.fallbackCopied = document.querySelector('textarea[readonly][style]').value; return true; }
      return false;
    };
  })()`);
  await click(page, "Copy all");
  await wait(page, "window.fallbackCopied === 'const saved = 42;'");
  await page.evaluate("document.execCommand = window.originalCopy");

  await page.evaluate(
    "document.querySelector('textarea[data-bind=code]').value='const mirrored = 7;'; document.querySelector('textarea[data-bind=code]').dispatchEvent(new Event('input',{bubbles:true}));",
  );
  await wait(page, "editor.state.doc.toString() === 'const mirrored = 7;'");
  await page.evaluate("fetch('/editor-redraw')");
  await wait(
    page,
    `${host}.querySelector('.cm-content').textContent === 'const mirrored = 7;'`,
  );
  await click(page, "Read only");
  await wait(page, `${content}.getAttribute('contenteditable') === 'false'`);
  await page.evaluate("editor.focus()");
  await page.command("Input.insertText", { text: "forbidden" });
  assertEquals(
    await page.evaluate("editor.state.doc.toString()"),
    "const mirrored = 7;",
  );
  await click(page, "Read only");
  await click(page, "Reactive");
  await type(page, "const reactive = true;");
  await wait(
    page,
    "fetch('/editor-probe').then(r=>r.json()).then(v=>v.code === 'const reactive = true;' && v.lastEvent === 'change')",
  );
  await click(page, "Reactive");
  for (const language of languages) {
    await page.evaluate(
      `(() => { const select = document.querySelector('select[data-bind=language]'); select.value = '${language}'; select.dispatchEvent(new Event('input', {bubbles:true})); })()`,
    );
    await wait(
      page,
      `${host}.dataset.language === '${language}' && !${host}.closest('[inert]')`,
    );
  }
  await click(page, "Long code");
  await editor(page);
  await page.evaluate(
    "window.retainedEditor = editor.dom; editor.scrollDOM.scrollTop=1600; editor.scrollDOM.scrollLeft=300;",
  );
  await wait(
    page,
    "editor.scrollDOM.scrollTop > 1500 && editor.scrollDOM.scrollLeft > 250",
  );
  await click(page, "Save");
  assertEquals(
    await page.evaluate(
      "fetch('/editor-probe').then(r=>r.json()).then(v=>v.screen.elements.code.scroll.y > 1500 && v.screen.elements.code.scroll.x > 250 && !!v.screen.elements.code.data.selection)",
    ),
    true,
  );
  assertEquals(await page.evaluate("editor.dom === retainedEditor"), true);
  await click(page, "Fullscreen");
  assertEquals(
    await page.evaluate(
      `${host}.getBoundingClientRect().top >= document.querySelector('.navbar').getBoundingClientRect().bottom - 1 && ${host}.getBoundingClientRect().bottom === innerHeight`,
    ),
    true,
  );
  await page.command("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
  });
  await page.command("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
  });
  await wait(page, `!${host}.classList.contains('uui-content-fullscreen')`);
  await click(page, "Fullscreen");
  await click(page, "Other page");
  await wait(page, "!document.querySelector('.uui-content-fullscreen')");
  await click(page, "Back");
  await wait(
    page,
    `${host}?.dataset.language !== undefined && !${host}.closest('[hidden],[inert]')`,
  );
  await wait(
    page,
    "editor.dom === retainedEditor && editor.scrollDOM.scrollTop > 1500",
  );
  await click(page, "Save");
  await page.command("Page.reload");
  await editor(page);
  await wait(
    page,
    "editor.scrollDOM.scrollTop > 1500 && editor.scrollDOM.scrollLeft > 250",
  );
  await click(page, "Reset state");
  await editor(page);
  await wait(
    page,
    "editor.scrollDOM.scrollTop === 0 && editor.scrollDOM.scrollLeft === 0",
  );
  for (const width of [1200, 390]) {
    await page.command("Emulation.setDeviceMetricsOverride", {
      width,
      height: 850,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await wait(page, `${host}.clientWidth > 0`);
    assertEquals(
      await page.evaluate("document.documentElement.scrollWidth <= innerWidth"),
      true,
    );
  }
  await page.command("Emulation.clearDeviceMetricsOverride");
  await click(page, "Modal editor");
  await wait(
    page,
    "document.querySelector('dialog:modal .cm-content')?.textContent === '{\"modal\": true}'",
  );
  await click(page, "Fullscreen");
  await click(page, "Exit fullscreen");
  await click(page, "Back");
  await click(page, "Terminate");
  await wait(
    page,
    "document.querySelector('[data-custom-element-id=stack] .cm-content')?.textContent.includes('Editor source test')",
  );
  await click(page, "Source code");
  await wait(
    page,
    "document.querySelector('[data-custom-element-id=source] .uui-code-line-error') !== null && document.querySelector('[data-custom-element-id=source]').dataset.language === 'typescript'",
  );
  assertEquals(
    await page.evaluate(
      "document.querySelector('[data-custom-element-id=source]').dataset.language",
    ),
    "typescript",
  );
  assertEquals(
    await page.evaluate(
      "document.querySelector('[data-custom-element-id=source] .cm-content').getAttribute('contenteditable')",
    ),
    "false",
  );
  assertEquals(
    await page.evaluate(
      "document.querySelector('[data-custom-element-id=source] .cm-lineNumbers').textContent.includes('10')",
    ),
    true,
  );
  await page.evaluate(
    "navigator.clipboard.writeText = async text => { window.copied = text; }",
  );
  await click(page, "Copy all");
  assertEquals(
    await page.evaluate(
      "window.copied.includes('interface Browser') && !window.copied.includes('> 10 |')",
    ),
    true,
  );
  await click(page, "Home");
  await wait(
    page,
    "document.querySelector('.screen-title')?.textContent === 'Code editor'",
  );
}
