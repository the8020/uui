import { MessageHistory } from "./messages.ts";
import { AsyncLocalStorage } from "node:async_hooks";
import { type ChannelFrame } from "./channel.ts";
import { agentOperation, transcribe } from "./agent.ts";
import { queryValueHelp, setListSource } from "./lists.ts";
import { type ListQuery, type ValueHelpRequest } from "/p/the8020/db/fields.ts";
import { Channel } from "./session.ts";
import { Model } from "./model.ts";
import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { z } from "/p/the8020/db/fields.ts";
import { validateCustomElements } from "./custom_elements.ts";
import {
  initialListState,
  screenElement,
  validScreenStateUpdate,
} from "./screen_state.ts";
import { codeEditor } from "./services/shell/frontend/components/code-editor/mod.ts";
import {
  buildControls,
  buildFieldCatalog,
  field,
  fieldMetadata,
} from "./fields.ts";
import { field as sharedField, money } from "/p/the8020/db/fields.ts";
import { CONFIRM_CLASS, confirmAction } from "./confirm.ts";
import { describeError } from "./errors.ts";
import {
  applyLayoutOverride,
  type LayoutDocument,
  resolveLayoutReferences,
  validateLayout,
} from "./layout.ts";
import {
  ACCOUNT_EVENT,
  BACK_EVENT,
  type ComponentStyle,
  type ControlDescriptor,
  CUSTOMIZATION_EVENT,
  MAX_UUI_MESSAGE_BODY_LENGTH,
  parseClientMessage,
  UUI_PROTOCOL_VERSION,
  type UUIClientMessage,
  type UUIWorkerOutbound,
} from "./protocol.ts";
import {
  bindSession,
  callScreen,
  captureMessages,
  commandScreen,
  connectChannels,
  copyText,
  currentScreenChannel,
  disconnectChannels,
  nextScreenChannel,
  presentModal,
  presentPage,
  type ScreenChannel,
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
  readonly messageHistory = new MessageHistory();
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

  #listSequence = 0;
  push(message: UUIClientMessage): void {
    if (message.type === "channel.frame" && message.id === "update") {
      if (!this.#listSequence) connectChannels("fixture-connection");
      message.requestId = `client-${++this.#listSequence}`;
      if (message.generation === "fixture-generation") {
        message.generation = topScreen(lastPresentation(this))
          .channelGeneration!;
      }
      const request = (message.value as {
        request: { instanceId: string; updates: { id: string }[] };
      }).request;
      message.namespace = topScreen(lastPresentation(this)).lists.find((list) =>
        list.id === request.updates[0]!.id
      )!.channelNamespace!;
      if (request.instanceId === "fixture") {
        request.instanceId = topScreen(lastPresentation(this)).state.instanceId;
      }
    }
    if (
      (message.type === "screen.event") &&
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
  assertEquals(
    buildControls(buildFieldCatalog(z.object({
      output: field(z.string(), { length: "full" }),
    })))[0]?.length,
    "full",
  );
  assertEquals(
    buildControls(fields, [{ bind: "email", length: "full" }])[0]?.length,
    "full",
  );
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

Deno.test("explicit lists resolve shortcuts to one control placement", () => {
  const fields = buildFieldCatalog(z.object({ rows: z.array(z.string()) }));
  const controls = buildControls(fields, [{
    id: "rows-control",
    bind: "rows",
    shortcut: { key: "F10" },
  }]);
  const layout = validateLayout({
    schema: 1,
    id: "lists",
    root: {
      type: "stack",
      children: [{ type: "list", bind: "rows" }],
    },
  });
  resolveLayoutReferences(structuredClone(layout), controls);
  assertThrows(
    () =>
      resolveLayoutReferences(structuredClone(layout), [
        ...controls,
        { ...controls[0]!, id: "other", shortcut: { key: "F11" } },
      ]),
    TypeError,
    "multiple shortcuts",
  );
  layout.root.controls = ["rows-control"];
  assertThrows(
    () => resolveLayoutReferences(structuredClone(layout), controls),
    TypeError,
    "placed more than once",
  );
  delete layout.root.controls;
  layout.root.children!.push({ id: "second", type: "list", bind: "rows" });
  assertThrows(
    () => resolveLayoutReferences(structuredClone(layout), controls),
    TypeError,
    "placed more than once",
  );
  // Repeated bindings without shortcuts retain independent list views.
  resolveLayoutReferences(layout, buildControls(fields));
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
  for (
    const input of [
      { name: "value", path: "__proto__.value" },
      { name: "value", path: "", label: 42 },
      { name: "value", path: "", description: {} },
    ]
  ) {
    assertThrows(
      () =>
        validateCustomElements([{
          module: "/component.js",
          config: {},
          fallback: { inputs: [input] },
        } as never]),
      TypeError,
    );
  }
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

Deno.test("custom fields share validated edits and component metadata with ordinary screens", async () => {
  const test = new TestChannel();
  const unbind = bindSession(test);
  try {
    const schema = z.object({
      code: field(z.string().min(1), {
        custom: codeEditor({ language: "typescript" }),
      }),
      reference: field(z.string(), { custom: codeEditor(), readOnly: true }),
    });
    const model = new Model({ code: "original", reference: "fixed" });
    const pending = callScreen({
      id: "custom-field",
      schema,
      model,
      controls: [{ id: "code", bind: "code" }, {
        id: "reference",
        bind: "reference",
      }],
      customElements: [{ id: "widget", module: "/widget.js", config: {} }],
      actions: [{ id: "save", label: "Save" }],
    });
    await flushMicrotasks();
    const snapshot = topScreen(lastPresentation(test));
    assertEquals(snapshot.controls[0]!.control, "custom");
    assertEquals(snapshot.controls[0]!.custom?.config, {
      language: "typescript",
    });
    const element = {
      scroll: { x: 42, y: 300 },
      toolbarOpen: false,
      data: {
        selection: { anchor: 2, head: 3 },
        arbitrary: [true, null, "value"],
      },
    };
    const state = {
      version: 0,
      scroll: { x: 0, y: 5 },
      elements: { code: element, widget: element, save: element },
    };
    assertEquals(validScreenStateUpdate(state), true);
    for (
      const data of [{ invalid: NaN }, { invalid: undefined }, {
        tooBig: "x".repeat(32_769),
      }, { tooMany: Array(257).fill(0) }]
    ) {
      assertEquals(
        validScreenStateUpdate({
          ...state,
          elements: { code: { ...element, data } },
        }),
        false,
      );
    }
    let sequence = 0;
    for (
      const change of [{ bind: "reference", value: "forged" }, {
        bind: "code",
        value: "",
      }]
    ) {
      test.push({
        ...eventFor(lastPresentation(test), "save", ++sequence),
        changes: [change],
        screenState: state,
      });
      await flushMicrotasks();
      assertEquals(model.data, { code: "original", reference: "fixed" });
      assertEquals(model.screen.elements.code!.data, undefined);
    }
    test.push({
      ...eventFor(lastPresentation(test), "save", ++sequence),
      changes: [{ bind: "code", value: "edited" }],
      screenState: state,
    });
    assertEquals((await pending).action, "save");
    assertEquals(model.data.code, "edited");
    for (const id of ["code", "widget", "save"]) {
      assertEquals(model.screen.elements[id]!.data, element.data);
    }
    assertEquals(model.screen.elements.code!.scroll, element.scroll);
    model.resetScreen();
    assertEquals(model.screen.elements, {});
    assertThrows(
      () =>
        buildControls(buildFieldCatalog(schema), [{
          bind: "code",
          custom: {
            module: "https://external.example/code.js",
            config: {},
          },
        }]),
      TypeError,
      "invalid custom element",
    );
    await assertRejects(
      () =>
        callScreen({
          id: "too-many-custom-fields",
          schema,
          model,
          customElements: Array.from({ length: 15 }, (_, index) => ({
            id: `widget-${index}`,
            module: "/widget.js",
            config: {},
          })),
        }),
      TypeError,
      "at most 16 custom elements",
    );
  } finally {
    unbind();
  }
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
        updates: [{ id: "items", operation: "page", page: 0 }],
      },
      { ...validPage, surfaceId: "" },
      {
        ...validPage,
        updates: [{
          id: "items",
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
      test.push(listInput({
        ...eventFor(shown, "", 1),
        updates: [{
          id: list.id,
          operation: "capacity",
          pageSize: 10,
        }],
      }));
      await flushMicrotasks();
      shown = lastPresentation(test);
      list = topScreen(shown).lists[0]!;
      test.push(listInput({
        ...eventFor(shown, "", 2),
        updates: [{
          id: list.id,
          operation: "page",
          page: 5,
        }],
        changes: [{ bind: "note", value: "saved while paging" }],
        listChanges: [{
          id: list.id,
          rows: [{ index: 0, value: { id: 0, name: "Edited on page one" } }],
        }],
        screenState: {
          version: 0,
          scroll: { x: 0, y: 413 },
          elements: { records: { scroll: { x: 62, y: 0 }, toolbarOpen: true } },
        },
      }));
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
        selection: { id: list.id, index: 2 },
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
      for (const id of [BACK_EVENT, ACCOUNT_EVENT, CUSTOMIZATION_EVENT]) {
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
      await flushMicrotasks();
      assertEquals(test.messageHistory.snapshot().at(-1)?.level, "error");
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
  name:
    "automatic screen channels rotate once, coalesce redraws and never reuse settled owners",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const test = new TestChannel();
    const unbind = bindSession(test);
    const schema = z.object({ count: z.number() });
    const model = { count: 1 };
    let channel = nextScreenChannel();
    try {
      const first = callScreen({
        id: "monitor",
        schema,
        model: new Model(model),
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

      assertEquals(channel.signal.aborted, true);
      assertEquals(currentScreenChannel(), channel);
      const firstChannel = channel;
      channel = nextScreenChannel();
      const secondModel = { count: 3 };
      const second = callScreen({
        id: "monitor-again",
        schema,
        model: new Model(secondModel),
      });
      await flushMicrotasks();
      assertEquals(topScreen(lastPresentation(test)).id, "monitor-again");
      firstChannel.exit("stale");
      assertEquals(currentScreenChannel(), channel);
      const failure = new Error("monitor failed");
      channel.fail(failure);
      await assertRejects(() => second, Error, "monitor failed");

      channel = nextScreenChannel();
      const third = callScreen({
        id: "after-failure",
        schema,
        model: new Model(secondModel),
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
    const channel = nextScreenChannel();
    try {
      const root = callScreen({
        id: "root",
        schema,
        model: new Model(model),
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
    const channel = nextScreenChannel();
    const rootModel = new Model({ value: "root" });
    try {
      const root = callScreen({
        id: "root",
        schema,
        model: rootModel,
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
          callScreen({
            id: "concurrent",
            schema,
            model: new Model({ value: "other" }),
          }),
        Error,
        "only one callScreen()",
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
      "UUI session channel is not bound",
    );
    const test = new TestChannel();
    const unbind = bindSession(test);
    try {
      sendMessage("Information");
      sendMessage("Completed", "success");
      sendMessage("Attention", "warning");
      sendMessage("Failed", "error");
      assertEquals(test.sent, []);
      assertEquals(
        test.messageHistory.snapshot().map(({ level, message }) => ({
          level,
          message,
        })),
        [
          { level: "info", message: "Information" },
          { level: "success", message: "Completed" },
          { level: "warning", message: "Attention" },
          { level: "error", message: "Failed" },
        ],
      );
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

      connectChannels("message-test");
      const pending = callScreen({
        id: "message-wait",
        schema: z.object({}),
        model: new Model({}),
      });
      await Promise.resolve();
      const output = captureMessages();
      await (async () => {
        await Promise.resolve();
        output.send("Arrived while the screen was waiting", "success");
      })();
      const frame = test.sent.at(-1) as ChannelFrame;
      assertEquals(frame.type, "channel.frame");
      assertEquals(
        frame.namespace,
        topScreen(lastPresentation(test)).messageNamespace,
      );
      assertEquals(frame.id, "append");
      assertEquals(frame.value, {
        sequence: 5,
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
      assertThrows(() => output.send("late"), DOMException);
      assertEquals(test.messageHistory.snapshot(), []);
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

function listInput(
  raw: Record<string, unknown>,
): Extract<UUIClientMessage, { type: "channel.frame" }> {
  const {
    type: _type,
    protocol,
    sessionId,
    clientSequence,
    action: _action,
    eventType: _eventType,
    value,
    requestId: _requestId,
    generation: _generation,
    connection: _connection,
    namespace: _namespace,
    id: _id,
    kind: _kind,
    ...data
  } = raw;
  return {
    type: "channel.frame",
    protocol: Number(protocol),
    sessionId: String(sessionId),
    clientSequence: Number(clientSequence),
    connection: "fixture-connection",
    generation: "fixture-generation",
    namespace: String(
      (data.updates as { id: string }[] | undefined)?.[0]?.id ??
        (raw.namespace),
    ),
    id: "update",
    kind: "message",
    requestId: "client-1",
    value: {
      token: crypto.randomUUID(),
      request: {
        ...(value && typeof value === "object" && "request" in value
          ? value.request as object
          : value as object | undefined),
        ...data,
      },
    },
  };
}
function page(
  overrides: Record<string, unknown> = {},
): Extract<UUIClientMessage, { type: "channel.frame" }> {
  return listInput({
    ...event(),
    updates: [{ id: "items", operation: "page", page: 2 }],
    ...overrides,
  });
}

Deno.test({
  name: "confirmations share one compact modal and answer only on confirm",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const test = new TestChannel();
    const unbind = bindSession(test);
    try {
      const root = callScreen({
        id: "root",
        schema: z.object({}),
        model: new Model({}),
      });
      // A failed assertion ends the session; keep that from masking it.
      root.catch(() => {});
      await flushMicrotasks();
      const ask = () =>
        confirmAction({
          id: "role-delete",
          title: "Delete role",
          message: "Role **sales** will be deleted.",
          confirm: "Delete role",
          cancel: "Keep role",
        });
      let answer = ask();
      await flushMicrotasks();
      let shown = lastPresentation(test);
      const screen = topScreen(shown);
      assertEquals(surfaceSummary(shown), [
        ["surface-1", "page", "root"],
        ["surface-2", "modal", "role-delete"],
      ]);
      assertEquals(
        [screen.title, screen.description, screen.class],
        ["Delete role", "Role **sales** will be deleted.", CONFIRM_CLASS],
      );
      assertEquals(
        screen.header.actions.map((
          action,
        ) => [action.id, action.label, action.kind]),
        [["confirm", "Delete role", "danger"], [
          "cancel",
          "Keep role",
          undefined,
        ]],
      );
      test.push(eventFor(shown, "confirm", 1));
      assertEquals(await answer, true);

      for (
        const [action, sequence] of [["cancel", 2], [BACK_EVENT, 3]] as const
      ) {
        answer = ask();
        await flushMicrotasks();
        shown = lastPresentation(test);
        test.push(
          eventFor(
            shown,
            action,
            sequence,
            action === BACK_EVENT ? BACK_EVENT : "action",
          ),
        );
        assertEquals(await answer, false);
      }
      await flushMicrotasks();
      test.push(eventFor(lastPresentation(test), "done", 4));
      assertEquals((await root).action, "done");
    } finally {
      unbind();
    }
  },
});

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
  await new Promise((resolve) => setTimeout(resolve, 0));
}

Deno.test("field help drafts, cancels, commits, and pages searchable choices through standard lists", async () => {
  const test = new TestChannel();
  const unbind = bindSession(test);
  const requests: ValueHelpRequest[] = [];
  const values = Array.from({ length: 2001 }, (_, index) => `user${index}`);
  const user = field(z.string(), {
    label: "User",
    valueHelp: (request) => {
      requests.push({
        query: request.query,
        offset: request.offset,
        limit: request.limit,
      });
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
    test.push(listInput({
      ...eventFor(shown, "", ++sequence),
      updates: [{ id: list.id, ...update }],
    }));
    await flushMicrotasks();
  };
  try {
    const pending = callScreen({ id: "help-owner", schema, model });
    void pending.catch(() => {});
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
      __uuiSelected: false,
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
      __uuiSelected: false,
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
      selection: { id: list.id, index: 0 },
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
    assertEquals(test.messageHistory.snapshot().at(-1)?.level, "error");
    assertEquals(
      test.messageHistory.snapshot().at(-1)?.message.includes(
        "This user is unavailable",
      ),
      true,
    );
    await action("done", [{ bind: "value", value: "user1999" }]);
    assertEquals(model.data.user, "user1999");
    await open("reference");
    assertEquals(
      topScreen(lastPresentation(test)).header?.actions.map((item) =>
        item.label
      ),
      ["Navigate"],
    );
    assertEquals(topScreen(lastPresentation(test)).lists.length, 1);
    assertEquals(topScreen(lastPresentation(test)).controls[0]!.readOnly, true);
    const referenceHelp = lastPresentation(test);
    const referenceChoices = topScreen(referenceHelp).lists[0]!;
    test.push({
      ...eventFor(referenceHelp, "select", ++sequence, "select"),
      selection: {
        id: referenceChoices.id,
        index: 0,
      },
    });
    await flushMicrotasks();
    assertEquals(
      (topScreen(lastPresentation(test)).model as { value: string }).value,
      "user1",
      "browsing choices cannot change a read-only value",
    );
    assertEquals(model.data.reference, "user1");
    await action(BACK_EVENT);
    await action("save");
    assertEquals((await pending).action, "save");
  } finally {
    unbind();
  }
});

Deno.test("field help selects several values by key, all matches within a limit, and keeps written values", async () => {
  const test = new TestChannel();
  const unbind = bindSession(test);
  const codes = Array.from({ length: 30 }, (_, index) => `C${index}`);
  const help = (request: ValueHelpRequest) =>
    queryValueHelp(
      z.object({
        code: field(z.string(), { label: "Code" }),
        name: field(z.string(), { label: "Name" }),
      }),
      [
        { code: "a-b", name: "Hyphen" },
        ...codes.map((code) => ({
          code,
          name: `Country ${code}`,
        })),
      ],
      request,
    );
  const values = field(z.string(), {
    label: "Allowed values",
    valueHelp: help,
    multiple: { separator: ",", escape: "-*?!" },
  });
  const roles = z.array(field(z.string(), { label: "Role", valueHelp: help }))
    .max(3);
  const schema = z.object({ values, roles });
  const model = new Model({ values: "C1,7500-7599,!C2", roles: ["C1"] });
  let sequence = 0;
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
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
    await settle();
  };
  const update = async (updates: Record<string, unknown>[], changes = []) => {
    const shown = lastPresentation(test), list = topScreen(shown).lists[0]!;
    test.push(listInput({
      ...eventFor(shown, "", ++sequence),
      changes,
      updates: updates.map((item) => ({ id: list.id, ...item })),
    }));
    await settle();
    await settle();
  };
  const list = () => topScreen(lastPresentation(test)).lists[0]!;
  const value = () =>
    topScreen(lastPresentation(test)).model as { value: unknown };
  try {
    const pending = callScreen({ id: "multi-owner", schema, model });
    void pending.catch(() => {});
    const owner = topScreen(lastPresentation(test));
    assertEquals(
      owner.controls.map((item) => [item.bind, item.control, item.multiple]),
      [
        ["roles", "tags", { maximum: 3 }],
        ["values", "tags", { separator: ",", escape: "-*?!" }],
      ],
    );

    // Separated text: written literals are selected, grammar stays as written.
    await open("values");
    await update([{ operation: "capacity", pageSize: 40 }]);
    assertEquals(list().selection?.mode, "multiple");
    assertEquals(
      topScreen(lastPresentation(test)).state.elements.choices?.toolbarOpen,
      true,
    );
    assertEquals(list().focusSearch, true);
    assertEquals(
      list().rows.slice(0, 3).map((row) => [
        (row as { code: string }).code,
        (row as { __uuiSelected: boolean }).__uuiSelected,
      ]),
      [["a-b", false], ["C0", false], ["C1", true]],
    );
    await update([{
      operation: "selection",
      selected: true,
      range: { from: 0, to: 0 },
    }]);
    assertEquals(value().value, "C1,7500-7599,!C2,a\\-b");
    await update([{
      operation: "selection",
      selected: false,
      range: { from: 2, to: 2 },
    }]);
    assertEquals(value().value, "7500-7599,!C2,a\\-b");

    // Select all matching loads every match, within the chosen limit.
    await update([{
      operation: "query",
      query: { search: "Country C2", filters: {}, sort: null },
    }]);
    await update([{ operation: "selection", selected: true }]);
    assertEquals(
      value().value,
      "7500-7599,!C2,a\\-b,C2,C20,C21,C22,C23,C24,C25,C26,C27,C28,C29",
    );
    assertEquals(list().selection?.allSelected, true);
    await update([{
      operation: "query",
      query: { search: "", filters: {}, sort: null },
    }]);
    assertEquals(list().selection?.allSelected, false);
    // More matches than the limit: nothing is selected.
    await update(
      [{ operation: "capacity", pageSize: 40 }],
      [{ bind: "limit", value: 5 }] as never,
    );
    const before = value().value;
    await update([{ operation: "selection", selected: true }]);
    assertEquals(value().value, before, "a refused select-all changes nothing");
    assertEquals(
      JSON.stringify(test.sent).includes("matches more than 5 values"),
      true,
    );

    test.push(eventFor(lastPresentation(test), "done", ++sequence));
    await settle();
    assertEquals(model.data.values, before);

    // An array: values are its elements, bounded by the schema maximum.
    await open("roles");
    await update([{ operation: "capacity", pageSize: 40 }]);
    await update([{
      operation: "selection",
      selected: true,
      range: { from: 0, to: 1 },
    }]);
    assertEquals(value().value, ["C1", "a-b", "C0"]);
    await update([{
      operation: "selection",
      selected: true,
      range: { from: 3, to: 3 },
    }]);
    assertEquals(
      value().value,
      ["C1", "a-b", "C0"],
      "the maximum refuses more",
    );
    test.push(
      eventFor(lastPresentation(test), BACK_EVENT, ++sequence, BACK_EVENT),
    );
    await settle();
    assertEquals(model.data.roles, ["C1"], "closing discards the draft");
    test.push(eventFor(lastPresentation(test), "save", ++sequence));
    await pending;
  } finally {
    unbind();
  }
});

Deno.test("validation errors read as the field label and a plain message", () => {
  const schema = z.object({
    name: field(z.string().min(1), { label: "Role" }),
    note: z.string().max(3),
  });
  const empty = schema.safeParse({ name: "", note: "" });
  assertEquals(describeError(empty.error, schema), "Role: Enter a value.");
  const long = schema.safeParse({ name: "a", note: "toolong" });
  assertEquals(describeError(long.error, schema).startsWith("Note: "), true);
  const missing = schema.safeParse({ note: "" });
  assertEquals(describeError(missing.error, schema), "Role: Enter a value.");
  assertEquals(describeError(new Error("Role exists")), "Role exists");
});

Deno.test("clearing an optional input sends no value instead of an invalid empty text", async () => {
  const test = new TestChannel();
  const unbind = bindSession(test);
  const model = new Model<{ name?: string }>({ name: "sales" });
  try {
    const pending = callScreen({
      id: "optional-owner",
      schema: z.object({ name: z.string().min(1).optional() }),
      model,
    });
    test.push({
      ...eventFor(lastPresentation(test), "save", 1),
      changes: [{ bind: "name", value: "" }],
    });
    assertEquals((await pending).action, "save");
    assertEquals(model.data.name, undefined);
  } finally {
    unbind();
  }
});

Deno.test("back always leaves a screen and discards invalid drafts", async () => {
  const test = new TestChannel();
  const unbind = bindSession(test);
  const model = new Model({ code: "SK" });
  try {
    const pending = callScreen({
      id: "draft-owner",
      schema: z.object({ code: z.string().min(1) }),
      model,
    });
    test.push({
      ...eventFor(lastPresentation(test), BACK_EVENT, 1, BACK_EVENT),
      changes: [{ bind: "code", value: "" }],
    });
    assertEquals((await pending).action, BACK_EVENT);
    assertEquals(model.data.code, "SK");
  } finally {
    unbind();
  }
});

Deno.test("single-value field help highlights the value and finishes on activate", async () => {
  const test = new TestChannel();
  const unbind = bindSession(test);
  const country = field(z.string(), {
    label: "Country",
    valueHelp: (request) =>
      queryValueHelp(
        z.object({ code: field(z.string(), { label: "Code" }) }),
        [{ code: "CZ" }, { code: "SK" }],
        request,
      ),
  });
  const model = new Model({ country: "CZ" });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  try {
    const pending = callScreen({
      id: "single-owner",
      schema: z.object({ country }),
      model,
    });
    void pending.catch(() => {});
    let shown = lastPresentation(test);
    test.push({
      ...eventFor(shown, "field-help", 1, "field-help"),
      controlId: topScreen(shown).controls[0]!.id,
      bind: "country",
    });
    await settle();
    shown = lastPresentation(test);
    test.push(listInput({
      ...eventFor(shown, "", 2),
      updates: [{
        id: topScreen(shown).lists[0]!.id,
        operation: "capacity",
        pageSize: 10,
      }],
    }));
    await settle();
    shown = lastPresentation(test);
    const list = topScreen(shown).lists[0]!;
    assertEquals(list.selection?.mode, "single");
    assertEquals(
      list.rows.map((row) => (row as { __uuiSelected: boolean }).__uuiSelected),
      [true, false],
    );
    test.push({
      ...eventFor(shown, "select", 3, "activate"),
      selection: { id: list.id, index: 1 },
    });
    await settle();
    assertEquals(model.data.country, "SK");
    assertEquals(topScreen(lastPresentation(test)).id, "single-owner");
    test.push(eventFor(lastPresentation(test), "save", 4));
    await pending;
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
    // The current value is highlighted.
    assertEquals(list.rows, [{
      value: "red",
      label: "Red",
      __uuiSelected: true,
    }]);
    test.push(listInput({
      ...eventFor(help, "", 2),
      updates: [{
        id: list.id,
        operation: "query",
        query: { search: "BLUE", filters: {}, sort: null },
      }],
    }));
    await flushMicrotasks();
    assertEquals(topScreen(lastPresentation(test)).lists[0]!.rows, [{
      value: "blue",
      label: "Blue",
      __uuiSelected: false,
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
    const channel = nextScreenChannel();
    const schema = z.object({ value: z.string(), status: z.string() });
    const model = new Model({ value: "before", status: "waiting" });
    let settled = false;
    try {
      const pending = callScreen({
        id: "background-help",
        schema,
        model,
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

Deno.test("row clicks survive capacity updates and replacement of the business array", async () => {
  const test = new TestChannel();
  const unbind = bindSession(test);
  const model = new Model({ rows: [{ id: 7 }, { id: 8 }] });
  try {
    const pending = callScreen({
      id: "retained-list",
      schema: z.object({ rows: z.object({ id: z.number() }).array() }),
      model,
      controls: [{ id: "rows", bind: "rows", list: { key: "id" } }],
    });
    const shown = lastPresentation(test);
    test.push(listInput({
      ...eventFor(shown, "", 1),
      updates: [{ id: "rows", operation: "capacity", pageSize: 10 }],
    }));
    await flushMicrotasks();
    model.data.rows = structuredClone(model.data.rows);
    test.push({
      ...eventFor(shown, "select", 2, "select"),
      selection: { id: "rows", index: 0 },
    });
    const event = await pending;
    assertEquals(event.eventType === "select" && event.value, 7);
    assertEquals(test.messageHistory.snapshot(), []);
  } finally {
    unbind();
  }
});

Deno.test({
  name:
    "query interactions validate edits and notify before atomically merging metadata or resolving",
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
      void pending.catch(() => {});
      await flushMicrotasks();
      let shown = lastPresentation(channel);
      let list = topScreen(shown).lists[0]!;
      const query = { search: "changed", filters: {}, sort: null };
      const request = listInput({
        ...eventFor(shown, "", 1),
        updates: [{
          id: list.id,
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
          rows: [{ index: 0, value: { id: 1, label: "changed" } }],
        }],
      });
      channel.push(request);
      await flushMicrotasks();
      assertEquals(settled, false);
      assertEquals(model.data.note, "original");
      assertEquals(model.data.rows[0]!.label, "One");
      assertEquals(model.screen.scroll.y, 0);
      assertEquals(model.screen.elements.rows!.list!.query.search, "");
      model.data.rows.reverse();
      assertEquals(channel.messageHistory.snapshot().at(-1)?.level, "error");
      shown = lastPresentation(channel);
      list = topScreen(shown).lists[0]!;
      channel.push(listInput({
        ...request,
        ...eventFor(shown, "", 1),
        screenState:
          (request.value as { request: { screenState: unknown } }).request
            .screenState,
        updates: [{
          id: list.id,
          operation: "query",
          query,
        }],
        changes: [{ bind: "note", value: "saved" }],
        listChanges: [{
          id: list.id,
          rows: [{ index: 0, value: { id: 2, label: "changed" } }],
        }],
      }));
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
      channel.push(listInput({
        ...eventFor(shown, "", 2),
        updates: [{
          id: list.id,
          operation: "query",
          query,
        }],
      }));
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

Deno.test("provider capacity batches remain in one pending screen", async () => {
  const test = new TestChannel();
  const unbind = bindSession(test);
  const schema = z.object({
    note: z.string(),
    a: z.string().array(),
    b: z.string().array(),
  });
  const model = new Model({
    note: "original",
    a: [] as string[],
    b: [] as string[],
  });
  let malformed = false;
  for (const id of ["a", "b"]) {
    setListSource(model, id, ({ offset, limit }) => ({
      rows: malformed && id === "b" ? [42] : Array.from(
        { length: Math.min(limit, 20 - offset) },
        (_, n) => `${id}${offset + n}`,
      ),
      more: offset + limit < 20,
      totalItems: 20,
    }));
  }
  try {
    let settled = false;
    const pending = callScreen({
      id: "sources",
      schema,
      model,
      layout: {
        schema: 1,
        id: "sources",
        root: {
          type: "stack",
          children: ["a", "b"].map((id) => ({ id, type: "list", bind: id })),
        },
      },
    }).then((event) => {
      settled = true;
      return event;
    });
    await flushMicrotasks();
    const shown = lastPresentation(test);
    const state = structuredClone(model.screen);
    const data = structuredClone(model.data);
    malformed = true;
    test.push(
      listInput({
        ...eventFor(shown, "", 1),
        changes: [{ bind: "note", value: "must not commit" }],
        updates: topScreen(shown).lists.map((list) => ({
          id: list.id,
          operation: "capacity",
          pageSize: 4,
        })),
      }),
    );
    await flushMicrotasks();
    assertEquals(model.screen, state);
    assertEquals(model.data, data);
    malformed = false;
    test.push(
      listInput({
        ...eventFor(shown, "", 1),
        updates: topScreen(shown).lists.map((list) => ({
          id: list.id,
          operation: "capacity",
          pageSize: 4,
        })),
      }),
    );
    await flushMicrotasks();
    assertEquals(settled, false);
    assertEquals(
      topScreen(lastPresentation(test)).lists.map((list) => list.rows),
      [
        ["a0", "a1", "a2", "a3"],
        ["b0", "b1", "b2", "b3"],
      ],
    );
    assertEquals(model.data, data);
    assertEquals(model.screen.elements.a!.list!.pageSize, 4);
    assertEquals(model.screen.elements.b!.list!.pageSize, 4);
    test.push(eventFor(lastPresentation(test), BACK_EVENT, 2));
    await pending;
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
      controls: [{ id: "rows: été", bind: "rows" }],
    });
    void pending.then(() => {
      settled = true;
    });
    const shown = lastPresentation(channel);
    const list = topScreen(shown).lists[0]!;
    connectChannels("test-connection");
    const generation = topScreen(shown).channelGeneration!;
    const message = {
      type: "channel.frame" as const,
      protocol: UUI_PROTOCOL_VERSION,
      sessionId: channel.sessionId,
      clientSequence: 1,
      connection: "test-connection",
      namespace: list.channelNamespace!,
      generation,
      kind: "message" as const,
      requestId: "client-1",
      id: "read",
      value: {
        token: "read-1",
        request: {
          id: list.id,
          offset: 1000,
          limit: 1000,
        },
      },
    };
    assertThrows(
      () => parseClientMessage({ ...message, owner: "session" }),
      TypeError,
    );
    assertThrows(
      () =>
        parseClientMessage({
          ...message,
          changes: [{ bind: "note", value: "changed" }],
        }),
      TypeError,
    );
    channel.push(
      parseClientMessage({
        ...message,
        value: {
          ...message.value,
          request: { ...message.value.request, limit: 1001 },
        },
      }),
    );
    await flushMicrotasks();
    const error = (channel.sent as UUIWorkerOutbound[]).find((message) =>
      message.type === "channel.frame" &&
      (message.value as { token?: string }).token === "read-1"
    );
    assertEquals(
      error?.type === "channel.frame" &&
        typeof (error.value as { error?: string }).error === "string",
      true,
    );
    channel.push(
      parseClientMessage({
        ...message,
        requestId: "client-2",
        value: { ...message.value, token: "read-2" },
        clientSequence: 2,
      }),
    );
    await flushMicrotasks();
    const response = (channel.sent as UUIWorkerOutbound[]).find((message) =>
      message.type === "channel.frame" &&
      (message.value as { token?: string }).token === "read-2"
    );
    if (response?.type !== "channel.frame") {
      throw new Error("missing list data response");
    }
    const data = (response.value as { value: unknown })
      .value as import("./screen_state.ts").ListDataPage;
    assertEquals(data.rows.length, 1000);
    assertEquals(data.rows[0], { id: 1000 });
    assertEquals(data.more, true);
    assertEquals(data.totalItems, 2205);
    assertEquals(model.data.note, "original");
    assertEquals(model.screen.elements[list.id]!.list!.pageSize, 1);
    assertEquals(settled, false);
    channel.push(eventFor(shown, "done", 2));
    await pending;
  } finally {
    unbind();
  }
});

Deno.test("list toolbars share controls, identities and atomic whole-table selection", async () => {
  const channel = new TestChannel();
  const unbind = bindSession(channel);
  const schema = z.object({
    note: z.string().min(1),
    rows: z.array(
      z.object({ id: z.number(), flags: z.object({ selected: z.boolean() }) }),
    ),
  });
  const model = new Model({
    note: "before",
    rows: Array.from(
      { length: 12 },
      (_, id) => ({ id, flags: { selected: false } }),
    ),
  });
  const options = {
    id: "selection",
    schema,
    model,
    layout: {
      schema: 1,
      id: "main",
      root: {
        type: "list",
        id: "rows",
        bind: "rows",
        key: "id",
        display: ["id"],
        selection: "flags.selected",
        toolbar: [
          { id: "note", bind: "note", shortcut: { key: "F6" } },
          { type: "separator" },
          { id: "save", label: "Save" },
        ],
      },
    },
  };
  try {
    const pending = callScreen(options);
    let settled = false;
    pending.then(() => settled = true, () => {});
    let shown = lastPresentation(channel);
    let list = topScreen(shown).lists[0]!;
    assertEquals(list.toolbar?.map((item) => item.id), [
      "note",
      list.toolbar![1]!.id,
      "save",
    ]);
    assertEquals(
      Object.keys(topScreen(shown).state.elements).includes("save"),
      true,
    );
    assertEquals(list.selection, { bind: "flags.selected", selectedItems: 0 });
    let sequence = 0;
    const request = async (
      update: Record<string, unknown>,
      changes: Array<{ bind: string; value: unknown }> = [],
    ) => {
      shown = lastPresentation(channel);
      list = topScreen(shown).lists[0]!;
      channel.push(parseClientMessage(listInput({
        ...eventFor(shown, "", ++sequence),
        updates: [{ id: list.id, ...update }],
        changes,
      })));
      await flushMicrotasks();
    };
    await request({ operation: "capacity", pageSize: 3 });
    await request({ operation: "page", page: 2 });
    await request({ operation: "selection", selected: true }, [{
      bind: "note",
      value: "",
    }]);
    assertEquals(model.data.rows.some((row) => row.flags.selected), false);
    assertEquals(model.data.note, "before");
    await request({ operation: "selection", selected: true }, [{
      bind: "note",
      value: "after",
    }]);
    assertEquals(model.data.rows.every((row) => row.flags.selected), true);
    assertEquals(model.data.note, "after");
    assertEquals(topScreen(lastPresentation(channel)).lists[0]!.state.page, 2);
    assertEquals(settled, false);
    await request({ operation: "selection", selected: false });
    await request({
      operation: "query",
      query: {
        search: "",
        filters: { id: ">= 3" },
        sort: { column: "id", direction: "desc" },
      },
    });
    await request({
      operation: "selection",
      selected: true,
      range: { from: 1, to: 4 },
    });
    assertEquals(
      model.data.rows.filter((row) => row.flags.selected).map((row) => row.id),
      [7, 8, 9, 10],
    );
    await request({ operation: "selection", selected: true });
    assertEquals(
      model.data.rows.filter((row) => row.flags.selected).length,
      12,
    );
    model.data.rows.reverse();
    await request({
      operation: "selection",
      selected: false,
    });
    assertEquals(model.data.rows.every((row) => !row.flags.selected), true);
    await request({ operation: "selection", selected: true });
    await commandScreen(
      agentOperation.parse({
        op: "list",
        id: "rows",
        selection: { selected: false, range: { from: 0, to: 1 } },
      }),
      ++sequence,
    );
    assertEquals(
      model.data.rows.filter((row) => row.flags.selected).length,
      10,
    );
    const transcript = transcribe(lastPresentation(channel).presentation);
    assertEquals(transcript.includes('button: "save"'), true);
    assertEquals(transcript.includes("flags.selected"), false);
    await commandScreen({ op: "click", id: "save" }, ++sequence);
    assertEquals((await pending).action, "save");
    await assertRejects(
      () =>
        callScreen({
          ...options,
          header: { actions: [{ id: "save", label: "Duplicate" }] },
        }),
      TypeError,
      "duplicate",
    );
    await assertRejects(
      () =>
        callScreen({
          ...options,
          header: { controls: [{ bind: "note", shortcut: { key: "F6" } }] },
        }),
      TypeError,
      "duplicate screen shortcut",
    );
  } finally {
    unbind();
  }
});

Deno.test("component styling validates every declaration path and preserves identity", async () => {
  const appearance = { class: "attention", style: "border: 1px solid red;" };
  const fields = buildFieldCatalog(
    z.object({ note: field(z.string(), appearance) }),
  );
  const [control] = buildControls(fields);
  assertEquals([control!.class, control!.style], [
    appearance.class,
    appearance.style,
  ]);
  assertEquals(
    buildControls(fields, [{ bind: "note", class: "", style: "" }])[0]!.id,
    control!.id,
  );
  const test = new TestChannel();
  const unbind = bindSession(test);
  try {
    const options = {
      id: "styled",
      schema: z.object({ note: z.string() }),
      model: new Model({ note: "Text" }),
    };
    for (
      const invalid of [{ class: 42 }, { style: { border: "red" } }, {
        style: null,
      }]
    ) {
      const bad = invalid as unknown as ComponentStyle;
      assertThrows(() => field(z.string(), bad), TypeError, "must be a string");
      assertThrows(
        () => buildControls(fields, [{ bind: "note", ...bad }]),
        TypeError,
        "must be a string",
      );
      for (
        const declaration of [
          bad,
          { actions: [{ label: "Action", ...bad }] },
          { header: { controls: [{ bind: "note", ...bad }] } },
          { header: { elements: [{ type: "separator" as const, ...bad }] } },
          {
            layout: {
              schema: 1,
              id: "layout",
              root: { type: "field-group", ...bad },
            },
          },
          {
            layout: {
              schema: 1,
              id: "layout",
              root: {
                type: "actions",
                elements: [{ label: "Action", ...bad }],
              },
            },
          },
          {
            controls: [{
              bind: "note",
              list: { toolbar: [{ label: "Action", ...bad }] },
            }],
          },
          { customElements: [{ module: "/widget.js", config: {}, ...bad }] },
        ]
      ) {
        await assertRejects(
          () => callScreen({ ...options, ...declaration }),
          TypeError,
          "must be a string",
        );
      }
    }
  } finally {
    unbind();
  }
});

Deno.test("omitted program and component channels attach real routes with deterministic no-listener delivery", async () => {
  const transport = new TestChannel();
  const unbind = bindSession(transport);
  const model = new Model({ value: "unchanged" });
  try {
    connectChannels("default-connection");
    const pending = callScreen({
      id: "default-channels",
      model,
      schema: z.object({ value: z.string() }),
      controls: [{
        bind: "value",
        custom: { module: "/widget.js", config: {} },
      }],
      customElements: [{ module: "/widget.js", config: {} }],
    });
    const screen = topScreen(lastPresentation(transport));
    const namespaces = [
      screen.programNamespace,
      screen.customElements[0]!.channelNamespace,
      screen.controls[0]!.custom!.channelNamespace,
    ];
    assertEquals(
      namespaces.every((namespace) =>
        typeof namespace === "string" && namespace.length > 0
      ),
      true,
    );
    assertEquals(new Set(namespaces).size, 3);
    let sequence = 0;
    for (const namespace of namespaces) {
      for (const kind of ["message", "stream.open"] as const) {
        transport.push({
          type: "channel.frame",
          kind,
          id: "dashboard.updates.bytes",
          value: kind === "message" ? { drop: true } : undefined,
          ...(kind === "stream.open" ? { chunkBytes: 65536, frames: 4 } : {}),
          requestId: `client-${++sequence}`,
          connection: "default-connection",
          generation: screen.channelGeneration!,
          namespace: namespace!,
          sessionId: transport.sessionId,
          protocol: UUI_PROTOCOL_VERSION,
          clientSequence: sequence,
        });
      }
    }
    await flushMicrotasks();
    const frames = (transport.sent as UUIWorkerOutbound[]).filter((
      message,
    ): message is ChannelFrame => message.type === "channel.frame");
    assertEquals(
      frames.filter((frame) => frame.kind === "stream.cancel").length,
      3,
    );
    assertEquals(
      frames.some((frame) =>
        frame.kind === "stream.credit" && Number(frame.frames) > 0
      ),
      false,
    );
    assertEquals(model.data.value, "unchanged");
    transport.push(eventFor(lastPresentation(transport), "finish", ++sequence));
    await pending;
  } finally {
    unbind();
  }
});

Deno.test("component and program subscriptions share screen generations, initiating context and cancellation", async () => {
  const transport = new TestChannel();
  const unbind = bindSession(transport),
    context = new AsyncLocalStorage<string>();
  let screenChannel = nextScreenChannel(), component = new Channel();
  const model = new Model({ note: "original" });
  const waits: Array<
    { signal: AbortSignal; done: Promise<void>; resolve(): void }
  > = [];
  const handle = (channel: Channel | ScreenChannel) =>
    channel.subscribe("*", async (id, _data, { signal }) => {
      if (id === "echo") channel.send("output", { owner: context.getStore() });
      if (id === "wait") {
        const { done } = channel.send(
          "owned-by-handler",
          ReadableStream.from([]),
        );
        void done.catch(() => {});
        await new Promise<void>((resolve) =>
          waits.push({ signal, done, resolve })
        );
        assertThrows(() => channel.send("late", null), DOMException);
        assertThrows(() => channel.subscribe("*", () => {}), DOMException);
      }
    });
  let stopComponent = handle(component);
  handle(screenChannel);
  const options = {
    id: "channel-owners",
    model,
    schema: z.object({ note: z.string() }),
    customElements: [{
      module: "/widget.js",
      config: {},
      preserve: true,
      channel: component,
    }],
  };
  let sequence = 0, connection = "owner-connection";
  const send = async (namespace: string, generation: string, id: string) => {
    transport.push({
      type: "channel.frame",
      kind: "message",
      id,
      requestId: `client-${++sequence}`,
      connection,
      namespace,
      generation,
      value: null,
      protocol: UUI_PROTOCOL_VERSION,
      sessionId: transport.sessionId,
      clientSequence: sequence,
    });
    await flushMicrotasks();
  };
  const outputs = () =>
    (transport.sent as UUIWorkerOutbound[]).filter((
      message,
    ): message is ChannelFrame =>
      message.type === "channel.frame" && message.id === "output"
    );
  try {
    connectChannels(connection);
    let pending = context.run("screen owner", () => callScreen(options));
    let screen = topScreen(lastPresentation(transport)),
      generation = screen.channelGeneration!;
    let namespace = screen.customElements[0]!.channelNamespace!;
    await send(namespace, generation, "echo");
    await send(screen.programNamespace!, generation, "echo");
    assertEquals(outputs().map((frame) => frame.value), [{
      owner: "screen owner",
    }, { owner: "screen owner" }]);
    await send(namespace, generation, "wait");
    const modal = presentModal(() =>
      callScreen({ id: "covered", schema: z.object({}), model: new Model({}) })
    );
    assertEquals(waits[0]!.signal.aborted, true);
    await send(namespace, generation, "echo");
    assertEquals(outputs().length, 2);
    waits[0]!.resolve();
    transport.push(
      eventFor(lastPresentation(transport), BACK_EVENT, ++sequence, BACK_EVENT),
    );
    await modal;
    await send(namespace, generation, "wait");
    model.resetScreen();
    screenChannel.redraw();
    await flushMicrotasks();
    assertEquals(waits[1]!.signal.aborted, true);
    waits[1]!.resolve();
    const old = generation;
    screen = topScreen(lastPresentation(transport));
    generation = screen.channelGeneration!;
    namespace = screen.customElements[0]!.channelNamespace!;
    assertEquals(generation === old, false);
    await send(namespace, old, "echo");
    assertEquals(outputs().length, 2);
    await send(namespace, generation, "echo");
    assertEquals(outputs().at(-1)!.value, { owner: "screen owner" });
    await send(namespace, generation, "wait");
    screenChannel.exit();
    await pending;
    assertEquals(waits[2]!.signal.aborted, true);
    screenChannel = nextScreenChannel();
    component = new Channel();
    options.customElements[0]!.channel = component;
    stopComponent = handle(component);
    handle(screenChannel);
    pending = context.run("reused owner", () => callScreen(options));
    waits[2]!.resolve();
    screen = topScreen(lastPresentation(transport));
    generation = screen.channelGeneration!;
    namespace = screen.customElements[0]!.channelNamespace!;
    await send(namespace, generation, "wait");
    disconnectChannels();
    assertEquals(waits[3]!.signal.aborted, true);
    connection = "replacement-connection";
    connectChannels(connection);
    waits[3]!.resolve();
    await send(namespace, generation, "echo");
    assertEquals(outputs().at(-1)!.value, { owner: "reused owner" });
    await send(namespace, generation, "wait");
    stopComponent.unsubscribe();
    assertEquals(waits[4]!.signal.aborted, true);
    await assertRejects(() => waits[4]!.done, DOMException);
    waits[4]!.resolve();
    await send(screen.programNamespace!, generation, "wait");
    const failure = assertRejects(() => pending, Error, "screen failed");
    screenChannel.fail(new Error("screen failed"));
    await failure;
    assertEquals(waits[5]!.signal.aborted, true);
    waits[5]!.resolve();
    await flushMicrotasks();
    assertEquals(
      (transport.sent as UUIWorkerOutbound[]).some((message) =>
        message.type === "channel.frame" && message.id === "late"
      ),
      false,
    );
    assertEquals(model.data.note, "original");
  } finally {
    unbind();
    for (const wait of waits) wait.resolve();
  }
});

Deno.test("retained async browsing refreshes rows and totals under one pending call", async () => {
  const test = new TestChannel();
  const unbind = bindSession(test);
  const model = new Model({ note: "original", rows: [] as { id: number }[] });
  const channel = nextScreenChannel();
  let length = 12, known = true, providerCalls = 0, calls = 0, settlements = 0;
  setListSource(model, "rows", async ({ query, offset, limit, signal }) => {
    await Promise.resolve();
    signal.throwIfAborted();
    providerCalls++;
    const all = Array.from({ length }, (_, id) => ({ id })).filter((row) =>
      !query.search || String(row.id).includes(query.search)
    );
    return {
      rows: all.slice(offset, offset + limit),
      more: offset + limit < all.length,
      ...(known ? { totalItems: all.length, totalSourceItems: length } : {}),
    };
  });
  try {
    calls++;
    const pending = callScreen({
      id: "async-browsing",
      schema: z.object({
        note: z.string(),
        rows: z.object({ id: z.number() }).array(),
      }),
      model,
      controls: [{ id: "rows", bind: "rows" }, { id: "note", bind: "note" }],
    }).then((event) => {
      settlements++;
      return event;
    });
    await flushMicrotasks();
    await commandScreen({ op: "list", id: "rows", pageSize: 4 }, 1);
    await commandScreen({ op: "list", id: "rows", page: 2 }, 2);
    const before = topScreen(lastPresentation(test)).lists[0]!;
    assertEquals(before.rows, [{ id: 4 }, { id: 5 }, { id: 6 }, { id: 7 }]);
    assertEquals(model.data.rows, []);
    known = false;
    length = 15;
    channel.redraw();
    await flushMicrotasks();
    let view = topScreen(lastPresentation(test)).lists[0]!;
    assertEquals(
      [view.state.page, view.source?.totalItems, view.source?.more],
      [2, undefined, true],
    );
    await commandScreen({ op: "list", id: "rows", search: "1" }, 3);
    view = topScreen(lastPresentation(test)).lists[0]!;
    assertEquals(view.rows, [{ id: 1 }, { id: 10 }, { id: 11 }, { id: 12 }]);
    assertEquals(view.state.page, 1);
    await commandScreen({ op: "list", id: "rows", page: 2 }, 4);
    known = true;
    length = 2;
    channel.redraw();
    await flushMicrotasks();
    view = topScreen(lastPresentation(test)).lists[0]!;
    assertEquals([view.totalItems, view.totalSourceItems, view.source?.more], [
      1,
      2,
      false,
    ]);
    assertEquals([view.state.page, view.rows], [1, [{ id: 1 }]]);
    assertEquals([calls, settlements, providerCalls], [1, 0, 8]);
    channel.exit("done");
    await pending;
    assertEquals([calls, settlements], [1, 1]);
  } finally {
    unbind();
  }
});

Deno.test("provider row edits reject whole list and screen transactions without acknowledgement", async () => {
  const test = new TestChannel();
  const unbind = bindSession(test);
  const channel = nextScreenChannel();
  const model = new Model({
    note: "original",
    rows: [{ id: 0, label: "Local" }],
  });
  let reads = 0, settlements = 0;
  setListSource(model, "remote", () => {
    reads++;
    return { rows: [{ id: 1, label: "Remote" }], more: false };
  });
  const pending = callScreen({
    id: "provider-edits",
    schema: z.object({
      note: z.string(),
      rows: z.object({ id: z.number(), label: z.string() }).array(),
    }),
    model,
    controls: [
      { id: "note", bind: "note" },
      { id: "local", bind: "rows" },
      { id: "remote", bind: "rows" },
    ],
  }).then((event) => {
    settlements++;
    return event;
  });
  try {
    await flushMicrotasks();
    const shown = lastPresentation(test);
    const state = structuredClone(model.screen);
    const data = structuredClone(model.data);
    const listChanges = [
      {
        id: "local",
        rows: [{ index: 0, value: { id: 0, label: "Discard" } }],
      },
      {
        id: "remote",
        rows: [{ index: 0, value: { id: 1, label: "Edited" } }],
      },
    ];
    test.push(listInput({
      ...eventFor(shown, "", 1),
      changes: [{ bind: "note", value: "Discard" }],
      listChanges,
      updates: topScreen(shown).lists.map((list) => ({
        id: list.id,
        operation: "capacity",
        pageSize: 2,
      })),
    }));
    await flushMicrotasks();
    assertEquals(model.data, data);
    assertEquals(model.screen, state);
    assertEquals(reads, 1);
    assertEquals(
      test.sent.some((message) =>
        (message as { type: string }).type === "server.ack"
      ),
      false,
    );
    assertEquals(
      ((test.sent.at(-1) as ChannelFrame).value as { error: string }).error,
      "List providers do not support row edits",
    );
    // Save/Back uses the same owning edit admission as list updates.
    test.push({ ...eventFor(shown, "save", 2), listChanges });
    await flushMicrotasks();
    assertEquals(model.data, data);
    assertEquals(model.screen, state);
    assertEquals(settlements, 0);
    // Array edits can commit alongside provider refresh without replacing either view.
    test.push(listInput({
      ...eventFor(lastPresentation(test), "", 3),
      changes: [{ bind: "note", value: "accepted" }],
      listChanges: [{
        ...listChanges[0]!,
        rows: [{ index: 0, value: { id: 0, label: "Edited local" } }],
      }],
      updates: [{
        id: "remote",
        operation: "capacity",
        pageSize: 2,
      }],
    }));
    await flushMicrotasks();
    assertEquals(model.data, {
      note: "accepted",
      rows: [{ id: 0, label: "Edited local" }],
    });
    assertEquals(
      topScreen(lastPresentation(test)).lists.map((list) => list.rows),
      [
        [{ id: 0, label: "Edited local" }],
        [{ id: 1, label: "Remote" }],
      ],
    );
    assertEquals(model.screen.elements.remote!.list!.pageSize, 2);
    assertEquals(reads, 2);
    assertEquals(settlements, 0);
  } finally {
    channel.exit("done");
    await pending;
    unbind();
  }
});

Deno.test("retained provider views sharing a binding own independent rows and mappings", async () => {
  const test = new TestChannel();
  const unbind = bindSession(test);
  const channel = nextScreenChannel();
  const local = Array.from({ length: 3 }, (_, id) => ({ id, label: "Local" }));
  const model = new Model({ rows: local });
  const rows = [{ id: 1, label: "Original" }, { id: 2, label: "Second" }];
  for (const [id, search] of [["a", "Original"], ["b", "Second"]] as const) {
    screenElement(model.screen, id).list = {
      ...initialListState(),
      query: { search, filters: {}, sort: null },
    };
    setListSource(model, id, ({ query, offset, limit }) => {
      const matching = rows.filter((row) => row.label.includes(query.search));
      return {
        rows: matching.slice(offset, offset + limit),
        more: offset + limit < matching.length,
        totalItems: matching.length,
        totalSourceItems: rows.length,
      };
    });
  }
  const pending = callScreen({
    id: "shared-provider-binding",
    schema: z.object({
      rows: z.object({ id: z.number(), label: z.string() }).array(),
    }),
    model,
    controls: ["a", "b", "local"].map((id) => ({ id, bind: "rows" })),
  });
  try {
    await flushMicrotasks();
    let shown = lastPresentation(test);
    assertEquals(topScreen(shown).lists.map((list) => list.rows), [[rows[0]], [
      rows[1],
    ], [local[0]]]);
    await commandScreen(
      { op: "list", id: "a", search: "Second", pageSize: 2 },
      1,
    );
    shown = lastPresentation(test);
    const [nextA, nextB] = topScreen(shown).lists;
    assertEquals([nextA!.rows, nextB!.rows], [[rows[1]], [rows[1]]]);
    assertEquals([nextA!.state.pageSize, nextB!.state.pageSize], [2, 1]);
    assertEquals(model.data.rows, local);
    // Navigation must use the provider's accepted displayed row, not the business binding.
    test.push({
      ...eventFor(shown, "select", 2),
      eventType: "select",
      selection: { id: "b", index: 0 },
    });
    const event = await pending;
    assertEquals(event.eventType === "select" && event.value, rows[1]);
  } finally {
    channel.exit("done");
    await pending;
    unbind();
  }
});

Deno.test("delayed visible providers cannot commit after coverage connection reset or screen replacement", async () => {
  for (
    const action of [
      "cover",
      "disconnect",
      "reset",
      "replacement",
      "dispose",
      "source-replacement",
    ]
  ) {
    const test = new TestChannel();
    const unbind = bindSession(test);
    const model = new Model({ rows: [] as { id: number }[] });
    let channel = nextScreenChannel();
    const gate = Promise.withResolvers<import("./lists.ts").ListSourcePage>();
    let delayed = false, signal: AbortSignal | undefined;
    const dispose = setListSource(model, "rows", (request) => {
      if (delayed) {
        signal = request.signal;
        return gate.promise;
      }
      return {
        rows: [{ id: 1 }],
        more: false,
        totalItems: 1,
        totalSourceItems: 1,
      };
    });
    const options = {
      id: "provider-lifetime",
      schema: z.object({ rows: z.object({ id: z.number() }).array() }),
      model,
      controls: [{ id: "rows", bind: "rows" }],
    };
    let pending = callScreen(options);
    void pending.catch(() => {});
    try {
      await flushMicrotasks();
      delayed = true;
      test.push(
        listInput({
          ...eventFor(lastPresentation(test), "", 1),
          updates: [{
            id: "rows",
            operation: "query",
            query: { search: "late", filters: {}, sort: null },
          }],
        }),
      );
      await flushMicrotasks();
      let child: Promise<unknown> | undefined;
      let childChannel: ScreenChannel | undefined;
      if (action === "cover") {
        child = presentPage(() => {
          childChannel = nextScreenChannel();
          return callScreen({
            id: "cover",
            schema: z.object({ value: z.string() }),
            model: new Model({ value: "child" }),
          });
        });
        await flushMicrotasks();
      } else if (action === "disconnect") disconnectChannels();
      else if (action === "reset") model.resetScreen();
      else if (action === "dispose") dispose();
      else if (action === "source-replacement") {
        setListSource(
          model,
          "rows",
          () => ({ rows: [{ id: 1 }], more: false, totalItems: 1 }),
        );
      } else {
        channel.exit("replace");
        await pending;
      }
      assertEquals(signal?.aborted, true, action);
      delayed = false;
      if (action === "replacement") {
        channel = nextScreenChannel();
        pending = callScreen(options);
        await flushMicrotasks();
      } else if (["reset", "dispose", "source-replacement"].includes(action)) {
        channel.redraw();
        await flushMicrotasks();
      } else if (action === "disconnect") {
        connectChannels("fresh-connection");
        await commandScreen({ op: "list", id: "rows", pageSize: 3 }, 2);
      } else {
        channel.redraw();
        await flushMicrotasks();
        childChannel?.exit("back");
        await child;
        await flushMicrotasks();
      }
      const count = test.sent.length;
      gate.resolve({
        rows: [{ id: 999 }],
        more: false,
        totalItems: 1000,
        totalSourceItems: 1000,
      });
      await flushMicrotasks();
      assertEquals(model.data.rows, [], action);
      assertEquals(
        topScreen(lastPresentation(test)).lists[0]!.rows,
        action === "dispose" ? [] : [{ id: 1 }],
        action,
      );
      assertEquals(model.screen.elements.rows!.list!.query.search, "", action);
      assertEquals(test.sent.length, count, action);
      await commandScreen({ op: "list", id: "rows", pageSize: 2 }, 3);
      channel.exit("done");
      await pending;
    } finally {
      unbind();
    }
  }
});

Deno.test("provider refresh reports current failures and discards delayed old error output", async () => {
  const test = new TestChannel();
  const unbind = bindSession(test);
  let channel = nextScreenChannel();
  connectChannels("provider-errors");
  const model = new Model({ rows: [] as { id: number }[] });
  let failure: Promise<never> | undefined;
  setListSource(model, "rows", async () => {
    if (failure) return await failure;
    return { rows: [{ id: 1 }], more: false, totalItems: 1 };
  });
  const options = {
    id: "provider-errors",
    schema: z.object({ rows: z.object({ id: z.number() }).array() }),
    model,
    controls: [{ id: "rows", bind: "rows" }],
  };
  let pending = callScreen(options);
  try {
    await flushMicrotasks();
    failure = Promise.reject(new Error("Current provider failed"));
    channel.redraw();
    await flushMicrotasks();
    assertEquals(
      test.messageHistory.snapshot().at(-1)?.message,
      "Current provider failed",
    );
    const frame = test.sent.at(-1) as ChannelFrame;
    assertEquals(frame.id, "append");
    assertEquals(
      frame.namespace,
      topScreen(lastPresentation(test)).messageNamespace,
    );

    const delayed = Promise.withResolvers<never>();
    failure = delayed.promise;
    channel.redraw();
    await flushMicrotasks();
    channel.exit();
    await pending;
    failure = undefined;
    channel = nextScreenChannel();
    pending = callScreen(options);
    await flushMicrotasks();
    const history = test.messageHistory.snapshot(), sent = test.sent.length;
    delayed.reject(new Error("Old provider failed"));
    await flushMicrotasks();
    assertEquals(test.messageHistory.snapshot(), history);
    assertEquals(test.sent.length, sent);
    captureMessages().send("Fresh owner remains healthy", "success");
    channel.exit();
    await pending;
  } finally {
    unbind();
    await pending.catch(() => {});
  }
});

Deno.test("captured message output rejects late owners and preserves initiating context", async () => {
  for (
    const boundary of [
      "settlement",
      "reset",
      "dispose",
      "exit",
      "failure",
      "cover",
      "disconnect",
      "takeover",
      "unbind",
    ]
  ) {
    const test = new TestChannel(), model = new Model({});
    const unbind = bindSession(test);
    let channel = nextScreenChannel();
    connectChannels("messages-original");
    const context = new AsyncLocalStorage<string>();
    const gate = Promise.withResolvers<void>();
    let signal: AbortSignal | undefined, late = "", trusted: string | undefined;
    channel.subscribe("*", async (id, _data, { signal: incoming }) => {
      if (id !== "wait") return;
      signal = incoming;
      const output = captureMessages();
      await gate.promise;
      trusted = context.getStore();
      try {
        output.send("late captured");
        late = "sent";
      } catch {
        late = "rejected";
      }
      assertThrows(() => sendMessage("late ambient"), Error);
    });
    const options = {
      id: "messages",
      schema: z.object({}),
      model,
      actions: [{ id: "next", label: "Next" }],
    };
    let pending = context.run("trusted-program", () => callScreen(options));
    void pending.catch(() => {});
    let child: Promise<unknown> | undefined;
    let childChannel: ScreenChannel | undefined;
    try {
      const shown = lastPresentation(test), screen = topScreen(shown);
      const output = captureMessages();
      output.send("current");
      test.push({
        type: "channel.frame",
        protocol: UUI_PROTOCOL_VERSION,
        sessionId: test.sessionId,
        connection: "messages-original",
        namespace: screen.programNamespace!,
        generation: screen.channelGeneration!,
        kind: "message",
        id: "wait",
        requestId: "client-1",
        value: null,
        clientSequence: 0,
      });
      await flushMicrotasks();
      assertEquals(signal?.aborted, false);
      if (boundary === "settlement") {
        await commandScreen({ op: "click", id: "next" }, 1);
        await pending;
        channel = nextScreenChannel();
        pending = callScreen(options);
      } else if (boundary === "reset") {
        model.resetScreen();
        channel.redraw();
      } else if (boundary === "dispose") {
        channel.exit();
        await pending;
      } else if (boundary === "exit" || boundary === "failure") {
        if (boundary === "exit") channel.exit();
        else channel.fail(new Error("failure"));
        await pending.catch(() => {});
        channel = nextScreenChannel();
        pending = callScreen(options);
      } else if (boundary === "cover") {
        child = presentPage(() => {
          childChannel = nextScreenChannel();
          return callScreen({
            id: "child",
            schema: z.object({}),
            model: new Model({}),
          });
        });
      } else if (boundary === "disconnect") disconnectChannels();
      else if (boundary === "takeover") connectChannels("messages-replacement");
      else unbind();
      await flushMicrotasks();
      const history = test.messageHistory.snapshot();
      assertThrows(() => output.send("stale output"), Error);
      gate.resolve();
      await flushMicrotasks();
      assertEquals(signal?.aborted, true, boundary);
      assertEquals(late, "rejected", boundary);
      assertEquals(trusted, "trusted-program", boundary);
      assertEquals(test.messageHistory.snapshot(), history, boundary);
      if (child) {
        childChannel?.exit();
        await child;
      }
      if (boundary !== "unbind" && boundary !== "dispose") {
        connectChannels("messages-fresh");
        captureMessages().send("fresh", "success");
        assertEquals(test.messageHistory.snapshot().at(-1)?.message, "fresh");
      }
    } finally {
      gate.resolve();
      childChannel?.exit();
      unbind();
      await pending.catch(() => {});
      await child?.catch(() => {});
    }
  }
});

Deno.test("captured headless message state is accepted without a transport and expires on connection change", async () => {
  const test = new TestChannel();
  const unbind = bindSession(test);
  const channel = nextScreenChannel();
  const pending = callScreen({
    id: "headless-messages",
    schema: z.object({}),
    model: new Model({}),
  });
  try {
    const output = captureMessages();
    await Promise.resolve();
    output.send("Headless outcome", "success");
    assertEquals(
      test.messageHistory.snapshot().at(-1)?.message,
      "Headless outcome",
    );
    assertEquals(
      test.sent.filter((item) =>
        (item as ChannelFrame).type === "channel.frame"
      ),
      [],
    );
    connectChannels("first-socket");
    assertThrows(() => output.send("rebound"), DOMException);
    assertEquals(test.messageHistory.snapshot().length, 1);
    captureMessages().send("Fresh attached output");
    assertEquals((test.sent.at(-1) as ChannelFrame).id, "append");
    disconnectChannels();
    assertThrows(() => output.send("old initial attachment"), DOMException);
    channel.exit();
    await pending;
  } finally {
    unbind();
    await pending.catch(() => {});
  }
});

Deno.test("automatic routing separates list IDs, custom hosts and schema-owned custom fields without serializing bindings", async () => {
  const transport = new TestChannel();
  const unbind = bindSession(transport);
  const customField = new Channel(), host = new Channel();
  connectChannels("automatic-routing");
  const received: unknown[] = [];
  customField.subscribe("*", (id, data) => {
    received.push(["field", id, data]);
  });
  host.subscribe("*", (id, data) => {
    received.push(["host", id, data]);
  });
  const schema = z.object({
    value: field(z.string(), {
      custom: { module: "/widget.js", config: {}, channel: customField },
    }),
    rows: z.object({ value: z.string() }).array(),
  });
  const controller = nextScreenChannel();
  const pending = callScreen({
    id: "automatic-routing",
    schema,
    model: new Model({ value: "initial", rows: [{ value: "one" }] }),
    controls: [{ bind: "value" }, { id: "component:widget", bind: "rows" }],
    customElements: [{
      id: "widget",
      module: "/widget.js",
      config: {},
      channel: host,
    }],
  });
  try {
    const screen = topScreen(lastPresentation(transport));
    const routes = [
      screen.lists[0]!.channelNamespace,
      screen.controls[0]!.custom!.channelNamespace,
      screen.customElements[0]!.channelNamespace,
      screen.programNamespace,
    ];
    assertEquals(new Set(routes).size, 4);
    assertEquals(routes.every((route) => typeof route === "string"), true);
    assertEquals("channel" in screen.controls[0]!.custom!, false);
    assertEquals("channel" in screen.customElements[0]!, false);
    assertEquals(JSON.stringify(screen).includes('"channel":'), false);
    for (const [index, channel] of [customField, host].entries()) {
      transport.push({
        type: "channel.frame",
        protocol: UUI_PROTOCOL_VERSION,
        sessionId: transport.sessionId,
        clientSequence: 0,
        connection: "automatic-routing",
        ...channel.capture().reference,
        kind: "message",
        id: "event",
        requestId: `client-${index + 1}`,
        value: { index },
      });
    }
    await flushMicrotasks();
    assertEquals(received, [["field", "event", { index: 0 }], [
      "host",
      "event",
      { index: 1 },
    ]]);
  } finally {
    controller.exit();
    await pending;
    unbind();
  }
});

Deno.test("headless list work retains its initiating connection and cannot commit after takeover", async () => {
  const transport = new TestChannel();
  const unbind = bindSession(transport);
  const controller = nextScreenChannel(),
    model = new Model({ rows: [] as { value: string }[] });
  connectChannels("headless-origin");
  const gate = Promise.withResolvers<void>();
  let querySignal: AbortSignal | undefined;
  setListSource(model, "rows", async ({ query, signal }) => {
    if (query.search === "hold") {
      querySignal = signal;
      await gate.promise;
    }
    return {
      rows: [{ value: query.search || "initial" }],
      more: false,
      totalItems: 1,
    };
  });
  const pending = callScreen({
    id: "headless-connection",
    schema: z.object({ rows: z.object({ value: z.string() }).array() }),
    model,
    controls: [{ id: "rows", bind: "rows" }],
  });
  try {
    await flushMicrotasks();
    const request = commandScreen(
      { op: "list", id: "rows", search: "hold" },
      1,
    );
    const rejected = assertRejects(() => request, DOMException);
    await flushMicrotasks();
    assertEquals(querySignal?.aborted, false);
    connectChannels("headless-replacement");
    assertEquals(querySignal?.aborted, true);
    gate.resolve();
    await rejected;
    assertEquals(model.screen.elements.rows!.list!.query.search, "");
    await commandScreen({ op: "list", id: "rows", search: "fresh" }, 2);
    assertEquals(model.screen.elements.rows!.list!.query.search, "fresh");
  } finally {
    gate.resolve();
    controller.exit();
    await pending;
    unbind();
  }
});

Deno.test("inline layout and list-toolbar custom bindings retain their owning channels", async () => {
  const transport = new TestChannel();
  const unbind = bindSession(transport);
  const controller = nextScreenChannel();
  const fieldChannel = new Channel(), toolbarChannel = new Channel();
  connectChannels("inline-channels");
  const schema = z.object({
    value: z.string(),
    toolbarValue: z.string(),
    rows: z.string().array(),
  });
  const custom = (channel: Channel) => ({
    module: "/widget.js",
    config: {},
    channel,
  });
  const pending = callScreen({
    id: "inline-channels",
    schema,
    model: new Model({ value: "", toolbarValue: "", rows: ["one"] }),
    controls: [{ bind: "rows" }],
    layout: {
      schema: 1,
      id: "inline-layout",
      root: {
        type: "stack",
        elements: [{ bind: "value", custom: custom(fieldChannel) }],
        children: [{
          type: "list",
          id: "rows",
          bind: "rows",
          toolbar: [{ bind: "toolbarValue", custom: custom(toolbarChannel) }],
        }],
      },
    },
  });
  try {
    const screen = topScreen(lastPresentation(transport));
    const field = (screen.layout as LayoutDocument).root
      .elements![0] as ControlDescriptor;
    const toolbar = screen.lists[0]!.toolbar![0] as ControlDescriptor;
    assertEquals(
      field.custom!.channelNamespace,
      fieldChannel.capture().reference.namespace,
    );
    assertEquals(
      toolbar.custom!.channelNamespace,
      toolbarChannel.capture().reference.namespace,
    );
    assertEquals(JSON.stringify(screen).includes('"channel":'), false);
    const first = field.custom!.channelNamespace;
    controller.redraw();
    await flushMicrotasks();
    assertEquals(
      ((topScreen(lastPresentation(transport)).layout as LayoutDocument).root
        .elements![0] as ControlDescriptor).custom!.channelNamespace,
      first,
    );
  } finally {
    controller.exit();
    await pending;
    unbind();
  }
});

Deno.test("managed getters keep concrete per-surface identities through reset, nested restoration and closure", async () => {
  const transport = new TestChannel();
  const unbind = bindSession(transport);
  const root = nextScreenChannel(), nextBefore = nextScreenChannel();
  assertEquals(root, nextBefore);
  assertEquals(currentScreenChannel(), undefined);
  assertThrows(() => bindSession(new TestChannel()), Error, "already bound");
  const model = new Model({});
  const pending = callScreen({ id: "root-owner", schema: z.object({}), model });
  const next = nextScreenChannel();
  assertEquals(currentScreenChannel(), root);
  assertEquals(next === root, false);
  try {
    const generation = topScreen(lastPresentation(transport)).channelGeneration;
    model.resetScreen();
    root.redraw();
    await flushMicrotasks();
    assertEquals(currentScreenChannel(), root);
    assertEquals(nextScreenChannel(), next);
    assertEquals(
      topScreen(lastPresentation(transport)).channelGeneration === generation,
      false,
    );
    let modalOwner!: ScreenChannel, modalNext!: ScreenChannel;
    const modal = presentModal(async () => {
      assertEquals(currentScreenChannel(), undefined);
      modalOwner = nextScreenChannel();
      const call = callScreen({
        id: "modal-owner",
        schema: z.object({}),
        model: new Model({}),
      });
      modalNext = nextScreenChannel();
      assertEquals(currentScreenChannel(), modalOwner);
      await presentPage(async () => {
        const pageOwner = nextScreenChannel();
        const pageCall = callScreen({
          id: "page-owner",
          schema: z.object({}),
          model: new Model({}),
        });
        assertEquals(currentScreenChannel(), pageOwner);
        pageOwner.exit();
        await pageCall;
      });
      assertEquals(currentScreenChannel(), modalOwner);
      assertEquals(nextScreenChannel(), modalNext);
      await call;
    });
    await flushMicrotasks();
    assertEquals(currentScreenChannel(), root);
    assertEquals(nextScreenChannel(), next);
    modalOwner.exit();
    await modal;
    assertEquals(modalOwner.signal.aborted, true);
    assertEquals(modalNext.signal.aborted, true);
    root.exit();
    await pending;
    assertEquals(root.signal.aborted, true);
    assertEquals(currentScreenChannel(), root);
  } finally {
    unbind();
  }
  assertEquals(next.signal.aborted, true);
  assertThrows(() => next.subscribe("late", () => {}), DOMException);
  assertThrows(() => nextScreenChannel(), Error, "not bound");
});

Deno.test("failed validation, preparation and presentation discard candidates and keep the previous current owner", async () => {
  const transport = new TestChannel();
  const unbind = bindSession(transport);
  try {
    const current = nextScreenChannel();
    const call = callScreen({
      id: "before-failure",
      schema: z.object({}),
      model: new Model({}),
    });
    current.exit();
    await call;
    for (const boundary of ["validation", "preparation", "presentation"]) {
      const candidate = nextScreenChannel(), component = new Channel();
      const subscription = component.subscribe("*", () => {});
      const send = transport.send;
      if (boundary === "presentation") {
        transport.send = () => {
          throw new Error("Presentation failed");
        };
      }
      const model = new Model({});
      if (boundary === "preparation") {
        setListSource(model, "rows", () => {
          throw new Error("Provider failed");
        });
      }
      try {
        await assertRejects(() =>
          callScreen({
            id: boundary,
            schema: boundary === "validation"
              ? z.object({ required: z.string() })
              : boundary === "preparation"
              ? z.object({ rows: z.string().array() })
              : z.object({}),
            model: boundary === "preparation"
              ? Object.assign(model, { data: { rows: [] } })
              : model,
            controls: boundary === "preparation"
              ? [{ id: "rows", bind: "rows" }]
              : undefined,
            customElements: [{
              module: "/widget.js",
              config: {},
              channel: component,
            }],
          }), Error);
      } finally {
        transport.send = send;
      }
      assertEquals(currentScreenChannel(), current, boundary);
      assertEquals(nextScreenChannel() === candidate, false, boundary);
      assertEquals(candidate.signal.aborted, true, boundary);
      assertEquals(component.signal.aborted, true, boundary);
      assertEquals(subscription.matches("message"), false, boundary);
      assertThrows(() => component.subscribe("late", () => {}), DOMException);
      component.dispose();
    }
    const healthy = nextScreenChannel();
    const healthyCall = callScreen({
      id: "healthy",
      schema: z.object({}),
      model: new Model({}),
    });
    assertEquals(currentScreenChannel(), healthy);
    healthy.exit();
    await healthyCall;
  } finally {
    unbind();
  }
});

Deno.test("covered provider failures keep current and next ownership and restore the previous snapshot", async () => {
  for (const cover of [presentPage, presentModal]) {
    const transport = new TestChannel();
    const unbind = bindSession(transport);
    const gate = Promise.withResolvers<import("./lists.ts").ListSourcePage>();
    let child: Promise<unknown> | undefined,
      preparing: Promise<unknown> | undefined;
    try {
      const previous = nextScreenChannel();
      const first = callScreen({
        id: "previous-root",
        schema: z.object({}),
        model: new Model({}),
      });
      previous.exit();
      await first;
      const previousSnapshot = topScreen(lastPresentation(transport));
      let childChannel!: ScreenChannel;
      child = cover(() => {
        childChannel = nextScreenChannel();
        return callScreen({
          id: "child",
          schema: z.object({}),
          model: new Model({}),
        });
      });
      void child.catch(() => {});
      const candidate = nextScreenChannel(), component = new Channel();
      const subscription = component.subscribe("*", () => {});
      const model = new Model({ rows: [] as string[] });
      setListSource(model, "rows", () => gate.promise);
      preparing = callScreen({
        id: "preparing-root",
        schema: z.object({ rows: z.string().array() }),
        model,
        controls: [{ id: "rows", bind: "rows" }],
      });
      void preparing.catch(() => {});
      const before = presentations(transport).length;
      childChannel.redraw();
      await flushMicrotasks();
      assertEquals(presentations(transport).length, before + 1);
      assertEquals(topScreen(lastPresentation(transport)).id, "child");
      assertEquals(currentScreenChannel(), previous);
      assertEquals(nextScreenChannel(), candidate);
      gate.reject(new Error("Covered provider failed"));
      await assertRejects(() => preparing!, Error, "Covered provider failed");
      assertEquals(currentScreenChannel(), previous);
      assertEquals(nextScreenChannel() === candidate, false);
      assertEquals(candidate.signal.aborted, true);
      assertEquals(component.signal.aborted, true);
      assertEquals(subscription.matches("message"), false);
      assertThrows(() => candidate.subscribe("late", () => {}), DOMException);
      childChannel.exit();
      await child;
      const restored = lastPresentation(transport);
      assertEquals(topScreen(restored), previousSnapshot);
      assertEquals(restored.presentation.activeSurfaceId, null);
      const healthy = nextScreenChannel();
      const retry = callScreen({
        id: "healthy-root",
        schema: z.object({}),
        model: new Model({}),
      });
      assertEquals(currentScreenChannel(), healthy);
      healthy.exit();
      await retry;
    } finally {
      gate.reject(new Error("Covered provider failed"));
      await preparing?.catch(() => {});
      unbind();
      await child?.catch(() => {});
    }
  }
});

Deno.test("a prepared hidden candidate stays next until its own snapshot is published on restoration", async () => {
  const transport = new TestChannel();
  const unbind = bindSession(transport);
  let child: Promise<unknown> | undefined,
    pending: Promise<unknown> | undefined;
  try {
    const previous = nextScreenChannel();
    const first = callScreen({
      id: "previous-root",
      schema: z.object({}),
      model: new Model({}),
    });
    previous.exit();
    await first;
    let childChannel!: ScreenChannel;
    child = presentPage(() => {
      childChannel = nextScreenChannel();
      return callScreen({
        id: "child",
        schema: z.object({}),
        model: new Model({}),
      });
    });
    void child.catch(() => {});
    const candidate = nextScreenChannel();
    pending = callScreen({
      id: "prepared-root",
      schema: z.object({}),
      model: new Model({}),
    });
    void pending.catch(() => {});
    childChannel.redraw();
    await flushMicrotasks();
    assertEquals(topScreen(lastPresentation(transport)).id, "child");
    assertEquals(currentScreenChannel(), previous);
    assertEquals(nextScreenChannel(), candidate);
    childChannel.exit();
    await child;
    assertEquals(topScreen(lastPresentation(transport)).id, "prepared-root");
    assertEquals(currentScreenChannel(), candidate);
    const next = nextScreenChannel();
    assertEquals(next === candidate, false);
    candidate.redraw();
    await flushMicrotasks();
    assertEquals(currentScreenChannel(), candidate);
    assertEquals(nextScreenChannel(), next);
    candidate.exit();
    await pending;
  } finally {
    unbind();
    await Promise.allSettled([child, pending]);
  }
});

Deno.test("pending and completed component bindings dispose explicitly and never migrate to a later call or session", async () => {
  const transport = new TestChannel();
  const unbind = bindSession(transport);
  const unused = new Channel();
  const subscription = unused.subscribe("*", () => {});
  let cleaned = 0;
  unused.signal.addEventListener("abort", () => cleaned++, { once: true });
  unused.dispose();
  unused.dispose();
  assertEquals(cleaned, 1);
  assertEquals(subscription.matches("message"), false);
  const abandoned = new Channel();
  const abandonedSubscription = abandoned.subscribe("*", () => {});
  try {
    for (let index = 0; index < 12; index++) {
      const screen = nextScreenChannel(), component = new Channel();
      const handler = () => {};
      const subscription = component.subscribe("*", handler);
      assertEquals(subscription.handler, handler);
      const pending = callScreen({
        id: "repeated-owner",
        schema: z.object({}),
        model: new Model({}),
        customElements: [{
          module: "/widget.js",
          config: {},
          channel: component,
        }],
      });
      const next = nextScreenChannel();
      await assertRejects(
        () =>
          callScreen({
            id: "concurrent",
            schema: z.object({}),
            model: new Model({}),
          }),
        Error,
        "only one",
      );
      assertEquals(nextScreenChannel(), next);
      assertEquals(currentScreenChannel(), screen);
      screen.exit();
      await pending;
      assertEquals(component.signal.aborted, true);
      assertEquals(subscription.matches("message"), false);
      assertThrows(() => screen.subscribe("late", handler), DOMException);
      assertThrows(() => component.capture(false), DOMException);
      await assertRejects(
        () =>
          callScreen({
            id: "old-component",
            schema: z.object({}),
            model: new Model({}),
            customElements: [{
              module: "/widget.js",
              config: {},
              channel: component,
            }],
          }),
        TypeError,
        "different screen",
      );
    }
    assertEquals(abandoned.signal.aborted, true);
    assertEquals(abandonedSubscription.matches("message"), false);
  } finally {
    unbind();
  }
  const rebound = bindSession(new TestChannel());
  try {
    assertThrows(() => abandoned.subscribe("late", () => {}), DOMException);
  } finally {
    rebound();
  }
});

Deno.test("settlement during unabortable preparation cannot clear a succeeding screen or its next candidate", async () => {
  const transport = new TestChannel();
  const unbind = bindSession(transport);
  const gate = Promise.withResolvers<import("./lists.ts").ListSourcePage>();
  const model = new Model({ rows: [] as string[] });
  setListSource(model, "rows", () => gate.promise);
  const preparing = nextScreenChannel();
  const first = callScreen({
    id: "preparing",
    controls: [{ id: "rows", bind: "rows" }],
    schema: z.object({ rows: z.string().array() }),
    model,
  });
  const failed = assertRejects(() => first, DOMException);
  try {
    await flushMicrotasks();
    preparing.exit();
    const succeeding = nextScreenChannel();
    assertEquals(succeeding === preparing, false);
    const second = callScreen({
      id: "successor",
      schema: z.object({}),
      model: new Model({}),
    });
    const next = nextScreenChannel();
    gate.resolve({ rows: ["late"], more: false });
    await failed;
    assertEquals(currentScreenChannel(), succeeding);
    assertEquals(nextScreenChannel(), next);
    assertEquals(topScreen(lastPresentation(transport)).id, "successor");
    succeeding.exit();
    await second;
  } finally {
    gate.resolve({ rows: [], more: false });
    unbind();
  }
});

Deno.test("session end during preparation releases owners without an unhandled result rejection", async () => {
  const transport = new TestChannel();
  const unbind = bindSession(transport);
  const gate = Promise.withResolvers<import("./lists.ts").ListSourcePage>();
  const candidate = nextScreenChannel(), component = new Channel();
  const subscription = component.subscribe("*", () => {});
  const model = new Model({ rows: [] as string[] });
  let providerSignal!: AbortSignal;
  setListSource(model, "rows", ({ signal }) => {
    providerSignal = signal;
    return gate.promise;
  });
  const pending = callScreen({
    id: "preparing-at-session-end",
    controls: [{ id: "rows", bind: "rows" }],
    schema: z.object({ rows: z.string().array() }),
    model,
  });
  void pending.catch(() => {});
  try {
    unbind();
    const error = await assertRejects(() => pending, DOMException);
    assertEquals(error.name, "AbortError");
    await flushMicrotasks();
    assertEquals(providerSignal.aborted, true);
    assertEquals(candidate.signal.aborted, true);
    assertEquals(component.signal.aborted, true);
    assertEquals(subscription.matches("message"), false);
  } finally {
    gate.resolve({ rows: ["late"], more: false });
    unbind();
  }
});

Deno.test("separate concurrent Workers own independent current and next screen channels", async () => {
  const source = `
    import { bindSession, callScreen, currentScreenChannel, nextScreenChannel, Channel } from ${
    JSON.stringify(new URL("./session.ts", import.meta.url).href)
  };
    import { Model } from ${
    JSON.stringify(new URL("./model.ts", import.meta.url).href)
  };
    import { z } from ${
    JSON.stringify(new URL("../db/fields.ts", import.meta.url).href)
  };
    const unbind = bindSession({ sessionId: crypto.randomUUID(), send() {}, receive: () => new Promise(() => {}) });
    const current = nextScreenChannel(), component = new Channel();
    const pending = callScreen({ id: "worker-screen", schema: z.object({}), model: new Model({}) });
    const next = nextScreenChannel();
    postMessage({ namespace: current.capture(false).reference.namespace, current: currentScreenChannel() === current, next: next !== current });
    onmessage = async () => { current.exit(); await pending; unbind(); postMessage({ disposed: current.signal.aborted && next.signal.aborted && component.signal.aborted }); };
  `;
  const url = URL.createObjectURL(
    new Blob([source], { type: "text/javascript" }),
  );
  const workers = [
    new Worker(url, { type: "module" }),
    new Worker(url, { type: "module" }),
  ];
  const read = (worker: Worker) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Worker channel verification timed out")),
        10000,
      );
      worker.onmessage = (event) => {
        clearTimeout(timeout);
        resolve(event.data);
      };
      worker.onerror = (event) => {
        clearTimeout(timeout);
        event.preventDefault();
        reject(new Error(event.message));
      };
    });
  try {
    const [one, two] = await Promise.all(workers.map(read));
    assertEquals(one!.current && two!.current && one!.next && two!.next, true);
    assertEquals(one!.namespace === two!.namespace, false);
    const finished = workers.map(read);
    workers.forEach((worker) => worker.postMessage("finish"));
    assertEquals((await Promise.all(finished)).map((value) => value.disposed), [
      true,
      true,
    ]);
  } finally {
    workers.forEach((worker) => worker.terminate());
    URL.revokeObjectURL(url);
  }
});

Deno.test("failed surface pushes restore ownership and session end releases covered removal waits", async () => {
  const transport = new TestChannel();
  const unbind = bindSession(transport);
  const root = nextScreenChannel();
  const pending = callScreen({
    id: "root",
    schema: z.object({}),
    model: new Model({}),
  });
  void pending.catch(() => {});
  let inner: Promise<void> | undefined;
  let pageNext!: ScreenChannel, modalNext!: ScreenChannel;
  try {
    const send = transport.send;
    let fail = true, called = false;
    transport.send = (message) => {
      if (fail) {
        fail = false;
        throw new Error("Push failed");
      }
      send.call(transport, message);
    };
    await assertRejects(
      () =>
        presentPage(() => {
          called = true;
        }),
      Error,
      "Push failed",
    );
    transport.send = send;
    assertEquals(called, false);
    assertEquals(topScreen(lastPresentation(transport)).id, "root");
    assertEquals(currentScreenChannel(), root);
    const closing = presentPage(() => {
      pageNext = nextScreenChannel();
      void callScreen({
        id: "closing-page",
        schema: z.object({}),
        model: new Model({}),
      }).catch(() => {});
      inner = presentModal(async () => {
        modalNext = nextScreenChannel();
        await callScreen({
          id: "open-modal",
          schema: z.object({}),
          model: new Model({}),
        });
      });
      void inner.catch(() => {});
      // Return without awaiting the child: removal must wait for the newer surface.
    });
    let removed = false;
    void closing.then(() => removed = true);
    await flushMicrotasks();
    assertEquals(removed, false);
    unbind();
    await assertRejects(() => pending, DOMException);
    await assertRejects(() => inner!, DOMException);
    await closing;
    assertEquals(removed, true);
    assertEquals(pageNext.signal.aborted && modalNext.signal.aborted, true);
  } finally {
    unbind();
  }
});
