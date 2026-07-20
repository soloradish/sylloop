// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { usePlayerStore } from "./store";
import { DEFAULT_SHORTCUTS } from "./lib/shortcuts";
import { BUG_REPORT_URL, FEATURE_REQUEST_URL, PROJECT_URL_EN } from "./lib/externalLinks";

const mocks = vi.hoisted(() => ({
  getVersion: vi.fn(),
  invoke: vi.fn(),
  openDialog: vi.fn(),
  openUrl: vi.fn(),
}));

vi.mock("@tauri-apps/api/app", () => ({ getVersion: mocks.getVersion }));
vi.mock("@tauri-apps/api/core", () => ({
  Channel: class<T> { onmessage = (_event: T) => {}; },
  convertFileSrc: (path: string) => `asset://${path}`,
  isTauri: () => true,
  invoke: mocks.invoke,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.openDialog }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mocks.openUrl }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    onDragDropEvent: () => Promise.resolve(() => {}),
    setAlwaysOnTop: () => Promise.resolve(),
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
  mocks.getVersion.mockResolvedValue("0.1.0");
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation((command: string) => command === "get_analysis_cache_stats"
    ? Promise.resolve({ entryCount: 0, usedBytes: 0, limitBytes: 512 * 1024 * 1024 })
    : Promise.resolve(null));
  mocks.openDialog.mockReset();
  mocks.openDialog.mockResolvedValue(null);
  mocks.openUrl.mockReset();
  mocks.openUrl.mockResolvedValue(undefined);
  usePlayerStore.setState({
    preferences: { volume: 0.85, speed: 1, loopGap: 0, windowOpacity: 1, alwaysOnTop: false, language: "en", shortcuts: { ...DEFAULT_SHORTCUTS } },
    error: null,
  });
});

afterEach(() => cleanup());

describe("open file and Help entry points", () => {
  it("makes opening a file explicit and exposes protected support links", async () => {
    render(<App />);

    expect(screen.queryByRole("button", { name: "Sylloop" })).toBeNull();
    expect(screen.getByText("Sylloop").getAttribute("aria-label")).toBe("Sylloop");

    fireEvent.click(screen.getByRole("button", { name: "Open file" }));
    await waitFor(() => expect(mocks.openDialog).toHaveBeenCalledOnce());

    const helpButton = screen.getByRole("button", { name: "Help" });
    fireEvent.click(helpButton);
    const dialog = screen.getByRole("dialog", { name: "Help & feedback" });
    expect(document.activeElement).toBe(dialog);
    expect(dialog.textContent).toContain("GitHub Issues");
    expect(dialog.textContent).toContain("Do not upload private audio");

    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Close help and feedback" }));

    fireEvent.click(within(dialog).getByRole("button", { name: "Bug report" }));
    await waitFor(() => expect(mocks.openUrl).toHaveBeenLastCalledWith(BUG_REPORT_URL));
    fireEvent.click(within(dialog).getByRole("button", { name: "Feature request" }));
    await waitFor(() => expect(mocks.openUrl).toHaveBeenLastCalledWith(FEATURE_REQUEST_URL));
    fireEvent.click(within(dialog).getByRole("button", { name: "Visit lowid.me" }));
    await waitFor(() => expect(mocks.openUrl).toHaveBeenLastCalledWith(PROJECT_URL_EN));

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Help & feedback" })).toBeNull();
    expect(document.activeElement).toBe(helpButton);
  });

  it("closes from the backdrop and localizes external-link failures", async () => {
    window.history.pushState({}, "", "/");
    usePlayerStore.setState({ mediaPath: null, mediaName: "", mediaUrl: null });
    usePlayerStore.getState().setPreferences({ language: "zh-CN" });
    render(<App />);
    const helpButton = screen.getByRole("button", { name: "帮助" });
    fireEvent.click(helpButton);

    mocks.openUrl.mockRejectedValueOnce(new Error("shell open failed"));
    fireEvent.click(screen.getByRole("button", { name: "填写问题报告" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("无法在浏览器中打开这个链接"));

    fireEvent.mouseDown(screen.getByTestId("help-backdrop"));
    expect(screen.queryByRole("dialog", { name: "帮助与反馈" })).toBeNull();
    expect(document.activeElement).toBe(helpButton);
  });
});
