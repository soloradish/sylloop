// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { usePlayerStore } from "./store";
import { DEFAULT_SHORTCUTS } from "./lib/shortcuts";

let fullscreenElement: Element | null = null;
const requestFullscreen = vi.fn(() => Promise.resolve());
const exitFullscreen = vi.fn(() => Promise.resolve());

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
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => fullscreenElement,
  });
  Object.defineProperty(document.documentElement, "requestFullscreen", {
    configurable: true,
    value: requestFullscreen,
  });
  Object.defineProperty(document, "exitFullscreen", {
    configurable: true,
    value: exitFullscreen,
  });
});

beforeEach(() => {
  fullscreenElement = null;
  requestFullscreen.mockClear();
  exitFullscreen.mockClear();
  localStorage.clear();
  usePlayerStore.setState({ preferences: { volume: 0.85, speed: 1, loopGap: 0, windowOpacity: 1, alwaysOnTop: false, language: "zh-CN", shortcuts: { ...DEFAULT_SHORTCUTS } } });
  window.history.pushState({}, "", "/?demo=1");
});

afterEach(() => cleanup());

function setFullscreenElement(element: Element | null) {
  fullscreenElement = element;
  act(() => document.dispatchEvent(new Event("fullscreenchange")));
}

describe("fullscreen control", () => {
  it("requests fullscreen and switches to an exit action when fullscreen starts", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "全屏" }));
    expect(requestFullscreen).toHaveBeenCalledOnce();

    setFullscreenElement(document.documentElement);
    expect(screen.getByRole("button", { name: "退出全屏" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "退出全屏" }));
    expect(exitFullscreen).toHaveBeenCalledOnce();
  });

  it("returns to the fullscreen action after an external exit", () => {
    fullscreenElement = document.documentElement;
    render(<App />);
    expect(screen.getByRole("button", { name: "退出全屏" })).toBeTruthy();

    setFullscreenElement(null);
    expect(screen.getByRole("button", { name: "全屏" })).toBeTruthy();
  });

  it("keeps the actual state when a fullscreen request is rejected", async () => {
    requestFullscreen.mockRejectedValueOnce(new Error("Fullscreen denied"));
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "全屏" }));
    await act(async () => Promise.resolve());

    expect(screen.getByRole("button", { name: "全屏" })).toBeTruthy();
  });
});
