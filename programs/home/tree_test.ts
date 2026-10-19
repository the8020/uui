import { assertEquals } from "@std/assert";
import { type HomeTile, homeTree } from "./tree.ts";

const administration = {
  key: "administration",
  title: "Administration",
  icon: "admin_panel_settings",
  order: 10,
};
const tile = (
  id: string,
  title: string,
  order: number,
  path: HomeTile["path"],
): HomeTile => ({ id, title, description: `${title} tile`, order, path });

Deno.test("Home tree places tiles in category folders, folders first by order", () => {
  const tree = homeTree([
    tile("the8020/users/users", "Users", 10, [administration]),
    tile("the8020/admin-core/packages", "Packages", 10, [administration, {
      key: "administration/packages",
      title: "Packages",
      order: 10,
    }]),
    tile("the8020/auth/roles", "Roles", 5, [administration]),
    tile("the8020/jobs/jobs", "Jobs", 0, [{
      key: "operations",
      title: "Operations",
      order: 20,
    }]),
  ]);
  assertEquals(tree.children?.map((node) => node.label), [
    "Administration",
    "Operations",
  ]);
  const admin = tree.children![0]!;
  assertEquals(admin.icon, "admin_panel_settings");
  assertEquals(admin.children?.map((node) => [node.label, node.tile]), [
    ["Packages", undefined],
    ["Roles", "the8020/auth/roles"],
    ["Users", "the8020/users/users"],
  ]);
  assertEquals(
    admin.children![0]!.children![0]!.id,
    "tile:the8020/admin-core/packages",
  );
});

Deno.test("Home tree collapses a single root folder and keeps empty roots", () => {
  const tree = homeTree([tile("acme/x/x", "X", 0, [administration])]);
  assertEquals(tree.children?.map((node) => node.tile), ["acme/x/x"]);
  assertEquals(homeTree([]), { id: "", label: "Programs", children: [] });
});
