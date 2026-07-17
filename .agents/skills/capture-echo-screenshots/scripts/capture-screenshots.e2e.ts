import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Locale = "en" | "zh-CN";
type CaptureMode = "core" | "smart";

const stageDirectory = process.env.ECHO_SCREENSHOT_STAGE;
const focusScript = path.join(path.dirname(fileURLToPath(import.meta.url)), "focus-echo-window.ps1");
const mode = (process.env.ECHO_SCREENSHOT_MODE ?? "smart") as CaptureMode;
const mediaByLocale: Record<Locale, string | undefined> = {
  en: process.env.ECHO_SCREENSHOT_MEDIA_EN,
  "zh-CN": process.env.ECHO_SCREENSHOT_MEDIA_ZH_CN,
};

const localeCopy = {
  en: {
    segmentToken: "replayable segment",
    settingsTitle: "Settings",
    playlistTitle: "Playlist",
    helpTitle: "Help & feedback",
  },
  "zh-CN": {
    segmentToken: "可复听片段",
    settingsTitle: "设置",
    playlistTitle: "播放列表",
    helpTitle: "帮助与反馈",
  },
} satisfies Record<Locale, Record<string, string>>;

if (!stageDirectory) throw new Error("ECHO_SCREENSHOT_STAGE is required");
if (!mediaByLocale.en || !mediaByLocale["zh-CN"]) throw new Error("Both locale media paths are required");
if (!(["core", "smart"] as const).includes(mode)) throw new Error(`Unsupported capture mode: ${mode}`);

fs.mkdirSync(stageDirectory, { recursive: true });

const captured: string[] = [];
const skipped: Array<{ name: string; reason: string }> = [];
let originalPreferences: string | null | undefined;

async function settle(): Promise<void> {
  await browser.pause(300);
}

async function capture(name: string, required = true): Promise<boolean> {
  try {
    await settle();
    if (await $(".error-toast").isExisting()) throw new Error("an error toast is visible");
    const target = path.join(stageDirectory!, `${name}.png`);
    execFileSync("powershell.exe", [
      "-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass",
      "-File", focusScript, "-Action", "focus",
    ], { windowsHide: true, stdio: "pipe" });
    try {
      await browser.saveScreenshot(target);
    } finally {
      execFileSync("powershell.exe", [
        "-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass",
        "-File", focusScript, "-Action", "restore",
      ], { windowsHide: true, stdio: "pipe" });
    }
    captured.push(path.basename(target));
    return true;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (required) throw error;
    skipped.push({ name, reason });
    return false;
  }
}

async function setLocale(locale: Locale): Promise<void> {
  await browser.execute((nextLocale) => {
    const key = "echo-player-preferences";
    let saved: Record<string, unknown> = {};
    try {
      const raw = localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) saved = parsed;
    } catch {
      // Replace corrupt screenshot-session preferences with deterministic values.
    }
    localStorage.setItem(key, JSON.stringify({
      volume: 0.85,
      speed: 1,
      loopGap: 0,
      ...saved,
      language: nextLocale,
    }));
  }, locale);
  await browser.refresh();
  await expect($("h1")).toHaveText("Echo Player");
  await browser.execute(() => {
    const style = document.createElement("style");
    style.dataset.screenshotCapture = "true";
    style.textContent = "*,*::before,*::after{animation-duration:0s!important;transition:none!important;caret-color:transparent!important}";
    document.head.appendChild(style);
  });
  await settle();
}

async function openMedia(mediaPath: string): Promise<void> {
  await browser.execute(async (targetPath) => {
    if (!window.__ECHO_PLAYER_E2E_OPEN_PATH__) throw new Error("E2E open hook is unavailable");
    await window.__ECHO_PLAYER_E2E_OPEN_PATH__(targetPath);
  }, mediaPath);
  await expect($(".file-title")).toHaveText(path.basename(mediaPath));
  await expect($(".player-shell")).toBeDisplayed();
}

async function waitForAnalysis(locale: Locale): Promise<void> {
  await browser.waitUntil(async () => {
    const state = await $(".analysis-state").getText();
    return state.includes(localeCopy[locale].segmentToken);
  }, {
    timeout: 60_000,
    interval: 250,
    timeoutMsg: `analysis did not complete in ${locale}`,
  });
  await browser.waitUntil(async () => !(await $(".analysis-progress").isExisting()), {
    timeout: 10_000,
    interval: 200,
    timeoutMsg: "analysis progress overlay did not close",
  });
}

async function dragSelection(): Promise<void> {
  await browser.execute(() => {
    if (!window.__ECHO_PLAYER_E2E_SET_SELECTION__) throw new Error("E2E selection hook is unavailable");
    window.__ECHO_PLAYER_E2E_SET_SELECTION__(0.24, 0.58);
  });
  await $(".selection-draft-bar").waitForDisplayed();
}

async function captureLocale(locale: Locale): Promise<void> {
  const suffix = locale;
  const mediaPath = mediaByLocale[locale]!;
  await setLocale(locale);

  if (mode === "smart") await capture(`empty-state.${suffix}`);

  await openMedia(mediaPath);
  if (mode === "smart") {
    try {
      await $(".analysis-progress").waitForDisplayed({ timeout: 3_000 });
      await capture(`analysis-progress.${suffix}`, false);
    } catch {
      skipped.push({ name: `analysis-progress.${suffix}`, reason: "analysis completed before the overlay could be captured" });
    }
  }

  await waitForAnalysis(locale);
  await capture(`waveform-overview.${suffix}`);

  await dragSelection();
  if (mode === "smart") await capture(`selection-draft.${suffix}`);

  await $(".confirm-selection").click();
  await $(".selection-loop-workbench").waitForDisplayed();
  await browser.execute(() => {
    const media = document.querySelector("video");
    media?.pause();
  });
  await settle();
  await capture(`selection-loop.${suffix}`);

  await $(".selection-loop-exit").click();
  await $(".selection-loop-workbench").waitForDisplayed({ reverse: true });

  await $(".top-actions button[aria-haspopup='dialog']:not(.help-button)").click();
  await $(".settings-modal").waitForDisplayed();
  await expect($(".settings-modal h2")).toHaveText(localeCopy[locale].settingsTitle);
  await browser.execute(() => {
    const modal = document.querySelector<HTMLElement>(".settings-modal");
    if (modal) modal.scrollTop = 0;
  });
  await capture(`player-settings.${suffix}`);
  await $(".settings-modal-header button").click();

  if (mode === "smart") {
    await $(".top-actions button:first-child").click();
    await $(".playlist-drawer").waitForDisplayed();
    await expect($(".playlist-header strong")).toHaveText(localeCopy[locale].playlistTitle);
    await capture(`playlist.${suffix}`);
    await $(".playlist-header button:last-child").click();

    await $(".help-button").click();
    await $(".help-modal").waitForDisplayed();
    await expect($(".help-modal h2")).toHaveText(localeCopy[locale].helpTitle);
    await capture(`help.${suffix}`);
    await $(".help-modal-header button").click();
  }
}

describe("Echo Player bilingual documentation screenshots", () => {
  before(async () => {
    originalPreferences = await browser.execute(() => localStorage.getItem("echo-player-preferences"));
  });

  after(async () => {
    if (originalPreferences !== undefined) {
      await browser.execute((raw) => {
        const key = "echo-player-preferences";
        if (raw === null) localStorage.removeItem(key);
        else localStorage.setItem(key, raw);
      }, originalPreferences);
    }
    fs.writeFileSync(path.join(stageDirectory!, "capture-report.json"), JSON.stringify({ mode, captured, skipped }, null, 2));
  });

  it("captures the required states in English and Simplified Chinese", async () => {
    await captureLocale("en");
    await captureLocale("zh-CN");
  });
});
