// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { detectLocale, I18nProvider, useI18n } from "./i18n";
import { loadPlayerPreferences, PREFERENCES_STORAGE_KEY } from "./store";
import { DEFAULT_SHORTCUTS } from "./lib/shortcuts";
import type { AppLocale } from "./types";

afterEach(() => cleanup());

describe("locale detection", () => {
  it.each([
    [["zh-CN"], "zh-CN"],
    [["zh-Hans-SG"], "zh-CN"],
    [["zh"], "zh-CN"],
    [["zh-TW"], "zh-Hant"],
    [["zh-Hant-HK"], "zh-Hant"],
    [["zh-HK"], "zh-Hant"],
    [["zh-MO"], "zh-Hant"],
    [["fr-CA"], "fr"],
    [["en-GB"], "en"],
    [["de-DE"], "en"],
    [["de-DE", "fr-FR"], "fr"],
  ] as Array<[string[], AppLocale]>) ("maps %j to %s", (languages, expected) => {
    expect(detectLocale(languages)).toBe(expected);
  });

  it("prefers a saved language and safely migrates older settings", () => {
    const savedStorage = {
      getItem: (key: string) => key === PREFERENCES_STORAGE_KEY
        ? JSON.stringify({ volume: 0.4, speed: 1.5, loopGap: 0.5, language: "zh-Hant" })
        : null,
    };
    expect(loadPlayerPreferences(savedStorage, ["fr-CA"])).toEqual({
      volume: 0.4,
      speed: 1.5,
      loopGap: 0.5,
      windowOpacity: 1,
      alwaysOnTop: false,
      language: "zh-Hant",
      shortcuts: DEFAULT_SHORTCUTS,
    });

    const oldStorage = { getItem: () => JSON.stringify({ volume: 0.3, speed: 1.25 }) };
    expect(loadPlayerPreferences(oldStorage, ["fr-CA"])).toEqual({
      volume: 0.3,
      speed: 1.25,
      loopGap: 0,
      windowOpacity: 1,
      alwaysOnTop: false,
      language: "fr",
      shortcuts: DEFAULT_SHORTCUTS,
    });
  });

  it("recovers from corrupt and invalid preferences", () => {
    expect(loadPlayerPreferences({ getItem: () => "{" }, ["de-DE"])).toEqual({
      volume: 0.85,
      speed: 1,
      loopGap: 0,
      windowOpacity: 1,
      alwaysOnTop: false,
      language: "en",
      shortcuts: DEFAULT_SHORTCUTS,
    });
    expect(loadPlayerPreferences({ getItem: () => JSON.stringify({ volume: 2, speed: 0, loopGap: -1, language: "es" }) }, ["zh-TW"])).toEqual({
      volume: 0.85,
      speed: 1,
      loopGap: 0,
      windowOpacity: 1,
      alwaysOnTop: false,
      language: "zh-Hant",
      shortcuts: DEFAULT_SHORTCUTS,
    });
  });
});

function FormattingProbe() {
  const { formatFileCount, formatSeconds, t } = useI18n();
  return <div>{t("top.settings")}|{formatFileCount(2)}|{formatSeconds(0.5)}</div>;
}

function WindowLabelsProbe() {
  const { t } = useI18n();
  return <div>{t("settings.windowOpacity")}|{t("settings.alwaysOnTop")}|{t("top.pinWindow")}</div>;
}

describe("localized formatting", () => {
  it.each([
    ["zh-CN", "设置|2 个文件|0.5 秒"],
    ["zh-Hant", "設定|2 個檔案|0.5 秒"],
    ["en", "Settings|2 files|0.5 seconds"],
    ["fr", "Paramètres|2 fichiers|0,5 seconde"],
  ] as Array<[AppLocale, string]>) ("formats %s messages", (locale, expected) => {
    render(<I18nProvider locale={locale}><FormattingProbe /></I18nProvider>);
    expect(screen.getByText(expected)).toBeTruthy();
    expect(document.documentElement.lang).toBe(locale);
  });

  it.each([
    ["zh-CN", "窗口透明度|始终置顶|将窗口固定在最前"],
    ["zh-Hant", "視窗透明度|永遠置頂|將視窗固定在最前方"],
    ["en", "Window opacity|Always on top|Keep window on top"],
    ["fr", "Opacité de la fenêtre|Toujours au premier plan|Garder la fenêtre au premier plan"],
  ] as Array<[AppLocale, string]>) ("localizes window settings for %s", (locale, expected) => {
    render(<I18nProvider locale={locale}><WindowLabelsProbe /></I18nProvider>);
    expect(screen.getByText(expected)).toBeTruthy();
  });
});
