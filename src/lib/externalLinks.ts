import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { AppLocale } from "../types";

export const BUG_REPORT_URL = "https://github.com/soloradish/echo-player/issues/new?template=bug_report.yml";
export const FEATURE_REQUEST_URL = "https://github.com/soloradish/echo-player/issues/new?template=feature_request.yml";
export const PROJECT_URL_ZH = "https://lowid.me/zh/echo-player/";
export const PROJECT_URL_EN = "https://lowid.me/en/echo-player/";

export function projectUrlForLocale(locale: AppLocale): string {
  return locale === "zh-CN" || locale === "zh-Hant" ? PROJECT_URL_ZH : PROJECT_URL_EN;
}

export async function openExternalUrl(url: string): Promise<void> {
  if (isTauri()) {
    await openUrl(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
