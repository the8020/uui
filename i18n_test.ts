import { assert, assertEquals } from "@std/assert";
import { field, fieldMetadata, z } from "/p/the8020/db/fields.ts";
import { context } from "@the8020/context";
import {
  Localization,
  messages,
  withLocalization,
} from "/p/the8020/i18n/mod.ts";
import {
  buildControls,
  buildFieldCatalog,
  prepareSchemaTexts,
} from "./fields.ts";
import { validateLayout } from "./layout.ts";
import { validationError } from "/p/the8020/i18n/validation.ts";
const m = messages("example/accounts");
const shared = field(z.string().min(1), {
  label: m("name"),
  description: m("help"),
});
const schema = z.object({ name: shared });
Deno.test("shared Zod fields resolve per session without mutation and keep element identities", async () => {
  let loads = 0;
  const results = await Promise.all(
    ["sk", "pt"].map((language) =>
      withLocalization(
        new Localization(language, {
          defaultLanguage: "en",
          languages: [{ code: "en", name: "English" }],
          fallbacks: {},
        }, (packageId, chain) => {
          loads++;
          return Promise.resolve({
            package: packageId,
            language: chain[0]!,
            texts: {
              name: language,
              help: `help-${language}`,
              "validation.required": `required-${language}`,
            },
          });
        }),
        async () => {
          await prepareSchemaTexts(schema);
          const fields = buildFieldCatalog(schema);
          const controls = buildControls(fields);
          const layout = validateLayout({
            schema: 1,
            id: "test",
            root: { type: "section", title: m("name") },
          });
          assertEquals(fields[0]!.label, language);
          assertEquals(layout.root.title, language);
          assertEquals(context.language, language);
          for (let i = 0; i < 100; i++) {
            await prepareSchemaTexts(schema);
            buildFieldCatalog(schema);
          }
          return { control: controls[0]!.id, region: layout.root.id };
        },
      )
    ),
  );
  assertEquals(loads, 2);
  assertEquals(results[0], results[1]);
  assertEquals(fieldMetadata(shared)?.label, m("name"));
  const invalid = schema.safeParse({ name: "" }, { error: validationError });
  assert(!invalid.success);
  assertEquals(invalid.error.issues[0]!.message, "Enter a value.");
});
