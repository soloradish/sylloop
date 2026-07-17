// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(),
  openUrl: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: mocks.isTauri }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mocks.openUrl }));

import {
  BUG_REPORT_URL,
  PROJECT_URL_EN,
  PROJECT_URL_ZH,
  openExternalUrl,
  projectUrlForLocale,
} from "./externalLinks";

describe("external link boundaries", () => {
  beforeEach(() => {
    mocks.isTauri.mockReset();
    mocks.openUrl.mockReset();
  });

  it("chooses the project page from the application locale", () => {
    expect(PROJECT_URL_ZH).toBe("https://lowid.me/zh/echo-player/");
    expect(PROJECT_URL_EN).toBe("https://lowid.me/en/echo-player/");
    expect(projectUrlForLocale("zh-CN")).toBe("https://lowid.me/zh/echo-player/");
    expect(projectUrlForLocale("zh-Hant")).toBe("https://lowid.me/zh/echo-player/");
    expect(projectUrlForLocale("en")).toBe("https://lowid.me/en/echo-player/");
    expect(projectUrlForLocale("fr")).toBe("https://lowid.me/en/echo-player/");
  });

  it("uses the Tauri opener in the installed application", async () => {
    mocks.isTauri.mockReturnValue(true);
    mocks.openUrl.mockResolvedValue(undefined);

    await openExternalUrl(BUG_REPORT_URL);

    expect(mocks.openUrl).toHaveBeenCalledWith(BUG_REPORT_URL);
  });

  it("uses a protected new tab in browser development", async () => {
    mocks.isTauri.mockReturnValue(false);
    const openWindow = vi.spyOn(window, "open").mockImplementation(() => null);

    await openExternalUrl(PROJECT_URL_EN);

    expect(openWindow).toHaveBeenCalledWith(PROJECT_URL_EN, "_blank", "noopener,noreferrer");
    expect(mocks.openUrl).not.toHaveBeenCalled();
    openWindow.mockRestore();
  });
});
