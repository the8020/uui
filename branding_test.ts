import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  fetchBranding,
  fetchBrandingImage,
  saveBranding,
  validateBrandingImage,
} from "./branding.ts";
import { brandingDatabase } from "./branding_test_support.ts";
import { brandingAsset, brandingHead } from "./services/shell/branding.ts";
import { convertBrandingImage } from "./src/branding_conversion.ts";

Deno.test("system branding stores only overrides, validates images, checks authority, and serves public assets", async () => {
  const fixture = await brandingDatabase();
  const icon = await Deno.readFile(
    new URL("./services/shell/frontend/default-favicon.png", import.meta.url),
  );
  const social = await Deno.readFile(
    new URL("./services/shell/frontend/default-social.jpg", import.meta.url),
  );
  const logo = await convertBrandingImage("logo", social);
  try {
    assertEquals(await fetchBranding(), {
      title: "80|20",
      revision: "default",
      logo: null,
    });
    assertEquals(await fetchBrandingImage("favicon"), null);
    assertEquals(
      (await brandingAsset(new Request("https://test/branding/logo.png")))
        ?.status,
      404,
    );
    assertEquals(
      fixture.database.prepare(
        "select count(*) as n from the8020__uui__branding",
      ).get()?.n,
      0,
    );
    validateBrandingImage("favicon", icon);
    validateBrandingImage("social", social);
    for (const kind of ["favicon", "social"] as const) {
      assertThrows(() =>
        validateBrandingImage(
          kind,
          new TextEncoder().encode("<svg onload='alert(1)'></svg>"),
        )
      );
      assertThrows(() =>
        validateBrandingImage(kind, new Uint8Array(1_048_577))
      );
      assertThrows(() =>
        validateBrandingImage(kind, kind === "favicon" ? social : icon)
      );
    }
    const wrongSize = icon.slice();
    wrongSize[19] = 63;
    assertThrows(() => validateBrandingImage("favicon", wrongSize));
    const request = new Request("https://test/branding/favicon.png?v=default");
    const defaultResponse = await brandingAsset(request);
    assertEquals(defaultResponse?.status, 200);
    assertEquals(new Uint8Array(await defaultResponse!.arrayBuffer()), icon);
    assertEquals(
      await brandingAsset(new Request("https://test/branding/private.txt")),
      undefined,
    );
    await saveBranding({ title: ' Acme <&" > ', favicon: icon, social, logo });
    assertEquals(await fetchBrandingImage("logo"), logo);
    assertEquals(
      (await fetchBranding()).logo?.startsWith(
        "/the8020/uui/login/branding/logo.png?v=",
      ),
      true,
    );
    assertEquals(
      (await brandingAsset(new Request("https://test/branding/logo.png")))
        ?.headers.get("content-type"),
      "image/png",
    );
    assertEquals(await fetchBrandingImage("favicon"), icon);
    assertEquals(await fetchBrandingImage("social"), social);
    const saved = await fetchBranding();
    assertEquals(saved.title, 'Acme <&" >');
    const markup = brandingHead(
      saved,
      "https://public.example/the8020/uui/shell/?session=secret",
    );
    assertEquals(markup.includes("Acme &lt;&amp;&quot; &gt;"), true);
    assertEquals(
      markup.includes(
        "https://public.example/the8020/uui/login/branding/social.jpg?v=",
      ),
      true,
    );
    assertEquals(markup.includes("session=secret"), false);
    assertEquals(
      markup.includes('name="twitter:card" content="summary_large_image"'),
      true,
    );
    const response = await brandingAsset(request);
    assertEquals(response?.headers.get("content-type"), "image/png");
    assertEquals(response?.headers.get("cache-control"), "no-cache");
    const etag = response!.headers.get("etag")!;
    assertEquals(new Uint8Array(await response!.arrayBuffer()), icon);
    const unchanged = await brandingAsset(
      new Request(request, { headers: { "if-none-match": etag } }),
    );
    assertEquals(unchanged?.status, 304);
    assertEquals(await unchanged?.text(), "");
    const head = await brandingAsset(new Request(request, { method: "HEAD" }));
    assertEquals(head?.status, 200);
    assertEquals(await head?.text(), "");
    await saveBranding({ title: "Renamed" });
    assertEquals(await fetchBrandingImage("logo"), logo);
    assertEquals(await fetchBrandingImage("favicon"), icon);
    assertEquals(await fetchBrandingImage("social"), social);
    await assertRejects(() => saveBranding({ title: "" }));
    await assertRejects(() => saveBranding({ title: "Bad", social: icon }));
    assertEquals((await fetchBranding()).title, "Renamed");
    fixture.user("unauthorized");
    await assertRejects(
      () => saveBranding({ title: "Denied" }),
      Error,
      "Permission denied",
    );
    assertEquals((await fetchBranding()).title, "Renamed");
    fixture.user("system");
    await saveBranding({
      title: "80|20",
      favicon: null,
      social: null,
      logo: null,
    });
    assertEquals((await fetchBranding()).logo, null);
    assertEquals(await fetchBrandingImage("favicon"), null);
    assertEquals(await fetchBrandingImage("social"), null);
  } finally {
    fixture.close();
  }
});
