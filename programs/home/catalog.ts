import { readProgramManifest } from "/p/the8020/packages/programs.ts";
import {
  readWidgets,
  type WidgetCategory,
  type WidgetProgram,
} from "/p/the8020/packages/widgets.ts";
import { declarations } from "/p/the8020/auth/src/declarations.ts";
import { discoverPrograms } from "../../programs.ts";
import { type HomeFolder, type HomeTile, humanize } from "./tree.ts";

export interface HomeCatalog {
  tiles: HomeTile[];
  /** What each tile launches. */
  actions: Map<string, WidgetProgram>;
  /** The non-interactive program that reads each live tile's status. */
  data: Map<string, WidgetProgram>;
  /** The action a user needs for some value to see and open each tile. */
  visible: Map<string, string>;
}

/** Platform tiles must say who sees them; none is public by omission. */
const PLATFORM = "the8020/";

/**
 * Declared package widgets plus a default tile for every discoverable program
 * no widget opens. Widgets whose program is missing or not interactive, whose
 * `[visible]` action no installed package declares, and platform widgets
 * without `[visible]` (a permission or `public = true`) are skipped and
 * logged. Their programs, platform programs and packages with an unreadable
 * widget get no default tile, so nothing becomes public by mistake.
 */
export async function homeCatalog(packagesRoot: string): Promise<HomeCatalog> {
  const [catalog, programs, declared] = await Promise.all([
    readWidgets(packagesRoot),
    discoverPrograms(packagesRoot),
    declarations(new URL(`file://${packagesRoot}/`)),
  ]);
  const declaredActions = new Set(declared.map((item) => item.action));
  // A package with an unreadable widget gets no default tiles: the broken
  // file may have restricted any of its programs.
  const broken = new Set<string>();
  for (const problem of catalog.problems) {
    console.error(`Ignoring widget ${problem.path}: ${problem.message}`);
    const relative = problem.path.slice(packagesRoot.length + 1).split("/");
    broken.add(relative.slice(0, 2).join("/"));
  }
  const categories = new Map(
    catalog.categories.map((category) => [category.key, category]),
  );
  const tiles: HomeTile[] = [];
  const opens = new Map<string, WidgetProgram>();
  const data = new Map<string, WidgetProgram>();
  const visible = new Map<string, string>();
  const opened = new Set<string>();
  // Read every referenced manifest at once, then resolve widgets in order.
  const ids = new Set(
    catalog.widgets.flatMap((widget) => [
      widget.open.program,
      ...(widget.data === undefined ? [] : [widget.data.program]),
    ]),
  );
  const manifests = new Map(
    await Promise.all(
      [...ids].map(async (id) =>
        [id, await manifest(packagesRoot, id)] as const
      ),
    ),
  );
  for (const widget of catalog.widgets) {
    // A rejected widget's program never falls back to a public default tile.
    opened.add(widget.open.program);
    const permission = widget.visible !== undefined &&
        "permission" in widget.visible
      ? widget.visible.permission
      : undefined;
    if (widget.visible === undefined && widget.package.startsWith(PLATFORM)) {
      console.error(
        `Ignoring widget ${widget.id}: platform tiles need [visible]`,
      );
      continue;
    }
    if (permission !== undefined && !declaredActions.has(permission)) {
      console.error(
        `Ignoring widget ${widget.id}: ${permission} is not a declared permission`,
      );
      continue;
    }
    if (manifests.get(widget.open.program)?.uui !== true) {
      console.error(
        `Ignoring widget ${widget.id}: ${widget.open.program} is not an installed UUI program`,
      );
      continue;
    }
    let refresh: number | undefined;
    if (widget.data !== undefined) {
      if (manifests.get(widget.data.program)?.uui === false) {
        data.set(widget.id, {
          program: widget.data.program,
          arguments: widget.data.arguments,
        });
        refresh = widget.data.refresh;
      } else {
        console.error(
          `Ignoring data of widget ${widget.id}: ${widget.data.program} is not an installed non-interactive program`,
        );
      }
    }
    tiles.push({
      id: widget.id,
      title: widget.title,
      description: widget.description,
      ...(widget.icon === undefined ? {} : { icon: widget.icon }),
      order: widget.order,
      path: widget.category === undefined
        ? [packageFolder(widget.package)]
        : categoryPath(widget.category, categories),
      ...(data.has(widget.id) ? { data: { refresh } } : {}),
    });
    opens.set(widget.id, widget.open);
    if (permission !== undefined) visible.set(widget.id, permission);
    opened.add(widget.open.program);
  }
  for (const program of programs) {
    const packageId = program.id.split("/").slice(0, 2).join("/");
    if (
      opened.has(program.id) || program.id.startsWith(PLATFORM) ||
      broken.has(packageId)
    ) continue;
    tiles.push({
      id: program.id,
      title: humanize(program.id.split("/").at(-1)!),
      description: program.description,
      order: 0,
      path: [packageFolder(packageId)],
    });
    opens.set(program.id, { program: program.id, arguments: [] });
  }
  return { tiles, actions: opens, data, visible };
}

function categoryPath(
  key: string,
  categories: Map<string, WidgetCategory>,
): HomeFolder[] {
  const segments = key.split("/");
  return segments.map((segment, index) => {
    const path = segments.slice(0, index + 1).join("/");
    const category = categories.get(path);
    return {
      key: path,
      title: category?.title ?? humanize(segment),
      ...(category?.icon === undefined ? {} : { icon: category.icon }),
      order: category?.order ?? 0,
    };
  });
}

/** Packages without widgets keep a folder named after the package. */
function packageFolder(packageId: string): HomeFolder {
  return {
    key: `package:${packageId}`,
    title: humanize(packageId.split("/")[1]!),
    order: 1000,
  };
}

async function manifest(root: string, id: string) {
  const [namespace, repository, program] = id.split("/");
  try {
    return await readProgramManifest(
      `${root}/${namespace}/${repository}/programs/${program}/program.toml`,
    );
  } catch {
    return undefined;
  }
}

/**
 * Tiles the user may see: public ones, and those whose action some role grants
 * for any value. Each distinct action is evaluated once, without auditing.
 */
export async function permittedTiles(
  catalog: Pick<HomeCatalog, "tiles" | "visible">,
  permits: (action: string) => Promise<boolean>,
): Promise<HomeTile[]> {
  const granted = new Map(
    await Promise.all(
      [...new Set(catalog.visible.values())].map(async (action) =>
        [action, await permits(action)] as const
      ),
    ),
  );
  return catalog.tiles.filter((tile) => {
    const action = catalog.visible.get(tile.id);
    return action === undefined || granted.get(action) === true;
  });
}
