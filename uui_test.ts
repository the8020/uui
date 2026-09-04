import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { z } from "zod";
import { validateCustomElements } from "./custom_elements.ts";
import { buildControls, buildFieldCatalog, field } from "./fields.ts";
import { applyLayoutOverride, validateLayout } from "./layout.ts";
import { DEFAULT_SCREEN_LIST_PAGE_SIZE } from "./pagination.ts";
import {
  BACK_EVENT,
  MAX_UUI_MESSAGE_BODY_LENGTH,
  parseClientMessage,
  UUI_PROTOCOL_VERSION,
  type UUIClientMessage,
  type UUIWorkerOutbound,
} from "./protocol.ts";
import {
  bindSession,
  callScreen,
  copyText,
  presentModal,
  presentPage,
  ScreenChannel,
  sendMessage,
} from "./session.ts";

type PresentationShow = Extract<
  UUIWorkerOutbound,
  { type: "presentation.show" }
>;

class TestChannel {
  readonly sessionId = "session-test";
  sent: unknown[] = [];
  #inputs: UUIClientMessage[] = [];
  #waiters: Array<(message: UUIClientMessage) => void> = [];

  send(message: unknown): void {
    this.sent.push(message);
  }

  receive(): Promise<UUIClientMessage> {
    const item = this.#inputs.shift();
    if (item !== undefined) return Promise.resolve(item);
    return new Promise((resolve) => this.#waiters.push(resolve));
  }

  push(message: UUIClientMessage): void {
    const waiter = this.#waiters.shift();
    if (waiter === undefined) this.#inputs.push(message);
    else waiter(message);
  }
}

Deno.test("field catalog infers controls and keeps id separate from shared bind", () => {
  const schema = z.object({
    email: field(z.string().email(), {
      label: "Email",
      control: "email",
      length: "long",
    }),
    enabled: z.boolean(),
    role: z.enum(["administrator", "viewer"]),
    biography: field(z.string().optional(), { semanticType: "long-string" }),
    notes: field(z.string(), { control: "textarea", rowSpan: 3 }),
    token: field(z.string(), { control: "password" }),
    utilization: field(z.number().min(1).max(100), {
      control: "range",
      minimum: 1,
      maximum: 100,
      step: 1,
      valueSuffix: "%",
    }),
  });
  const fields = buildFieldCatalog(schema);
  assertEquals(
    fields.map((item) => [
      item.bind,
      item.control,
      item.required,
      item.length,
      item.rowSpan,
    ]),
    [
      ["biography", "textarea", false, "medium", 1],
      ["email", "email", true, "long", 1],
      ["enabled", "checkbox", true, "medium", 1],
      ["notes", "textarea", true, "medium", 3],
      ["role", "select", true, "medium", 1],
      ["token", "password", true, "medium", 1],
      ["utilization", "range", true, "medium", 1],
    ],
  );
  assertEquals(fields.find((item) => item.bind === "utilization"), {
    bind: "utilization",
    label: "Utilization",
    description: undefined,
    control: "range",
    group: undefined,
    length: "medium",
    rowSpan: 1,
    order: undefined,
    readOnly: undefined,
    hidden: undefined,
    required: true,
    placeholder: undefined,
    reactive: undefined,
    minimum: 1,
    maximum: 100,
    step: 1,
    valueSuffix: "%",
    options: undefined,
    searchHelp: undefined,
    semanticType: undefined,
  });
  const controls = buildControls(fields, [
    {
      id: "primary-email",
      bind: "email",
      label: "Primary email",
      length: "short",
    },
    { id: "confirmation-email", bind: "email", label: "Confirmation email" },
  ]);
  assertEquals(controls.map((item) => item.bind), ["email", "email"]);
  assertEquals(controls.map((item) => item.length), ["short", "long"]);
  assertEquals(controls.map((item) => item.rowSpan), [1, 1]);
  assertThrows(
    () =>
      buildControls(fields, [
        { id: "same", bind: "email" },
        { id: "same", bind: "email" },
      ]),
    TypeError,
    "duplicate",
  );
  assertThrows(
    () => field(z.string(), { rowSpan: 0 }),
    TypeError,
    "rowSpan",
  );
  assertThrows(
    () => buildControls(fields, [{ id: "notes", bind: "notes", rowSpan: 9 }]),
    TypeError,
    "rowSpan",
  );
  assertThrows(
    () => field(z.string(), { control: "range" }),
    TypeError,
    "number field",
  );
  assertThrows(
    () =>
      field(z.number(), {
        control: "range",
        minimum: 100,
        maximum: 1,
      }),
    TypeError,
    "minimum",
  );
});

Deno.test("layout validates data nodes and applies future overrides", () => {
  const layout = validateLayout({
    schema: 1,
    id: "main",
    root: {
      id: "root",
      type: "split",
      ratio: [50, 50],
      responsive: "stack",
      children: [
        {
          id: "left",
          type: "list",
          bind: "orders",
          display: ["addedRows"],
          headings: { addedRows: "+" },
        },
        { id: "right", type: "section", controls: ["email"] },
      ],
    },
  }, new Set(["email"]));
  const changed = applyLayoutOverride(layout, {
    baseLayoutId: "main",
    regionOrder: ["right", "left"],
    splitRatio: [40, 60],
    hiddenControls: ["email"],
    collapsedSections: ["right"],
  });
  assertEquals(changed.root.ratio, [40, 60]);
  assertEquals(changed.root.children?.map((item) => item.id), [
    "right",
    "left",
  ]);
  assertEquals(changed.root.children?.[0]?.controls, []);
  assertEquals(changed.root.children?.[0]?.collapsed, true);
  assertEquals(changed.root.children?.[1]?.headings, { addedRows: "+" });
  assertThrows(
    () =>
      validateLayout({
        schema: 1,
        id: "bad",
        root: { id: "root", type: "section", controls: ["missing"] },
      }, new Set(["email"])),
    TypeError,
    "unknown control",
  );
  const complete = validateLayout(
    {
      schema: 1,
      id: "complete",
      root: {
        id: "stack",
        type: "stack",
        children: [
          {
            id: "grid",
            type: "grid",
            columns: 2,
            minimumRegionWidth: 240,
            children: [
              {
                id: "field-group",
                type: "field-group",
                title: "Account",
                controls: ["email"],
              },
              { id: "section", type: "section", controls: ["email"] },
            ],
          },
          {
            id: "tabs",
            type: "tabs",
            selectedTab: "tab-two",
            children: [
              { id: "tab-one", type: "section" },
              { id: "tab-two", type: "section" },
            ],
          },
          { id: "actions", type: "actions", actions: ["save"] },
        ],
      },
    },
    new Set(["email"]),
    new Set(["save"]),
  );
  assertEquals(complete.root.children?.map((node) => node.type), [
    "grid",
    "tabs",
    "actions",
  ]);
  assertThrows(
    () =>
      validateLayout({
        schema: 1,
        id: "nested-field-group",
        root: {
          id: "group",
          type: "field-group",
          children: [{ id: "nested", type: "field-group" }],
        },
      }),
    TypeError,
    "cannot contain layout regions",
  );
  assertThrows(
    () =>
      validateLayout({
        schema: 1,
        id: "code",
        root: { id: "root", type: "stack", onclick: "run()" },
      }),
    TypeError,
    "unsupported property",
  );
  assertThrows(
    () =>
      validateLayout(
        {
          schema: 1,
          id: "actions",
          root: { id: "root", type: "actions", actions: ["missing"] },
        },
        new Set(),
        new Set(["save"]),
      ),
    TypeError,
    "unknown action",
  );
});

Deno.test("custom screen elements stay bounded and declarative", () => {
  const config = {
    enabled: true,
    target: { kind: "development", sandboxId: "sandbox-1" },
  };
  const elements = validateCustomElements([{
    id: "console",
    initializer: "sandbox-console.v1",
    preserve: true,
    config,
  }]);
  config.target.sandboxId = "changed-after-validation";
  assertEquals(elements, [{
    id: "console",
    initializer: "sandbox-console.v1",
    preserve: true,
    config: {
      enabled: true,
      target: { kind: "development", sandboxId: "sandbox-1" },
    },
  }]);
  assertEquals(
    validateLayout(
      {
        schema: 1,
        id: "custom-layout",
        root: {
          id: "console-region",
          type: "custom",
          customElement: "console",
        },
      },
      new Set(),
      new Set(),
      new Set(["console"]),
    ).root.type,
    "custom",
  );
  assertThrows(
    () =>
      validateLayout(
        {
          schema: 1,
          id: "custom-layout",
          root: {
            id: "console-region",
            type: "custom",
            customElement: "missing",
          },
        },
        new Set(),
        new Set(),
        new Set(["console"]),
      ),
    TypeError,
    "unknown custom element",
  );
  assertThrows(
    () =>
      validateCustomElements([{
        id: "console",
        initializer: "sandbox-console.v1",
        config: { connect: () => undefined },
      }]),
    TypeError,
    "JSON data",
  );
  assertThrows(
    () =>
      validateCustomElements([{
        id: "console",
        initializer: "sandbox-console.v1",
        config: {},
        source: "javascript:alert(1)",
      } as never]),
    TypeError,
    "unsupported property",
  );
});

Deno.test({
  name: "callScreen publishes a custom element descriptor with its layout",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const test = new TestChannel();
    const unbind = bindSession(test);
    try {
      const pending = callScreen({
        id: "custom-screen",
        schema: z.object({ ready: z.boolean() }),
        model: { ready: true },
        customElements: [{
          id: "console",
          initializer: "sandbox-console.v1",
          preserve: true,
          config: { enabled: true },
        }],
        layout: {
          schema: 1,
          id: "custom-layout",
          root: {
            id: "console-region",
            type: "custom",
            customElement: "console",
          },
        },
      });
      await Promise.resolve();
      const sent = presentation(test.sent[0]);
      const screen = sent.presentation.surfaces[0]!.screen;
      assertEquals(screen.customElements.length, 1);
      assertEquals(
        (screen.layout as { root: { customElement: string } }).root
          .customElement,
        "console",
      );
      test.push(event({
        screenId: "custom-screen",
        clientSequence: 1,
        action: BACK_EVENT,
        eventType: BACK_EVENT,
      }));
      assertEquals((await pending).action, BACK_EVENT);
    } finally {
      unbind();
    }
  },
});

Deno.test("client protocol rejects malformed event metadata", () => {
  const valid = event({
    controlId: "email-control",
    bind: "email",
    eventType: "change",
  });
  assertEquals(parseClientMessage(valid), valid);
  const validBack = event({
    action: BACK_EVENT,
    eventType: BACK_EVENT,
  });
  assertEquals(parseClientMessage(validBack), validBack);
  const validPage = page({
    bind: "orders",
    currentPage: 1,
    page: 2,
    changes: [{ bind: "orders", value: [] }],
  });
  assertEquals(parseClientMessage(validPage), validPage);
  const validLogout = {
    type: "session.logout",
    protocol: UUI_PROTOCOL_VERSION,
    sessionId: "session-test",
    clientSequence: 2,
  } as const;
  assertEquals(parseClientMessage(validLogout), validLogout);
  for (
    const invalid of [
      { ...valid, eventType: "execute-code" },
      { ...valid, action: BACK_EVENT, eventType: "action" },
      { ...valid, action: "save", eventType: BACK_EVENT },
      { ...valid, surfaceId: "" },
      { ...valid, screenRevision: 0 },
      { ...valid, controlId: 4 },
      { ...valid, changes: [{ bind: "" }] },
      { ...validPage, currentPage: 0 },
      { ...validPage, surfaceId: "" },
      { ...validPage, page: 1.5 },
      { ...validPage, changes: [{ bind: "" }] },
      { ...validLogout, sessionId: "" },
      {
        type: "client.ack",
        protocol: UUI_PROTOCOL_VERSION,
        sessionId: "session-test",
        clientSequence: 2,
        resync: "yes",
      },
    ]
  ) {
    assertThrows(() => parseClientMessage(invalid), TypeError);
  }
});

Deno.test({
  name: "callScreen pages lists without returning and merges visible edits",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const test = new TestChannel();
    const unbind = bindSession(test);
    try {
      const schema = z.object({
        records: z.array(z.object({ id: z.number(), name: z.string() })),
        note: z.string(),
      });
      const pageSize = DEFAULT_SCREEN_LIST_PAGE_SIZE;
      const model = {
        records: Array.from({ length: pageSize * 2 + 3 }, (_, id) => ({
          id,
          name: `Record ${id}`,
        })),
        note: "initial",
      };
      let returned = false;
      const pending = callScreen({
        id: "paged-list",
        schema,
        model,
        layout: {
          schema: 1,
          id: "paged-layout",
          root: { id: "records", type: "list", bind: "records" },
        },
      }).then((result) => {
        returned = true;
        return result;
      });
      await Promise.resolve();
      const initial = topScreen(test.sent[0]);
      const initialModel = initial.model as typeof model;
      assertEquals(initialModel.records.length, pageSize);
      assertEquals(initial.pagination?.lists, [{
        bind: "records",
        page: 1,
        pageSize,
        totalItems: pageSize * 2 + 3,
        totalPages: 3,
      }]);
      assertEquals(model.records.length, pageSize * 2 + 3);

      const firstPage = structuredClone(initialModel.records);
      firstPage[0]!.name = "Edited on page one";
      test.push(page({
        screenId: "paged-list",
        clientSequence: 1,
        bind: "records",
        currentPage: 1,
        page: 2,
        changes: [
          { bind: "note", value: "saved while paging" },
          { bind: "records", value: firstPage },
        ],
      }));
      await Promise.resolve();
      assertEquals(returned, false);
      const second = topScreen(test.sent[1]);
      const secondModel = second.model as typeof model;
      assertEquals(
        secondModel.records.map((record) => record.id),
        Array.from({ length: pageSize }, (_, index) => index + pageSize),
      );
      assertEquals(second.pagination?.lists[0]?.page, 2);
      assertEquals(model.records[0]?.name, "Edited on page one");
      assertEquals(model.note, "saved while paging");

      const secondPage = structuredClone(secondModel.records);
      secondPage[0]!.name = "Edited on page two";
      test.push(event({
        screenId: "paged-list",
        screenRevision: 1,
        clientSequence: 2,
        action: "done",
        changes: [{ bind: "records", value: secondPage }],
      }));
      assertEquals((await pending).action, "done");
      assertEquals(model.records.length, pageSize * 2 + 3);
      assertEquals(model.records[pageSize]?.name, "Edited on page two");
    } finally {
      unbind();
    }
  },
});

Deno.test({
  name:
    "callScreen suspends, validates, mutates the original model, and deduplicates",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const test = new TestChannel();
    const unbind = bindSession(test);
    try {
      const schema = z.object({
        email: z.string().email(),
        enabled: z.boolean(),
      });
      const model = { email: "old@example.com", enabled: true };
      await assertRejects(
        () =>
          callScreen({
            id: "invalid-actions",
            schema,
            model,
            actions: [
              { id: "save", label: "Save" },
              { id: "save", label: "Save again" },
            ],
          }),
        TypeError,
        "duplicate",
      );
      await assertRejects(
        () =>
          callScreen({
            id: "reserved-back",
            schema,
            model,
            header: { actions: [{ id: BACK_EVENT, label: "Back" }] },
          }),
        TypeError,
        "reserved",
      );
      const headerPending = callScreen({
        id: "header-catalog",
        schema,
        model,
        header: {
          controls: [{ id: "header-email", bind: "email" }],
          actions: [{ id: "save", label: "Save", kind: "primary" }],
        },
      });
      await Promise.resolve();
      const headerScreen = topScreen(test.sent.at(-1));
      assertEquals(
        headerScreen.header.controls.map((item) => ({
          id: item.id,
          bind: item.bind,
        })),
        [{ id: "header-email", bind: "email" }],
      );
      assertEquals(headerScreen.header.actions, [{
        id: "save",
        label: "Save",
        kind: "primary",
      }]);
      assertEquals(
        headerScreen.controls.some((item) => item.id === "header-email"),
        false,
      );
      assertEquals(headerScreen.actions, []);
      test.push(event({
        screenId: "header-catalog",
        clientSequence: 1,
        action: BACK_EVENT,
        eventType: BACK_EVENT,
      }));
      assertEquals((await headerPending).action, BACK_EVENT);
      const pending = callScreen({ id: "detail", schema, model });
      await Promise.resolve();
      assertEquals(
        (test.sent[0] as { type: string }).type,
        "presentation.show",
      );
      await assertRejects(
        () => callScreen({ id: "other", schema, model }),
        Error,
        "only one",
      );
      test.push(event({ clientSequence: 2, screenRevision: 99 }));
      test.push(
        event({
          clientSequence: 2,
          screenRevision: 2,
          changes: [{ bind: "missing", value: "x" }],
        }),
      );
      test.push(event({
        clientSequence: 2,
        screenRevision: 2,
        changes: [{ bind: "email", value: "new@example.com" }],
      }));
      const result = await pending;
      assertEquals(result.action, "save");
      assertEquals(model, { email: "new@example.com", enabled: true });
      assertEquals(
        test.sent.filter((item) =>
          (item as { type?: string }).type === "session.error"
        ).length,
        2,
      );

      const second = callScreen({ id: "detail", schema, model });
      await Promise.resolve();
      test.push(event({ clientSequence: 2, screenRevision: 3 }));
      test.push(
        event({
          clientSequence: 3,
          screenRevision: 3,
          action: BACK_EVENT,
          eventType: BACK_EVENT,
        }),
      );
      assertEquals((await second).action, BACK_EVENT);
      assertEquals(
        test.sent.some((item) =>
          (item as { type?: string; clientSequence?: number }).type ===
            "server.ack" &&
          (item as { clientSequence?: number }).clientSequence === 2
        ),
        true,
      );

      const reactive = callScreen({ id: "detail", schema, model });
      await Promise.resolve();
      test.push(event({
        clientSequence: 4,
        screenRevision: 4,
        action: "change",
        eventType: "change",
        bind: "enabled",
        value: false,
        changes: [{ bind: "enabled", value: false }],
      }));
      const reactiveResult = await reactive;
      assertEquals(reactiveResult, {
        action: "change",
        controlId: undefined,
        bind: "enabled",
        eventType: "change",
        value: false,
        clientSequence: 4,
      });
      assertEquals(model.enabled, false);
    } finally {
      unbind();
    }
  },
});

Deno.test({
  name: "ordinary programs can be presented as a modal or a page",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const test = new TestChannel();
    const unbind = bindSession(test);
    const schema = z.object({ value: z.string() });
    const ordinaryProgram = async (title: string): Promise<string> => {
      const result = await callScreen({
        id: "ordinary-program",
        title,
        schema,
        model: { value: title },
      });
      return result.action;
    };
    try {
      const root = callScreen({
        id: "root",
        schema,
        model: { value: "root" },
      });
      await flushMicrotasks();

      const modal = presentModal(() => ordinaryProgram("Modal program"));
      await flushMicrotasks();
      let shown = lastPresentation(test);
      assertEquals(surfaceSummary(shown), [
        ["surface-1", "page", "root"],
        ["surface-2", "modal", "ordinary-program"],
      ]);
      test.push(eventFor(shown, "modal-result", 1));
      assertEquals(await modal, "modal-result");
      await flushMicrotasks();
      assertEquals(surfaceSummary(lastPresentation(test)), [
        ["surface-1", "page", "root"],
      ]);

      const pageProgram = presentPage(() => ordinaryProgram("Page program"));
      await flushMicrotasks();
      shown = lastPresentation(test);
      assertEquals(surfaceSummary(shown), [
        ["surface-3", "page", "ordinary-program"],
      ]);
      test.push(eventFor(shown, "page-result", 2));
      assertEquals(await pageProgram, "page-result");
      await flushMicrotasks();
      assertEquals(surfaceSummary(lastPresentation(test)), [
        ["surface-1", "page", "root"],
      ]);

      test.push(eventFor(lastPresentation(test), "done", 3));
      assertEquals((await root).action, "done");
    } finally {
      unbind();
    }
  },
});

Deno.test({
  name:
    "surface stack restores page and modal continuations and routes only to its top",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const test = new TestChannel();
    const unbind = bindSession(test);
    const schema = z.object({ label: z.string() });
    const screen = (label: string) =>
      callScreen({
        id: "identical-screen-id",
        title: label,
        schema,
        model: { label },
      });
    try {
      const pageA = screen("Page A");
      await flushMicrotasks();
      const flow = presentModal(async () => {
        const modalB = screen("Modal B");
        await presentPage(async () => {
          const pageD = screen("Page D");
          await presentModal(() => screen("Modal E"));
          return await pageD;
        });
        return await modalB;
      });
      await flushMicrotasks();

      let shown = lastPresentation(test);
      assertEquals(surfaceSummary(shown), [
        ["surface-3", "page", "identical-screen-id"],
        ["surface-4", "modal", "identical-screen-id"],
      ]);
      assertEquals(
        shown.presentation.surfaces.map((item) => item.screen.title),
        ["Page D", "Modal E"],
      );

      const rootSurface = presentationAt(
        test,
        (item) =>
          item.presentation.surfaces[0]?.surfaceId === "surface-1" &&
          item.presentation.surfaces.length === 1,
      );
      test.push(eventFor(rootSurface, "wrong-layer", 1));
      await flushMicrotasks();
      assertEquals(
        test.sent.some((item) =>
          (item as { type?: string; code?: string }).type === "session.error" &&
          (item as { code?: string }).code === "screen_revision_mismatch"
        ),
        true,
      );

      test.push(eventFor(shown, "close-e", 1));
      await flushMicrotasks();
      shown = lastPresentation(test);
      assertEquals(surfaceSummary(shown), [
        ["surface-3", "page", "identical-screen-id"],
      ]);
      assertEquals(shown.presentation.surfaces[0]?.screen.title, "Page D");

      test.push(eventFor(shown, "close-d", 2));
      await flushMicrotasks();
      shown = lastPresentation(test);
      assertEquals(surfaceSummary(shown), [
        ["surface-1", "page", "identical-screen-id"],
        ["surface-2", "modal", "identical-screen-id"],
      ]);
      assertEquals(
        shown.presentation.surfaces.map((item) => item.screen.title),
        ["Page A", "Modal B"],
      );

      test.push(eventFor(shown, BACK_EVENT, 3, BACK_EVENT));
      assertEquals((await flow).action, BACK_EVENT);
      await flushMicrotasks();
      shown = lastPresentation(test);
      assertEquals(surfaceSummary(shown), [
        ["surface-1", "page", "identical-screen-id"],
      ]);
      test.push(eventFor(shown, "done", 4));
      assertEquals((await pageA).action, "done");
    } finally {
      unbind();
    }
  },
});

Deno.test({
  name: "modal surfaces stack and restore their unchanged prefixes",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const test = new TestChannel();
    const unbind = bindSession(test);
    const schema = z.object({ value: z.string() });
    const show = (id: string) =>
      callScreen({ id, schema, model: { value: id } });
    try {
      const pageA = show("page-a");
      await flushMicrotasks();
      const modalB = presentModal(async () => {
        const pendingB = show("modal-b");
        await presentModal(() => show("modal-c"));
        return await pendingB;
      });
      await flushMicrotasks();
      let shown = lastPresentation(test);
      assertEquals(surfaceSummary(shown), [
        ["surface-1", "page", "page-a"],
        ["surface-2", "modal", "modal-b"],
        ["surface-3", "modal", "modal-c"],
      ]);
      test.push(eventFor(shown, BACK_EVENT, 1, BACK_EVENT));
      await flushMicrotasks();
      shown = lastPresentation(test);
      assertEquals(surfaceSummary(shown), [
        ["surface-1", "page", "page-a"],
        ["surface-2", "modal", "modal-b"],
      ]);
      test.push(eventFor(shown, BACK_EVENT, 2, BACK_EVENT));
      await modalB;
      await flushMicrotasks();
      shown = lastPresentation(test);
      assertEquals(surfaceSummary(shown), [
        ["surface-1", "page", "page-a"],
      ]);
      test.push(eventFor(shown, "done", 3));
      await pageA;
    } finally {
      unbind();
    }
  },
});

Deno.test({
  name: "one modal surface replaces sequential screens without nesting",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const test = new TestChannel();
    const unbind = bindSession(test);
    const schema = z.object({ step: z.number() });
    try {
      const root = callScreen({ id: "root", schema, model: { step: 0 } });
      await flushMicrotasks();
      const modal = presentModal(async () => {
        await callScreen({ id: "step-one", schema, model: { step: 1 } });
        return await callScreen({
          id: "step-two",
          schema,
          model: { step: 2 },
        });
      });
      await flushMicrotasks();
      let shown = lastPresentation(test);
      const modalSurfaceID = shown.presentation.surfaces.at(-1)!.surfaceId;
      assertEquals(shown.presentation.surfaces.at(-1)?.screen.id, "step-one");
      test.push(eventFor(shown, "next", 1));
      await flushMicrotasks();
      shown = lastPresentation(test);
      assertEquals(
        shown.presentation.surfaces.at(-1)?.surfaceId,
        modalSurfaceID,
      );
      assertEquals(shown.presentation.surfaces.at(-1)?.screen.id, "step-two");
      test.push(eventFor(shown, "finish", 2));
      assertEquals((await modal).action, "finish");
      await flushMicrotasks();
      shown = lastPresentation(test);
      test.push(eventFor(shown, "done", 3));
      await root;
    } finally {
      unbind();
    }
  },
});

Deno.test({
  name: "ScreenChannel redraws, coalesces, exits, detaches, and is reusable",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const test = new TestChannel();
    const unbind = bindSession(test);
    const schema = z.object({ count: z.number() });
    const model = { count: 1 };
    const channel = new ScreenChannel();
    try {
      const first = callScreen({
        id: "monitor",
        schema,
        model,
        channel,
      });
      await flushMicrotasks();
      const before = presentations(test).length;
      model.count = 2;
      channel.redraw();
      channel.redraw();
      channel.redraw();
      await flushMicrotasks();
      assertEquals(presentations(test).length, before + 1);
      assertEquals(
        topScreen(lastPresentation(test)).model,
        { count: 2 },
      );

      channel.exit("monitor-stopped");
      assertEquals(await first, {
        action: "monitor-stopped",
        eventType: "exit",
        origin: "channel",
      });
      channel.redraw();
      channel.exit("stale");
      channel.fail(new Error("stale"));

      const secondModel = { count: 3 };
      const second = callScreen({
        id: "monitor-again",
        schema,
        model: secondModel,
        channel,
      });
      await flushMicrotasks();
      assertEquals(topScreen(lastPresentation(test)).id, "monitor-again");
      const failure = new Error("monitor failed");
      channel.fail(failure);
      await assertRejects(() => second, Error, "monitor failed");

      const third = callScreen({
        id: "after-failure",
        schema,
        model: secondModel,
        channel,
      });
      await flushMicrotasks();
      channel.exit();
      assertEquals(await third, {
        action: "exit",
        eventType: "exit",
        origin: "channel",
      });
    } finally {
      unbind();
    }
  },
});

Deno.test({
  name: "ScreenChannel redraw caches a covered surface until it is restored",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const test = new TestChannel();
    const unbind = bindSession(test);
    const schema = z.object({ value: z.string() });
    const model = { value: "before" };
    const channel = new ScreenChannel();
    try {
      const root = callScreen({ id: "root", schema, model, channel });
      await flushMicrotasks();
      const modal = presentModal(() =>
        callScreen({
          id: "cover",
          schema,
          model: { value: "cover" },
        })
      );
      await flushMicrotasks();
      const before = presentations(test).length;
      model.value = "updated while covered";
      channel.redraw();
      await flushMicrotasks();
      assertEquals(presentations(test).length, before);

      let shown = lastPresentation(test);
      test.push(eventFor(shown, BACK_EVENT, 1, BACK_EVENT));
      await modal;
      await flushMicrotasks();
      shown = lastPresentation(test);
      assertEquals(topScreen(shown).model, { value: "updated while covered" });
      test.push(eventFor(shown, "done", 2));
      await root;
    } finally {
      unbind();
    }
  },
});

Deno.test({
  name: "surface and channel failures clean up without replacing the caller",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const test = new TestChannel();
    const unbind = bindSession(test);
    const schema = z.object({ value: z.string() });
    const channel = new ScreenChannel();
    try {
      const root = callScreen({
        id: "root",
        schema,
        model: { value: "root" },
        channel,
      });
      await flushMicrotasks();
      await assertRejects(
        () =>
          presentModal(() =>
            callScreen({
              id: "illegal-channel-reuse",
              schema,
              model: { value: "modal" },
              channel,
            })
          ),
        Error,
        "only one pending",
      );
      await flushMicrotasks();
      assertEquals(surfaceSummary(lastPresentation(test)), [
        ["surface-1", "page", "root"],
      ]);

      const original = new Error("modal callback failed");
      await assertRejects(
        () =>
          presentModal(async () => {
            await Promise.resolve();
            throw original;
          }),
        Error,
        "modal callback failed",
      );
      await flushMicrotasks();
      assertEquals(surfaceSummary(lastPresentation(test)), [
        ["surface-1", "page", "root"],
      ]);
      channel.exit("done");
      await root;
    } finally {
      unbind();
    }
  },
});

Deno.test("clipboard writes stay on the bound session channel and are bounded", () => {
  const test = new TestChannel();
  const unbind = bindSession(test);
  try {
    copyText("short dump");
    assertEquals(test.sent, [{ type: "clipboard.write", text: "short dump" }]);
    assertThrows(() => copyText("x".repeat(1_000_001)), TypeError, "1,000,000");
  } finally {
    unbind();
  }
});

Deno.test({
  name: "messages use the public session channel during and between roundtrips",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    assertThrows(
      () => sendMessage("not bound"),
      Error,
      "requires a bound UUI session Worker",
    );
    const test = new TestChannel();
    const unbind = bindSession(test);
    try {
      sendMessage("Information");
      sendMessage("Completed", "success");
      sendMessage("Attention", "warning");
      sendMessage("Failed", "error");
      assertEquals(test.sent, [
        { type: "notification.show", level: "info", message: "Information" },
        {
          type: "notification.show",
          level: "success",
          message: "Completed",
        },
        {
          type: "notification.show",
          level: "warning",
          message: "Attention",
        },
        { type: "notification.show", level: "error", message: "Failed" },
      ]);
      assertThrows(() => sendMessage("   "), TypeError, "1 to 20000");
      assertThrows(
        () => sendMessage("x".repeat(MAX_UUI_MESSAGE_BODY_LENGTH + 1)),
        TypeError,
        "1 to 20000",
      );
      assertThrows(
        () => sendMessage("bad kind", "fatal" as never),
        TypeError,
        "unsupported UUI message kind",
      );

      const pending = callScreen({
        id: "message-wait",
        schema: z.object({}),
        model: {},
      });
      await Promise.resolve();
      await (async () => {
        await Promise.resolve();
        sendMessage("Arrived while the screen was waiting", "success");
      })();
      assertEquals(test.sent.at(-1), {
        type: "notification.show",
        level: "success",
        message: "Arrived while the screen was waiting",
      });
      test.push(event({
        screenId: "message-wait",
        screenRevision: 1,
        clientSequence: 1,
      }));
      assertEquals((await pending).action, "save");
    } finally {
      unbind();
    }
  },
});

function event(
  overrides: Partial<Extract<UUIClientMessage, { type: "screen.event" }>> = {},
): Extract<UUIClientMessage, { type: "screen.event" }> {
  return {
    type: "screen.event",
    protocol: UUI_PROTOCOL_VERSION,
    sessionId: "session-test",
    surfaceId: "surface-1",
    screenId: "detail",
    screenRevision: 1,
    clientSequence: 1,
    action: "save",
    changes: [],
    ...overrides,
  };
}

function page(
  overrides: Partial<Extract<UUIClientMessage, { type: "screen.page" }>> = {},
): Extract<UUIClientMessage, { type: "screen.page" }> {
  return {
    type: "screen.page",
    protocol: UUI_PROTOCOL_VERSION,
    sessionId: "session-test",
    surfaceId: "surface-1",
    screenId: "detail",
    screenRevision: 1,
    clientSequence: 1,
    bind: "items",
    currentPage: 1,
    page: 2,
    changes: [{ bind: "items", value: [] }],
    ...overrides,
  };
}

function presentation(value: unknown): PresentationShow {
  const message = value as PresentationShow;
  if (message.type !== "presentation.show") {
    throw new TypeError("expected presentation.show");
  }
  return message;
}

function topScreen(value: unknown) {
  return presentation(value).presentation.surfaces.at(-1)!.screen;
}

function presentations(test: TestChannel): PresentationShow[] {
  return test.sent.filter((item): item is PresentationShow =>
    (item as { type?: unknown }).type === "presentation.show"
  );
}

function lastPresentation(test: TestChannel): PresentationShow {
  const result = presentations(test).at(-1);
  if (result === undefined) throw new TypeError("no presentation was sent");
  return result;
}

function presentationAt(
  test: TestChannel,
  predicate: (message: PresentationShow) => boolean,
): PresentationShow {
  const result = presentations(test).find(predicate);
  if (result === undefined) throw new TypeError("presentation was not found");
  return result;
}

function surfaceSummary(
  message: PresentationShow,
): Array<[string, "page" | "modal", string]> {
  return message.presentation.surfaces.map((surface) => [
    surface.surfaceId,
    surface.kind,
    surface.screen.id,
  ]);
}

function eventFor(
  message: PresentationShow,
  action: string,
  clientSequence: number,
  eventType: Extract<
    UUIClientMessage,
    { type: "screen.event" }
  >["eventType"] = "action",
): Extract<UUIClientMessage, { type: "screen.event" }> {
  const surface = message.presentation.surfaces.at(-1)!;
  return event({
    surfaceId: surface.surfaceId,
    screenId: surface.screen.id,
    screenRevision: surface.screen.revision,
    clientSequence,
    action,
    eventType,
  });
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 12; index++) await Promise.resolve();
}
