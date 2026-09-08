import { queryValueHelp } from "./lists.ts";
import { type ListQuery, type ValueHelpRequest } from "/p/the8020/db/fields.ts";
import { Model } from "./model.ts";
import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { z } from "zod";
import { validateCustomElements } from "./custom_elements.ts";
import {
  buildControls,
  buildFieldCatalog,
  field,
  fieldMetadata,
} from "./fields.ts";
import { field as sharedField, money } from "/p/the8020/db/fields.ts";
import { applyLayoutOverride, validateLayout } from "./layout.ts";
import {
  ACCOUNT_EVENT,
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

Deno.test("shared semantic fields retain help and independent screen presentation", () => {
  const valueHelp = () => ({
    schema: z.object({ value: z.string(), label: z.string() }),
    rows: [{ value: "alice", label: "Alice" }],
    more: false,
  });
  const user = sharedField(z.string(), {
    label: "User",
    description: "Choose an **account**.",
    valueHelp,
  });
  const owner = field(user, {
    label: "Owner",
    length: "long",
    group: "Assignment",
  });
  const reviewer = field(owner.nullable(), {
    label: "Reviewer",
    readOnly: true,
  });
  assertEquals(fieldMetadata(user)?.label, "User");
  assertEquals(fieldMetadata(owner)?.label, "Owner");
  assertEquals(fieldMetadata(reviewer)?.length, "long");
  assertEquals(fieldMetadata(reviewer)?.valueHelp, valueHelp);
  const catalog = buildFieldCatalog(z.object({ owner, reviewer }));
  assertEquals(
    catalog.map(({ label, description, length, required }) => ({
      label,
      description,
      length,
      required,
    })),
    [
      {
        label: "Owner",
        description: "Choose an **account**.",
        length: "long",
        required: true,
      },
      {
        label: "Reviewer",
        description: "Choose an **account**.",
        length: "long",
        required: false,
      },
    ],
  );
  // Callbacks stay with the schema in the Worker, outside the wire descriptors.
  structuredClone(catalog);
});

Deno.test("decimal presentation retains its exact string schema and storage contract", () => {
  const amount = field(money().refine((value) => !value.startsWith("-")), {
    label: "Total",
    description: "Enter the **total amount**.",
  });
  const descriptor = buildFieldCatalog(z.object({ amount }))[0]!;
  assertEquals(descriptor.control, "text");
  assertEquals(descriptor.semanticType, "decimal");
  assertEquals(fieldMetadata(amount)?.storage, {
    type: "decimal",
    precision: 18,
    scale: 2,
  });
  assertEquals(amount.parse("9999999999999999.99"), "9999999999999999.99");
  assertEquals(amount.safeParse(1.25).success, false);
  assertEquals(amount.safeParse("-1.25").success, false);
});

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
    if (
      (message.type === "screen.event" || message.type === "screen.list") &&
      message.instanceId === "fixture"
    ) {
      message.instanceId = topScreen(lastPresentation(this)).state.instanceId;
    }
    const waiter = this.#waiters.shift();
    if (waiter === undefined) this.#inputs.push(message);
    else waiter(message);
  }
}

Deno.test("field catalog infers controls and keeps id separate from shared bind", () => {
  const schema = z.object({
    email: field(z.email(), {
      label: "Email",
      control: "email",
      length: "long",
    }),
    enabled: z.boolean(),
    attempts: z.int().nullable(),
    ratio: z.float64(),
    role: z.enum(["administrator", "viewer"]),
    biography: field(z.string().optional(), { semanticType: "long-string" }),
    notes: field(z.string(), { control: "textarea", rowSpan: 3 }),
    token: field(z.string(), { control: "password" }),
    utilization: field(z.int().min(1).max(100), {
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
      ["attempts", "number", false, "medium", 1],
      ["biography", "textarea", false, "medium", 1],
      ["email", "email", true, "long", 1],
      ["enabled", "checkbox", true, "medium", 1],
      ["notes", "textarea", true, "medium", 3],
      ["ratio", "number", true, "medium", 1],
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
    fieldHelp: undefined,
    semanticType: undefined,
    list: undefined,
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
    module: "/component.js",
    preserve: true,
    config,
  }]);
  config.target.sandboxId = "changed-after-validation";
  assertEquals(elements, [{
    id: "console",
    module: "/component.js",
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
        module: "/component.js",
        config: { connect: () => undefined },
      }]),
    TypeError,
    "JSON data",
  );
  assertThrows(
    () =>
      validateCustomElements([{
        id: "console",
        module: "/component.js",
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
        model: new Model({ ready: true }),
        customElements: [{
          id: "console",
          module: "/component.js",
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
  const validPage = page();
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
      {
        ...validPage,
        updates: [{ id: "items", revision: 0, operation: "page", page: 1 }],
      },
      { ...validPage, surfaceId: "" },
      {
        ...validPage,
        updates: [{
          id: "items",
          revision: 1,
          operation: "capacity",
          pageSize: 1.5,
        }],
      },
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
  name:
    "retained Model keeps page five through mapped edits, selection, and refreshed data",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const test = new TestChannel();
    const unbind = bindSession(test);
    const schema = z.object({
      records: z.array(z.object({ id: z.number(), name: z.string() })),
      note: z.string(),
    });
    const data = {
      records: Array.from(
        { length: 103 },
        (_, id) => ({ id, name: `Record ${id}` }),
      ),
      note: "initial",
    };
    const model = new Model(data);
    const options = {
      id: "paged-list",
      schema,
      model,
      layout: {
        schema: 1,
        id: "paged-layout",
        root: { id: "records", type: "list", bind: "records", key: "id" },
      },
    };
    try {
      let returned = false;
      const pending = callScreen(options).then((event) => {
        returned = true;
        return event;
      });
      await flushMicrotasks();
      let shown = lastPresentation(test);
      let list = topScreen(shown).lists[0]!;
      assertEquals(list.state.measured, false);
      assertEquals((topScreen(shown).model as typeof data).records, []);
      test.push({
        ...eventFor(shown, "", 1),
        type: "screen.list",
        updates: [{
          id: list.id,
          revision: list.revision,
          operation: "capacity",
          pageSize: 10,
        }],
      });
      await flushMicrotasks();
      shown = lastPresentation(test);
      list = topScreen(shown).lists[0]!;
      test.push({
        ...eventFor(shown, "", 2),
        type: "screen.list",
        updates: [{
          id: list.id,
          revision: list.revision,
          operation: "page",
          page: 5,
        }],
        changes: [{ bind: "note", value: "saved while paging" }],
        listChanges: [{
          id: list.id,
          revision: list.revision,
          rows: [{ index: 0, value: { id: 0, name: "Edited on page one" } }],
        }],
        screenState: {
          version: 0,
          scroll: { x: 0, y: 413 },
          elements: { records: { scroll: { x: 62, y: 0 }, toolbarOpen: true } },
        },
      });
      await flushMicrotasks();
      shown = lastPresentation(test);
      list = topScreen(shown).lists[0]!;
      assertEquals(returned, false);
      assertEquals(list.rows, data.records.slice(40, 50));
      assertEquals(data.records.length, 103);
      assertEquals(data.records[0]!.name, "Edited on page one");
      assertEquals(data.note, "saved while paging");
      assertEquals(model.screen.scroll.y, 413);
      test.push({
        ...eventFor(shown, "select", 3, "select"),
        selection: { id: list.id, revision: list.revision, index: 2 },
      });
      const selected = await pending;
      assertEquals(selected.eventType, "select");
      if (selected.eventType === "select") assertEquals(selected.value, 42);
      const next = callScreen(options);
      await flushMicrotasks();
      shown = lastPresentation(test);
      list = topScreen(shown).lists[0]!;
      assertEquals(list.state.page, 5);
      assertEquals(topScreen(shown).state.elements.records!.toolbarOpen, true);
      test.push(eventFor(shown, "refresh", 4));
      await next;
      model.data = structuredClone(data);
      const refreshed = callScreen(options);
      await flushMicrotasks();
      shown = lastPresentation(test);
      assertEquals(topScreen(shown).lists[0]!.state.page, 5);
      assertEquals(topScreen(shown).state.instanceId, model.screen.instanceId);
      test.push(eventFor(shown, "done", 5));
      await refreshed;
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
            model: new Model(model),
            actions: [
              { id: "save", label: "Save" },
              { id: "save", label: "Save again" },
            ],
          }),
        TypeError,
        "duplicate",
      );
      for (const id of [BACK_EVENT, ACCOUNT_EVENT]) {
        await assertRejects(
          () =>
            callScreen({
              id: "reserved-action",
              schema,
              model: new Model(model),
              header: { actions: [{ id, label: "Reserved" }] },
            }),
          TypeError,
          "reserved",
        );
      }
      const headerPending = callScreen({
        id: "header-catalog",
        schema,
        model: new Model(model),
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
      const pending = callScreen({
        id: "detail",
        schema,
        model: new Model(model),
      });
      await Promise.resolve();
      assertEquals(
        (test.sent[0] as { type: string }).type,
        "presentation.show",
      );
      await assertRejects(
        () => callScreen({ id: "other", schema, model: new Model(model) }),
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

      const second = callScreen({
        id: "detail",
        schema,
        model: new Model(model),
      });
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

      const reactive = callScreen({
        id: "detail",
        schema,
        model: new Model(model),
      });
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
        model: new Model({ value: title }),
      });
      return result.action;
    };
    try {
      const root = callScreen({
        id: "root",
        schema,
        model: new Model({ value: "root" }),
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
        model: new Model({ label }),
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
      callScreen({ id, schema, model: new Model({ value: id }) });
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
      const root = callScreen({
        id: "root",
        schema,
        model: new Model({ step: 0 }),
      });
      await flushMicrotasks();
      const modal = presentModal(async () => {
        await callScreen({
          id: "step-one",
          schema,
          model: new Model({ step: 1 }),
        });
        return await callScreen({
          id: "step-two",
          schema,
          model: new Model({ step: 2 }),
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
        model: new Model(model),
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
        model: new Model(secondModel),
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
        model: new Model(secondModel),
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
      const root = callScreen({
        id: "root",
        schema,
        model: new Model(model),
        channel,
      });
      await flushMicrotasks();
      const modal = presentModal(() =>
        callScreen({
          id: "cover",
          schema,
          model: new Model({ value: "cover" }),
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
    const rootModel = new Model({ value: "root" });
    try {
      const root = callScreen({
        id: "root",
        schema,
        model: rootModel,
        channel,
      });
      await flushMicrotasks();
      const collision = new Model({ value: "collision" });
      collision.screen.instanceId = rootModel.screen.instanceId;
      await assertRejects(
        () =>
          presentModal(() =>
            callScreen({
              id: "colliding-model",
              schema,
              model: collision,
            })
          ),
        TypeError,
        "Model identity is already attached",
      );
      await flushMicrotasks();
      assertEquals(topScreen(lastPresentation(test)).model, rootModel.data);
      await assertRejects(
        () =>
          presentModal(() =>
            callScreen({
              id: "illegal-channel-reuse",
              schema,
              model: new Model({ value: "modal" }),
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

Deno.test("screen functions reject calls outside a UUI session", async () => {
  const test = new TestChannel();
  const screen = () =>
    callScreen({ id: "unbound", schema: z.object({}), model: new Model({}) });
  let callbackCalled = false;
  const callback = () => {
    callbackCalled = true;
  };
  for (const ended of [false, true]) {
    if (ended) bindSession(test)();
    for (
      const call of [
        screen,
        () => presentPage(callback),
        () => presentModal(callback),
      ]
    ) {
      await assertRejects(call, Error, "UUI session channel is not bound");
    }
  }
  assertEquals(callbackCalled, false);
  assertEquals(test.sent, []);
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
        model: new Model({}),
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
        instanceId: "fixture",
        screenState: { version: 0, scroll: { x: 0, y: 0 }, elements: {} },
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
    instanceId: "fixture",
    screenState: { version: 0, scroll: { x: 0, y: 0 }, elements: {} },
    clientSequence: 1,
    action: "save",
    changes: [],
    ...overrides,
  };
}

function page(
  overrides: Partial<Extract<UUIClientMessage, { type: "screen.list" }>> = {},
): Extract<UUIClientMessage, { type: "screen.list" }> {
  return {
    type: "screen.list",
    protocol: UUI_PROTOCOL_VERSION,
    sessionId: "session-test",
    surfaceId: "surface-1",
    screenId: "detail",
    screenRevision: 1,
    instanceId: "fixture",
    screenState: { version: 0, scroll: { x: 0, y: 0 }, elements: {} },
    clientSequence: 1,
    updates: [{ id: "items", revision: 1, operation: "page", page: 2 }],
    changes: [],
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
    instanceId: surface.screen.state.instanceId,
    screenState: {
      version: surface.screen.state.version,
      scroll: surface.screen.state.scroll,
      elements: {},
    },
    clientSequence,
    action,
    eventType,
  });
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 12; index++) await Promise.resolve();
}

Deno.test("field help drafts, cancels, commits, and pages searchable choices through standard lists", async () => {
  const test = new TestChannel();
  const unbind = bindSession(test);
  const requests: ValueHelpRequest[] = [];
  const values = Array.from({ length: 2001 }, (_, index) => `user${index}`);
  const user = field(z.string(), {
    label: "User",
    valueHelp: (request) => {
      requests.push(request);
      return queryValueHelp(
        z.object({
          username: field(z.string(), {
            label: "Username",
            description: "Account key.",
          }),
          rank: z.number(),
          enabled: z.boolean(),
        }),
        values.map((username, rank) => ({
          username,
          rank,
          enabled: rank % 2 === 0,
        })),
        request,
      );
    },
    open: () => {},
  });
  const schema = z.object({ user, reference: field(user, { readOnly: true }) })
    .refine((value) => value.user !== "blocked", "This user is unavailable");
  const model = new Model({ user: "user0", reference: "user1" });
  let sequence = 0;
  const action = async (
    id: string,
    changes: Array<{ bind: string; value: unknown }> = [],
  ) => {
    test.push({ ...eventFor(lastPresentation(test), id, ++sequence), changes });
    await flushMicrotasks();
  };
  const open = async (bind: string) => {
    const shown = lastPresentation(test);
    const control = topScreen(shown).controls.find((item) =>
      item.bind === bind
    )!;
    test.push({
      ...eventFor(shown, "field-help", ++sequence, "field-help"),
      controlId: control.id,
      bind,
    });
    await flushMicrotasks();
  };
  const request = async (
    update: { operation: "capacity"; pageSize: number } | {
      operation: "page";
      page: number;
    } | {
      operation: "query";
      query: ListQuery;
    },
  ) => {
    const shown = lastPresentation(test), list = topScreen(shown).lists[0]!;
    test.push({
      ...eventFor(shown, "", ++sequence),
      type: "screen.list",
      updates: [{ id: list.id, revision: list.revision, ...update }],
    });
    await flushMicrotasks();
  };
  try {
    const pending = callScreen({ id: "help-owner", schema, model });
    await open("user");
    assertEquals(
      topScreen(lastPresentation(test)).header?.actions.map((item) =>
        item.label
      ),
      ["Done", "Navigate"],
    );
    assertEquals(requests, [{
      query: { search: "", filters: {}, sort: null },
      offset: 0,
      limit: 1,
    }]);
    assertEquals(
      topScreen(lastPresentation(test)).state.elements.choices?.toolbarOpen,
      true,
    );
    await assertRejects(
      () => callScreen({ id: "concurrent", schema, model }),
      Error,
      "only one",
    );
    await request({ operation: "capacity", pageSize: 7 });
    assertEquals(requests.at(-1), {
      query: { search: "", filters: {}, sort: null },
      offset: 0,
      limit: 7,
    });
    await request({ operation: "page", page: 2 });
    assertEquals(requests.at(-1), {
      query: { search: "", filters: {}, sort: null },
      offset: 7,
      limit: 7,
    });
    assertEquals(topScreen(lastPresentation(test)).lists[0]!.rows[0], {
      username: "user7",
      rank: 7,
      enabled: false,
    });
    await request({
      operation: "query",
      query: {
        search: "",
        filters: { enabled: "true" },
        sort: { column: "rank", direction: "desc" },
      },
    });
    assertEquals(topScreen(lastPresentation(test)).lists[0]!.rows[0], {
      username: "user2000",
      rank: 2000,
      enabled: true,
    });
    assertEquals(
      topScreen(lastPresentation(test)).lists[0]!.totalSourceItems,
      2001,
    );
    await request({
      operation: "query",
      query: { search: "user1999", filters: {}, sort: null },
    });
    assertEquals(requests.at(-1), {
      query: { search: "user1999", filters: {}, sort: null },
      offset: 0,
      limit: 7,
    });
    const shown = lastPresentation(test), list = topScreen(shown).lists[0]!;
    assertEquals(list.totalPages, 1);
    test.push({
      ...eventFor(shown, "select", ++sequence, "select"),
      selection: { id: list.id, revision: list.revision, index: 0 },
    });
    await flushMicrotasks();
    assertEquals(
      (topScreen(lastPresentation(test)).model as { value: string }).value,
      "user1999",
    );
    assertEquals(model.data.user, "user0");
    await action(BACK_EVENT);
    assertEquals(topScreen(lastPresentation(test)).id, "help-owner");
    assertEquals(model.data.user, "user0");
    await open("user");
    await action("open", [{ bind: "value", value: "user20" }]);
    assertEquals(
      model.data.user,
      "user0",
      "Navigate does not commit the draft",
    );
    await action(BACK_EVENT, [{ bind: "value", value: 42 }]);
    assertEquals(
      model.data.user,
      "user0",
      "Close discards even an invalid draft",
    );
    await open("user");
    await action("done", [{ bind: "value", value: "blocked" }]);
    assertEquals(model.data.user, "user0");
    assertEquals(topScreen(lastPresentation(test)).id, "uui-field-help");
    await action("done", [{ bind: "value", value: "user1999" }]);
    assertEquals(model.data.user, "user1999");
    await open("reference");
    assertEquals(
      topScreen(lastPresentation(test)).header?.actions.map((item) =>
        item.label
      ),
      ["Navigate"],
    );
    assertEquals(topScreen(lastPresentation(test)).lists.length, 0);
    await action(BACK_EVENT);
    await action("save");
    assertEquals((await pending).action, "save");
  } finally {
    unbind();
  }
});

Deno.test("enum field help exposes searchable options and commits only on Done", async () => {
  const test = new TestChannel();
  const unbind = bindSession(test);
  const schema = z.object({ value: z.enum(["red", "green", "blue"]) });
  const model = new Model({ value: "red" as "red" | "green" | "blue" });
  try {
    const pending = callScreen({ id: "enum", schema, model });
    void pending.catch(() => {});
    const shown = lastPresentation(test),
      control = topScreen(shown).controls[0]!;
    test.push({
      ...eventFor(shown, "field-help", 1, "field-help"),
      controlId: control.id,
      bind: "value",
    });
    await flushMicrotasks();
    const help = lastPresentation(test), list = topScreen(help).lists[0]!;
    assertEquals(list.rows, [{ value: "red", label: "Red" }]);
    test.push({
      ...eventFor(help, "", 2),
      type: "screen.list",
      updates: [{
        id: list.id,
        revision: list.revision,
        operation: "query",
        query: { search: "BLUE", filters: {}, sort: null },
      }],
    });
    await flushMicrotasks();
    assertEquals(topScreen(lastPresentation(test)).lists[0]!.rows, [{
      value: "blue",
      label: "Blue",
    }]);
    test.push(eventFor(lastPresentation(test), BACK_EVENT, 3, BACK_EVENT));
    await flushMicrotasks();
    assertEquals(model.data.value, "red");
    test.push(eventFor(lastPresentation(test), "save", 4));
    await pending;
  } finally {
    unbind();
  }
});

Deno.test("field help retains background redraws and defers channel completion until return", async () => {
  for (const fail of [false, true]) {
    const test = new TestChannel();
    const unbind = bindSession(test);
    const channel = new ScreenChannel();
    const schema = z.object({ value: z.string(), status: z.string() });
    const model = new Model({ value: "before", status: "waiting" });
    let settled = false;
    try {
      const pending = callScreen({
        id: "background-help",
        schema,
        model,
        channel,
      })
        .then((event) => {
          settled = true;
          return event;
        }, (error: unknown) => {
          settled = true;
          return error;
        });
      let shown = lastPresentation(test);
      const control = topScreen(shown).controls.find((item) =>
        item.bind === "value"
      )!;
      test.push({
        ...eventFor(shown, "field-help", 1, "field-help"),
        controlId: control.id,
        bind: control.bind,
      });
      await flushMicrotasks();
      model.data.status = "updated";
      channel.redraw();
      await flushMicrotasks();
      shown = lastPresentation(test);
      assertEquals(topScreen(shown).id, "uui-field-help");
      const error = new Error("background failure");
      if (fail) channel.fail(error);
      else channel.exit("refresh");
      await flushMicrotasks();
      assertEquals(settled, false);
      test.push(eventFor(shown, "done", 2));
      assertEquals(
        await pending,
        fail ? error : {
          action: "refresh",
          eventType: "exit",
          origin: "channel",
        },
      );
      const restored = topScreen(lastPresentation(test));
      assertEquals(restored.id, "background-help");
      assertEquals((restored.model as { status: string }).status, "updated");
    } finally {
      unbind();
    }
  }
});

Deno.test("field help preserves parent validation and returns reactive changes to its program", async () => {
  const test = new TestChannel();
  const unbind = bindSession(test);
  const schema = z.object({ value: field(z.string(), { reactive: true }) })
    .refine((model) => model.value !== "blocked", "This value is unavailable");
  const model = new Model({ value: "before" });
  try {
    const pending = callScreen({ id: "reactive-help", schema, model });
    let shown = lastPresentation(test);
    const control = topScreen(shown).controls[0]!;
    test.push({
      ...eventFor(shown, "field-help", 1, "field-help"),
      controlId: control.id,
      bind: control.bind,
    });
    await flushMicrotasks();
    shown = lastPresentation(test);
    test.push({
      ...eventFor(shown, "done", 2),
      changes: [{ bind: "value", value: "blocked" }],
    });
    await flushMicrotasks();
    assertEquals(model.data.value, "before");
    shown = lastPresentation(test);
    test.push({
      ...eventFor(shown, "done", 3),
      changes: [{ bind: "value", value: "after" }],
    });
    const event = await pending;
    assertEquals(event.eventType, "change");
    assertEquals(event.bind, "value");
    assertEquals(model.data.value, "after");
  } finally {
    unbind();
  }
});

Deno.test({
  name:
    "query interactions validate edits and stale mappings before atomically merging metadata or resolving",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const channel = new TestChannel();
    const unbind = bindSession(channel);
    const schema = z.object({
      note: z.string(),
      rows: z.array(z.object({ id: z.number(), label: z.string() })),
    });
    const model = new Model({
      note: "original",
      rows: [{ id: 1, label: "One" }, { id: 2, label: "Two" }],
    });
    const options = {
      id: "query",
      schema,
      model,
      layout: {
        schema: 1,
        id: "query-layout",
        root: {
          id: "rows",
          type: "list",
          bind: "rows",
          triggerFilterEvents: true,
        },
      },
    };
    try {
      let settled = false;
      const pending = callScreen(options).then((e) => {
        settled = true;
        return e;
      });
      await flushMicrotasks();
      let shown = lastPresentation(channel);
      let list = topScreen(shown).lists[0]!;
      const query = { search: "changed", filters: {}, sort: null };
      const request = {
        ...eventFor(shown, "", 1),
        type: "screen.list" as const,
        updates: [{
          id: list.id,
          revision: list.revision,
          operation: "query" as const,
          query,
        }],
        screenState: {
          version: 0,
          scroll: { x: 0, y: 95 },
          elements: { rows: { scroll: { x: 45, y: 0 }, toolbarOpen: true } },
        },
        changes: [{ bind: "note", value: 42 }],
        listChanges: [{
          id: list.id,
          revision: list.revision,
          rows: [{ index: 0, value: { id: 1, label: "changed" } }],
        }],
      };
      channel.push(request);
      await flushMicrotasks();
      assertEquals(settled, false);
      assertEquals(model.data.note, "original");
      assertEquals(model.data.rows[0]!.label, "One");
      assertEquals(model.screen.scroll.y, 0);
      assertEquals(model.screen.elements.rows!.list!.query.search, "");
      model.data.rows.reverse();
      channel.push({ ...request, changes: [{ bind: "note", value: "saved" }] });
      await flushMicrotasks();
      assertEquals(
        (channel.sent.findLast((message) =>
          (message as { type: string }).type === "session.error"
        ) as { code: string }).code,
        "list_view_mismatch",
      );
      assertEquals(model.data.note, "original");
      assertEquals(model.data.rows[0]!.label, "Two");
      shown = lastPresentation(channel);
      list = topScreen(shown).lists[0]!;
      channel.push({
        ...request,
        ...eventFor(shown, "", 1),
        type: "screen.list",
        screenState: request.screenState,
        updates: [{
          id: list.id,
          revision: list.revision,
          operation: "query",
          query,
        }],
        changes: [{ bind: "note", value: "saved" }],
        listChanges: [{
          id: list.id,
          revision: list.revision,
          rows: [{ index: 0, value: { id: 2, label: "changed" } }],
        }],
      });
      const event = await pending;
      assertEquals(event, {
        action: "list-query",
        eventType: "list-query",
        listId: "rows",
        bind: "rows",
        clientSequence: 1,
        change: "search",
        query,
      });
      assertEquals(model.data.rows, [{ id: 2, label: "changed" }, {
        id: 1,
        label: "One",
      }]);
      assertEquals(model.data.note, "saved");
      assertEquals(model.screen.scroll.y, 95);
      assertEquals(model.screen.elements.rows!.toolbarOpen, true);
      const next = callScreen(options);
      await flushMicrotasks();
      shown = lastPresentation(channel);
      list = topScreen(shown).lists[0]!;
      assertEquals(list.totalItems, 1);
      channel.push({
        ...eventFor(shown, "", 2),
        type: "screen.list",
        updates: [{
          id: list.id,
          revision: list.revision,
          operation: "query",
          query,
        }],
      });
      await flushMicrotasks();
      assertEquals(
        lastPresentation(channel).presentation.activeSurfaceId,
        "surface-1",
      );
      channel.push(eventFor(lastPresentation(channel), "done", 3));
      await next;
    } finally {
      unbind();
    }
  },
});

Deno.test({
  name:
    "screen identities reserve IDs across element kinds and normalize binding references",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const channel = new TestChannel();
    const unbind = bindSession(channel);
    const schema = z.object({ value: z.string() });
    const model = new Model({ value: "initial" });
    const implicit = buildControls(buildFieldCatalog(schema))[0]!.id;
    try {
      const options = {
        id: "identity",
        schema,
        model,
        actions: [{ id: implicit, label: "Reserved" }],
        layout: {
          schema: 1,
          id: "identity-layout",
          root: { type: "section", controls: ["value"] },
        },
        customElements: [{ module: "/probe.js", config: {} }],
      };
      const pending = callScreen(options);
      await flushMicrotasks();
      const screen = topScreen(lastPresentation(channel));
      assertEquals(screen.controls[0]!.id === implicit, false);
      assertEquals(
        (screen.layout as import("./layout.ts").LayoutDocument).root.controls,
        [screen.controls[0]!.id],
      );
      assertEquals(screen.customElements[0]!.id.startsWith("custom-"), true);
      channel.push(eventFor(lastPresentation(channel), "done", 1));
      await pending;
      await assertRejects(
        () =>
          callScreen({
            ...options,
            controls: [{ id: "duplicate", bind: "value" }],
            actions: [{ id: "duplicate", label: "Duplicate" }],
          }),
        TypeError,
        "duplicate",
      );
      const special = callScreen({
        id: "special-id",
        schema,
        model,
        controls: [{ id: "__proto__", bind: "value" }],
      });
      await flushMicrotasks();
      assertEquals(Object.hasOwn(model.screen.elements, "__proto__"), true);
      assertEquals(
        Object.keys(topScreen(lastPresentation(channel)).state.elements),
        ["__proto__"],
      );
      assertEquals(model.screen.elements.__proto__!.scroll, { x: 0, y: 0 });
      channel.push(eventFor(lastPresentation(channel), "done", 2));
      await special;
    } finally {
      unbind();
    }
  },
});

Deno.test("page-source interactions report every measured list for one atomic reload", async () => {
  const test = new TestChannel();
  const unbind = bindSession(test);
  const schema = z.object({ a: z.string().array(), b: z.string().array() });
  const model = new Model({ a: ["A"], b: ["B"] });
  try {
    const pending = callScreen({
      id: "sources",
      schema,
      model,
      layout: {
        schema: 1,
        id: "sources",
        root: {
          type: "stack",
          children: ["a", "b"].map((id) => ({
            id,
            type: "list",
            bind: id,
            pageSource: { more: true },
          })),
        },
      },
    });
    const shown = lastPresentation(test);
    test.push({
      ...eventFor(shown, "", 1),
      type: "screen.list",
      updates: topScreen(shown).lists.map((list) => ({
        id: list.id,
        revision: list.revision,
        operation: "capacity",
        pageSize: 4,
      })),
    });
    const result = await pending;
    assertEquals(result.eventType, "list-page");
    if (result.eventType !== "list-page") throw new Error("expected list-page");
    assertEquals(result.reloadLists, ["a", "b"]);
    assertEquals(model.screen.elements.a!.list!.pageSize, 4);
    assertEquals(model.screen.elements.b!.list!.pageSize, 4);
  } finally {
    unbind();
  }
});

Deno.test("list reads use the pending screen channel without committing edits or resolving the screen", async () => {
  const channel = new TestChannel();
  const unbind = bindSession(channel);
  const model = new Model({
    note: "original",
    rows: Array.from({ length: 2205 }, (_, id) => ({ id })),
  });
  try {
    let settled = false;
    const pending = callScreen({
      id: "read-list",
      schema: z.object({
        note: z.string(),
        rows: z.object({ id: z.number() }).array(),
      }),
      model,
    });
    void pending.then(() => {
      settled = true;
    });
    const shown = lastPresentation(channel);
    const list = topScreen(shown).lists[0]!;
    const message = {
      ...eventFor(shown, "", 1),
      type: "screen.list" as const,
      updates: [],
      changes: [],
      read: { id: list.id, revision: list.revision, offset: 1000, limit: 1000 },
    };
    assertThrows(
      () =>
        parseClientMessage({
          ...message,
          changes: [{ bind: "note", value: "changed" }],
        }),
      TypeError,
    );
    assertThrows(
      () =>
        parseClientMessage({
          ...message,
          read: { ...message.read, limit: 1001 },
        }),
      TypeError,
    );
    channel.push(parseClientMessage(message));
    await flushMicrotasks();
    const response = (channel.sent as UUIWorkerOutbound[]).find((message) =>
      message.type === "screen.list.data"
    );
    if (response?.type !== "screen.list.data") {
      throw new Error("missing list data response");
    }
    assertEquals(response.clientSequence, 1);
    assertEquals(response.data.rows.length, 1000);
    assertEquals(response.data.rows[0], { id: 1000 });
    assertEquals(response.data.more, true);
    assertEquals(response.data.totalItems, 2205);
    assertEquals(model.data.note, "original");
    assertEquals(model.screen.elements[list.id]!.list!.pageSize, 1);
    assertEquals(settled, false);
    channel.push(eventFor(shown, "done", 2));
    await pending;
  } finally {
    unbind();
  }
});
