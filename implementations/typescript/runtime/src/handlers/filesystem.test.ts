// ---------------------------------------------------------------------------
// Tests for the filesystem IO handlers — Phase 2 of the implementation
// roadmap. Covers the round-trip codec workflow these handlers exist to
// support: write bytes, read them back, list a directory, then clean up.
//
// Uses the OS temp directory so the tests don't pollute the repo.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRegistry } from "@fenel/engine/registry";
import { stdModule } from "@fenel/engine/modules/std";
import { codecModule, codecNatives } from "@fenel/engine/modules/codec";
import { dispatchRegistry } from "@fenel/engine/system-entities";
import { registerFilesystemHandlers } from "./filesystem";

let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "fenel-codec-"));
});

afterAll(async () => {
  if (workDir) {
    await rm(workDir, { recursive: true, force: true });
  }
});

function makeRegistry() {
  // Minimal module set so the IO handlers register without dragging in
  // the full runtime providers / DB-backed handlers.
  const reg = createRegistry([stdModule, codecModule], {
    dispatchRegistry,
  });
  registerFilesystemHandlers(reg);
  return reg;
}

const fakeCtx = {
  accountId: "test-account",
  profileId: "test-profile",
  callFunction: async () => null,
  dispatchAction: async () => null,
  signedQueueUrl: () => "",
} as never;

describe("fs.write_file + fs.read_file", () => {
  it("round-trips raw bytes", async () => {
    const reg = makeRegistry();
    const path = join(workDir, "bytes.bin");
    const bytes = Uint8Array.of(0x48, 0x65, 0x6c, 0x6c, 0x6f);

    const writeHandler = reg.getIOHandler("fs.write_file");
    const readHandler = reg.getIOHandler("fs.read_file");
    expect(writeHandler).toBeDefined();
    expect(readHandler).toBeDefined();

    const writeResult = await writeHandler!({ path, bytes }, fakeCtx);
    expect(writeResult).toEqual({
      action: "continue",
      value: { $tag: "Ok", _0: null },
    });

    const readResult = (await readHandler!({ path }, fakeCtx)) as {
      action: string;
      value: { $tag: string; value: Uint8Array };
    };
    expect(readResult.action).toBe("continue");
    expect(readResult.value.$tag).toBe("Ok");
    expect(Array.from(readResult.value.value)).toEqual([0x48, 0x65, 0x6c, 0x6c, 0x6f]);
  });

  it("round-trips text via the 'text' arg", async () => {
    const reg = makeRegistry();
    const path = join(workDir, "text.txt");
    await reg.getIOHandler("fs.write_file")!({ path, text: "hello, world" }, fakeCtx);
    const readResult = (await reg.getIOHandler("fs.read_file")!({ path }, fakeCtx)) as {
      action: string;
      value: { $tag: string; value: Uint8Array };
    };
    expect(readResult.value.$tag).toBe("Ok");
    expect(new TextDecoder().decode(readResult.value.value)).toBe("hello, world");
  });

  it("write returns Err when neither bytes nor text supplied", async () => {
    const reg = makeRegistry();
    const path = join(workDir, "missing-payload.bin");
    const result = (await reg.getIOHandler("fs.write_file")!({ path }, fakeCtx)) as {
      action: string;
      value: { $tag: string; value: string };
    };
    expect(result.value.$tag).toBe("Err");
    expect(result.value.value).toMatch(/bytes.*text/);
  });

  it("read returns Err when the file does not exist", async () => {
    const reg = makeRegistry();
    const path = join(workDir, "nonexistent.bin");
    const result = (await reg.getIOHandler("fs.read_file")!({ path }, fakeCtx)) as {
      action: string;
      value: { $tag: string; value: string };
    };
    expect(result.value.$tag).toBe("Err");
  });

  it("write accepts number[] payloads (the codec module's Bytes shape)", async () => {
    const reg = makeRegistry();
    const path = join(workDir, "from-array.bin");
    const writeResult = (await reg.getIOHandler("fs.write_file")!(
      { path, bytes: [1, 2, 3, 4] },
      fakeCtx,
    )) as { action: string; value: { $tag: string } };
    expect(writeResult.value.$tag).toBe("Ok");
    const readResult = (await reg.getIOHandler("fs.read_file")!({ path }, fakeCtx)) as {
      action: string;
      value: { $tag: string; value: Uint8Array };
    };
    expect(Array.from(readResult.value.value)).toEqual([1, 2, 3, 4]);
  });
});

describe("fs.list_dir", () => {
  it("returns sorted entries", async () => {
    const reg = makeRegistry();
    // Set up a fresh sub-directory with predictable contents.
    const sub = join(workDir, "list-test");
    await reg.getIOHandler("fs.write_file")!({ path: join(sub, "a.txt"), text: "1" }, fakeCtx).catch(() => undefined);
    // The above will fail because the dir doesn't exist yet; recreate.
    const { mkdir } = await import("node:fs/promises");
    await mkdir(sub, { recursive: true });
    for (const name of ["c.txt", "a.txt", "b.txt"]) {
      await reg.getIOHandler("fs.write_file")!({ path: join(sub, name), text: name }, fakeCtx);
    }
    const result = (await reg.getIOHandler("fs.list_dir")!({ path: sub }, fakeCtx)) as {
      action: string;
      value: { $tag: string; value: string[] };
    };
    expect(result.value.$tag).toBe("Ok");
    expect(result.value.value).toEqual(["a.txt", "b.txt", "c.txt"]);
  });

  it("returns Err for missing directory", async () => {
    const reg = makeRegistry();
    const result = (await reg.getIOHandler("fs.list_dir")!(
      { path: join(workDir, "no-such-dir") },
      fakeCtx,
    )) as { action: string; value: { $tag: string } };
    expect(result.value.$tag).toBe("Err");
  });
});

describe("fs.file_exists", () => {
  it("returns Just true for an existing file", async () => {
    const reg = makeRegistry();
    const path = join(workDir, "exists.txt");
    await reg.getIOHandler("fs.write_file")!({ path, text: "x" }, fakeCtx);
    const result = (await reg.getIOHandler("fs.file_exists")!({ path }, fakeCtx)) as {
      action: string;
      value: { $tag: string; value: boolean };
    };
    expect(result.value).toEqual({ $tag: "Just", _0: true });
  });

  it("returns Nothing for a missing path", async () => {
    const reg = makeRegistry();
    const result = (await reg.getIOHandler("fs.file_exists")!(
      { path: join(workDir, "nope.txt") },
      fakeCtx,
    )) as { action: string; value: { $tag: string } };
    expect(result.value).toEqual({ $tag: "Nothing" });
  });
});

// ---------------------------------------------------------------------------
// End-to-end: write base64-encoded bytes via codec, then read them back.
// Exercises the integration story Phase 2 was designed for.
// ---------------------------------------------------------------------------

describe("end-to-end — base64 encode → write → read → decode", () => {
  it("round-trips through filesystem + codec", async () => {
    const reg = makeRegistry();
    const path = join(workDir, "encoded.b64");
    const original = Uint8Array.of(0xde, 0xad, 0xbe, 0xef);

    // Encode to base64 string
    const encoded = codecNatives.base64Encode!(original) as { $tag: string; value: string };
    expect(encoded.$tag).toBe("Ok");

    // Write the base64 string to disk
    const writeResult = (await reg.getIOHandler("fs.write_file")!(
      { path, text: encoded.value },
      fakeCtx,
    )) as { action: string; value: { $tag: string } };
    expect(writeResult.value.$tag).toBe("Ok");

    // Read it back as bytes, then decode the UTF-8 → string
    const readResult = (await reg.getIOHandler("fs.read_file")!({ path }, fakeCtx)) as {
      action: string;
      value: { $tag: string; value: Uint8Array };
    };
    expect(readResult.value.$tag).toBe("Ok");
    const text = new TextDecoder().decode(readResult.value.value);

    // Decode the base64 → bytes
    const decoded = codecNatives.base64Decode!(text) as { $tag: string; value: Uint8Array };
    expect(decoded.$tag).toBe("Ok");
    expect(Array.from(decoded.value)).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });
});
