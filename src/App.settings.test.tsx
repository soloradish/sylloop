// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { loadPlayerPreferences, usePlayerStore } from "./store";
import { DEFAULT_SHORTCUTS } from "./lib/shortcuts";

const playMock = vi.fn(() => Promise.resolve());

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: playMock });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", { configurable: true, value: vi.fn() });
});

beforeEach(() => {
  playMock.mockClear();
  localStorage.clear();
  usePlayerStore.getState().clearMedia();
  usePlayerStore.setState({ preferences: { volume: 0.85, speed: 1, loopGap: 0, windowOpacity: 1, alwaysOnTop: false, language: "zh-CN", shortcuts: { ...DEFAULT_SHORTCUTS } }, error: null });
  window.history.pushState({}, "", "/?demo=1");
});

afterEach(() => cleanup());

describe("settings modal", () => {
  it("keeps playback settings in a single immediate-apply dialog", () => {
    render(<App />);
    expect(screen.queryByRole("button", { name: "加载字幕" })).toBeNull();
    expect(document.querySelector(".subtitle-card")).toBeNull();
    const settingsButton = screen.getByRole("button", { name: "设置" });
    fireEvent.click(settingsButton);

    const dialog = screen.getByRole("dialog", { name: "设置" });
    expect(within(dialog).getByTestId("settings-version").textContent).toBe("Sylloop · 开发版本");
    expect(within(dialog).queryByLabelText("音量")).toBeNull();
    expect(within(dialog).queryByLabelText("字幕偏移")).toBeNull();
    expect(within(dialog).queryByText("字幕")).toBeNull();
    expect(screen.getByLabelText("音量")).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByLabelText("显示语言"));

    fireEvent.change(within(dialog).getByLabelText("段间停顿"), { target: { value: "1" } });
    fireEvent.change(within(dialog).getByLabelText("播放倍速"), { target: { value: "1.25" } });

    expect(usePlayerStore.getState().preferences).toEqual({ volume: 0.85, speed: 1.25, loopGap: 1, windowOpacity: 1, alwaysOnTop: false, language: "zh-CN", shortcuts: DEFAULT_SHORTCUTS });
    expect((document.querySelector("video") as HTMLVideoElement).playbackRate).toBe(1.25);
    expect(JSON.parse(localStorage.getItem("sylloop-preferences") ?? "{}")).toMatchObject({ speed: 1.25, loopGap: 1 });

    fireEvent.click(within(dialog).getByRole("button", { name: "关闭设置" }));
    expect(screen.queryByRole("dialog", { name: "设置" })).toBeNull();
    expect(document.activeElement).toBe(settingsButton);

    expect(fireEvent.keyDown(settingsButton, { key: " ", code: "Space" })).toBe(false);
    expect(playMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: "设置" })).toBeNull();
    expect(document.activeElement).not.toBe(settingsButton);

    settingsButton.focus();
    expect(fireEvent.keyDown(settingsButton, { key: "x", code: "KeyX" })).toBe(true);
    expect(document.activeElement).toBe(settingsButton);
    expect(fireEvent.keyDown(settingsButton, { key: "Enter", code: "Enter" })).toBe(true);
    expect(document.activeElement).toBe(settingsButton);
  });

  it("closes with Escape or the backdrop and keeps keyboard focus inside", () => {
    render(<App />);
    const settingsButton = screen.getByRole("button", { name: "设置" });
    fireEvent.click(settingsButton);

    let dialog = screen.getByRole("dialog", { name: "设置" });
    const closeButton = within(dialog).getByRole("button", { name: "关闭设置" });
    const restoreDefaults = within(dialog).getByRole("button", { name: "还原默认" });
    closeButton.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(restoreDefaults);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "设置" })).toBeNull();

    fireEvent.click(settingsButton);
    dialog = screen.getByRole("dialog", { name: "设置" });
    const backdrop = screen.getByTestId("settings-backdrop");
    fireEvent.mouseDown(backdrop);
    expect(screen.queryByRole("dialog", { name: "设置" })).toBeNull();
    expect(document.activeElement).toBe(settingsButton);
  });

  it("loads older saved preferences with the default loop gap", () => {
    localStorage.setItem("sylloop-preferences", JSON.stringify({ volume: 0.4, speed: 1.5 }));
    usePlayerStore.setState({ preferences: loadPlayerPreferences(localStorage, ["zh-CN"]) });
    render(<App />);

    expect(usePlayerStore.getState().preferences).toEqual({ volume: 0.4, speed: 1.5, loopGap: 0, windowOpacity: 1, alwaysOnTop: false, language: "zh-CN", shortcuts: DEFAULT_SHORTCUTS });
    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    expect((screen.getByLabelText("段间停顿") as HTMLSelectElement).value).toBe("0");
  });

  it("keeps the top pin and window settings synchronized", () => {
    render(<App />);
    const pin = screen.getByRole("button", { name: "始终置顶" });
    expect(pin.getAttribute("aria-pressed")).toBe("false");
    expect(within(pin).getByTestId("pin-icon-outline")).toBeTruthy();

    fireEvent.click(pin);
    expect(pin.getAttribute("aria-pressed")).toBe("true");
    expect(within(pin).getByTestId("pin-icon-filled")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    const dialog = screen.getByRole("dialog", { name: "设置" });
    const alwaysOnTop = within(dialog).getByRole("checkbox", { name: "始终置顶" }) as HTMLInputElement;
    expect(alwaysOnTop.checked).toBe(true);

    const opacity = within(dialog).getByRole("slider", { name: "窗口透明度" }) as HTMLInputElement;
    fireEvent.change(opacity, { target: { value: "65" } });
    expect(usePlayerStore.getState().preferences.windowOpacity).toBe(0.65);
    expect(within(dialog).getByText("65%")).toBeTruthy();

    fireEvent.click(alwaysOnTop);
    expect(pin.getAttribute("aria-pressed")).toBe("false");
    expect(JSON.parse(localStorage.getItem("sylloop-preferences") ?? "{}")).toMatchObject({
      windowOpacity: 0.65,
      alwaysOnTop: false,
    });
  });

  it("exposes the top pin before media is opened", () => {
    window.history.pushState({}, "", "/");
    render(<App />);

    expect(screen.getByRole("heading", { name: "Sylloop" })).toBeTruthy();
    const pin = screen.getByRole("button", { name: "始终置顶" });
    fireEvent.click(pin);
    expect(pin.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(pin);
    expect(pin.getAttribute("aria-pressed")).toBe("false");
  });

  it("records core shortcuts, rejects conflicts, and restores every preference default", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "设置" }));

    const playShortcut = screen.getByRole("button", { name: "修改“播放或暂停”的快捷键" });
    fireEvent.click(playShortcut);
    expect(playShortcut.textContent).toBe("请按键…");
    fireEvent.keyDown(playShortcut, { key: " ", code: "Space" });
    expect(playShortcut.textContent).toBe("Space");
    expect(usePlayerStore.getState().isPlaying).toBe(false);

    fireEvent.click(playShortcut);
    fireEvent.keyDown(playShortcut, { key: "k", code: "KeyK", ctrlKey: true });
    expect(playShortcut.textContent).toBe("Ctrl+K");
    expect(usePlayerStore.getState().preferences.shortcuts.playPause).toBe("Ctrl+KeyK");

    const previousShortcut = screen.getByRole("button", { name: "修改“上一语音片段”的快捷键" });
    fireEvent.click(previousShortcut);
    fireEvent.keyDown(previousShortcut, { key: "k", code: "KeyK", ctrlKey: true });
    expect(screen.getByRole("alert").textContent).toContain("Ctrl+K 已分配给“播放或暂停”");
    expect(usePlayerStore.getState().preferences.shortcuts.previousSegment).toBe("KeyA");

    fireEvent.change(screen.getByLabelText("段间停顿"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("播放倍速"), { target: { value: "1.5" } });
    fireEvent.change(screen.getByLabelText("窗口透明度"), { target: { value: "55" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "始终置顶" }));
    fireEvent.click(screen.getByRole("button", { name: "还原默认" }));

    expect(usePlayerStore.getState().preferences).toEqual({
      volume: 0.85,
      speed: 1,
      loopGap: 0,
      windowOpacity: 1,
      alwaysOnTop: false,
      language: "en",
      shortcuts: DEFAULT_SHORTCUTS,
    });
    expect(usePlayerStore.getState().loop.gap).toBe(0);
    expect(screen.getByRole("button", { name: "Restore defaults" })).toBeTruthy();
  });

  it("switches the whole interface language immediately and persists it", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "设置" }));

    fireEvent.change(screen.getByLabelText("显示语言"), { target: { value: "fr" } });

    expect(screen.getByRole("dialog", { name: "Paramètres" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Liste de lecture · 3" })).toBeTruthy();
    expect(document.documentElement.lang).toBe("fr");
    expect(JSON.parse(localStorage.getItem("sylloop-preferences") ?? "{}")).toMatchObject({ language: "fr" });

    fireEvent.change(screen.getByLabelText("Langue d’affichage"), { target: { value: "zh-Hant" } });
    expect(screen.getByRole("dialog", { name: "設定" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "播放清單 · 3" })).toBeTruthy();
    expect(document.documentElement.lang).toBe("zh-Hant");
  });

  it("retranslates structured errors while preserving technical details", () => {
    render(<App />);
    act(() => usePlayerStore.getState().setError({ code: "ffmpeg_unavailable", detail: "spawn ENOENT" }));

    expect(screen.getByRole("alert").textContent).toContain("无法启动内置音频分析引擎");
    expect(screen.getByRole("alert").textContent).toContain("spawn ENOENT");

    act(() => usePlayerStore.getState().setPreferences({ language: "en" }));
    expect(screen.getByRole("alert").textContent).toContain("The bundled audio analysis engine could not be started");
    expect(screen.getByRole("alert").textContent).toContain("spawn ENOENT");
  });
});
