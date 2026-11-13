/** Import-inert argv/output wrapper for the shared raw-Git package reconstruction. */

import { resolve } from "node:path";
import type { CompiledArtifactId } from "./lib/compiled-artifact-protocol";
import {
  prepareCompiledArtifactCheckPackage,
  type PreparedCompiledArtifactCheckPackage,
  type PrepareCompiledArtifactCheckPackageInput,
} from "./lib/compiled-artifact-git-package";

export {
  prepareCompiledArtifactCheckPackage,
  type PreparedCompiledArtifactCheckPackage,
  type PrepareCompiledArtifactCheckPackageInput,
};

type ParsedCli = {
  readonly sourceCommit: string;
  readonly artifact: CompiledArtifactId;
  readonly output: string;
};

function parseCli(args: readonly string[]): ParsedCli {
  const values = new Map<string, string>();
  for (const arg of args) {
    const match = /^--(source-commit|artifact|output)=(.+)$/u.exec(arg);
    if (match === null || values.has(match[1]!)) {
      throw new TypeError("expected exactly --source-commit=<sha> --artifact=<id> --output=<path>");
    }
    values.set(match[1]!, match[2]!);
  }
  if (values.size !== 3) {
    throw new TypeError("expected exactly --source-commit=<sha> --artifact=<id> --output=<path>");
  }
  const artifact = values.get("artifact");
  if (artifact !== "compiled-parser" && artifact !== "compiled-resolver") {
    throw new TypeError("--artifact must be compiled-parser or compiled-resolver");
  }
  return {
    sourceCommit: values.get("source-commit")!,
    artifact,
    output: values.get("output")!,
  };
}

export function main(
  args: readonly string[] = process.argv.slice(2),
  repositoryRoot = resolve(import.meta.dir, "../../../.."),
): number {
  try {
    const parsed = parseCli(args);
    const prepared = prepareCompiledArtifactCheckPackage({ repositoryRoot, ...parsed });
    process.stderr.write(
      `[compiled-artifact-package] ${prepared.metadata.artifact} ${prepared.packageDigest} -> ${prepared.output}\n`,
    );
    return 0;
  } catch (error) {
    process.stderr.write(
      `[compiled-artifact-package] ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 2;
  }
}

if (import.meta.main) process.exit(main());
