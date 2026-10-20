import {
  BACK_EVENT,
  callScreen,
  Channel,
  endSession,
  invokeProgram,
  Model,
  packageAssetURL,
  z,
} from "/p/the8020/uui/mod.ts";
import layout from "./layouts/main.json" with { type: "json" };
import { homeCatalog } from "./catalog.ts";
import { homeTree } from "./tree.ts";
import { readTileData } from "./tile_data.ts";
import { concurrencyLimit } from "./limiter.ts";

/** Upper bound on tiles one `load` request may ask for. */
const MAX_TILES_PER_LOAD = 100;
/** Data programs running at once per Home session; others wait in order. */
const DATA_CONCURRENCY = 6;

const HomeScreen = z.object({});

export default function home(): Promise<void> {
  return runHome("/workspace/packages");
}

export async function runHome(programsRoot: string): Promise<void> {
  // One Model keeps the navigator's selected folder across program returns.
  const screenModel = new Model<z.infer<typeof HomeScreen>>({});
  const runData = concurrencyLimit(DATA_CONCURRENCY);
  // The catalog is kept between renders and rebuilt only on explicit Refresh.
  let catalog: Awaited<ReturnType<typeof homeCatalog>> | undefined;
  while (true) {
    catalog ??= await homeCatalog(programsRoot);
    const current = catalog;
    const channel = new Channel();
    // The browser asks for the tiles it shows, so no result precedes its
    // subscription; each tile is sent as soon as its program answers.
    const loading = channel.subscribe("load", async (_id, data) => {
      const output = channel.capture();
      const requested = typeof data === "object" && data !== null &&
          Array.isArray((data as { tiles?: unknown }).tiles)
        ? (data as { tiles: unknown[] }).tiles
        : [];
      const tiles = [...new Set(requested)].filter((tile): tile is string =>
        typeof tile === "string" && current.data.has(tile)
      ).slice(0, MAX_TILES_PER_LOAD);
      await Promise.all(tiles.map((tile) =>
        runData(async () => {
          // A queued tile whose screen already ended is skipped.
          if (output.signal.aborted) return;
          const message = await readTileData(
            tile,
            current.data.get(tile)!,
            programsRoot,
          );
          if (!output.signal.aborted) output.send("data", message);
        })
      ));
    });
    let event: Awaited<ReturnType<typeof callScreen>>;
    try {
      event = await callScreen({
        id: "home",
        title: "Welcome to 80|20",
        schema: HomeScreen,
        model: screenModel,
        layout,
        header: {
          actions: [
            { id: "refresh", label: "[[icon=refresh color=warning]] Refresh" },
            { id: "logout", label: "Logout" },
          ],
        },
        customElements: [{
          id: "programs",
          channel,
          preserve: true,
          module: packageAssetURL("the8020/uui", "home-navigator.js"),
          styles: [packageAssetURL("the8020/uui", "home-navigator.css")],
          config: { tree: homeTree(current.tiles) },
        }],
      });
    } finally {
      loading.unsubscribe();
      channel.dispose();
    }
    if (event.action === "refresh") catalog = undefined;
    if (event.action === BACK_EVENT || event.action === "refresh") continue;
    if (event.action === "logout") {
      endSession("Signing out…", "/the8020/uui/login/logout");
      return;
    }
    if (event.action === "select" && typeof event.value === "string") {
      const action = current.actions.get(event.value);
      if (action === undefined) continue;
      await invokeProgram(action.program, action.arguments, programsRoot);
    }
  }
}
