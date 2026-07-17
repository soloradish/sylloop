// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { SettingsModal } from "./SettingsModal";
import { DEFAULT_SHORTCUTS } from "../lib/shortcuts";

afterEach(() => cleanup());

function renderSettings(cacheDisabled = false) {
  const onClearCache = vi.fn();
  render(
    <I18nProvider locale="en">
      <SettingsModal
        appVersion="0.1.0"
        isDevelopmentBuild={false}
        language="en"
        speed={1}
        loopGap={0}
        shortcuts={{ ...DEFAULT_SHORTCUTS }}
        cacheStats={{ entryCount: 3, usedBytes: 12.5 * 1024 * 1024, limitBytes: 512 * 1024 * 1024 }}
        cacheClearing={false}
        cacheDisabled={cacheDisabled}
        onLanguageChange={vi.fn()}
        onSpeedChange={vi.fn()}
        onLoopGapChange={vi.fn()}
        onShortcutChange={vi.fn()}
        onResetPreferences={vi.fn()}
        onClearCache={onClearCache}
        onClose={vi.fn()}
      />
    </I18nProvider>,
  );
  return onClearCache;
}

describe("analysis cache settings", () => {
  it("shows the installed application version", () => {
    renderSettings();
    expect(screen.getByTestId("settings-version").textContent).toBe("Sylloop · Version 0.1.0");
  });

  it("shows cache usage and clears saved analysis", () => {
    const onClearCache = renderSettings();
    expect(screen.getByText("12.5 MB of 512 MB · 3 files")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear cache" }));
    expect(onClearCache).toHaveBeenCalledOnce();
  });

  it("disables clearing while an analysis is active", () => {
    renderSettings(true);
    const button = screen.getByRole("button", { name: "Clear cache" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toBe("Wait for the current analysis to finish");
  });
});
