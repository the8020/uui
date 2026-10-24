import { assert, assertEquals } from "@std/assert";
import type { NativeBrowserFixtureContext } from "./browser_e2e.ts";

/** Installed package, real authentication/SQL, and both native service nodes. */
export default async function verify(context: NativeBrowserFixtureContext) {
  const {
    page,
    baseURL,
    otherNodeURL,
    clickRow,
    clickButton,
    waitForScreen,
    waitForPage,
  } = context;
  const publicAsset = async (origin: string, name: string) => {
    const response = await fetch(
      `${origin}/the8020/uui/login/branding/${name}`,
    );
    assertEquals(response.status, 200);
    assertEquals(response.headers.get("x-content-type-options"), "nosniff");
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert(bytes.length > 0);
    return bytes;
  };
  const defaultIcon = await publicAsset(baseURL, "favicon.png");
  const defaultSocial = await publicAsset(baseURL, "social.jpg");
  assert(defaultIcon.length < 4096);
  assert(defaultSocial.length < 50_000);
  const initial = await fetch(`${baseURL}/the8020/uui/login/`);
  assert((await initial.text()).includes('property="og:image"'));
  await clickRow(page, "the8020/uui/system-customization");
  await waitForScreen(page, "System customization");
  await context.setValue(page, '[data-bind="title"]', "Native branding");
  await page.evaluate(`(async () => {
    const canvas = new OffscreenCanvas(180,100);
    const ctx = canvas.getContext('2d'); ctx.fillStyle='#ff8000'; ctx.fillRect(0,0,180,100);
    const blob = await canvas.convertToBlob({type:'image/webp'});
    for (const input of document.querySelectorAll('input[type=file]')) {
      const files = new DataTransfer(); files.items.add(new File([blob], 'custom.webp', {type:'image/webp'}));
      input.files=files.files; input.dispatchEvent(new Event('change',{bubbles:true}));
    }
  })()`);
  await waitForPage(
    page,
    `Array.from(document.querySelectorAll('input[type=file]')).every(input=>!input.disabled)`,
    "converted uploads",
  );
  await clickButton(page, "Save");
  await waitForPage(
    page,
    `document.title === 'Native branding System customization'`,
    "custom server title",
  );
  const customIcon = await publicAsset(baseURL, "favicon.png");
  const customSocial = await publicAsset(baseURL, "social.jpg");
  assertEquals(customIcon.slice(0, 4), new Uint8Array([137, 80, 78, 71]));
  assertEquals(customSocial.slice(0, 2), new Uint8Array([255, 216]));
  assertEquals(await publicAsset(otherNodeURL, "favicon.png"), customIcon);
  assertEquals(await publicAsset(otherNodeURL, "social.jpg"), customSocial);
  const login = await fetch(`${otherNodeURL}/the8020/uui/login/`);
  assert(
    (await login.text()).includes("<title>Native branding Sign in</title>"),
  );
  await page.command("Page.reload");
  await waitForScreen(page, "System customization");
  await waitForPage(
    page,
    `document.title === 'Native branding System customization'`,
    "title survives reload",
  );
  for (
    const label of [
      "Use default title",
      "Use default favicon",
      "Use default preview",
    ]
  ) {
    await clickButton(page, label);
    await waitForScreen(page, "System customization");
  }
  await clickButton(page, "Save");
  await waitForPage(
    page,
    `document.title === '80|20 System customization'`,
    "default title restored",
  );
  assertEquals(await publicAsset(baseURL, "favicon.png"), defaultIcon);
  assertEquals(await publicAsset(baseURL, "social.jpg"), defaultSocial);
  console.log(
    "Native branding passed: defaults, WebP conversion, database images, public/cross-node delivery, titles, reload, and reset",
  );
}
