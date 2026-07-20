import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const directory = args.get("--directory");
const layout = args.get("--layout");
const target = args.get("--target");
if (!directory || !["package", "resource"].includes(layout) || !target) {
  throw new Error("Usage: node scripts/verify-ffmpeg-resource.mjs --directory PATH --layout package|resource --target TARGET");
}

const lock = JSON.parse(await readFile(path.join(root, "scripts", "ffmpeg-lock.json"), "utf8"));
const asset = lock.assets[target];
if (!asset) throw new Error(`FFmpeg lock does not contain target '${target}'.`);

const executableName = target.startsWith("windows-") ? "ffmpeg.exe" : "ffmpeg";
const executable = path.join(directory, layout === "package" ? "bin" : "", executableName);
const buildInfoPath = path.join(directory, layout === "package" ? "BUILD-INFO.json" : "FFMPEG_BUILD_INFO.json");
const licenses = path.join(directory, layout === "package" ? "LICENSES" : "FFMPEG_LICENSES");

await access(executable, target.startsWith("windows-") ? constants.F_OK : constants.X_OK);
const info = JSON.parse(await readFile(buildInfoPath, "utf8"));

function assertEqual(actual, expected, field) {
  if (actual !== expected) {
    throw new Error(`FFmpeg BUILD-INFO.json field '${field}' must be '${expected}', got '${actual}'.`);
  }
}

assertEqual(info.schemaVersion, lock.schemaVersion, "schemaVersion");
assertEqual(info.releaseTag, lock.releaseTag, "releaseTag");
assertEqual(info.ffmpegVersion, lock.ffmpegVersion, "ffmpegVersion");
assertEqual(info.distributionRevision, lock.distributionRevision, "distributionRevision");
assertEqual(info.profile, lock.profile, "profile");
assertEqual(info.target, asset.target, "target");
assertEqual(info.architecture, asset.architecture, "architecture");
assertEqual(info.license, lock.license, "license");
assertEqual(info.source.url, lock.source.upstreamUrl, "source.url");
assertEqual(info.source.sha256, lock.source.upstreamSha256, "source.sha256");
assertEqual(info.provenance.repository, lock.repository, "provenance.repository");
assertEqual(info.provenance.commit, lock.build.commit, "provenance.commit");

for (const requiredArgument of ["--disable-network", "--disable-gpl", "--disable-nonfree", "--disable-version3"]) {
  if (!info.configureArgs.includes(requiredArgument)) {
    throw new Error(`FFmpeg BUILD-INFO.json is missing required core argument '${requiredArgument}'.`);
  }
}
for (const licenseFile of lock.licenseFiles) await access(path.join(licenses, licenseFile), constants.F_OK);

function probe(argument) {
  const result = spawnSync(executable, [argument], { encoding: "utf8", timeout: 30_000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`FFmpeg ${argument} probe exited with status ${result.status}.`);
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

const versionOutput = probe("-version");
if (!new RegExp(`ffmpeg version n?${lock.ffmpegVersion.replaceAll(".", "\\.")}(?:\\s|$)`).test(versionOutput)) {
  throw new Error(`FFmpeg executable did not report version ${lock.ffmpegVersion}.`);
}
const buildOutput = probe("-buildconf");
if (/--enable-(gpl|nonfree|version3)/.test(buildOutput)) {
  throw new Error("FFmpeg executable enables a forbidden GPL, nonfree, or version3 option.");
}
for (const requiredArgument of ["--disable-network", "--disable-gpl", "--disable-nonfree", "--disable-version3"]) {
  if (!buildOutput.includes(requiredArgument)) {
    throw new Error(`FFmpeg executable is missing required core argument '${requiredArgument}'.`);
  }
}

console.log(`Verified FFmpeg ${lock.ffmpegVersion}-r${lock.distributionRevision} ${target} ${layout}.`);
