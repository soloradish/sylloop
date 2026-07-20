// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { usePlayerStore } from "./store";
import { DEFAULT_SHORTCUTS } from "./lib/shortcuts";
import type { LoopState } from "./types";

let mediaPaused = true;
let animationFrameCallback: FrameRequestCallback | null = null;
const playMock = vi.fn(function (this: HTMLMediaElement) {
  mediaPaused = false;
  this.dispatchEvent(new Event("play"));
  return Promise.resolve();
});
const pauseMock = vi.fn(function (this: HTMLMediaElement) {
  mediaPaused = true;
  this.dispatchEvent(new Event("pause"));
});

beforeAll(() => {
  class PointerEventMock extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  }
  class ResizeObserverMock {
    observe() {}
    disconnect() {}
  }
  vi.stubGlobal("PointerEvent", PointerEventMock);
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
    animationFrameCallback = callback;
    return 1;
  }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", { configurable: true, value: vi.fn(() => true) });
  Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLMediaElement.prototype, "paused", { configurable: true, get: () => mediaPaused });
  Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: playMock });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", { configurable: true, value: pauseMock });
});

beforeEach(() => {
  mediaPaused = true;
  animationFrameCallback = null;
  playMock.mockClear();
  pauseMock.mockClear();
  localStorage.clear();
  usePlayerStore.setState({ preferences: { volume: 0.85, speed: 1, loopGap: 0, windowOpacity: 1, alwaysOnTop: false, language: "zh-CN", shortcuts: { ...DEFAULT_SHORTCUTS } } });
  window.history.pushState({}, "", "/?demo=1");
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});

function renderDemo() {
  render(<App />);
  const waveform = screen.getByRole("slider", { name: "拖动选择要重复听的内容" });
  Object.defineProperty(waveform, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 112, width: 100, height: 112, toJSON: () => ({}) }),
  });
  return {
    waveform,
    media: document.querySelector("video") as HTMLVideoElement,
  };
}

function selectRange(waveform: HTMLElement, startX = 25, endX = 50) {
  fireEvent.pointerDown(waveform, { pointerId: 1, clientX: startX });
  fireEvent.pointerMove(waveform, { pointerId: 1, clientX: endX });
  fireEvent.pointerUp(waveform, { pointerId: 1, clientX: endX });
}

function selectAndStart(waveform: HTMLElement, startX = 25, endX = 50) {
  selectRange(waveform, startX, endX);
  fireEvent.click(screen.getByRole("button", { name: "开始循环" }));
}

async function runAnimationFrame() {
  const callback = animationFrameCallback;
  if (!callback) throw new Error("animation frame callback was not registered");
  await act(async () => {
    callback(0);
    await Promise.resolve();
  });
}

describe("selection loop workbench", () => {
  it("moves an active current-segment loop to the segment clicked on the waveform", () => {
    const { waveform } = renderDemo();
    fireEvent.click(screen.getByRole("button", { name: "循环当前片段" }));
    expect(usePlayerStore.getState().loop).toMatchObject({ mode: "segment", start: 4.05, end: 7.1 });

    selectRange(waveform, 75, 75);

    expect(usePlayerStore.getState().currentTime).toBe(9);
    expect(usePlayerStore.getState().loop).toMatchObject({
      mode: "segment",
      start: 7.45,
      end: 11.8,
      completed: 0,
    });
    expect(screen.getByRole("button", { name: "循环当前片段" }).textContent).toContain("00:07–00:11");
  });

  it("waits for confirmation, then locks the waveform and restores the default whole-media loop snapshot", () => {
    const { waveform } = renderDemo();
    selectRange(waveform);

    expect(screen.getByRole("region", { name: "待确认的重复范围" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "选区循环工作台" })).toBeNull();
    expect(usePlayerStore.getState().loop).toMatchObject({ mode: "media", start: 0, end: 12 });
    expect(usePlayerStore.getState().currentTime).toBe(4.8);
    expect(playMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "开始循环" }));

    expect(screen.getByRole("region", { name: "选区循环工作台" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "调整选区起点" })).toBeNull();
    expect(screen.queryByRole("group", { name: "循环范围" })).toBeNull();
    expect(usePlayerStore.getState().loop).toMatchObject({ mode: "selection", start: 3, end: 6, completed: 0 });
    expect(usePlayerStore.getState().currentTime).toBe(3);
    expect(playMock).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "结束选区循环并返回之前的播放现场" }));

    expect(screen.queryByRole("region", { name: "选区循环工作台" })).toBeNull();
    expect(screen.getByRole("group", { name: "循环范围" })).toBeTruthy();
    expect(usePlayerStore.getState().loop).toMatchObject({ mode: "media", start: 0, end: 12 });
    expect(usePlayerStore.getState().currentTime).toBe(4.8);
    expect(usePlayerStore.getState().isPlaying).toBe(false);
  });

  it("clears an unconfirmed draft with Escape without changing playback", () => {
    const { waveform } = renderDemo();
    selectRange(waveform);
    expect(screen.getByRole("region", { name: "待确认的重复范围" })).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("region", { name: "待确认的重复范围" })).toBeNull();
    expect(usePlayerStore.getState().loop).toMatchObject({ mode: "media", start: 0, end: 12 });
    expect(usePlayerStore.getState().currentTime).toBe(4.8);
    expect(playMock).not.toHaveBeenCalled();
  });

  it("restores the exact playing segment-loop snapshot and suppresses normal shortcuts during the session", () => {
    const { waveform } = renderDemo();
    const previousLoop: LoopState = {
      mode: "segment",
      start: 4.05,
      end: 7.1,
      completed: 2,
      gap: 1,
    };
    act(() => {
      usePlayerStore.getState().setLoop(previousLoop);
      usePlayerStore.getState().setPlayback({ currentTime: 5.25, isPlaying: true });
    });
    mediaPaused = false;

    selectAndStart(waveform, 10, 30);
    fireEvent.keyDown(window, { key: "s", code: "KeyS" });
    expect(usePlayerStore.getState().loop.mode).toBe("selection");

    fireEvent.keyDown(window, { key: "Escape" });

    expect(usePlayerStore.getState().loop).toEqual(previousLoop);
    expect(usePlayerStore.getState().currentTime).toBe(5.25);
    expect(usePlayerStore.getState().isPlaying).toBe(true);
    expect(playMock).toHaveBeenCalledTimes(2);
  });

  it("shows an infinite-loop status without inline configuration controls", () => {
    const { waveform } = renderDemo();
    selectAndStart(waveform);

    expect(screen.getByText("第 1 次 · 无限循环 · 无停顿")).toBeTruthy();
    expect(screen.queryByLabelText("重复次数")).toBeNull();
    expect(screen.queryByLabelText("段间停顿")).toBeNull();
  });

  it("keeps an infinite selection loop active across repeated passes", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { waveform, media } = renderDemo();
    selectAndStart(waveform);

    for (let pass = 1; pass <= 3; pass += 1) {
      media.currentTime = 6;
      await runAnimationFrame();
      await act(async () => {
        vi.runOnlyPendingTimers();
        await Promise.resolve();
      });
    }

    expect(screen.getByRole("region", { name: "选区循环工作台" })).toBeTruthy();
    expect(usePlayerStore.getState().loop).toMatchObject({ mode: "selection", completed: 3 });
    expect(screen.getByText("第 4 次 · 无限循环 · 无停顿")).toBeTruthy();
    expect(playMock).toHaveBeenCalledTimes(4);
  });

  it("cancels a pending gap restart when the session exits", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { waveform, media } = renderDemo();
    act(() => usePlayerStore.getState().setPreferences({ loopGap: 1 }));
    selectAndStart(waveform);

    media.currentTime = 6;
    await runAnimationFrame();
    expect(usePlayerStore.getState().loop.completed).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "结束选区循环并返回之前的播放现场" }));
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });

    expect(usePlayerStore.getState().currentTime).toBe(4.8);
    expect(usePlayerStore.getState().loop.mode).toBe("media");
    expect(playMock).toHaveBeenCalledOnce();
  });

  it("restarts a pending gap countdown with the new modal setting", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    usePlayerStore.getState().setPreferences({ loopGap: 2 });
    const { waveform, media } = renderDemo();
    selectAndStart(waveform);

    media.currentTime = 6;
    await runAnimationFrame();
    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    fireEvent.change(screen.getByLabelText("段间停顿"), { target: { value: "0.5" } });

    await act(async () => {
      vi.advanceTimersByTime(499);
      await Promise.resolve();
    });
    expect(playMock).toHaveBeenCalledOnce();

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(playMock).toHaveBeenCalledTimes(2);
    expect(usePlayerStore.getState().loop.gap).toBe(0.5);

    await act(async () => {
      vi.advanceTimersByTime(1500);
      await Promise.resolve();
    });
    expect(playMock).toHaveBeenCalledTimes(2);
  });
});
