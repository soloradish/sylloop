import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STABLE_SEMVER_PATTERN } from "./version.mjs";

export const RELEASE_MANIFEST_FILE_NAME = "sylloop-release-v1.json";

const REPOSITORY_RELEASE_URL = "https://github.com/soloradish/sylloop/releases/download";
const SOURCE_COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

function parseReleaseTag(tag) {
  if (typeof tag !== "string" || !tag.startsWith("v")) {
    throw new Error(`Release tag must be in vX.Y.Z form: ${tag}`);
  }
  const version = tag.slice(1);
  if (!STABLE_SEMVER_PATTERN.test(version)) {
    throw new Error(`Release tag must contain a stable semantic version: ${tag}`);
  }
  return version;
}

function normalizePublishedAt(value) {
  if (typeof value !== "string" || !RFC3339_PATTERN.test(value)) {
    throw new Error(`Published time must be RFC 3339: ${value}`);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`Published time must be RFC 3339: ${value}`);
  return new Date(timestamp).toISOString();
}

const ASSET_SPECS = {
  windows_x86_64: (version) => `Sylloop_${version}_x64-setup.exe`,
  macos_aarch64: (version) => `Sylloop_${version}_aarch64.dmg`,
  macos_x86_64: (version) => `Sylloop_${version}_x64.dmg`,
};

export async function createReleaseManifest({ assetPaths, tag, sourceCommit, publishedAt }) {
  const version = parseReleaseTag(tag);
  const normalizedCommit = sourceCommit?.toLowerCase();
  if (!SOURCE_COMMIT_PATTERN.test(normalizedCommit ?? "")) {
    throw new Error(`Source commit must be a full 40-character Git SHA: ${sourceCommit}`);
  }

  const downloads = {};
  for (const [platform, expectedName] of Object.entries(ASSET_SPECS)) {
    const assetPath = assetPaths?.[platform];
    if (!assetPath) throw new Error(`Missing release asset for ${platform}`);
    const asset = await stat(assetPath);
    if (!asset.isFile() || asset.size <= 0) {
      throw new Error(`Release asset must be a non-empty file: ${assetPath}`);
    }
    const fileName = path.basename(assetPath);
    const canonicalName = expectedName(version);
    if (fileName !== canonicalName) {
      throw new Error(`Release asset filename must be the canonical name ${canonicalName}: ${fileName}`);
    }
    downloads[platform] = {
      fileName,
      url: `${REPOSITORY_RELEASE_URL}/${encodeURIComponent(tag)}/${encodeURIComponent(fileName)}`,
      size: asset.size,
      sha256: await sha256File(assetPath),
    };
  }

  return {
    schemaVersion: 1,
    product: "sylloop",
    channel: "stable",
    version,
    publishedAt: normalizePublishedAt(publishedAt),
    sourceCommit: normalizedCommit,
    productPages: {
      zh: "https://lowid.me/zh/sylloop/",
      en: "https://lowid.me/en/sylloop/",
    },
    downloads,
  };
}

export async function writeReleaseManifest(options) {
  const manifest = await createReleaseManifest(options);
  const outputPath = options.outputPath ?? path.resolve(RELEASE_MANIFEST_FILE_NAME);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { manifest, outputPath };
}

function parseCliArguments(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || value === undefined) {
      throw new Error("Usage: release-manifest --windows PATH --macos-aarch64 PATH --macos-x86-64 PATH --tag vX.Y.Z --source-commit SHA --published-at RFC3339 --output PATH");
    }
    values.set(name, value);
  }

  const required = ["--windows", "--macos-aarch64", "--macos-x86-64", "--tag", "--source-commit", "--published-at", "--output"];
  for (const name of required) {
    if (!values.has(name)) throw new Error(`Missing required argument ${name}`);
  }
  if (values.size !== required.length) throw new Error("Unknown or duplicate release manifest argument");

  return {
    assetPaths: {
      windows_x86_64: path.resolve(values.get("--windows")),
      macos_aarch64: path.resolve(values.get("--macos-aarch64")),
      macos_x86_64: path.resolve(values.get("--macos-x86-64")),
    },
    tag: values.get("--tag"),
    sourceCommit: values.get("--source-commit"),
    publishedAt: values.get("--published-at"),
    outputPath: path.resolve(values.get("--output")),
  };
}

async function main() {
  const { manifest, outputPath } = await writeReleaseManifest(parseCliArguments(process.argv.slice(2)));
  console.log(`Wrote ${outputPath}`);
  console.log(`Sylloop ${manifest.version}: ${Object.keys(manifest.downloads).length} release assets`);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
