import { invokeProgram } from "../../programs.ts";

/** Live tile status returned by a widget's `[data]` program. */
export interface TileData {
  value?: string;
  detail?: string;
  status?: TileStatus;
}

export type TileStatus = "ok" | "info" | "warning" | "danger";

/** What the browser receives for one tile. */
export type TileDataMessage =
  | ({ tile: string } & TileData)
  | { tile: string; error: true };

const STATUSES = new Set<string>(["ok", "info", "warning", "danger"]);
export const TILE_DATA_TIMEOUT_MS = 10_000;

/**
 * Run a non-interactive data program and keep only its bounded display fields.
 * Failures, timeouts and invalid results become one logged error marker.
 */
export async function readTileData(
  tile: string,
  source: { program: string; arguments: string[] },
  packagesRoot: string,
  timeoutMs = TILE_DATA_TIMEOUT_MS,
): Promise<TileDataMessage> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      invokeProgram(source.program, source.arguments, packagesRoot),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`timed out after ${timeoutMs} ms`)),
          timeoutMs,
        );
      }),
    ]);
    return { tile, ...tileData(result) };
  } catch (error) {
    console.error(
      `Tile ${tile} data from ${source.program} failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return { tile, error: true };
  } finally {
    clearTimeout(timer);
  }
}

export function tileData(value: unknown): TileData {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("tile data must be an object");
  }
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).find((key) =>
    !["value", "detail", "status"].includes(key)
  );
  if (unknown !== undefined) {
    throw new TypeError(`unknown tile data field ${unknown}`);
  }
  const result: TileData = {};
  if (record.value !== undefined) {
    result.value = displayText(record.value, "value", 24);
  }
  if (record.detail !== undefined) {
    result.detail = displayText(record.detail, "detail", 120);
  }
  if (record.status !== undefined) {
    if (typeof record.status !== "string" || !STATUSES.has(record.status)) {
      throw new TypeError(
        "tile data status must be ok, info, warning or danger",
      );
    }
    result.status = record.status as TileStatus;
  }
  return result;
}

function displayText(value: unknown, label: string, maximum: number): string {
  const text = typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : value;
  if (typeof text !== "string" || text.length > maximum) {
    throw new TypeError(
      `tile data ${label} must be text up to ${maximum} characters`,
    );
  }
  return text;
}
