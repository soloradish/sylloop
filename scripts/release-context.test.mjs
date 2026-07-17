import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectReleaseContext } from "../.agents/skills/bump-sylloop-version/scripts/collect-release-context.mjs";

const roots = [];

function git(root, ...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
}

async function createFirstReleaseRepository() {
  const root = await mkdtemp(path.join(os.tmpdir(), "sylloop-release-context-"));
  roots.push(root);
  await mkdir(path.join(root, "src-tauri"), { recursive: true });
  await Promise.all([
    writeFile(path.join(root, "package.json"), '{"name":"sylloop","version":"0.1.0"}\n'),
    writeFile(path.join(root, "package-lock.json"), '{"name":"sylloop","version":"0.1.0","packages":{"":{"name":"sylloop","version":"0.1.0"}}}\n'),
    writeFile(path.join(root, "src-tauri", "Cargo.toml"), '[package]\nname = "sylloop"\nversion = "0.1.0"\n'),
    writeFile(path.join(root, "src-tauri", "Cargo.lock"), 'version = 4\n\n[[package]]\nname = "sylloop"\nversion = "0.1.0"\n'),
    writeFile(path.join(root, "src-tauri", "tauri.conf.json"), '{"productName":"Sylloop","version":"0.1.0"}\n'),
    writeFile(path.join(root, "CHANGELOG.md"), '# Changelog\n\n## [Unreleased]\n\n### Added\n\n- First public release.\n'),
  ]);
  git(root, "init", "-b", "main");
  git(root, "config", "user.name", "Release Context Test");
  git(root, "config", "user.email", "release-context@example.invalid");
  git(root, "add", ".");
  git(root, "commit", "-m", "Initial application");
  git(root, "update-ref", "refs/remotes/origin/main", "HEAD");
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("release context collector", () => {
  it("reports synchronized first-release evidence without making a recommendation", async () => {
    const root = await createFirstReleaseRepository();
    const context = await collectReleaseContext(root, { offline: true });
    expect(context.baseTag).toBeNull();
    expect(context.stableTags).toEqual([]);
    expect(context.allStableTags).toEqual([]);
    expect(context.range).toBe("initial..origin/main");
    expect(context.versions.authoritativeVersion).toBe("0.1.0");
    expect(context.versions.synchronized).toBe(true);
    expect(context.unreleasedChangelog).toContain("First public release.");
    expect(context.changedFiles).toContain("A\tpackage.json");
    expect(context.github).toEqual({ available: false, error: "offline mode" });
    expect(context).not.toHaveProperty("recommendation");
  });
});
