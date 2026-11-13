import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, open, rm, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { REPOSITORY_EXACT_FILES, REPOSITORY_RECURSIVE_ROOTS, captureStableEpoch,
  computeOwnerEpoch, repositoryRelativePath } from "./artifact-bytes.ts";
import { isPublicBootstrapInput, publicBootstrapExactInputs }
  from "../../../../../distros/narthex/solid/public-bootstrap-inputs.mjs";

// Exercise the real byte scanner/digest owner against a tiny repository-local
// tree. Only watcher delivery is controlled; sentinel and input IO are real.
const repository = fileURLToPath(new URL("../../../../../", import.meta.url));
const scratch = resolve(repository, ".tmp-diag");
const patch = repositoryRelativePath("patches/@solidjs%2Fsignals@2.0.0-rc.7.patch");
const ownerPath = repositoryRelativePath("implementations/typescript/engine/scripts/fixture-owner.mjs");
const hash = value => createHash("sha256").update(value).digest("hex");

function inside(parent, target) {
  const absolute = resolve(target);
  const child = relative(resolve(parent), absolute);
  if (!child || child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child))
    throw new Error(`Fixture path escapes its intended root: ${absolute}`);
  return absolute;
}

async function write(root, path, bytes) {
  const target = inside(root, join(root, ...path.split("/")));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
}

function fakeWatcher(root) {
  let handlers, watches = 0, closes = 0;
  const emitAbsolute = path => handlers?.event("rename",
    repositoryRelativePath(relative(root, inside(root, path)).replaceAll("\\", "/")));
  return {
    count: () => ({ watches, closes }),
    dependencies: {
      nonce: () => "0123456789abcdef",
      watchFactory(requestedRoot, nextHandlers) {
        if (resolve(requestedRoot) !== resolve(root)) throw new Error("Unexpected fixture watcher root");
        watches++;
        handlers = nextHandlers;
        return { async close() { closes++; if (handlers === nextHandlers) handlers = undefined; } };
      },
      async createSentinel(absolutePath, payload) {
        const descriptor = await open(inside(root, absolutePath), "wx");
        try { await descriptor.writeFile(payload); }
        finally { await descriptor.close(); }
        emitAbsolute(absolutePath);
      },
      async removeSentinel(absolutePath) {
        await unlink(inside(root, absolutePath));
        emitAbsolute(absolutePath);
      },
      drainWatcher: async () => undefined,
      sentinelTimeoutMs: 100,
    },
  };
}

test("changing only the managed Solid patch changes captured repository and compiled-owner epochs", async () => {
  inside(repository, scratch);
  await mkdir(scratch, { recursive: true });
  if ((await lstat(scratch)).isSymbolicLink()) throw new Error("Fixture scratch root must not be a link");
  const root = inside(scratch, await mkdtemp(join(scratch, "artifact-patch-epoch-")));
  try {
    for (const path of REPOSITORY_EXACT_FILES) await write(root, path, `${path}\n`);
    for (const path of REPOSITORY_RECURSIVE_ROOTS) await write(root, `${path}/fixture.txt`, "stable recursive input\n");
    await write(root, ownerPath, "export const fixtureOwner = true;\n");
    // Write independently of the roster: a roster regression must leave an
    // existing patch uncaptured and fail this test, rather than omit the input.
    const beforeBytes = "managed Solid patch\nprivate companion writes = before\n";
    const afterBytes = "managed Solid patch\nprivate companion writes = after!\n";
    await write(root, patch, beforeBytes);
    expect(REPOSITORY_EXACT_FILES.filter(path => path === patch)).toEqual([patch]);
    expect(publicBootstrapExactInputs.filter(path => path === patch)).toEqual([patch]);
    expect(isPublicBootstrapInput(patch)).toBe(true);
    const domains = ["compiled-parser", "compiled-resolver"].map(artifact => ({
      kind: "owner-overlay", artifact, exactFiles: [ownerPath],
    }));
    async function capture() {
      const watcher = fakeWatcher(root);
      const result = await captureStableEpoch({ repositoryRoot: root, domains }, watcher.dependencies);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(`Fixture capture refused: ${JSON.stringify(result.issue)}`);
      expect(watcher.count()).toEqual({ watches: 2, closes: 2 });
      expect(result.value.repositoryEpoch).toBe(result.value.repository.digest);
      return result.value;
    }
    const before = await capture();
    await write(root, patch, afterBytes);
    const after = await capture();
    const unchanged = await capture();
    const oldRow = before.repository.rows.filter(row => row.path === patch);
    const newRow = after.repository.rows.filter(row => row.path === patch);
    expect(oldRow).toHaveLength(1);
    expect(newRow).toHaveLength(1);
    expect(oldRow[0].sha256).toBe(hash(beforeBytes));
    expect(newRow[0].sha256).toBe(hash(afterBytes));
    expect(oldRow[0].byteLength).toBe(Buffer.byteLength(beforeBytes));
    expect(newRow[0].byteLength).toBe(Buffer.byteLength(afterBytes));
    expect(before.bytes.has(patch)).toBe(true);
    expect(Buffer.from(before.bytes.read(patch)).toString("utf8")).toBe(beforeBytes);
    expect(Buffer.from(after.bytes.read(patch)).toString("utf8")).toBe(afterBytes);
    expect(after.repositoryEpoch).not.toBe(before.repositoryEpoch);
    expect(after.repository.rows.filter(row => row.path !== patch))
      .toEqual(before.repository.rows.filter(row => row.path !== patch));
    expect(after.domains).toEqual(before.domains);
    expect(unchanged.repository).toEqual(after.repository);
    expect(unchanged.repositoryEpoch).toBe(after.repositoryEpoch);
    for (const artifact of ["compiled-parser", "compiled-resolver"]) {
      const binding = capture => computeOwnerEpoch({ artifact, repositoryEpoch: capture.repositoryEpoch,
        ownerOverlayDigest: capture.domains.find(domain => domain.domain === `owner-overlay:${artifact}`).digest,
        dependencyDigest: hash("unchanged fixture dependencies"), protocolVersion: "fixture-v1",
        recoveryStubVersion: "fixture-v1", portableGenerationAbi: "fixture-v1" });
      expect(binding(after)).not.toBe(binding(before));
      expect(binding(unchanged)).toBe(binding(after));
    }
  } finally {
    // Check the final absolute target immediately before recursive removal;
    // the scratch directory and shared repository are never removal targets.
    const target = inside(scratch, root);
    inside(repository, target);
    if ((await lstat(target)).isSymbolicLink()) throw new Error("Fixture root became a link");
    await rm(target, { recursive: true, force: true });
  }
});
