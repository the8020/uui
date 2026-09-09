import { assert, assertEquals, assertNotEquals } from "@std/assert";
import type { NativeBrowserFixtureContext } from "./browser_e2e.ts";

/** Real entity field help and independent tabs sharing one authentication cookie. */
export default async function verify(context: NativeBrowserFixtureContext) {
  const { page, baseURL, clickRow, clickButton, waitForScreen, waitForPage } =
    context;
  const closeHelp = () =>
    context.click(
      page,
      "dialog[open]:not([inert]) .presentation-modal-close",
    );
  const readOnlyHelp = async (label: string) => {
    await clickButton(page, `View ${label}: field help`);
    await waitForScreen(page, label);
    await waitForPage(
      page,
      `(() => {
        const help = document.querySelector('dialog[open]:not([inert])');
        return help?.querySelector('[data-bind="value"]')?.readOnly &&
          help.querySelector('[aria-label="Search list"]') &&
          [...help.querySelectorAll('button')].some(button => button.textContent === 'Navigate') &&
          ![...help.querySelectorAll('button')].some(button => button.textContent === 'Done');
      })()`,
      `${label} retains lookup and navigation without editing`,
    );
  };
  await clickRow(page, "the8020/admin-core/services");
  await waitForScreen(page, "Services");
  await clickRow(page, "the8020/uui/shell");
  await waitForScreen(page, "Service shell");
  await readOnlyHelp("Package");
  await clickButton(page, "Navigate");
  await waitForScreen(page, "Package the8020/uui");
  await clickButton(page, "Advanced");
  await waitForScreen(page, "Advanced · the8020/uui");
  await readOnlyHelp("Package");
  await closeHelp();
  await waitForScreen(page, "Advanced · the8020/uui");
  await clickButton(page, "Back");
  await waitForScreen(page, "Package the8020/uui");
  await clickButton(page, "Back");
  await waitForScreen(page, "Package");
  await closeHelp();
  await waitForScreen(page, "Service shell");
  await clickButton(page, "Advanced");
  await waitForScreen(page, "Advanced · shell");
  await readOnlyHelp("Service");
  await closeHelp();
  await waitForScreen(page, "Advanced · shell");
  await clickButton(page, "Back");
  await waitForScreen(page, "Service shell");
  await clickButton(page, "Configure");
  await waitForScreen(page, "Configure shell");
  await clickButton(page, "Edit Public execution user: field help");
  await waitForScreen(page, "Public execution user");
  await waitForPage(
    page,
    `document.querySelector('dialog[open] [aria-label="Search list"]') !== null`,
    "user value help is searchable",
  );
  await clickRow(page, "admin");
  await waitForPage(
    page,
    `document.querySelector('dialog[open] [data-bind="value"]')?.value === 'admin'`,
    "user choice updates the help draft",
  );
  await clickButton(page, "Navigate");
  await waitForScreen(page, "User admin");
  await readOnlyHelp("User");
  await closeHelp();
  await waitForScreen(page, "User admin");
  await clickButton(page, "Back");
  await waitForScreen(page, "Public execution user");
  await closeHelp();
  await waitForScreen(page, "Configure shell");

  const session = (client: typeof page) => {
    const message = client.websocketFrames.map((frame) => {
      try {
        return JSON.parse(frame.payloadData);
      } catch {
        return {};
      }
    }).findLast((message) => message.sessionId);
    assert(message?.sessionId, "session identity missing from WebSocket");
    return message.sessionId as string;
  };
  const original = session(page);
  const second = await context.openPage();
  await waitForScreen(second, "Welcome to 80|20");
  assertNotEquals(
    session(second),
    original,
    "a new tab creates its own session",
  );
  await waitForScreen(page, "Configure shell");
  await page.command("Page.reload");
  await waitForScreen(page, "Configure shell");
  assertEquals(session(page), original, "reload retains this tab's session");
  assertEquals(
    await page.evaluate(`new URL(location.href).searchParams.has('session')`),
    false,
  );

  await second.command("Page.navigate", {
    url: `${baseURL}/the8020/uui/shell/?session=${original}`,
  });
  await waitForScreen(second, "Configure shell");
  await waitForPage(
    page,
    `document.querySelector('.uui-control-dialog')?.open === true`,
    "an explicit session link takes control",
  );
  await second.command("Page.navigate", { url: "about:blank" });
  await waitForScreen(page, "Configure shell", 15_000);
}
