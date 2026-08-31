export interface DiscoveredProgram {
  id: string;
  description: string;
}

export interface ProgramManifest {
  schema: 1;
  description: string;
  entrypoint: string;
  defaultLayout?: string;
  discoverable: boolean;
}

export interface TerminatedProgramInput {
  readonly exception: unknown;
  readonly programId: string;
  readonly entrypoint: string;
  readonly occurredAt: string;
  readonly homeProgram: string;
  readonly terminatedProgram: string;
}

export class ProgramExecutionError extends Error {
  readonly programId: string;
  readonly entrypoint: string;
  readonly exception: unknown;

  constructor(programId: string, entrypoint: string, exception: unknown) {
    super(`program ${programId} failed: ${errorMessage(exception)}`, {
      cause: exception,
    });
    this.name = "ProgramExecutionError";
    this.programId = programId;
    this.entrypoint = entrypoint;
    this.exception = exception;
  }
}

const segmentPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export async function discoverPrograms(
  packagesRoot = "/workspace/packages",
): Promise<DiscoveredProgram[]> {
  const result: DiscoveredProgram[] = [];
  for await (const namespace of Deno.readDir(packagesRoot)) {
    if (!namespace.isDirectory || !validSegment(namespace.name)) continue;
    const namespaceRoot = `${packagesRoot}/${namespace.name}`;
    for await (const repository of Deno.readDir(namespaceRoot)) {
      if (!repository.isDirectory || !validSegment(repository.name)) continue;
      const programsRoot = `${namespaceRoot}/${repository.name}/programs`;
      try {
        for await (const program of Deno.readDir(programsRoot)) {
          if (!program.isDirectory || !validSegment(program.name)) continue;
          let manifest: ProgramManifest;
          try {
            manifest = await readProgramManifest(
              `${programsRoot}/${program.name}/program.toml`,
            );
          } catch (error) {
            if (error instanceof Deno.errors.NotFound) continue;
            throw error;
          }
          if (!manifest.discoverable) continue;
          result.push({
            id: `${namespace.name}/${repository.name}/${program.name}`,
            description: manifest.description,
          });
        }
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
    }
  }
  return result.sort((left, right) => left.id.localeCompare(right.id));
}

export async function invokeProgram(
  id: string,
  input?: unknown,
  packagesRoot = "/workspace/packages",
): Promise<unknown> {
  if (!validProgramID(id)) {
    throw new TypeError("program ID must be namespace/repository/program");
  }
  const [namespace, repository, program] = id.split("/") as [
    string,
    string,
    string,
  ];
  const root = await Deno.realPath(packagesRoot);
  const programRoot = await Deno.realPath(
    `${root}/${namespace}/${repository}/programs/${program}`,
  );
  if (!beneath(programRoot, root)) {
    throw new TypeError("program path escapes packages root");
  }
  const manifest = await readProgramManifest(`${programRoot}/program.toml`);
  const entrypoint = await Deno.realPath(
    `${programRoot}/${manifest.entrypoint}`,
  );
  if (!beneath(entrypoint, programRoot)) {
    throw new TypeError("program entrypoint escapes its directory");
  }
  try {
    const module = await import(new URL(`file://${entrypoint}`).href) as {
      default?: unknown;
    };
    if (typeof module.default !== "function") {
      throw new TypeError(`program ${id} must default-export a function`);
    }
    return await module.default(input);
  } catch (error) {
    if (error instanceof ProgramExecutionError) throw error;
    throw new ProgramExecutionError(id, entrypoint, error);
  }
}

export async function readProgramManifest(
  path: string,
): Promise<ProgramManifest> {
  const source = await Deno.readTextFile(path);
  const schema = integerValue(source, "schema");
  const description = stringValue(source, "description");
  const entrypoint = stringValue(source, "entrypoint") || "program.ts";
  const defaultLayout = stringValue(source, "default_layout");
  if (
    schema !== 1 || description.length === 0 || !safeRelativePath(entrypoint)
  ) {
    throw new TypeError(`invalid program manifest ${path}`);
  }
  return {
    schema: 1,
    description,
    entrypoint,
    defaultLayout: defaultLayout || undefined,
    discoverable: booleanValue(source, "discoverable") ?? true,
  };
}

export function validProgramID(value: string): boolean {
  const parts = value.split("/");
  return parts.length === 3 && parts.every(validSegment);
}

function validSegment(value: string | undefined): value is string {
  return value !== undefined && value !== "." && value !== ".." &&
    segmentPattern.test(value);
}

function safeRelativePath(value: string): boolean {
  return value.length > 0 && !value.startsWith("/") && !value.includes("\\") &&
    !value.includes("\0") &&
    value.split("/").every((part) => validSegment(part));
}

function beneath(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

function integerValue(source: string, key: string): number {
  const match = source.match(
    new RegExp(`^\\s*${key}\\s*=\\s*(\\d+)\\s*$`, "m"),
  );
  return match === null ? 0 : Number(match[1]);
}

function stringValue(source: string, key: string): string {
  const match = source.match(
    new RegExp(`^\\s*${key}\\s*=\\s*("(?:[^"\\\\]|\\\\.)*")\\s*$`, "m"),
  );
  if (match === null) return "";
  return JSON.parse(match[1]!);
}

function booleanValue(source: string, key: string): boolean | undefined {
  const match = source.match(
    new RegExp(`^\\s*${key}\\s*=\\s*(true|false)\\s*$`, "m"),
  );
  return match === null ? undefined : match[1] === "true";
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
