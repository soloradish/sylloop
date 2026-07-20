// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { usePlayerStore } from "./store";
import { DEFAULT_SHORTCUTS } from "./lib/shortcuts";

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: vi.fn(() => Promise.resolve()) });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", { configurable: true, value: vi.fn() });
});

beforeEach(() => {
  localStorage.clear();
  usePlayerStore.setState({ preferences: { volume: 0.85, speed: 1, loopGap: 0, windowOpacity: 1, alwaysOnTop: false, language: "zh-CN", shortcuts: { ...DEFAULT_SHORTCUTS } } });
  window.history.pushState({}, "", "/?demo=1");
});

afterEach(() => cleanup());

describe("loop range selector", () => {
  it("defaults to the whole audio and switches between the two loop ranges", () => {
    render(<App />);

    const selector = screen.getByRole("group", { name: "循环范围" });
    const segment = within(selector).getByRole("button", { name: "循环当前片段" });
    const media = within(selector).getByRole("button", { name: "循环整个音频" });

    expect(within(selector).queryByRole("button", { name: "不循环" })).toBeNull();
    expect(media.getAttribute("aria-pressed")).toBe("true");
    const mediaMarker = media.querySelector(".loop-current-marker");
    const segmentMarker = segment.querySelector(".loop-current-marker");
    expect(mediaMarker?.textContent).toBe("当前 · ");
    expect(segmentMarker?.textContent).toBe("当前 · ");
    expect(mediaMarker?.getAttribute("aria-hidden")).toBe("false");
    expect(segmentMarker?.getAttribute("aria-hidden")).toBe("true");
    expect(usePlayerStore.getState().loop).toEqual({
      mode: "media",
      start: 0,
      end: 12,
      completed: 0,
      gap: 0,
    });
    expect(segment.textContent).toContain("00:04–00:07");
    expect(media.textContent).toContain("00:12");

    fireEvent.click(segment);
    expect(segment.getAttribute("aria-pressed")).toBe("true");
    expect(mediaMarker?.getAttribute("aria-hidden")).toBe("true");
    expect(segmentMarker?.getAttribute("aria-hidden")).toBe("false");
    expect(usePlayerStore.getState().loop).toEqual({
      mode: "segment",
      start: 4.05,
      end: 7.1,
      completed: 0,
      gap: 0,
    });

    fireEvent.click(media);
    expect(media.getAttribute("aria-pressed")).toBe("true");
    expect(mediaMarker?.getAttribute("aria-hidden")).toBe("false");
    expect(segmentMarker?.getAttribute("aria-hidden")).toBe("true");
    expect(usePlayerStore.getState().loop).toEqual({
      mode: "media",
      start: 0,
      end: 12,
      completed: 0,
      gap: 0,
    });

  });

  it("keeps the loop shortcut as a direct current-segment toggle without obscuring whole-media mode", () => {
    render(<App />);
    const selector = screen.getByRole("group", { name: "循环范围" });
    const media = within(selector).getByRole("button", { name: "循环整个音频" });

    expect(media.getAttribute("aria-pressed")).toBe("true");
    expect(usePlayerStore.getState().loop.mode).toBe("media");

    fireEvent.keyDown(window, { key: "s", code: "KeyS" });
    expect(usePlayerStore.getState().loop.mode).toBe("segment");

    fireEvent.keyDown(window, { key: "s", code: "KeyS" });
    expect(usePlayerStore.getState().loop.mode).toBe("media");
  });

  it("runs left-hand shortcuts while a button is focused and honors a customized shortcut", () => {
    render(<App />);
    const settingsButton = screen.getByRole("button", { name: "设置" });
    settingsButton.focus();

    expect(fireEvent.keyDown(settingsButton, { key: "a", code: "KeyA" })).toBe(false);
    expect(usePlayerStore.getState().currentTime).toBe(0.25);
    expect(screen.queryByRole("dialog", { name: "设置" })).toBeNull();
    expect(document.activeElement).not.toBe(settingsButton);

    settingsButton.focus();
    expect(fireEvent.keyDown(settingsButton, { key: "d", code: "KeyD" })).toBe(false);
    expect(usePlayerStore.getState().currentTime).toBe(4.05);
    expect(document.activeElement).not.toBe(settingsButton);

    settingsButton.focus();
    expect(fireEvent.keyDown(settingsButton, { key: "s", code: "KeyS" })).toBe(false);
    expect(usePlayerStore.getState().loop.mode).toBe("segment");
    expect(document.activeElement).not.toBe(settingsButton);

    act(() => usePlayerStore.getState().setPreferences({
      shortcuts: { ...DEFAULT_SHORTCUTS, toggleLoopRange: "Ctrl+KeyK" },
    }));
    fireEvent.keyDown(window, { key: "s", code: "KeyS" });
    expect(usePlayerStore.getState().loop.mode).toBe("segment");
    fireEvent.keyDown(window, { key: "k", code: "KeyK", ctrlKey: true });
    expect(usePlayerStore.getState().loop.mode).toBe("media");
  });
});
