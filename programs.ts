import {
  type ProgramManifest,
  readProgramManifest,
} from "/p/the8020/packages/programs.ts";
export {
  type ProgramManifest,
  readProgramManifest,
} from "/p/the8020/packages/programs.ts";

export interface DiscoveredProgram {
  id: string;
  description: string;
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
          if (!manifest.discoverable || !manifest.uui) continue;
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
  inputs: unknown[] = [],
  packagesRoot = "/workspace/packages",
): Promise<unknown> {
  if (!Array.isArray(inputs)) {
    throw new TypeError("program inputs must be an array of arguments");
  }
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
    return await module.default(...inputs);
  } catch (error) {
    if (error instanceof ProgramExecutionError) throw error;
    throw new ProgramExecutionError(id, entrypoint, error);
  }
}

export function validProgramID(value: string): boolean {
  const parts = value.split("/");
  return parts.length === 3 && parts.every(validSegment);
}

function validSegment(value: string | undefined): value is string {
  return value !== undefined && value !== "." && value !== ".." &&
    segmentPattern.test(value);
}

function beneath(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
