import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkVersion } from "./version.mjs";

const RELEASE_BRANCH_PATTERN = /^codex\/release-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const RELEASE_FILES = [
  "CHANGELOG.md",
  "package-lock.json",
  "package.json",
  "src-tauri/Cargo.lock",
  "src-tauri/Cargo.toml",
  "src-tauri/tauri.conf.json",
];
const VERSION_PLACEHOLDER = "<release-version>";

function git(root, ...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
}

function readRevisionFile(root, revision, relativePath) {
  return git(root, "show", `${revision}:${relativePath}`);
}

function normalizeJson(text, relativePath) {
  const value = JSON.parse(text);
  if (relativePath === "package.json") {
    if (typeof value.version !== "string") throw new Error("package.json is missing version");
    value.version = VERSION_PLACEHOLDER;
  } else if (relativePath === "package-lock.json") {
    if (typeof value.version !== "string" || typeof value.packages?.[""]?.version !== "string") {
      throw new Error("package-lock.json is missing root versions");
    }
    value.version = VERSION_PLACEHOLDER;
    value.packages[""].version = VERSION_PLACEHOLDER;
  } else if (relativePath === "src-tauri/tauri.conf.json") {
    if (typeof value.version !== "string") throw new Error("tauri.conf.json is missing version");
    value.version = VERSION_PLACEHOLDER;
  }
  return JSON.stringify(value);
}

function findTomlSection(text, sectionName) {
  const match = new RegExp(`^\\[${sectionName}\\]\\s*$`, "m").exec(text);
  if (!match) throw new Error(`missing [${sectionName}] section`);
  const start = match.index + match[0].length;
  const rest = text.slice(start);
  const nextSection = /^\s*\[[^[]/m.exec(rest);
  return { start, end: nextSection ? start + nextSection.index : text.length };
}

function normalizeCargoToml(text) {
  const section = findTomlSection(text, "package");
  const content = text.slice(section.start, section.end);
  const versions = [...content.matchAll(/^version\s*=\s*"[^"]+"\s*$/gm)];
  if (versions.length !== 1) throw new Error("Cargo.toml package version is ambiguous");
  const normalized = content.replace(/^version\s*=\s*"[^"]+"\s*$/m, `version = "${VERSION_PLACEHOLDER}"`);
  return text.slice(0, section.start) + normalized + text.slice(section.end);
}

function normalizeCargoLock(text) {
  const starts = [...text.matchAll(/^\[\[package\]\]\s*$/gm)].map((match) => match.index);
  const matches = [];
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index];
    const end = starts[index + 1] ?? text.length;
    const block = text.slice(start, end);
    if (/^name = "sylloop"\s*$/m.test(block)) matches.push({ start, end, block });
  }
  if (matches.length !== 1) throw new Error("Cargo.lock sylloop package is ambiguous");
  const entry = matches[0];
  const versions = [...entry.block.matchAll(/^version = "[^"]+"\s*$/gm)];
  if (versions.length !== 1) throw new Error("Cargo.lock sylloop version is ambiguous");
  const normalized = entry.block.replace(
    /^version = "[^"]+"\s*$/m,
    `version = "${VERSION_PLACEHOLDER}"`,
  );
  return text.slice(0, entry.start) + normalized + text.slice(entry.end);
}

function normalizeVersionFile(text, relativePath) {
  if (relativePath.endsWith(".json")) return normalizeJson(text, relativePath);
  if (relativePath === "src-tauri/Cargo.toml") return normalizeCargoToml(text);
  if (relativePath === "src-tauri/Cargo.lock") return normalizeCargoLock(text);
  throw new Error(`unsupported release file: ${relativePath}`);
}

function changedFiles(root, base, head) {
  return git(root, "diff", "--name-only", "--diff-filter=ACDMRTUXB", base, head)
    .split(/\r?\n/u)
    .filter(Boolean)
    .sort();
}

export async function classifyCiChange({ root = process.cwd(), base, head, headRef }) {
  if (!RELEASE_BRANCH_PATTERN.test(headRef ?? "")) return "full";
  try {
    const files = changedFiles(root, base, head);
    if (files.length !== RELEASE_FILES.length || files.some((file, index) => file !== RELEASE_FILES[index])) {
      return "full";
    }

    for (const relativePath of RELEASE_FILES.filter((file) => file !== "CHANGELOG.md")) {
      const before = normalizeVersionFile(readRevisionFile(root, base, relativePath), relativePath);
      const after = normalizeVersionFile(readRevisionFile(root, head, relativePath), relativePath);
      if (before !== after) return "full";
    }

    await checkVersion(root);
    return "release-only";
  } catch {
    return "full";
  }
}

function parseArguments(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error("Usage: node scripts/classify-ci-change.mjs --base SHA --head SHA --head-ref BRANCH");
    }
    values[key.slice(2)] = value;
  }
  if (!values.base || !values.head || !values["head-ref"]) {
    throw new Error("Usage: node scripts/classify-ci-change.mjs --base SHA --head SHA --head-ref BRANCH");
  }
  return { base: values.base, head: values.head, headRef: values["head-ref"] };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  console.log(await classifyCiChange({ root: process.cwd(), ...options }));
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
