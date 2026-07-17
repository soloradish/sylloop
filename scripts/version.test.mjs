import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkVersion, setVersion } from "./version.mjs";

const roots = [];

async function createFixture(overrides = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "sylloop-version-"));
  roots.push(root);
  await mkdir(path.join(root, "src-tauri"), { recursive: true });
  const files = {
    "package.json": '{\n  "name": "sylloop",\n  "version": "0.1.0"\n}\n',
    "package-lock.json": '{\n  "name": "sylloop",\n  "version": "0.1.0",\n  "packages": {\n    "": {\n      "name": "sylloop",\n      "version": "0.1.0"\n    }\n  }\n}\n',
    "src-tauri/Cargo.toml": '[package]\nname = "sylloop"\nversion = "0.1.0"\nedition = "2021"\n',
    "src-tauri/Cargo.lock": 'version = 4\n\n[[package]]\nname = "sylloop"\nversion = "0.1.0"\ndependencies = []\n\n[[package]]\nname = "other"\nversion = "2.0.0"\n',
    "src-tauri/tauri.conf.json": '{\n  "productName": "Sylloop",\n  "version": "0.1.0"\n}\n',
    ...overrides,
  };
  await Promise.all(Object.entries(files).map(([relativePath, contents]) => writeFile(path.join(root, relativePath), contents, "utf8")));
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("version management", () => {
  it("synchronizes every application version source", async () => {
    const root = await createFixture();
    const state = await setVersion(root, "0.2.0");
    expect(new Set(Object.values(state.values))).toEqual(new Set(["0.2.0"]));
    expect(await readFile(path.join(root, "src-tauri/Cargo.lock"), "utf8")).toContain('name = "other"\nversion = "2.0.0"');
  });

  it.each(["1", "1.2", "01.2.3", "1.02.3", "1.2.03", "1.2.3-beta.1", "v1.2.3"])(
    "rejects an invalid stable version: %s",
    async (version) => {
      const root = await createFixture();
      await expect(setVersion(root, version)).rejects.toThrow("stable semantic version");
    },
  );

  it("rejects downgrades", async () => {
    const root = await createFixture();
    await setVersion(root, "1.2.3");
    await expect(setVersion(root, "1.2.2")).rejects.toThrow("Version downgrade is not allowed");
  });

  it("reports mismatched manifests and tags", async () => {
    const root = await createFixture({
      "package.json": '{\n  "name": "sylloop",\n  "version": "0.1.1"\n}\n',
    });
    await expect(checkVersion(root)).rejects.toThrow("Version sources do not match");
    const synchronized = await createFixture();
    await expect(checkVersion(synchronized, "v0.1.1")).rejects.toThrow("does not match application version v0.1.0");
  });

  it("validates every structure before writing any file", async () => {
    const malformedCargo = '[package]\nname = "sylloop"\nedition = "2021"\n';
    const root = await createFixture({ "src-tauri/Cargo.toml": malformedCargo });
    const before = await readFile(path.join(root, "package.json"), "utf8");
    await expect(setVersion(root, "0.2.0")).rejects.toThrow("exactly one version");
    expect(await readFile(path.join(root, "package.json"), "utf8")).toBe(before);
    expect(await readFile(path.join(root, "src-tauri/Cargo.toml"), "utf8")).toBe(malformedCargo);
  });

  it("rejects duplicate version declarations before writing", async () => {
    const duplicateCargo = '[package]\nname = "sylloop"\nversion = "0.1.0"\nversion = "0.1.0"\n';
    const root = await createFixture({ "src-tauri/Cargo.toml": duplicateCargo });
    const before = await readFile(path.join(root, "package.json"), "utf8");
    await expect(setVersion(root, "0.2.0")).rejects.toThrow("exactly one version");
    expect(await readFile(path.join(root, "package.json"), "utf8")).toBe(before);
  });

  it("rolls back earlier writes when a later write fails", async () => {
    const root = await createFixture();
    const before = await Promise.all([
      readFile(path.join(root, "package.json"), "utf8"),
      readFile(path.join(root, "package-lock.json"), "utf8"),
    ]);
    let writeCount = 0;
    let failed = false;
    const failOnceWriter = async (...args) => {
      writeCount += 1;
      if (!failed && writeCount === 3) {
        failed = true;
        throw new Error("simulated write failure");
      }
      return writeFile(...args);
    };

    await expect(setVersion(root, "0.2.0", failOnceWriter)).rejects.toThrow("simulated write failure");
    expect(await readFile(path.join(root, "package.json"), "utf8")).toBe(before[0]);
    expect(await readFile(path.join(root, "package-lock.json"), "utf8")).toBe(before[1]);
    expect((await checkVersion(root)).authoritativeVersion).toBe("0.1.0");
  });
});
