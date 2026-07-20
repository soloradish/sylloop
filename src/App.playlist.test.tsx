// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: vi.fn(() => Promise.resolve()) });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", { configurable: true, value: vi.fn() });
});

afterEach(() => cleanup());

beforeEach(() => {
  usePlayerStore.setState({ preferences: { volume: 0.85, speed: 1, loopGap: 0, windowOpacity: 1, alwaysOnTop: false, language: "zh-CN", shortcuts: { ...DEFAULT_SHORTCUTS } } });
});

describe("playlist drawer", () => {
  it("shows the session playlist and highlights the current item", async () => {
    window.history.pushState({}, "", "/?demo=1");
    render(<App />);

    const toggle = await screen.findByRole("button", { name: "播放列表 · 3" });
    fireEvent.click(toggle);

    expect(screen.getByLabelText("播放列表")).toBeTruthy();
    expect(screen.getByText("3 个文件")).toBeTruthy();
    expect(screen.getByRole("button", { name: /listening-practice\.mp3/ }).getAttribute("aria-current")).toBe("true");
  });

  it("keeps the play button accessible while switching SVG icons", async () => {
    window.history.pushState({}, "", "/?demo=1");
    render(<App />);

    expect(await screen.findByRole("button", { name: "播放" })).toBeTruthy();
    expect(screen.getByTestId("play-icon")).toBeTruthy();

    act(() => usePlayerStore.getState().setPlayback({ isPlaying: true }));
    expect(screen.getByRole("button", { name: "暂停" })).toBeTruthy();
    expect(screen.getByTestId("pause-icon")).toBeTruthy();
  });
});
