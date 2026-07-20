// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { usePlayerStore } from "./store";
import { DEFAULT_SHORTCUTS } from "./lib/shortcuts";

const mocks = vi.hoisted(() => ({
  getVersion: vi.fn(),
  invoke: vi.fn(),
  setAlwaysOnTop: vi.fn(),
}));

vi.mock("@tauri-apps/api/app", () => ({ getVersion: mocks.getVersion }));
vi.mock("@tauri-apps/api/core", () => ({
  Channel: class<T> { onmessage = (_event: T) => {}; },
  convertFileSrc: (path: string) => `asset://${path}`,
  isTauri: () => true,
  invoke: mocks.invoke,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    onDragDropEvent: () => Promise.resolve(() => {}),
    setAlwaysOnTop: mocks.setAlwaysOnTop,
  }),
}));

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
  window.history.pushState({}, "", "/?demo=1");
  mocks.getVersion.mockReset();
  mocks.invoke.mockReset();
  mocks.setAlwaysOnTop.mockReset();
  mocks.setAlwaysOnTop.mockResolvedValue(undefined);
  mocks.invoke.mockImplementation((command: string) => command === "get_analysis_cache_stats"
    ? Promise.resolve({ entryCount: 0, usedBytes: 0, limitBytes: 512 * 1024 * 1024 })
    : Promise.resolve(null));
  usePlayerStore.setState({
    preferences: { volume: 0.85, speed: 1, loopGap: 0, windowOpacity: 1, alwaysOnTop: false, language: "en", shortcuts: { ...DEFAULT_SHORTCUTS } },
    error: null,
  });
});

afterEach(() => cleanup());

describe("runtime application version", () => {
  it("shows the version reported by the installed Tauri application", async () => {
    mocks.getVersion.mockResolvedValue("0.1.0");
    render(<App />);
    await waitFor(() => expect(mocks.getVersion).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(within(screen.getByRole("dialog", { name: "Settings" })).getByTestId("settings-version").textContent)
      .toBe("Sylloop · Version 0.1.0");
  });

  it("falls back without surfacing an application error when the version is unavailable", async () => {
    mocks.getVersion.mockRejectedValue(new Error("version unavailable"));
    render(<App />);
    await waitFor(() => expect(mocks.getVersion).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(within(screen.getByRole("dialog", { name: "Settings" })).getByTestId("settings-version").textContent)
      .toBe("Sylloop · Version unavailable");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("restores the last applied window appearance when a native update fails", async () => {
    mocks.getVersion.mockResolvedValue("0.1.0");
    mocks.invoke.mockRejectedValueOnce(new Error("native window denied the change"));
    usePlayerStore.setState((state) => ({
      preferences: { ...state.preferences, windowOpacity: 0.6, alwaysOnTop: true },
    }));

    render(<App />);

    await waitFor(() => expect(usePlayerStore.getState().preferences).toMatchObject({
      windowOpacity: 1,
      alwaysOnTop: false,
    }));
    expect(usePlayerStore.getState().error).toMatchObject({
      code: "window_appearance_failed",
      detail: "native window denied the change",
    });
  });
});
