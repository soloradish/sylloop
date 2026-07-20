// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { usePlayerStore } from "./store";
import { DEFAULT_SHORTCUTS } from "./lib/shortcuts";
import type { AnalysisEvent, WaveformData } from "./types";

interface PendingAnalysis {
  args: { path: string; requestId: string; onEvent: { onmessage: (event: AnalysisEvent) => void } };
  resolve: (waveform: WaveformData) => void;
  reject: (error: unknown) => void;
}

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  open: vi.fn(),
  pending: [] as PendingAnalysis[],
}));

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class<T> {
    onmessage = (_event: T) => {};
  },
  convertFileSrc: (path: string) => `asset://${path}`,
  isTauri: () => true,
  invoke: mocks.invoke,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    onDragDropEvent: () => Promise.resolve(() => {}),
    setAlwaysOnTop: () => Promise.resolve(),
  }),
}));

const waveform: WaveformData = {
  duration: 120,
  sampleRate: 16000,
  peaksPerSecond: 50,
  peaks: [0.2, 0.4, 0.3],
  segments: [{ id: "one", start: 0, end: 120, replayStart: 0 }],
};

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
  mocks.pending.length = 0;
  mocks.invoke.mockReset();
  mocks.open.mockReset();
  mocks.invoke.mockImplementation((command: string, args?: PendingAnalysis["args"]) => {
    if (command === "open_media_context" && args) {
      const path = args.path;
      const name = path.split(/[\\/]/).pop() ?? path;
      return Promise.resolve({
        selected: { path, name },
        playlist: [{ path, name }],
      });
    }
    if (command === "get_analysis_cache_stats") {
      return Promise.resolve({ entryCount: 0, usedBytes: 0, limitBytes: 512 * 1024 * 1024 });
    }
    if (command === "cancel_analysis") return Promise.resolve(true);
    if (command === "analyze_audio" && args) {
      return new Promise<WaveformData>((resolve, reject) => {
        mocks.pending.push({ args, resolve, reject });
      });
    }
    return Promise.resolve(null);
  });
  window.history.pushState({}, "", "/");
  usePlayerStore.setState({
    mediaPath: null,
    mediaName: "",
    mediaUrl: null,
    duration: 0,
    currentTime: 0,
    isPlaying: false,
    isAnalyzing: false,
    analysisRequestId: null,
    analysisStarted: false,
    analysisProgress: null,
    waveform: null,
    segments: [],
    error: null,
    playlist: [],
    currentPlaylistIndex: -1,
    preferences: { volume: 0.85, speed: 1, loopGap: 0, windowOpacity: 1, alwaysOnTop: false, language: "en", shortcuts: { ...DEFAULT_SHORTCUTS } },
  });
});

afterEach(() => cleanup());

async function openMedia(path: string) {
  mocks.open.mockResolvedValueOnce(path);
  fireEvent.click(screen.getByRole("button", { name: /open audio or video/i }));
  await waitFor(() => expect(document.querySelector("video")).toBeTruthy());
  const media = document.querySelector("video") as HTMLVideoElement;
  Object.defineProperty(media, "duration", { configurable: true, value: 120 });
  fireEvent.loadedMetadata(media);
  await waitFor(() => expect(mocks.pending.length).toBeGreaterThan(0));
}

describe("media analysis lifecycle", () => {
  it("shows delayed progress and cancels without surfacing an error", async () => {
    render(<App />);
    await openMedia("C:\\Media\\long.mp3");
    const pending = mocks.pending[0];

    act(() => pending.args.onEvent.onmessage({
      requestId: pending.args.requestId,
      phase: "progress",
      progress: 0.4,
      processedSeconds: 48,
    }));

    const status = await screen.findByRole("status", {}, { timeout: 1000 });
    expect(status.textContent).toContain("40% complete");
    fireEvent.click(screen.getByRole("button", { name: "Cancel analysis" }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(mocks.invoke).toHaveBeenCalledWith("cancel_analysis", { requestId: pending.args.requestId });

    await act(async () => {
      pending.reject({ code: "analysis_cancelled" });
      await Promise.resolve();
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Analyze again" })).toBeTruthy();
  });

  it("loads a cached result without flashing the progress panel", async () => {
    render(<App />);
    await openMedia("C:\\Media\\cached.mp3");

    await act(async () => {
      mocks.pending[0].resolve(waveform);
      await Promise.resolve();
    });

    expect(screen.queryByRole("status")).toBeNull();
    expect(usePlayerStore.getState().waveform).toEqual(waveform);
    expect(usePlayerStore.getState().isAnalyzing).toBe(false);
  });

  it("ignores stale progress and completion after switching files", async () => {
    render(<App />);
    await openMedia("C:\\Media\\first.mp3");
    const first = mocks.pending[0];

    mocks.open.mockResolvedValueOnce("C:\\Media\\second.mp3");
    fireEvent.click(screen.getByTitle("Open another file"));
    await waitFor(() => expect(usePlayerStore.getState().mediaPath).toBe("C:\\Media\\second.mp3"));
    const secondMedia = document.querySelector("video") as HTMLVideoElement;
    Object.defineProperty(secondMedia, "duration", { configurable: true, value: 120 });
    fireEvent.loadedMetadata(secondMedia);
    await waitFor(() => expect(mocks.pending.length).toBe(2));
    const second = mocks.pending[1];

    act(() => first.args.onEvent.onmessage({
      requestId: first.args.requestId,
      phase: "progress",
      progress: 0.9,
      processedSeconds: 108,
    }));
    await act(async () => {
      first.resolve(waveform);
      await Promise.resolve();
    });
    expect(usePlayerStore.getState().analysisStarted).toBe(false);
    expect(usePlayerStore.getState().waveform).toBeNull();

    act(() => second.args.onEvent.onmessage({
      requestId: second.args.requestId,
      phase: "progress",
      progress: 0.6,
      processedSeconds: 72,
    }));
    expect(usePlayerStore.getState().analysisProgress).toBe(0.6);
    expect(usePlayerStore.getState().analysisRequestId).toBe(second.args.requestId);

    await act(async () => {
      second.resolve(waveform);
      await Promise.resolve();
    });
    expect(usePlayerStore.getState().waveform).toEqual(waveform);
  });
});
