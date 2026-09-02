import { assertEquals, assertStringIncludes } from "@std/assert";
import { renderMarkdownHTML } from "./markdown.ts";

Deno.test("UUI Markdown renders headings, tables, lists, and inline text", () => {
  const html = renderMarkdownHTML(`# Result

**Saved** with \`code\`.

| Package | State |
| --- | --- |
| demo | ready |

- first
- second
`);
  assertStringIncludes(html, "<h1>Result</h1>");
  assertStringIncludes(html, "<strong>Saved</strong>");
  assertStringIncludes(html, "<code>code</code>");
  assertStringIncludes(html, "<table>");
  assertStringIncludes(html, "<th>Package</th>");
  assertStringIncludes(html, "<li>first</li>");
});

Deno.test("UUI Markdown escapes HTML and rejects executable links and images", () => {
  const html = renderMarkdownHTML(
    `<script>alert("no")</script>\n\n[unsafe](javascript:alert(1))\n\n![remote](https://example.test/a.png)`,
  );
  assertEquals(html.includes("<script>"), false);
  assertStringIncludes(html, "&lt;script&gt;");
  assertEquals(html.includes('href="javascript:'), false);
  assertEquals(html.includes("<img"), false);
});
