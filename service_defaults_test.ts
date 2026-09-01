import { assertEquals } from "@std/assert";

function setting(manifest: string, section: string, name: string): string {
  const block = manifest.match(
    new RegExp(`(?:^|\\n)\\[${section}\\]\\n([\\s\\S]*?)(?=\\n\\[|$)`),
  );
  if (block === null) throw new Error(`missing [${section}] section`);
  const value = block[1]?.match(new RegExp(`^${name}\\s*=\\s*(.+)$`, "m"));
  if (value?.[1] === undefined) {
    throw new Error(`missing ${section}.${name}`);
  }
  return value[1].trim();
}

Deno.test("first-party UUI services retain their capacity defaults", async () => {
  const manifests = await Promise.all(
    ["login", "shell", "session"].map((service) =>
      Deno.readTextFile(
        new URL(`./services/${service}/service.toml`, import.meta.url),
      )
    ),
  );
  const [login, shell, session] = manifests;
  if (login === undefined || shell === undefined || session === undefined) {
    throw new Error("missing UUI service manifest");
  }

  for (const manifest of [login, shell]) {
    assertEquals(setting(manifest, "scaling", "minimum_workers"), "0");
    assertEquals(setting(manifest, "scaling", "maximum_workers"), "128");
    assertEquals(setting(manifest, "scaling", "concurrency_per_worker"), "16");
    assertEquals(setting(manifest, "scaling", "target_utilization"), "0.70");
    assertEquals(setting(manifest, "scaling", "worker_keep_alive"), '"2m"');
    assertEquals(setting(manifest, "placement", "sandbox_group"), '"uui"');
    assertEquals(setting(manifest, "placement", "minimum_sandboxes"), "0");
    assertEquals(setting(manifest, "placement", "workers_per_sandbox"), "64");
  }

  assertEquals(setting(session, "scaling", "minimum_workers"), "0");
  assertEquals(setting(session, "scaling", "maximum_workers"), "0");
  assertEquals(setting(session, "scaling", "concurrency_per_worker"), "1");
  assertEquals(setting(session, "scaling", "target_utilization"), "1.00");
  assertEquals(setting(session, "lifecycle", "session_keep_alive"), '"10m"');
  assertEquals(setting(session, "placement", "sandbox_group"), '"uui"');
  assertEquals(setting(session, "placement", "minimum_sandboxes"), "0");
  assertEquals(setting(session, "placement", "workers_per_sandbox"), "64");
});
