import { assertEquals, assertRejects } from "@std/assert";
import {
  discoverPrograms,
  invokeProgram,
  ProgramExecutionError,
  readProgramManifest,
  validProgramID,
} from "/p/the8020/uui/mod.ts";

Deno.test("home discovers canonical visible program manifests", async () => {
  const root = await Deno.makeTempDir({ prefix: "the8020-discovery-test-" });
  try {
    for (
      const repository of [
        "uui",
        "admin-core",
        "admin-db",
        "demo",
        "dev-core",
        "jobs",
      ]
    ) {
      const source = new URL(`../../${repository}/programs`, import.meta.url)
        .pathname;
      await copyDirectory(source, `${root}/the8020/${repository}/programs`);
    }
    const programs = await discoverPrograms(root);
    assertEquals(
      programs.some((item) => item.id === "the8020/demo/demo-form"),
      true,
    );
    assertEquals(
      programs.some((item) => item.id === "the8020/demo/demo-master-detail"),
      true,
    );
    assertEquals(
      programs.some((item) =>
        item.id === "the8020/demo/demo-responsive-fields"
      ),
      true,
    );
    assertEquals(
      programs.some((item) => item.id === "the8020/uui/sessions"),
      true,
    );
    assertEquals(
      programs.some((item) => item.id === "the8020/admin-core/sessions"),
      false,
    );
    assertEquals(
      programs.some((item) => item.id === "the8020/admin-core/packages"),
      true,
    );
    assertEquals(
      programs.some((item) => item.id === "the8020/admin-db/database"),
      true,
    );
    assertEquals(
      programs.some((item) => item.id === "the8020/uui/home"),
      false,
    );
    assertEquals(
      programs.some((item) => item.id === "the8020/uui/program-terminated"),
      false,
    );
    const manifest = await readProgramManifest(
      `${root}/the8020/uui/programs/home/program.toml`,
    );
    assertEquals(manifest.entrypoint, "program.ts");
    assertEquals(manifest.discoverable, false);
    assertEquals(manifest.uui, true);
    assertEquals(
      programs.some((item) => item.id === "the8020/admin-core/programs"),
      true,
    );
    assertEquals(
      programs.some((item) => item.id === "the8020/jobs/jobs"),
      true,
    );
    assertEquals(
      programs.some((item) => item.id === "the8020/jobs/echo"),
      false,
    );
    assertEquals(validProgramID("the8020/demo/demo-form"), true);
    assertEquals(validProgramID("../core-ui/demo-form"), false);
    await assertRejects(
      () =>
        readProgramManifest(
          `${root}/the8020/demo/programs/demo-form/layouts/main.json`,
        ),
      TypeError,
      "invalid program manifest",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

async function copyDirectory(source: string, destination: string) {
  await Deno.mkdir(destination, { recursive: true });
  for await (const entry of Deno.readDir(source)) {
    const from = `${source}/${entry.name}`;
    const to = `${destination}/${entry.name}`;
    if (entry.isDirectory) await copyDirectory(from, to);
    else if (entry.isFile) await Deno.copyFile(from, to);
  }
}

Deno.test("program manifests parse TOML and reject invalid UUI flags", async () => {
  const root = await Deno.makeTempDir({ prefix: "the8020-manifest-test-" });
  const path = `${root}/program.toml`;
  try {
    for (
      const [flag, expected] of [["", false], ["uui = false", false], [
        "uui = true # Interactive",
        true,
      ]] as const
    ) {
      await Deno.writeTextFile(
        path,
        `schema = 1\ndescription = 'Example' # Description\n${flag}\n`,
      );
      const manifest = await readProgramManifest(path);
      assertEquals(manifest.uui, expected);
      assertEquals(manifest.description, "Example");
    }
    await Deno.writeTextFile(
      path,
      'schema = 1\ndescription = "Default entrypoint"\nentrypoint = ""\n',
    );
    assertEquals((await readProgramManifest(path)).entrypoint, "program.ts");
    await Deno.writeTextFile(
      path,
      'schema = 1.0\ndescription = "Invalid schema type"\n',
    );
    await assertRejects(
      () => readProgramManifest(path),
      TypeError,
      "invalid program manifest",
    );
    for (
      const flag of [
        'uui = "true"',
        "uui = 1",
        "uui = true\nuui = false",
        "uui = yes",
        "unknown = true",
      ]
    ) {
      await Deno.writeTextFile(
        path,
        `schema = 1\ndescription = "Example"\n${flag}\n`,
      );
      await assertRejects(
        () => readProgramManifest(path),
        TypeError,
        "invalid program manifest",
      );
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("dynamic invocation validates identity, containment, and default export", async () => {
  const root = await Deno.makeTempDir({ prefix: "the8020-program-test-" });
  try {
    const programRoot = `${root}/example/testing/programs`;
    await Deno.mkdir(`${programRoot}/working`, { recursive: true });
    await Deno.writeTextFile(
      `${programRoot}/working/program.toml`,
      'schema = 1\ndescription = "Working"\nentrypoint = "program.ts"\n',
    );
    await Deno.writeTextFile(
      `${programRoot}/working/program.ts`,
      "export default async function(...inputs: unknown[]) { " +
        "(globalThis as Record<string, unknown>).programTestInput = inputs; return 'done'; }\n",
    );
    assertEquals(
      await invokeProgram("example/testing/working", [
        { answer: 42 },
        "second",
        false,
      ], root),
      "done",
    );
    assertEquals(
      (globalThis as Record<string, unknown>).programTestInput,
      [{ answer: 42 }, "second", false],
    );

    await Deno.mkdir(`${programRoot}/missing-default`, { recursive: true });
    await Deno.writeTextFile(
      `${programRoot}/missing-default/program.toml`,
      'schema = 1\ndescription = "Missing"\nentrypoint = "program.ts"\n',
    );
    await Deno.writeTextFile(
      `${programRoot}/missing-default/program.ts`,
      "export const value = 1;\n",
    );
    await assertRejects(
      () => invokeProgram("example/testing/missing-default", undefined, root),
      ProgramExecutionError,
      "default-export a function",
    );

    await Deno.mkdir(`${programRoot}/escape`, { recursive: true });
    await Deno.writeTextFile(
      `${programRoot}/escape/program.toml`,
      'schema = 1\ndescription = "Escape"\nentrypoint = "../outside.ts"\n',
    );
    await assertRejects(
      () => invokeProgram("example/testing/escape", undefined, root),
      TypeError,
      "invalid program manifest",
    );
    await assertRejects(
      () => invokeProgram("../testing/working", undefined, root),
      TypeError,
      "namespace/repository/program",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
    delete (globalThis as Record<string, unknown>).programTestInput;
  }
});
