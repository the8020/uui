/** One Home navigator node: a folder of nodes, or a launchable tile. */
export interface HomeNode {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  /** Present only on launchable tiles; sent back as the `select` value. */
  tile?: string;
  /** Live status is available; `refresh` repeats it every N seconds. */
  data?: { refresh?: number };
  children?: HomeNode[];
}

/** One folder level of a tile's category path. */
export interface HomeFolder {
  key: string;
  title: string;
  icon?: string;
  order: number;
}

/** A resolved, localized tile placed under its category folders. */
export interface HomeTile {
  id: string;
  title: string;
  description: string;
  icon?: string;
  order: number;
  path: HomeFolder[];
  data?: { refresh?: number };
}

export const ROOT_ID = "";

/**
 * Builds category folders with their tiles. Folders precede tiles; both sort
 * by order, then title. A root with a single folder collapses into it.
 */
export function homeTree(tiles: readonly HomeTile[]): HomeNode {
  const root: HomeNode = { id: ROOT_ID, label: "Programs", children: [] };
  const order = new Map<HomeNode, number>();
  for (const tile of tiles) {
    let folder = root;
    for (const level of tile.path) {
      const id = `folder:${level.key}`;
      let next = folder.children!.find((node) => node.id === id);
      if (next === undefined) {
        next = {
          id,
          label: level.title,
          ...(level.icon === undefined ? {} : { icon: level.icon }),
          children: [],
        };
        order.set(next, level.order);
        folder.children!.push(next);
      }
      folder = next;
    }
    const node: HomeNode = {
      id: `tile:${tile.id}`,
      label: tile.title,
      description: tile.description,
      ...(tile.icon === undefined ? {} : { icon: tile.icon }),
      tile: tile.id,
      ...(tile.data === undefined ? {} : {
        data: tile.data.refresh === undefined
          ? {}
          : { refresh: tile.data.refresh },
      }),
    };
    order.set(node, tile.order);
    folder.children!.push(node);
  }
  const sort = (node: HomeNode) => {
    node.children?.sort((left, right) =>
      Number(left.tile !== undefined) - Number(right.tile !== undefined) ||
      order.get(left)! - order.get(right)! ||
      left.label.localeCompare(right.label)
    );
    node.children?.forEach(sort);
  };
  sort(root);
  while (
    root.children!.length === 1 && root.children![0]!.tile === undefined
  ) {
    root.children = root.children![0]!.children;
  }
  return root;
}

export function humanize(name: string): string {
  const words = name.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
