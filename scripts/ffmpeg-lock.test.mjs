import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const lock = JSON.parse(await readFile(path.join(root, "scripts", "ffmpeg-lock.json"), "utf8"));

describe("FFmpeg distribution lock", () => {
  it("pins one immutable core asset for every shipped architecture", () => {
    expect(lock.repository).toBe("soloradish/ffmpeg-dist");
    expect(lock.profile).toBe("core");
    expect(lock.license).toBe("LGPL-2.1-or-later");
    expect(Object.keys(lock.assets).sort()).toEqual([
      "macos-aarch64",
      "macos-x86_64",
      "windows-x86_64",
    ]);

    for (const [target, asset] of Object.entries(lock.assets)) {
      expect(asset.target).toBe(target);
      expect(asset.url).toBe(
        `https://github.com/${lock.repository}/releases/download/${lock.releaseTag}/${asset.archiveName}`,
      );
      expect(asset.packageDirectory).toBe(asset.archiveName.replace(/\.(?:zip|tar\.xz)$/, ""));
      expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("pins the exact corresponding source and build provenance", () => {
    expect(lock.source.url).toBe(
      `https://github.com/${lock.repository}/releases/download/${lock.releaseTag}/${lock.source.archiveName}`,
    );
    expect(lock.source.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(lock.source.upstreamSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(lock.build.url).toBe(`https://github.com/${lock.repository}/tree/${lock.build.commit}`);
    expect(lock.build.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(lock.licenseFiles).toEqual([
      "FFmpeg-COPYING.LGPLv2.1",
      "FFmpeg-COPYING.LGPLv3",
      "FFmpeg-LICENSE.md",
    ]);
  });
});
