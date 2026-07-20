import { create } from "zustand";
import type { AppError, AppLocale, LoopState, PlayerPreferences, PlaylistItem, Segment, WaveformData } from "./types";
import { OFF_LOOP } from "./types";
import { playlistIndex } from "./lib/playlist";
import { detectLocale, isAppLocale } from "./i18n";
import { DEFAULT_SHORTCUTS, loadShortcutBindings } from "./lib/shortcuts";

export const PREFERENCES_STORAGE_KEY = "sylloop-preferences";

const BASE_PREFERENCES = {
  volume: 0.85,
  speed: 1,
  loopGap: 0,
  windowOpacity: 1,
  alwaysOnTop: false,
} as const;
const LOOP_GAPS = new Set([0, 0.5, 1, 2]);

function finiteNumber(value: unknown, fallback: number, isValid: (value: number) => boolean): number {
  return typeof value === "number" && Number.isFinite(value) && isValid(value) ? value : fallback;
}

export function loadPlayerPreferences(
  storage: Pick<Storage, "getItem"> | null = typeof localStorage === "undefined" ? null : localStorage,
  languages: readonly string[] = typeof navigator === "undefined" ? [] : navigator.languages,
): PlayerPreferences {
  let saved: Record<string, unknown> = {};
  try {
    const raw = storage?.getItem(PREFERENCES_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) saved = parsed as Record<string, unknown>;
  } catch {
    // Corrupt or inaccessible preferences fall back to safe defaults.
  }

  return {
    volume: finiteNumber(saved.volume, BASE_PREFERENCES.volume, (value) => value >= 0 && value <= 1),
    speed: finiteNumber(saved.speed, BASE_PREFERENCES.speed, (value) => value >= 0.5 && value <= 2),
    loopGap: finiteNumber(saved.loopGap, BASE_PREFERENCES.loopGap, (value) => LOOP_GAPS.has(value)),
    windowOpacity: finiteNumber(saved.windowOpacity, BASE_PREFERENCES.windowOpacity, (value) => value >= 0.4 && value <= 1),
    alwaysOnTop: typeof saved.alwaysOnTop === "boolean" ? saved.alwaysOnTop : BASE_PREFERENCES.alwaysOnTop,
    language: isAppLocale(saved.language) ? saved.language : detectLocale(languages),
    shortcuts: loadShortcutBindings(saved.shortcuts),
  };
}

export function createDefaultPlayerPreferences(
  languages: readonly string[] = typeof navigator === "undefined" ? [] : navigator.languages,
): PlayerPreferences {
  return {
    ...BASE_PREFERENCES,
    language: detectLocale(languages),
    shortcuts: { ...DEFAULT_SHORTCUTS },
  };
}

interface PlayerStore {
  mediaPath: string | null;
  mediaName: string;
  mediaUrl: string | null;
  duration: number;
  currentTime: number;
  isPlaying: boolean;
  isAnalyzing: boolean;
  analysisRequestId: string | null;
  analysisStarted: boolean;
  analysisProgress: number | null;
  waveform: WaveformData | null;
  segments: Segment[];
  loop: LoopState;
  preferences: PlayerPreferences;
  error: AppError | null;
  playlist: PlaylistItem[];
  currentPlaylistIndex: number;
  setMedia: (path: string, url: string) => void;
  clearMedia: () => void;
  setPlayback: (state: Partial<Pick<PlayerStore, "duration" | "currentTime" | "isPlaying">>) => void;
  startAnalysis: (requestId: string) => void;
  updateAnalysis: (requestId: string, progress: number | null, started?: boolean) => void;
  finishAnalysis: (requestId: string) => void;
  setWaveform: (waveform: WaveformData) => void;
  setSegments: (segments: Segment[]) => void;
  setLoop: (loop: LoopState) => void;
  setPreferences: (preferences: Partial<PlayerPreferences>) => void;
  resetPreferences: () => void;
  setError: (error: AppError | null) => void;
  setPlaylist: (playlist: PlaylistItem[]) => void;
}

export const usePlayerStore = create<PlayerStore>((set) => ({
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
  loop: OFF_LOOP,
  preferences: loadPlayerPreferences(),
  error: null,
  playlist: [],
  currentPlaylistIndex: -1,
  setMedia: (path, url) => set((state) => ({
    mediaPath: path,
    mediaName: path.split(/[\\/]/).pop() ?? path,
    mediaUrl: url,
    duration: 0,
    currentTime: 0,
    isPlaying: false,
    waveform: null,
    segments: [],
    loop: OFF_LOOP,
    error: null,
    isAnalyzing: false,
    analysisRequestId: null,
    analysisStarted: false,
    analysisProgress: null,
    currentPlaylistIndex: playlistIndex(state.playlist, path),
  })),
  clearMedia: () => set({
    mediaPath: null,
    mediaName: "",
    mediaUrl: null,
    duration: 0,
    currentTime: 0,
    isPlaying: false,
    waveform: null,
    segments: [],
    loop: OFF_LOOP,
    isAnalyzing: false,
    analysisRequestId: null,
    analysisStarted: false,
    analysisProgress: null,
    currentPlaylistIndex: -1,
    error: null,
    playlist: [],
  }),
  setPlayback: (state) => set(state),
  startAnalysis: (analysisRequestId) => set({
    isAnalyzing: true,
    analysisRequestId,
    analysisStarted: false,
    analysisProgress: null,
  }),
  updateAnalysis: (requestId, analysisProgress, analysisStarted = true) => set((state) => (
    state.analysisRequestId === requestId
      ? { analysisProgress, analysisStarted }
      : {}
  )),
  finishAnalysis: (requestId) => set((state) => (
    state.analysisRequestId === requestId
      ? { isAnalyzing: false, analysisRequestId: null, analysisStarted: false, analysisProgress: null }
      : {}
  )),
  setWaveform: (waveform) => set({
    waveform,
    segments: waveform.segments,
    isAnalyzing: false,
    analysisRequestId: null,
    analysisStarted: false,
    analysisProgress: 1,
  }),
  setSegments: (segments) => set({ segments }),
  setLoop: (loop) => set({ loop }),
  setPreferences: (preferences) => set((state) => ({ preferences: { ...state.preferences, ...preferences } })),
  resetPreferences: () => set({ preferences: createDefaultPlayerPreferences() }),
  setError: (error) => set({ error }),
  setPlaylist: (playlist) => set((state) => ({
    playlist,
    currentPlaylistIndex: playlistIndex(playlist, state.mediaPath),
  })),
}));
