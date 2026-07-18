import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const isWindows = process.platform === "win32";
const script = isWindows ? "prepare-ffmpeg.ps1" : "prepare-ffmpeg.sh";
const command = isWindows ? "powershell" : "bash";
const args = isWindows
  ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(root, "scripts", script)]
  : [path.join(root, "scripts", script)];

if (!isWindows && process.platform !== "darwin") {
  throw new Error(`Bundled FFmpeg preparation is not supported on ${process.platform}.`);
}

const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
