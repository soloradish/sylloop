import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectVersionState, compareStableSemver, STABLE_SEMVER_PATTERN } from "../../../../scripts/version.mjs";

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

function run(command, args, cwd, options = {}) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", options.captureStderr ? "pipe" : "ignore"],
  }).trim();
}

function runGit(args, cwd) {
  return run("git", args, cwd);
}

function lines(value) {
  return value ? value.split(/\r?\n/).filter(Boolean) : [];
}

function readStableTags(root, mergedOnly = false) {
  const args = ["tag"];
  if (mergedOnly) args.push("--merged", "origin/main");
  args.push("--list", "v*");
  return lines(runGit(args, root))
    .filter((tag) => STABLE_SEMVER_PATTERN.test(tag.slice(1)))
    .sort((left, right) => compareStableSemver(left.slice(1), right.slice(1)));
}

function parseCommits(value) {
  return lines(value).map((line) => {
    const [sha, shortSha, subject, authoredAt] = line.split("\u001f");
    return { sha, shortSha, subject, authoredAt };
  });
}

function extractUnreleased(changelog) {
  const match = /^## \[Unreleased\]\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(changelog);
  return match ? match[1].trim() : null;
}

function readGitHubJson(args, root) {
  try {
    return { available: true, items: JSON.parse(run("gh", args, root, { captureStderr: true }) || "[]") };
  } catch (error) {
    const message = error instanceof Error ? error.message.split(/\r?\n/)[0] : String(error);
    return { available: false, error: message };
  }
}

export async function collectReleaseContext(root, { offline = false } = {}) {
  const repositoryRoot = root ? path.resolve(root) : runGit(["rev-parse", "--show-toplevel"], process.cwd());
  runGit(["rev-parse", "--verify", "origin/main"], repositoryRoot);
  const versions = await collectVersionState(repositoryRoot);
  const allStableTags = readStableTags(repositoryRoot);
  const stableTags = readStableTags(repositoryRoot, true);
  const baseTag = stableTags.at(-1) ?? null;
  const rangeStart = baseTag ?? EMPTY_TREE;
  const changelog = await readFile(path.join(repositoryRoot, "CHANGELOG.md"), "utf8");
  const github = offline ? { available: false, error: "offline mode" } : {
    releases: readGitHubJson(["release", "list", "--limit", "100", "--json", "tagName,isDraft,isPrerelease,publishedAt,url"], repositoryRoot),
    pullRequests: readGitHubJson(["pr", "list", "--state", "all", "--limit", "100", "--json", "number,title,headRefName,baseRefName,state,isDraft,url"], repositoryRoot),
  };

  return {
    repositoryRoot,
    branch: runGit(["branch", "--show-current"], repositoryRoot) || null,
    head: runGit(["rev-parse", "HEAD"], repositoryRoot),
    originMain: runGit(["rev-parse", "origin/main"], repositoryRoot),
    worktreeStatus: lines(runGit(["status", "--short"], repositoryRoot)),
    versions: {
      authoritativeVersion: versions.authoritativeVersion,
      values: versions.values,
      synchronized: new Set(Object.values(versions.values)).size === 1,
    },
    stableTags,
    allStableTags,
    baseTag,
    range: baseTag ? `${baseTag}..origin/main` : "initial..origin/main",
    commits: parseCommits(runGit(["log", "--format=%H%x1f%h%x1f%s%x1f%aI", baseTag ? `${baseTag}..origin/main` : "origin/main"], repositoryRoot)),
    changedFiles: lines(runGit(["diff", "--name-status", rangeStart, "origin/main"], repositoryRoot)),
    diffStat: runGit(["diff", "--stat", rangeStart, "origin/main"], repositoryRoot),
    unreleasedChangelog: extractUnreleased(changelog),
    releaseBranches: lines(runGit(["branch", "--all", "--list", "*release-v*"], repositoryRoot)).map((branch) => branch.trim()),
    github,
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--offline")) throw new Error("Usage: node collect-release-context.mjs [--offline]");
  const context = await collectReleaseContext(null, { offline: args.includes("--offline") });
  console.log(JSON.stringify(context, null, 2));
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
