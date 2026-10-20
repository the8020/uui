import { readProgramManifest } from "/p/the8020/packages/programs.ts";
import {
  readWidgets,
  type WidgetCategory,
  type WidgetProgram,
} from "/p/the8020/packages/widgets.ts";
import { discoverPrograms } from "../../programs.ts";
import { type HomeFolder, type HomeTile, humanize } from "./tree.ts";

export interface HomeCatalog {
  tiles: HomeTile[];
  /** What each tile launches. */
  actions: Map<string, WidgetProgram>;
  /** The non-interactive program that reads each live tile's status. */
  data: Map<string, WidgetProgram>;
}

/**
 * Declared package widgets plus a default tile for every discoverable program
 * no widget opens. Widgets whose program is missing or not interactive are
 * skipped and logged.
 */
export async function homeCatalog(packagesRoot: string): Promise<HomeCatalog> {
  const [catalog, programs] = await Promise.all([
    readWidgets(packagesRoot),
    discoverPrograms(packagesRoot),
  ]);
  for (const problem of catalog.problems) {
    console.error(`Ignoring widget ${problem.path}: ${problem.message}`);
  }
  const categories = new Map(
    catalog.categories.map((category) => [category.key, category]),
  );
  const tiles: HomeTile[] = [];
  const actions = new Map<string, WidgetProgram>();
  const data = new Map<string, WidgetProgram>();
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
    actions.set(widget.id, widget.open);
    opened.add(widget.open.program);
  }
  for (const program of programs) {
    if (opened.has(program.id)) continue;
    tiles.push({
      id: program.id,
      title: humanize(program.id.split("/").at(-1)!),
      description: program.description,
      order: 0,
      path: [packageFolder(program.id.split("/").slice(0, 2).join("/"))],
    });
    actions.set(program.id, { program: program.id, arguments: [] });
  }
  return { tiles, actions, data };
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
