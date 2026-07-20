export interface Segment {
  id: string;
  start: number;
  end: number;
  replayStart: number;
}

export interface WaveformData {
  duration: number;
  sampleRate: number;
  peaksPerSecond: number;
  peaks: number[];
  segments: Segment[];
}

export interface AnalysisEvent {
  requestId: string;
  phase: "started" | "progress";
  progress: number | null;
  processedSeconds: number;
}

export interface CacheStats {
  entryCount: number;
  usedBytes: number;
  limitBytes: number;
}

export type LoopMode = "off" | "segment" | "media" | "selection";

export interface LoopState {
  mode: LoopMode;
  start: number;
  end: number;
  completed: number;
  gap: number;
}

export interface PlayerPreferences {
  volume: number;
  speed: number;
  loopGap: number;
  windowOpacity: number;
  alwaysOnTop: boolean;
  language: AppLocale;
  shortcuts: ShortcutBindings;
}

export type ShortcutAction =
  | "playPause"
  | "previousSegment"
  | "nextSegment"
  | "replaySegment"
  | "toggleLoopRange";

export type ShortcutBindings = Record<ShortcutAction, string>;

export type AppLocale = "zh-CN" | "zh-Hant" | "en" | "fr";

export interface AppError {
  code: string;
  detail?: string;
}

export interface PlaylistItem {
  path: string;
  name: string;
  kind: "audio" | "video";
}

export interface MediaContext {
  selected: PlaylistItem;
  playlist: PlaylistItem[];
}

export interface AnalysisCapability {
  available: boolean;
  source: "bundled" | "environment" | "path" | "unavailable";
  version?: string;
}

export const OFF_LOOP: LoopState = {
  mode: "off",
  start: 0,
  end: 0,
  completed: 0,
  gap: 0,
};
