import fs from "node:fs";
import path from "node:path";

const fixture = path.resolve("e2e/fixtures/generated/sample.wav");
const appConfig = JSON.parse(
  fs.readFileSync(path.resolve("src-tauri/tauri.conf.json"), "utf8"),
) as { version: string };
const normalizeWindowsPath = (value: string) => value.replace(/^\\\\\?\\/, "").toLowerCase();

describe("Sylloop Windows application", () => {
  it("starts with the expected empty state and bundled analyzer", async () => {
    await expect($("h1")).toHaveText("Sylloop");

    const emptyPin = $(".empty-window-actions .window-pin-button");
    await expect(emptyPin).toBeDisplayed();
    if ((await emptyPin.getAttribute("aria-pressed")) === "true") await emptyPin.click();
    await expect(emptyPin).toHaveAttribute("aria-pressed", "false");
    await emptyPin.click();
    await expect(emptyPin).toHaveAttribute("aria-pressed", "true");
    await emptyPin.click();
    await expect(emptyPin).toHaveAttribute("aria-pressed", "false");
    await browser.pause(150);
    expect(await $$(".error-toast").length).toBe(0);

    const capability = await browser.tauri.execute(({ core }) =>
      core.invoke<{ available: boolean; source: string; version: string | null }>("get_analysis_capability"),
    );
    expect(capability.available).toBe(true);
    expect(capability.source).toBe("bundled");
    expect(capability.version).toMatch(/8\.1\.2/);
  });

  it("opens a scoped local file through the app boundary and analyzes it", async () => {
    await browser.tauri.execute(({ core }) => core.invoke("clear_analysis_cache"));
    await browser.execute(async (mediaPath) => {
      if (!window.__SYLLOOP_E2E_OPEN_PATH__) throw new Error("E2E open hook is unavailable");
      await window.__SYLLOOP_E2E_OPEN_PATH__(mediaPath);
    }, fixture);
    await expect($(".file-title")).toHaveText("sample.wav");
    await expect($(".player-shell")).toBeDisplayed();

    await browser.waitUntil(async () => {
      const stats = await browser.tauri.execute(({ core }) =>
        core.invoke<{ entryCount: number }>("get_analysis_cache_stats"),
      );
      return stats.entryCount > 0;
    }, { timeout: 30_000, timeoutMsg: "audio analysis did not complete" });

    const context = await browser.tauri.execute(({ core }, mediaPath) =>
      core.invoke<{ selected: { path: string }; playlist: Array<{ path: string }> }>("open_media_context", { path: mediaPath }),
      fixture,
    );
    expect(normalizeWindowsPath(context.selected.path)).toBe(normalizeWindowsPath(fixture));
    expect(context.playlist.some((item) => normalizeWindowsPath(item.path) === normalizeWindowsPath(fixture))).toBe(true);

    const openedSettings = await browser.execute(() => {
      const buttons = document.querySelectorAll<HTMLButtonElement>(
        '.top-actions button[aria-haspopup="dialog"]',
      );
      const settingsButton = buttons.item(buttons.length - 1);
      if (!settingsButton) return false;
      settingsButton.click();
      return true;
    });
    expect(openedSettings).toBe(true);
    const settingsVersion = $(".settings-version");
    await expect(settingsVersion).toBeDisplayed();
    await browser.waitUntil(
      async () => (await settingsVersion.getText()).includes(appConfig.version),
      {
        timeoutMsg: `Settings did not show application version ${appConfig.version}`,
      },
    );

    const opacity = $("#settings-window-opacity");
    const alwaysOnTop = $("#settings-always-on-top");
    await expect(opacity).toBeDisplayed();
    await browser.execute(() => {
      const input = document.querySelector<HTMLInputElement>("#settings-window-opacity");
      if (!input) throw new Error("Window opacity control is unavailable");
      input.value = "40";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect(opacity).toHaveValue("40");
    await alwaysOnTop.click();
    await expect($(".top-actions .window-pin-button")).toHaveAttribute("aria-pressed", "true");
    await alwaysOnTop.click();
    await expect($(".top-actions .window-pin-button")).toHaveAttribute("aria-pressed", "false");
    await browser.execute(() => {
      const input = document.querySelector<HTMLInputElement>("#settings-window-opacity");
      if (!input) throw new Error("Window opacity control is unavailable");
      input.value = "100";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect(opacity).toHaveValue("100");
    await browser.pause(150);
    expect(await $$(".error-toast").length).toBe(0);
    await $(".settings-modal-header button").click();
    await expect($(".settings-modal")).not.toBeDisplayed();
  });

  it("shows explicit file and support entry points without launching an external browser", async () => {
    const wordmark = $(".wordmark");
    expect(await wordmark.getTagName()).toBe("span");
    await expect($(".open-file-button")).toBeDisplayed();

    await $(".help-button").click();
    await expect($(".help-modal")).toBeDisplayed();
    expect(await $$(".help-actions button").length).toBe(3);

    await $(".help-modal-header button").click();
    await expect($(".help-modal")).not.toBeDisplayed();
  });
});
