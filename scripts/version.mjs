import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const STABLE_SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

const VERSION_FILES = {
  packageJson: "package.json",
  packageLock: "package-lock.json",
  cargoToml: path.join("src-tauri", "Cargo.toml"),
  cargoLock: path.join("src-tauri", "Cargo.lock"),
  tauriConfig: path.join("src-tauri", "tauri.conf.json"),
};

function parseStableSemver(value, label = "version") {
  const match = STABLE_SEMVER_PATTERN.exec(value);
  if (!match) {
    throw new Error(`${label} must be a stable semantic version in X.Y.Z form without leading zeroes: ${value}`);
  }
  return match.slice(1).map(Number);
}

export function compareStableSemver(left, right) {
  const leftParts = parseStableSemver(left, "left version");
  const rightParts = parseStableSemver(right, "right version");
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }
  return 0;
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function findTomlSection(text, sectionName, label) {
  const sectionPattern = new RegExp(`^\\[${sectionName.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\]\\s*$`, "m");
  const match = sectionPattern.exec(text);
  if (!match) throw new Error(`${label} is missing [${sectionName}]`);
  const start = match.index + match[0].length;
  const rest = text.slice(start);
  const nextSection = /^\s*\[[^[]/m.exec(rest);
  return { start, end: nextSection ? start + nextSection.index : text.length };
}

function readTomlVersion(text, sectionName, label) {
  const section = findTomlSection(text, sectionName, label);
  const content = text.slice(section.start, section.end);
  const matches = [...content.matchAll(/^version\s*=\s*"([^"]+)"\s*$/gm)];
  if (matches.length !== 1) throw new Error(`${label} must contain exactly one version in [${sectionName}]`);
  return matches[0][1];
}

function replaceTomlVersion(text, sectionName, version, label) {
  const section = findTomlSection(text, sectionName, label);
  const content = text.slice(section.start, section.end);
  const matches = [...content.matchAll(/^version\s*=\s*"([^"]+)"\s*$/gm)];
  if (matches.length !== 1) throw new Error(`${label} must contain exactly one version in [${sectionName}]`);
  const updated = content.replace(/^version\s*=\s*"[^"]+"\s*$/m, `version = "${version}"`);
  return text.slice(0, section.start) + updated + text.slice(section.end);
}

function findCargoLockPackage(text, packageName) {
  const starts = [...text.matchAll(/^\[\[package\]\]\s*$/gm)].map((match) => match.index);
  const matching = [];
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index];
    const end = starts[index + 1] ?? text.length;
    const block = text.slice(start, end);
    if (new RegExp(`^name = "${packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*$`, "m").test(block)) {
      matching.push({ start, end, block });
    }
  }
  if (matching.length !== 1) throw new Error(`Cargo.lock must contain exactly one ${packageName} package entry`);
  return matching[0];
}

function readCargoLockVersion(text) {
  const entry = findCargoLockPackage(text, "sylloop");
  const matches = [...entry.block.matchAll(/^version = "([^"]+)"\s*$/gm)];
  if (matches.length !== 1) throw new Error("Cargo.lock sylloop entry must contain exactly one version");
  return matches[0][1];
}

function replaceCargoLockVersion(text, version) {
  const entry = findCargoLockPackage(text, "sylloop");
  const matches = [...entry.block.matchAll(/^version = "([^"]+)"\s*$/gm)];
  if (matches.length !== 1) throw new Error("Cargo.lock sylloop entry must contain exactly one version");
  const updated = entry.block.replace(/^version = "[^"]+"\s*$/m, `version = "${version}"`);
  return text.slice(0, entry.start) + updated + text.slice(entry.end);
}

async function readVersionFiles(root) {
  const entries = await Promise.all(Object.entries(VERSION_FILES).map(async ([key, relativePath]) => {
    const absolutePath = path.join(root, relativePath);
    return [key, { relativePath, absolutePath, text: await readFile(absolutePath, "utf8") }];
  }));
  return Object.fromEntries(entries);
}

export async function collectVersionState(root = process.cwd()) {
  const files = await readVersionFiles(root);
  const packageJson = parseJson(files.packageJson.text, VERSION_FILES.packageJson);
  const packageLock = parseJson(files.packageLock.text, VERSION_FILES.packageLock);
  const tauriConfig = parseJson(files.tauriConfig.text, VERSION_FILES.tauriConfig);

  const values = {
    tauriConfig: tauriConfig.version,
    packageJson: packageJson.version,
    packageLock: packageLock.version,
    packageLockRoot: packageLock.packages?.[""]?.version,
    cargoToml: readTomlVersion(files.cargoToml.text, "package", VERSION_FILES.cargoToml),
    cargoLock: readCargoLockVersion(files.cargoLock.text),
  };

  for (const [label, value] of Object.entries(values)) {
    if (typeof value !== "string") throw new Error(`${label} version is missing`);
    parseStableSemver(value, label);
  }

  return { authoritativeVersion: values.tauriConfig, values, files };
}

export async function checkVersion(root = process.cwd(), expectedTag = null) {
  const state = await collectVersionState(root);
  const mismatches = Object.entries(state.values).filter(([, value]) => value !== state.authoritativeVersion);
  if (mismatches.length) {
    const detail = mismatches.map(([label, value]) => `${label}=${value}`).join(", ");
    throw new Error(`Version sources do not match tauriConfig=${state.authoritativeVersion}: ${detail}`);
  }
  if (expectedTag !== null) {
    const expected = `v${state.authoritativeVersion}`;
    if (expectedTag !== expected) throw new Error(`Tag ${expectedTag} does not match application version ${expected}`);
  }
  return state;
}

function stringifyJson(value, originalText) {
  const newline = originalText.includes("\r\n") ? "\r\n" : "\n";
  const trailingNewline = originalText.endsWith("\n") ? newline : "";
  return JSON.stringify(value, null, 2).replaceAll("\n", newline) + trailingNewline;
}

async function writeTransaction(changes, writer = writeFile) {
  const written = [];
  try {
    for (const change of changes) {
      await writer(change.absolutePath, change.updatedText, "utf8");
      written.push(change);
    }
  } catch (error) {
    await Promise.allSettled(written.map((change) => writer(change.absolutePath, change.originalText, "utf8")));
    throw error;
  }
}

export async function setVersion(root = process.cwd(), nextVersion, writer = writeFile) {
  parseStableSemver(nextVersion, "new version");
  const state = await collectVersionState(root);
  if (compareStableSemver(nextVersion, state.authoritativeVersion) < 0) {
    throw new Error(`Version downgrade is not allowed: ${state.authoritativeVersion} -> ${nextVersion}`);
  }

  const packageJson = parseJson(state.files.packageJson.text, VERSION_FILES.packageJson);
  const packageLock = parseJson(state.files.packageLock.text, VERSION_FILES.packageLock);
  const tauriConfig = parseJson(state.files.tauriConfig.text, VERSION_FILES.tauriConfig);
  if (!packageLock.packages?.[""]) throw new Error("package-lock.json is missing the root packages entry");

  packageJson.version = nextVersion;
  packageLock.version = nextVersion;
  packageLock.packages[""].version = nextVersion;
  tauriConfig.version = nextVersion;

  const updatedByKey = {
    packageJson: stringifyJson(packageJson, state.files.packageJson.text),
    packageLock: stringifyJson(packageLock, state.files.packageLock.text),
    tauriConfig: stringifyJson(tauriConfig, state.files.tauriConfig.text),
    cargoToml: replaceTomlVersion(state.files.cargoToml.text, "package", nextVersion, VERSION_FILES.cargoToml),
    cargoLock: replaceCargoLockVersion(state.files.cargoLock.text, nextVersion),
  };

  const changes = Object.entries(updatedByKey).map(([key, updatedText]) => ({
    absolutePath: state.files[key].absolutePath,
    originalText: state.files[key].text,
    updatedText,
  }));
  await writeTransaction(changes, writer);
  return checkVersion(root);
}

function parseCliArguments(args) {
  const [command, ...rest] = args;
  if (command === "set") {
    if (rest.length !== 1) throw new Error("Usage: npm run version:set -- X.Y.Z");
    return { command, version: rest[0] };
  }
  if (command === "check") {
    if (!rest.length) return { command, tag: null };
    if (rest.length === 2 && rest[0] === "--tag") return { command, tag: rest[1] };
    throw new Error("Usage: npm run version:check -- [--tag vX.Y.Z]");
  }
  throw new Error("Usage: node scripts/version.mjs <set X.Y.Z|check [--tag vX.Y.Z]>");
}

async function main() {
  const options = parseCliArguments(process.argv.slice(2));
  const state = options.command === "set"
    ? await setVersion(process.cwd(), options.version)
    : await checkVersion(process.cwd(), options.tag);
  for (const [label, value] of Object.entries(state.values)) console.log(`${label}: ${value}`);
  if (options.command === "set") console.log(`Version synchronized at ${state.authoritativeVersion}.`);
  else console.log(options.tag ? `Version and tag ${options.tag} are valid.` : "Version sources are synchronized.");
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
