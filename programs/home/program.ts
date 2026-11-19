import { text as localizedText } from "/p/the8020/i18n/mod.ts";
import { msg } from "/p/the8020/uui/i18n/messages.ts";
import {
  BACK_EVENT,
  callScreen,
  Channel,
  endSession,
  field,
  invokeProgram,
  Model,
  packageAssetURL,
  sendMessage,
  SESSION_RESTART_EVENT,
  z,
} from "/p/the8020/uui/mod.ts";
import { context } from "@the8020/context";
import { permitsAny, permittedActions } from "/p/the8020/auth/mod.ts";
import layout from "./layouts/main.json" with { type: "json" };
import { homeCatalog, permittedTiles } from "./catalog.ts";
import { homeTree } from "./tree.ts";
import { readTileData } from "./tile_data.ts";
import { concurrencyLimit } from "./limiter.ts";
import { effectiveShortcuts, shortcutFields } from "../../shortcuts.ts";
import { fetchUserShortcuts } from "../../preferences.ts";
import { fieldMetadata } from "../../fields.ts";

/** Upper bound on tiles one `load` request may ask for. */
const MAX_TILES_PER_LOAD = 100;
/** Data programs running at once per Home session; others wait in order. */
const DATA_CONCURRENCY = 6;

export default function home(): Promise<void> {
  return runHome("/workspace/packages");
}

export async function runHome(programsRoot: string): Promise<void> {
  // One Model keeps the navigator's selected folder across program returns.
  const screenModel = new Model({ shortcut: "" });
  const runData = concurrencyLimit(DATA_CONCURRENCY);
  // The catalog is kept between renders and rebuilt only on explicit Refresh.
  let catalog: Awaited<ReturnType<typeof homeCatalog>> | undefined;
  while (true) {
    catalog ??= await homeCatalog(programsRoot);
    const current = catalog;
    const fields = shortcutFields(() => Promise.resolve(current.programs));
    const schema = z.object({
      shortcut: field(fields.shortcut.or(z.literal("")), {
        ...fieldMetadata(fields.shortcut),
        label: `[[icon=keyboard_command_key]] ${
          localizedText(fieldMetadata(fields.shortcut)!.label!)
        }`,
        class: "home-shortcut",
        description: msg("shortcuts.help"),
        enterEvent: "launch-shortcut",
        placeholder: fieldMetadata(fields.shortcut)!.label,
      }),
    });
    // Roles may change between renders, so visibility is evaluated each time.
    const tiles = await permittedTiles(
      current,
      (actions) => permittedActions(context.username, actions),
    );
    const shown = new Set(tiles.map((tile) => tile.id));
    const channel = new Channel();
    const shortcuts = channel.subscribe("shortcuts", async () => {
      const output = channel.capture();
      const rows = effectiveShortcuts(
        current.programs,
        await fetchUserShortcuts(),
      );
      const counts = new Map<string, number>();
      for (const row of rows) {
        counts.set(row.shortcut, (counts.get(row.shortcut) ?? 0) + 1);
      }
      const byProgram = new Map<string, string[]>();
      for (const row of rows) {
        if (counts.get(row.shortcut) !== 1) continue;
        const codes = byProgram.get(row.program) ?? [];
        codes.push(row.shortcut);
        byProgram.set(row.program, codes);
      }
      output.send(
        "shortcuts",
        Object.fromEntries(tiles.map((tile) => [
          tile.id,
          byProgram.get(current.actions.get(tile.id)!.program) ?? [],
        ])),
      );
    });
    // The browser asks for the tiles it shows, so no result precedes its
    // subscription; each tile is sent as soon as its program answers.
    const loading = channel.subscribe("load", async (_id, data) => {
      const output = channel.capture();
      const requested = typeof data === "object" && data !== null &&
          Array.isArray((data as { tiles?: unknown }).tiles)
        ? (data as { tiles: unknown[] }).tiles
        : [];
      const tiles = [...new Set(requested)].filter((tile): tile is string =>
        typeof tile === "string" && shown.has(tile) && current.data.has(tile)
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
        class: "home-screen",
        title: msg("program.welcome_to_80_20"),
        schema,
        model: screenModel,
        layout,
        systemButtons: {
          exit: { id: SESSION_RESTART_EVENT, label: "[[icon=refresh]]" },
        },
        header: {
          actions: [
            { id: "refresh", label: msg("program.refresh") },
            { id: "logout", label: msg("shell.logout") },
          ],
        },
        customElements: [{
          id: "programs",
          channel,
          preserve: true,
          module: packageAssetURL("the8020/uui", "home-navigator.js"),
          styles: [packageAssetURL("the8020/uui", "home-navigator.css")],
          config: { tree: homeTree(tiles) },
        }],
      });
    } finally {
      loading.unsubscribe();
      shortcuts.unsubscribe();
      channel.dispose();
    }
    if (event.action === "refresh") catalog = undefined;
    if (event.action === BACK_EVENT || event.action === "refresh") continue;
    if (event.action === "logout") {
      endSession(
        localizedText(msg("program.signing_out")),
        "/the8020/uui/login/logout",
      );
      return;
    }
    if (event.action === "launch-shortcut") {
      const code = screenModel.data.shortcut.trim().toUpperCase();
      if (!code) continue;
      const matches = effectiveShortcuts(
        current.programs,
        await fetchUserShortcuts(),
      )
        .filter((row) => row.shortcut === code);
      if (matches.length !== 1) {
        sendMessage(
          localizedText(
            msg(matches.length ? "shortcuts.ambiguous" : "shortcuts.not_found"),
          ),
          "error",
        );
        continue;
      }
      screenModel.data.shortcut = "";
      await invokeProgram(matches[0]!.program, [], programsRoot);
    }
    if (event.action === "select" && typeof event.value === "string") {
      const action = current.actions.get(event.value);
      if (action === undefined) continue;
      // Hiding is not enforcement, but a stale tile still must not launch.
      const permission = current.visible.get(event.value);
      if (
        permission !== undefined &&
        !await permitsAny(context.username, permission)
      ) {
        sendMessage(
          localizedText(msg("program.you_no_longer_have_access_to_this")),
          "error",
        );
        continue;
      }
      await invokeProgram(action.program, action.arguments, programsRoot);
    }
  }
}
