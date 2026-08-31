import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { z } from "zod";
import { validateCustomElements } from "./custom_elements.ts";
import { buildControls, buildFieldCatalog, field } from "./fields.ts";
import { applyLayoutOverride, validateLayout } from "./layout.ts";
import { DEFAULT_SCREEN_LIST_PAGE_SIZE } from "./pagination.ts";
import {
  BACK_EVENT,
  parseClientMessage,
  UUI_PROTOCOL_VERSION,
  type UUIClientMessage,
} from "./protocol.ts";
import { bindSession, callScreen, copyText } from "./session.ts";

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
        { id: "left", type: "list", bind: "orders" },
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
      const sent = test.sent[0] as {
        screen: {
          customElements: unknown[];
          layout: { root: { customElement: string } };
        };
      };
      assertEquals(sent.screen.customElements.length, 1);
      assertEquals(sent.screen.layout.root.customElement, "console");
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
  for (
    const invalid of [
      { ...valid, eventType: "execute-code" },
      { ...valid, action: BACK_EVENT, eventType: "action" },
      { ...valid, action: "save", eventType: BACK_EVENT },
      { ...valid, screenRevision: 0 },
      { ...valid, controlId: 4 },
      { ...valid, changes: [{ bind: "" }] },
      { ...validPage, currentPage: 0 },
      { ...validPage, page: 1.5 },
      { ...validPage, changes: [{ bind: "" }] },
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
      const initial = test.sent[0] as {
        type: string;
        screen: {
          model: typeof model;
          pagination: {
            lists: Array<Record<string, number | string>>;
          };
        };
      };
      assertEquals(initial.type, "screen.show");
      assertEquals(initial.screen.model.records.length, pageSize);
      assertEquals(initial.screen.pagination.lists, [{
        bind: "records",
        page: 1,
        pageSize,
        totalItems: pageSize * 2 + 3,
        totalPages: 3,
      }]);
      assertEquals(model.records.length, pageSize * 2 + 3);

      const firstPage = structuredClone(initial.screen.model.records);
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
      const second = test.sent[1] as {
        type: string;
        screen: {
          model: typeof model;
          pagination: { lists: Array<Record<string, number | string>> };
        };
      };
      assertEquals(second.type, "screen.show");
      assertEquals(
        second.screen.model.records.map((record) => record.id),
        Array.from({ length: pageSize }, (_, index) => index + pageSize),
      );
      assertEquals(second.screen.pagination.lists[0]?.page, 2);
      assertEquals(model.records[0]?.name, "Edited on page one");
      assertEquals(model.note, "saved while paging");

      const secondPage = structuredClone(second.screen.model.records);
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
      const headerScreen = test.sent.at(-1) as {
        screen: {
          controls: Array<{ id: string }>;
          actions: unknown[];
          header: {
            controls: Array<Record<string, unknown>>;
            actions: Array<Record<string, unknown>>;
          };
        };
      };
      assertEquals(
        headerScreen.screen.header.controls.map((item) => ({
          id: item.id,
          bind: item.bind,
        })),
        [{ id: "header-email", bind: "email" }],
      );
      assertEquals(headerScreen.screen.header.actions, [{
        id: "save",
        label: "Save",
        kind: "primary",
      }]);
      assertEquals(
        headerScreen.screen.controls.some((item) => item.id === "header-email"),
        false,
      );
      assertEquals(headerScreen.screen.actions, []);
      test.push(event({
        screenId: "header-catalog",
        clientSequence: 1,
        action: BACK_EVENT,
        eventType: BACK_EVENT,
      }));
      assertEquals((await headerPending).action, BACK_EVENT);
      const pending = callScreen({ id: "detail", schema, model });
      await Promise.resolve();
      assertEquals((test.sent[0] as { type: string }).type, "screen.show");
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

function event(
  overrides: Partial<Extract<UUIClientMessage, { type: "screen.event" }>> = {},
): Extract<UUIClientMessage, { type: "screen.event" }> {
  return {
    type: "screen.event",
    protocol: UUI_PROTOCOL_VERSION,
    sessionId: "session-test",
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
