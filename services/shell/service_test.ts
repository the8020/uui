import { assertEquals, assertMatch } from "@std/assert";
import service from "./service.ts";

const context = {
  signal: new AbortController().signal,
  meta: {
    requestId: "request-shell",
    serviceId: "the8020/uui/shell",
    serviceGeneration: 1,
    canonicalBasePath: "/the8020/uui/shell",
    originalUrl: "https://the8020.example/the8020/uui/shell/",
    execution: {
      nodeId: "node-test",
      runtimeGroupId: "rgp-test",
      sandboxId: "sbx-test",
      workerId: "wrk-test",
      workerExecutionId: "execution-test",
    },
    auth: {
      authenticated: true,
      realm: "bootstrap-admin" as const,
      userId: "bootstrap-admin:Admin",
      username: "Admin",
      authVersion: 1,
    },
  },
};

Deno.test("shell emits only non-secret boot data and local assets", async () => {
  const response = await service.fetch(
    new Request("https://service/"),
    context,
  );
  const body = await response.text();
  assertEquals(response.status, 200);
  assertEquals(
    body.includes("wss://the8020.example/the8020/uui/session/connect"),
    true,
  );
  assertEquals(body.includes("the8020_auth"), false);
  assertEquals(body.includes("resumeToken"), false);
  assertEquals(body.includes('"heartbeatInterval":30000'), true);
  assertEquals(body.includes('"reconnectInitialDelay":250'), true);
  assertEquals(body.includes('"reconnectMaximumDelay":10000'), true);
  assertEquals(body.includes('<html lang="en" data-theme="dark">'), true);
  assertEquals(body.includes("<title>80|20</title>"), true);
  assertEquals(body.includes('id="theme-toggle"'), true);
  assertEquals(body.includes("theme-icon-sun"), false);
  assertEquals(body.includes("theme-icon-moon"), false);
  assertEquals(body.includes(">Light mode</button>"), false);
  assertEquals(body.includes(">Dark mode</button>"), false);
  assertEquals(body.includes('aria-label="80|20 platform session"'), true);
  assertEquals(body.includes('class="brand-gold"'), true);
  assertEquals(body.includes('class="brand-pipe"'), true);
  assertEquals(body.includes('id="screen-back"'), true);
  assertEquals(body.includes(">Back</button>"), false);
  assertEquals(body.includes('aria-label="Back"'), true);
  assertEquals(body.includes('id="program-header"'), true);
  assertEquals(body.includes('id="program-header-visible"'), true);
  assertEquals(body.includes('id="program-header-overflow"'), true);
  assertEquals(body.includes('id="program-header-overflow-toggle"'), true);
  assertEquals(body.includes('id="program-header-overflow-items"'), true);
  assertEquals(body.includes('id="interaction-shield"'), true);
  assertEquals(body.includes('class="interaction-indicator"'), true);
  assertEquals(body.includes('class="interaction-spinner"'), true);
  assertEquals(body.includes(">80</span>"), true);
  assertEquals(body.includes(">|</span><span"), true);
  assertEquals(body.includes("__the8020_theme_nonce__"), false);
  const initializerOffset = body.indexOf(
    "window.__the8020InitialThemeApplied",
  );
  const stylesheetOffset = body.indexOf(
    '<link rel="stylesheet" href="styles.css">',
  );
  assertEquals(
    initializerOffset >= 0 && initializerOffset < stylesheetOffset,
    true,
  );
  assertEquals(body.includes('"the8020.uui.theme:initial"'), true);
  const themeNonce = body.match(/<script nonce="([a-f0-9]{32})">/)?.[1];
  assertEquals(typeof themeNonce, "string");
  assertEquals(
    response.headers.get("content-security-policy")?.includes(
      `'nonce-${themeNonce}'`,
    ),
    true,
  );
  const browserClient = await service.fetch(
    new Request("https://service/main.js"),
    context,
  );
  assertEquals(browserClient.status, 200);
  assertEquals(
    browserClient.headers.get("content-type"),
    "text/javascript; charset=utf-8",
  );
  assertEquals(browserClient.headers.get("cache-control"), "no-cache");
  await browserClient.body?.cancel();
  const sourceMap = await service.fetch(
    new Request("https://service/main.js.map"),
    context,
  );
  assertEquals(sourceMap.status, 200);
  assertEquals(
    sourceMap.headers.get("content-type"),
    "application/json; charset=utf-8",
  );
  assertEquals(sourceMap.headers.get("cache-control"), "no-cache");
  await sourceMap.body?.cancel();
  const css = await service.fetch(
    new Request("https://service/styles.css"),
    context,
  );
  assertEquals(css.status, 200);
  assertEquals(css.headers.get("content-type"), "text/css; charset=utf-8");
  const cssBody = await css.text();
  assertEquals(cssBody.includes('html[data-theme="dark"]'), true);
  assertEquals(cssBody.includes("--primary: #5b5bd6"), true);
  assertEquals(cssBody.includes("--brand-gold: #cd9d00"), true);
  assertEquals(cssBody.includes("--interaction-feedback-delay: 500ms"), true);
  assertEquals(/\.notice\s*\{[^}]*border-left:/s.test(cssBody), false);
  assertMatch(
    cssBody,
    /html\[data-interaction-pending\] \.interaction-shield\s*\{[^}]*pointer-events:\s*auto;[^}]*backdrop-filter:\s*blur\(3px\);[^}]*transition-delay:\s*var\(--interaction-feedback-delay\);/s,
  );
  assertMatch(
    cssBody,
    /html\[data-interaction-pending\] \.interaction-indicator\s*\{[^}]*opacity:\s*1;[^}]*transition-delay:\s*var\(--interaction-feedback-delay\);/s,
  );
  assertMatch(
    cssBody,
    /\.brand\s*\{[^}]*min-height:\s*30px;[^}]*gap:\s*0;[^}]*color:\s*var\(--text\);[^}]*font-size:\s*30px;[^}]*font-weight:\s*600;[^}]*line-height:\s*30px;/s,
  );
  assertMatch(
    cssBody,
    /\.brand-gold\s*\{[^}]*color:\s*var\(--brand-gold\);/s,
  );
  assertMatch(
    cssBody,
    /\.brand-pipe\s*\{[^}]*position:\s*relative;[^}]*align-self:\s*stretch;[^}]*width:\s*0\.22em;[^}]*overflow:\s*hidden;[^}]*color:\s*transparent;/s,
  );
  assertMatch(
    cssBody,
    /\.brand-pipe::before\s*\{[^}]*position:\s*absolute;[^}]*inset-block-start:\s*50%;[^}]*inset-inline-start:\s*50%;[^}]*height:\s*24px;[^}]*border-inline-start:\s*3px solid var\(--text\);[^}]*translate:\s*-50% -50%;/s,
  );
  assertMatch(
    cssBody,
    /\.theme-toggle\s*\{[^}]*width:\s*32px;[^}]*min-width:\s*32px;[^}]*padding:\s*0;/s,
  );
  assertMatch(
    cssBody,
    /\.navbar-inner\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*auto minmax\(0, 1fr\) auto;[^}]*gap:\s*12px;/s,
  );
  assertMatch(
    cssBody,
    /\.navbar-leading\s*\{[^}]*grid-column:\s*1;[^}]*grid-row:\s*1;/s,
  );
  assertMatch(
    cssBody,
    /\.program-header\s*\{[^}]*grid-column:\s*2;[^}]*grid-row:\s*1;[^}]*min-width:\s*0;/s,
  );
  assertMatch(
    cssBody,
    /\.program-header-visible\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;[^}]*flex:\s*0 1 auto;[^}]*gap:\s*8px;[^}]*overflow:\s*hidden;/s,
  );
  assertMatch(
    cssBody,
    /\.program-header-visible:empty\s*\{[^}]*display:\s*none;/s,
  );
  assertMatch(
    cssBody,
    /\.navbar-actions\s*\{[^}]*grid-column:\s*3;[^}]*grid-row:\s*1;[^}]*justify-self:\s*end;/s,
  );
  assertMatch(
    cssBody,
    /\.program-header-overflow-items\s*\{[^}]*position:\s*absolute;[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 1fr\);[^}]*grid-auto-flow:\s*row;[^}]*overflow:\s*auto;[^}]*background:\s*var\(--surface\);[^}]*box-shadow:\s*var\(--shadow\);/s,
  );
  assertMatch(
    cssBody,
    /\.program-header-overflow-items\s*\{[^}]*--program-header-overflow-inline-shift:\s*0px;[^}]*inset-inline-end:\s*calc\(0px - var\(--program-header-overflow-inline-shift\)\);/s,
  );
  assertMatch(
    cssBody,
    /\.program-header \.program-header-overflow-items > \.program-header-item\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*100%;/s,
  );
  assertEquals(cssBody.includes("@media (max-width: 860px)"), false);
  assertMatch(
    cssBody,
    /\.material-icon\s*\{[^}]*--material-icon-size:\s*1\.2em;[^}]*width:\s*var\(--material-icon-size\);[^}]*height:\s*var\(--material-icon-size\);[^}]*flex:\s*0 0 var\(--material-icon-size\);[^}]*background-color:\s*currentColor;[^}]*mask:\s*var\(--material-icon-url\) center \/ contain no-repeat;[^}]*vertical-align:\s*middle;/s,
  );
  assertMatch(
    cssBody,
    /\.btn \.material-icon,\s*\.button \.material-icon,\s*button \.material-icon\s*\{[^}]*--material-icon-size:\s*1\.5em;/s,
  );
  assertMatch(
    cssBody,
    /\.screen-back \.material-icon,\s*\.program-header-overflow-toggle \.material-icon,\s*\.theme-toggle \.material-icon\s*\{[^}]*--material-icon-size:\s*20px;/s,
  );
  assertMatch(
    cssBody,
    /\.btn,\s*\.button\s*\{[^}]*display:\s*inline-flex;[^}]*align-items:\s*center;[^}]*gap:\s*0\.45em;/s,
  );
  for (
    const color of [
      "text",
      "muted",
      "primary",
      "success",
      "warning",
      "danger",
      "info",
      "brand",
    ]
  ) {
    assertEquals(cssBody.includes(`.material-icon-color-${color}`), true);
  }
  assertEquals(cssBody.includes(".brand-mark"), false);
  assertMatch(
    cssBody,
    /\*\s*\{[^}]*overscroll-behavior:\s*contain;/s,
  );
  assertMatch(
    cssBody,
    /\.screen\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*border:\s*0;[^}]*padding:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/s,
  );
  assertMatch(
    cssBody,
    /\.layout-section\s*\{[^}]*border:\s*0;[^}]*padding:\s*0;[^}]*background:\s*transparent;/s,
  );
  assertMatch(
    cssBody,
    /\.field > label,\s*\.field > legend\s*\{[^}]*overflow:\s*hidden;[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*max-width:\s*100%;[^}]*height:\s*var\(--field-grid-label-height, 1\.085rem\);[^}]*color:\s*var\(--muted\);[^}]*font-size:\s*0\.7em;[^}]*font-weight:\s*800;[^}]*letter-spacing:\s*0\.06em;[^}]*line-height:\s*var\(--field-grid-label-height, 1\.085rem\);[^}]*text-overflow:\s*ellipsis;[^}]*text-transform:\s*uppercase;[^}]*white-space:\s*nowrap;/s,
  );
  assertMatch(
    cssBody,
    /\.screen-title\s*\{[^}]*margin:\s*0;/s,
  );
  assertMatch(
    cssBody,
    /\.screen-description\s*\{[^}]*margin:\s*4px 0 32px;/s,
  );
  assertMatch(
    cssBody,
    /\.screen-title \+ :not\(\.screen-description\)\s*\{[^}]*margin-block-start:\s*32px;/s,
  );
  assertMatch(
    cssBody,
    /:root\s*\{[^}]*--section-card-gap:\s*24px;/s,
  );
  assertMatch(
    cssBody,
    /\.section-title\s*\{[^}]*margin:\s*0;/s,
  );
  assertMatch(
    cssBody,
    /\.layout-stack\s*\{[^}]*gap:\s*clamp\(32px, 4vw, 48px\);/s,
  );
  assertMatch(
    cssBody,
    /\.layout-section > \.layout-stack\s*\{[^}]*gap:\s*var\(--section-card-gap\);/s,
  );
  assertMatch(
    cssBody,
    /\.layout-grid\s*\{[^}]*column-gap:\s*16px;[^}]*row-gap:\s*var\(--section-card-gap\);/s,
  );
  assertMatch(
    cssBody,
    /\.layout-split\s*\{[^}]*column-gap:\s*16px;[^}]*row-gap:\s*var\(--section-card-gap\);/s,
  );
  assertMatch(
    cssBody,
    /\.layout-section\s*\{[^}]*gap:\s*var\(--section-card-gap\);[^}]*border:\s*0;/s,
  );
  assertMatch(
    cssBody,
    /\.layout-field-group,\s*\.layout-detail,\s*\.layout-list\s*\{[^}]*--group-radius:\s*14px;[^}]*--group-padding-inline-start:\s*0\.78rem;[^}]*--group-padding-inline-end:\s*1\.5rem;[^}]*border:\s*1px[^}]*border-radius:\s*var\(--group-radius\);[^}]*padding:\s*16px var\(--group-padding-inline-end\) 16px\s*var\(--group-padding-inline-start\);[^}]*background:\s*var\(--surface\);[^}]*box-shadow:/s,
  );
  assertEquals(cssBody.includes("box-shadow: var(--shadow)"), true);
  assertMatch(
    cssBody,
    /html\[data-theme="dark"\]\s*\{[^}]*--shadow:\s*0 18px 45px rgb\(0 0 0 \/ 28%\);/s,
  );
  assertMatch(
    cssBody,
    /\.field input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\):not\(\[type="range"\]\),\s*\.field textarea,\s*\.field select\s*\{[^}]*border:\s*0;[^}]*border-bottom:\s*1px solid var\(--border\);[^}]*padding:\s*0;[^}]*background:\s*transparent;/s,
  );
  assertMatch(
    cssBody,
    /\.field :is\(input, textarea, select\):disabled,\s*\.field :is\(input, textarea\)\[readonly\]\s*\{[^}]*color:\s*var\(--text\);[^}]*-webkit-text-fill-color:\s*var\(--text\);[^}]*opacity:\s*1;[^}]*cursor:\s*default;/s,
  );
  assertMatch(
    cssBody,
    /\.field-has-edit-affordance input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\):not\(\[type="range"\]\),\s*\.field-has-edit-affordance textarea,\s*\.field-has-edit-affordance select\s*\{[^}]*padding-inline-end:\s*1\.8rem;/s,
  );
  assertMatch(
    cssBody,
    /\.field:is\([\s\S]*?\[data-control-kind="checkbox"\],[\s\S]*?\[data-control-kind="switch"\][\s\S]*?\) \.field-input-shell\s*\{[^}]*display:\s*flex;[^}]*min-height:\s*var\(--field-grid-control-height, 38px\);[^}]*border-bottom:\s*1px solid var\(--border\);/s,
  );
  assertMatch(
    cssBody,
    /\.field\[data-control-kind="range"\] \.field-input-shell\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*auto minmax\(0, 1fr\);[^}]*border-bottom:\s*1px solid var\(--border\);/s,
  );
  assertMatch(
    cssBody,
    /\.field\[data-control-kind="range"\]\.field-has-edit-affordance \.field-input-shell,\s*\.field-radio\.field-has-edit-affordance \.field-input-shell\s*\{[^}]*padding-inline-end:\s*1\.8rem;/s,
  );
  assertMatch(
    cssBody,
    /\.field input\[type="range"\]\s*\{[^}]*--range-thumb-size:\s*0\.875rem;[^}]*appearance:\s*none;[^}]*width:\s*100%;[^}]*linear-gradient\([^}]*--range-progress[^}]*center\s*\/\s*calc\(100% - var\(--range-thumb-size\)\) 3px no-repeat;[^}]*accent-color:\s*var\(--primary\);/s,
  );
  assertMatch(
    cssBody,
    /\.field input\[type="range"\]::-webkit-slider-thumb\s*\{[^}]*box-sizing:\s*border-box;[^}]*width:\s*var\(--range-thumb-size\);[^}]*height:\s*var\(--range-thumb-size\);/s,
  );
  assertMatch(
    cssBody,
    /\.field input\[type="range"\]::-moz-range-thumb\s*\{[^}]*box-sizing:\s*border-box;[^}]*width:\s*var\(--range-thumb-size\);[^}]*height:\s*var\(--range-thumb-size\);/s,
  );
  assertMatch(
    cssBody,
    /\.field-range-value\s*\{[^}]*font-variant-numeric:\s*tabular-nums;[^}]*text-align:\s*end;/s,
  );
  assertMatch(
    cssBody,
    /\.field\[data-control-kind="select"\] select\s*\{[^}]*appearance:\s*none;/s,
  );
  assertMatch(
    cssBody,
    /\.field-select-icon\s*\{[^}]*inset-inline-end:\s*0;[^}]*pointer-events:\s*none;/s,
  );
  assertMatch(
    cssBody,
    /\.field-has-edit-affordance \.field-select-icon\s*\{[^}]*inset-inline-end:\s*1\.45rem;/s,
  );
  assertMatch(
    cssBody,
    /\.field-edit-icon\s*\{[^}]*inset-inline-end:\s*0;[^}]*mask-size:\s*1\.2rem 1\.2rem;[^}]*pointer-events:\s*none;/s,
  );
  assertMatch(
    cssBody,
    /\.field\[data-control-kind="textarea"\] \.field-edit-icon\s*\{[^}]*inset-block-start:\s*auto;[^}]*inset-block-end:\s*calc\(19px - 0\.45rem\);/s,
  );
  assertEquals(cssBody.includes("::-webkit-inner-spin-button"), false);
  assertMatch(
    cssBody,
    /\.group-title\s*\{[^}]*position:\s*absolute;[^}]*inset-inline-start:\s*-1px;[^}]*border-radius:\s*10px 20px 0 0;[^}]*padding:\s*0\.28rem var\(--group-padding-inline-end\) 0\.28rem\s*var\(--group-padding-inline-start\);[^}]*background:\s*var\(--surface\);[^}]*font-size:\s*1rem;[^}]*font-weight:\s*600;[^}]*text-align:\s*left;[^}]*translate:\s*0 -50%;/s,
  );
  assertMatch(
    cssBody,
    /@media \(max-width:\s*680px\)[\s\S]*?\.layout-field-group,\s*\.layout-detail,\s*\.layout-list\s*\{[^}]*padding:\s*13px var\(--group-padding-inline-end\) 13px\s*var\(--group-padding-inline-start\);/s,
  );
  assertMatch(
    cssBody,
    /\.group-title::before\s*\{[^}]*border:\s*1px solid var\(--group-border-color\);[^}]*border-bottom:\s*0;[^}]*border-radius:\s*inherit;[^}]*clip-path:\s*inset\(0 0 50% 0\);/s,
  );
  assertMatch(
    cssBody,
    /\.group-title::after\s*\{[^}]*inset-block:\s*50% 0;[^}]*inset-inline-start:\s*0;[^}]*border-inline-start:\s*1px solid var\(--group-border-color\);/s,
  );
  assertEquals(cssBody.includes("./assets/material-"), false);
  assertEquals(cssBody.includes("@font-face"), false);
  assertEquals(cssBody.includes("transition: transform"), false);
  assertEquals(cssBody.includes("transform: translateY"), false);
  assertEquals(
    cssBody.includes("@container field-group (min-width: 480px)"),
    true,
  );
  assertEquals(
    cssBody.includes("@container field-group (min-width: 850px)"),
    true,
  );
  assertEquals(
    cssBody.includes(
      "grid-template-columns: repeat(8, minmax(0, 1fr))",
    ),
    true,
  );
  assertEquals(
    cssBody.includes("grid-column: var(--field-grid-desktop-column)"),
    true,
  );
  assertMatch(
    cssBody,
    /\.field-group-fields\s*\{[^}]*--field-grid-label-height:\s*1\.085rem;[^}]*--field-grid-control-height:\s*38px;[^}]*--field-grid-message-line-height:\s*0\.9rem;[^}]*--field-grid-message-gap:\s*4px;[^}]*--field-grid-message-slot-height:\s*calc\([^}]*--field-grid-row-height:\s*calc\([^}]*--field-grid-gap:\s*20px;[^}]*align-items:\s*stretch;[^}]*gap:\s*var\(--field-grid-gap\);/s,
  );
  assertMatch(
    cssBody,
    /\.field\s*\{[^}]*gap:\s*0;[^}]*padding:\s*0;/s,
  );
  assertMatch(
    cssBody,
    /\.field-group-fields-exact-rows\s*\{[^}]*grid-auto-rows:\s*var\(--field-grid-row-height\);/s,
  );
  assertMatch(
    cssBody,
    /\.field-group-fields-exact-rows\s*>\s*\.field:not\(\.field-radio\)\s*\{[^}]*grid-template-rows:\s*var\(--field-grid-label-height\) minmax\(0, 1fr\)\s*var\(--field-grid-message-slot-height\);/s,
  );
  assertMatch(
    cssBody,
    /\.field-message\s*\{[^}]*height:\s*var\(--field-grid-message-slot-height, 1\.15rem\);[^}]*padding-block-start:\s*var\(--field-grid-message-gap, 4px\);[^}]*line-height:\s*var\(--field-grid-message-line-height, 0\.9rem\);/s,
  );
  assertMatch(
    cssBody,
    /\.field-message-text\s*\{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*user-select:\s*text;[^}]*white-space:\s*nowrap;[^}]*cursor:\s*text;/s,
  );
  assertMatch(
    cssBody,
    /\.field-message-trigger\s*\{[^}]*text-decoration:\s*underline dotted;[^}]*user-select:\s*none;[^}]*cursor:\s*help;/s,
  );
  assertMatch(
    cssBody,
    /\.field-message-popover\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*auto;[^}]*max-width:\s*min\(28rem, calc\(100vw - 20px\)\);[^}]*margin:\s*0;[^}]*overflow-wrap:\s*anywhere;/s,
  );
  assertMatch(
    cssBody,
    /\.program-header \.field\s*\{[^}]*--field-grid-label-height:\s*0\.85rem;[^}]*width:\s*12rem;/s,
  );
  assertMatch(
    cssBody,
    /\.field-group-fields-exact-rows[\s\S]*?>\s*\.field\[data-control-kind="textarea"\] textarea\s*\{[^}]*height:\s*100%;[^}]*min-height:\s*0;/s,
  );
  assertMatch(
    cssBody,
    /\.field textarea\s*\{[^}]*min-height:\s*6rem;[^}]*resize:\s*none;/s,
  );
  assertMatch(
    cssBody,
    /\.field input\[type="checkbox"\]\s*\{[^}]*appearance:\s*none;[^}]*display:\s*block;[^}]*height:\s*1\.25rem;[^}]*border:\s*1px solid var\(--border\);[^}]*background:\s*transparent;/s,
  );
  assertMatch(
    cssBody,
    /\.field input\[type="checkbox"\]:checked\s*\{[^}]*border-color:\s*var\(--primary\);[^}]*background:\s*var\(--primary\);/s,
  );
  assertMatch(
    cssBody,
    /\.field-radio \.field-input-shell\s*\{[^}]*display:\s*grid;[^}]*border-bottom:\s*1px solid var\(--border\);/s,
  );
  assertMatch(
    cssBody,
    /\.field-radio input\[type="radio"\]\s*\{[^}]*appearance:\s*none;[^}]*border:\s*1px solid var\(--border\);[^}]*border-radius:\s*50%;/s,
  );

  const staticAssets = [
    ["material-edit-24-a4b3c9f6.svg", 400, "M3 17.25V21h3.75"],
    ["material-light-mode-24-e5b6e132.svg", 1_000, "M12 7c-2.76"],
    ["material-dark-mode-24-bab57d17.svg", 400, "M12 3c-4.97"],
    ["material-arrow-back-24-e083cc60.svg", 300, "M20 11H7.83"],
    ["material-arrow-drop-down-24-e083cc60.svg", 250, "M7 10l5 5"],
    ["material-more-vert-24-e083cc60.svg", 400, "M12 8c1.1"],
    ["material-refresh-24-e083cc60.svg", 500, "M17.65 6.35"],
    ["material-save-24-e083cc60.svg", 500, "M17 3H5"],
  ] as const;
  for (const [name, maximumLength, marker] of staticAssets) {
    const asset = await service.fetch(
      new Request(`https://service/assets/${name}`),
      context,
    );
    assertEquals(asset.status, 200);
    assertEquals(asset.headers.get("content-type"), "image/svg+xml");
    assertEquals(
      asset.headers.get("cache-control"),
      "public, max-age=31536000, immutable",
    );
    const assetBody = await asset.text();
    assertEquals(assetBody.length < maximumLength, true);
    assertEquals(assetBody.includes(marker), true);
  }
  const rejectedAsset = await service.fetch(
    new Request("https://service/assets/not-an-icon.txt"),
    context,
  );
  assertEquals(rejectedAsset.status, 404);
  const rejectedSource = await service.fetch(
    new Request("https://service/frontend/main.ts"),
    context,
  );
  assertEquals(rejectedSource.status, 404);
  const rejectedTraversal = await service.fetch(
    new Request("https://service/assets/%2e%2e%2fstyles.css"),
    context,
  );
  assertEquals(rejectedTraversal.status, 404);
});
