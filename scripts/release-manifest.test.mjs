import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createReleaseManifest, writeReleaseManifest } from "./release-manifest.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(async (directory) => {
    const { rm } = await import("node:fs/promises");
    await rm(directory, { recursive: true, force: true });
  }));
});

async function fixture(fileName = "Sylloop_1.2.3_x64-setup.exe") {
  const directory = await mkdtemp(path.join(tmpdir(), "sylloop-release-manifest-"));
  temporaryDirectories.push(directory);
  const installerPath = path.join(directory, fileName);
  const bytes = Buffer.from("installer fixture");
  await writeFile(installerPath, bytes);
  return { directory, installerPath, bytes };
}

const validOptions = {
  tag: "v1.2.3",
  sourceCommit: "ABCDEF0123456789ABCDEF0123456789ABCDEF01",
  publishedAt: "2026-07-17T17:32:13-04:00",
};

describe("release manifest generation", () => {
  it("derives immutable release metadata from the installer", async () => {
    const { installerPath, bytes } = await fixture();
    const manifest = await createReleaseManifest({ installerPath, ...validOptions });

    expect(manifest).toEqual({
      schemaVersion: 1,
      product: "sylloop",
      channel: "stable",
      version: "1.2.3",
      publishedAt: "2026-07-17T21:32:13.000Z",
      sourceCommit: validOptions.sourceCommit.toLowerCase(),
      productPages: {
        zh: "https://lowid.me/zh/sylloop/",
        en: "https://lowid.me/en/sylloop/",
      },
      downloads: {
        windows_x86_64: {
          fileName: "Sylloop_1.2.3_x64-setup.exe",
          url: "https://github.com/soloradish/sylloop/releases/download/v1.2.3/Sylloop_1.2.3_x64-setup.exe",
          size: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        },
      },
    });
  });

  it("writes a stable JSON asset name with a trailing newline", async () => {
    const { directory, installerPath } = await fixture();
    const outputPath = path.join(directory, "assets", "sylloop-release-v1.json");
    const { manifest } = await writeReleaseManifest({ installerPath, outputPath, ...validOptions });
    const text = await readFile(outputPath, "utf8");

    expect(text.endsWith("\n")).toBe(true);
    expect(JSON.parse(text)).toEqual(manifest);
  });

  it.each([
    ["v1.2", validOptions.sourceCommit, validOptions.publishedAt, "stable semantic version"],
    ["1.2.3", validOptions.sourceCommit, validOptions.publishedAt, "vX.Y.Z"],
    [validOptions.tag, "abc123", validOptions.publishedAt, "40-character Git SHA"],
    [validOptions.tag, validOptions.sourceCommit, "not-a-date", "RFC 3339"],
    [validOptions.tag, validOptions.sourceCommit, "2026-07-17", "RFC 3339"],
  ])("rejects invalid release identity", async (tag, sourceCommit, publishedAt, message) => {
    const { installerPath } = await fixture();
    await expect(createReleaseManifest({ installerPath, tag, sourceCommit, publishedAt })).rejects.toThrow(message);
  });

  it("rejects installers whose filename does not match the release", async () => {
    const { installerPath } = await fixture("Sylloop_1.2.2_x64-setup.exe");
    await expect(createReleaseManifest({ installerPath, ...validOptions })).rejects.toThrow("canonical release name");
  });
});
