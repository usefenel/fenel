/** Import-inert public controller for the compiled-resolver owner protocol. */

import { resolve } from "node:path";
import { runCompiledArtifactOwnerCli } from "./lib/compiled-artifact-owner";

export async function main(
  args: readonly string[] = process.argv.slice(2),
  repositoryRoot = resolve(import.meta.dir, "../../../.."),
): Promise<number> {
  return runCompiledArtifactOwnerCli({
    artifact: "compiled-resolver",
    repositoryRoot,
    args,
  });
}

if (import.meta.main) process.exitCode = await main();
