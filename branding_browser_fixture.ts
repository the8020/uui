import { assertEquals } from "@std/assert";
import { brandingDatabase } from "./branding_test_support.ts";
import { fetchBranding, fetchBrandingImage } from "./branding.ts";
import { callScreen, Model, z } from "./mod.ts";

interface Browser {
  evaluate<T>(expression: string): Promise<T>;
  command(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

export default async function fixture() {
  const database = await brandingDatabase();
  const { default: systemCustomization } = await import(
    "./programs/system-customization/program.ts"
  );
  const { default: shell } = await import("./services/shell/service.ts");
  const { default: login } = await import("./services/login/service.ts");
  return {
    close() {
      database.close();
      return Promise.resolve();
    },
    async run() {
      while (true) {
        await systemCustomization();
        await callScreen({
          id: "returned",
          title: "Returned",
          model: new Model({}),
          schema: z.object({}),
          actions: [{ id: "open", label: "Open customization" }],
        });
      }
    },
    async serve(request: Request) {
      const url = new URL(request.url);
      const publicPage = url.pathname.startsWith("/the8020/uui/login/");
      const base = publicPage ? "/the8020/uui/login" : "/the8020/uui/shell";
      if (
        url.pathname !== "/" && !url.pathname.startsWith(base + "/") &&
        !["/main.js", "/styles.css", "/markdown.css"].includes(url.pathname)
      ) return undefined;
      const originalUrl = url.href;
      url.pathname = url.pathname.slice(
        url.pathname.startsWith(base) ? base.length : 0,
      );
      const response = await (publicPage ? login : shell).fetch(
        new Request(url, request),
        {
          signal: request.signal,
          meta: {
            contextId: "test",
            serviceId: `the8020/uui/${publicPage ? "login" : "shell"}`,
            serviceGeneration: 1,
            canonicalBasePath: base,
            originalUrl,
            client: { ipAddress: "127.0.0.1", networkScope: "loopback" },
            execution: { nodeId: "test", sandboxId: "test", workerId: "test" },
            user: { userId: "user:system", username: "system" },
            auth: { authenticated: !publicPage },
          },
        },
      );
      if (!publicPage && url.pathname === "/") {
        const body = (await response.text()).replace(
          /"websocketUrl":"[^"]+"/,
          `"websocketUrl":"ws://${url.host}/session"`,
        );
        return new Response(body, {
          headers: response.headers,
          status: response.status,
        });
      }
      return response;
    },
    async verify(page: Browser) {
      const wait = async (expression: string) => {
        const end = Date.now() + 10_000;
        while (!await page.evaluate(expression)) {
          if (Date.now() > end) throw new Error(`Timed out: ${expression}`);
          await new Promise((resolve) => setTimeout(resolve, 30));
        }
      };
      const ready = () =>
        wait(
          `document.querySelector('.screen-title')?.textContent === 'System customization' && document.querySelectorAll('input[type=file]').length === 2 && !document.querySelector('#screen-back').disabled`,
        );
      const click = async (id: string) => {
        await page.evaluate(
          `document.querySelector('[data-element-id="${id}"]').click()`,
        );
        await wait(`!document.querySelector('#screen-back').disabled`);
      };
      const title = async (value: string) => {
        await page.evaluate(
          `(() => { const input = document.querySelector('[data-bind=title]'); input.value = ${
            JSON.stringify(value)
          }; input.dispatchEvent(new Event('input', { bubbles: true })); })()`,
        );
      };
      const upload = async (index: number, invalid = false) => {
        await page.evaluate(`(async () => {
          const canvas = new OffscreenCanvas(300, 100);
          const context = canvas.getContext('2d');
          context.fillStyle = '#ff0000'; context.fillRect(0,0,100,100);
          context.fillStyle = '#00ff00'; context.fillRect(100,0,100,100);
          context.fillStyle = '#0000ff'; context.fillRect(200,0,100,100);
          const blob = ${
          invalid
            ? "new Blob(['not an image'])"
            : "await canvas.convertToBlob({type:'image/png'})"
        };
          const files = new DataTransfer(); files.items.add(new File([blob], 'landscape.png', {type:'image/png'}));
          const input = document.querySelectorAll('input[type=file]')[${index}];
          input.files = files.files; input.dispatchEvent(new Event('change', {bubbles:true}));
        })()`);
        await wait(
          `!document.querySelectorAll('input[type=file]')[${index}]?.disabled`,
        );
      };
      await ready();
      await wait(`document.title === '80|20 System customization'`);
      await wait(
        `Array.from(document.querySelectorAll('img')).every(img => img.complete && img.naturalWidth > 0)`,
      );
      await title("My server");
      await upload(0);
      await upload(1);
      await click("save");
      await wait(`document.title === 'My server System customization'`);
      assertEquals((await fetchBranding()).title, "My server");
      assertEquals(
        (await fetchBrandingImage("favicon"))!.length < 32_768,
        true,
      );
      const images = await page.evaluate<
        { width: number; height: number; pixel: number[]; social: number[] }
      >(`(async () => {
        const bitmap = await createImageBitmap(await (await fetch('/the8020/uui/login/branding/favicon.png')).blob());
        const canvas = new OffscreenCanvas(64,64); const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap,0,0);
        const social = await createImageBitmap(await (await fetch('/the8020/uui/login/branding/social.jpg')).blob());
        return {width:bitmap.width,height:bitmap.height,pixel:[...ctx.getImageData(4,4,1,1).data],social:[social.width,social.height]};
      })()`);
      assertEquals(images, {
        width: 64,
        height: 64,
        pixel: [0, 255, 0, 255],
        social: [1200, 630],
      });
      const loginHTML = await page.evaluate<string>(
        `fetch('/the8020/uui/login/').then(r=>r.text())`,
      );
      assertEquals(
        loginHTML.includes("<title>My server Sign in</title>"),
        true,
      );
      assertEquals(loginHTML.includes('property="og:image"'), true);
      await upload(0, true);
      await wait(
        `document.body.textContent.includes('Choose an image your browser can open.')`,
      );
      await title("Cancelled");
      await page.evaluate(`document.querySelector('#screen-back').click()`);
      await wait(
        `document.querySelector('.screen-title')?.textContent === 'Returned'`,
      );
      assertEquals((await fetchBranding()).title, "My server");
      await click("open");
      await ready();
      // Returning from one default action retains an upload for the other image.
      await upload(0);
      await click("default-social");
      await ready();
      await click("save");
      await ready();
      assertEquals(await fetchBrandingImage("social"), null);
      assertEquals(await fetchBrandingImage("favicon") !== null, true);
      await click("default-title");
      await ready();
      await click("default-favicon");
      await ready();
      await click("save");
      await ready();
      await wait(`document.title === '80|20 System customization'`);
      assertEquals(await fetchBrandingImage("favicon"), null);
      await page.command("Emulation.setDeviceMetricsOverride", {
        width: 390,
        height: 844,
        deviceScaleFactor: 1,
        mobile: true,
      });
      await wait(`document.documentElement.scrollWidth <= innerWidth`);
      assertEquals(
        await page.evaluate(
          `Array.from(document.querySelectorAll('img')).every(img => img.getBoundingClientRect().right <= innerWidth)`,
        ),
        true,
      );
      const screenshot = await page.command("Page.captureScreenshot", {
        format: "png",
      }) as { data: string };
      await Deno.writeFile(
        "/tmp/8020-system-customization-mobile.png",
        Uint8Array.fromBase64(screenshot.data),
      );
    },
  };
}
