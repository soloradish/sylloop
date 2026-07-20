import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function read(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

describe("macOS distribution signing policy", () => {
  it("configures ad-hoc signing without changing the deployment target", async () => {
    const config = JSON.parse(await read("src-tauri/tauri.macos.conf.json"));
    expect(config.bundle.macOS).toMatchObject({
      minimumSystemVersion: "11.0",
      signingIdentity: "-",
    });
  });

  it("ad-hoc signs FFmpeg and verifies final DMGs in CI and releases", async () => {
    const prepare = await read("scripts/prepare-ffmpeg.sh");
    const smoke = await read("scripts/smoke-macos-dmg.sh");
    const ci = await read(".github/workflows/ci.yml");
    const release = await read(".github/workflows/release.yml");

    expect(prepare).toContain('codesign --force --sign - "$output"');
    expect(prepare).toContain('codesign --verify --strict --verbose=2 "$output"');
    expect(smoke).toContain('codesign --verify --deep --strict --verbose=2 "$app"');
    expect(smoke).toContain("Signature=adhoc");
    expect(ci).toContain('bash scripts/smoke-macos-dmg.sh "$dmg" "$target"');
    expect(release).toContain('bash scripts/smoke-macos-dmg.sh "$dmg" "macos-${{ matrix.arch }}"');
  });
});
