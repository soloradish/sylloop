import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { classifyCiChange } from "./classify-ci-change.mjs";
import { setVersion } from "./version.mjs";

const roots = [];

function git(root, ...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }).trim();
}

async function createRepository() {
  const root = await mkdtemp(path.join(os.tmpdir(), "sylloop-ci-change-"));
  roots.push(root);
  await mkdir(path.join(root, "src-tauri", "src"), { recursive: true });
  await Promise.all([
    writeFile(path.join(root, "package.json"), '{"name":"sylloop","version":"0.1.0","dependencies":{"react":"19.0.0"}}\n'),
    writeFile(path.join(root, "package-lock.json"), '{"name":"sylloop","version":"0.1.0","lockfileVersion":3,"packages":{"":{"name":"sylloop","version":"0.1.0","dependencies":{"react":"19.0.0"}},"node_modules/react":{"version":"19.0.0"}}}\n'),
    writeFile(path.join(root, "src-tauri", "Cargo.toml"), '[package]\nname = "sylloop"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\nserde = "1"\n'),
    writeFile(path.join(root, "src-tauri", "Cargo.lock"), 'version = 4\n\n[[package]]\nname = "sylloop"\nversion = "0.1.0"\ndependencies = ["serde"]\n\n[[package]]\nname = "serde"\nversion = "1.0.0"\n'),
    writeFile(path.join(root, "src-tauri", "tauri.conf.json"), '{"productName":"Sylloop","version":"0.1.0"}\n'),
    writeFile(path.join(root, "src-tauri", "src", "lib.rs"), "pub fn run() {}\n"),
    writeFile(path.join(root, "CHANGELOG.md"), "# Changelog\n\n## [Unreleased]\n"),
  ]);
  git(root, "init", "-b", "main");
  git(root, "config", "core.autocrlf", "false");
  git(root, "config", "user.name", "CI Change Test");
  git(root, "config", "user.email", "ci-change@example.invalid");
  git(root, "add", ".");
  git(root, "commit", "-m", "base");
  return { root, base: git(root, "rev-parse", "HEAD") };
}

async function prepareRelease(root) {
  await setVersion(root, "0.2.0");
  await writeFile(path.join(root, "CHANGELOG.md"), "# Changelog\n\n## [Unreleased]\n\n## [0.2.0]\n\n- Release.\n");
}

function commit(root, message = "prepare release") {
  git(root, "add", ".");
  git(root, "commit", "-m", message);
  return git(root, "rev-parse", "HEAD");
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("CI change classification", () => {
  it("recognizes a synchronized standard release change", async () => {
    const { root, base } = await createRepository();
    await prepareRelease(root);
    const head = commit(root);
    await expect(classifyCiChange({ root, base, head, headRef: "codex/release-v0.2.0" })).resolves.toBe("release-only");
  });

  it.each([
    ["package dependency", async (root) => {
      const file = path.join(root, "package.json");
      const value = JSON.parse(await readFile(file, "utf8"));
      value.dependencies.react = "19.1.0";
      await writeFile(file, `${JSON.stringify(value)}\n`);
    }],
    ["Cargo dependency", async (root) => {
      const file = path.join(root, "src-tauri", "Cargo.toml");
      await writeFile(file, (await readFile(file, "utf8")).replace('serde = "1"', 'serde = "1.1"'));
    }],
  ])("uses full CI when a %s changes", async (_label, mutate) => {
    const { root, base } = await createRepository();
    await prepareRelease(root);
    await mutate(root);
    const head = commit(root);
    await expect(classifyCiChange({ root, base, head, headRef: "codex/release-v0.2.0" })).resolves.toBe("full");
  });

  it("uses full CI when an extra source file changes", async () => {
    const { root, base } = await createRepository();
    await prepareRelease(root);
    await writeFile(path.join(root, "src-tauri", "src", "lib.rs"), "pub fn run() { println!(\"changed\"); }\n");
    const head = commit(root);
    await expect(classifyCiChange({ root, base, head, headRef: "codex/release-v0.2.0" })).resolves.toBe("full");
  });

  it("uses full CI outside the release branch convention", async () => {
    const { root, base } = await createRepository();
    await prepareRelease(root);
    const head = commit(root);
    await expect(classifyCiChange({ root, base, head, headRef: "codex/version-update" })).resolves.toBe("full");
  });

  it("uses full CI when a required version file is unchanged", async () => {
    const { root, base } = await createRepository();
    await prepareRelease(root);
    const original = git(root, "show", `${base}:src-tauri/Cargo.lock`);
    await writeFile(path.join(root, "src-tauri", "Cargo.lock"), `${original}\n`);
    const head = commit(root);
    await expect(classifyCiChange({ root, base, head, headRef: "codex/release-v0.2.0" })).resolves.toBe("full");
  });

  it("uses full CI for unsynchronized or malformed version metadata", async () => {
    const { root, base } = await createRepository();
    await prepareRelease(root);
    await writeFile(path.join(root, "src-tauri", "tauri.conf.json"), '{"productName":"Sylloop","version":"not-semver"}\n');
    const head = commit(root);
    await expect(classifyCiChange({ root, base, head, headRef: "codex/release-v0.2.0" })).resolves.toBe("full");
  });
});
