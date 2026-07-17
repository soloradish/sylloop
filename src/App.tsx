import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Channel, convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Waveform } from "./components/Waveform";
import { PlaybackIcon } from "./components/PlaybackIcon";
import { SettingsModal } from "./components/SettingsModal";
import { BrandMark } from "./components/BrandMark";
import { HelpModal } from "./components/HelpModal";
import { AnalysisProgress } from "./components/AnalysisProgress";
import { ERROR_MESSAGE_KEYS, I18nProvider, useI18n } from "./i18n";
import { currentSegmentIndex, formatTime } from "./lib/segments";
import { sortPlaylist } from "./lib/playlist";
import { formatShortcut, shortcutActionForEvent } from "./lib/shortcuts";
import { openExternalUrl, projectUrlForLocale } from "./lib/externalLinks";
import { MEDIA_EXTENSIONS, isSupportedMediaPath, isVideoPath } from "./mediaFormats";
import { PREFERENCES_STORAGE_KEY, usePlayerStore } from "./store";
import type { AnalysisEvent, AppError, CacheStats, LoopState, MediaContext, PlaylistItem, Segment, WaveformData } from "./types";

interface Selection {
  start: number;
  end: number;
}

interface PlaybackSnapshot {
  currentTime: number;
  isPlaying: boolean;
  loop: LoopState;
  loopGapPreference: number;
}

interface SelectionLoopSession {
  selection: Selection;
  snapshot: PlaybackSnapshot;
}

type OpenSource = "new" | "playlist";
type StandardLoopMode = "segment" | "media";

let requestSequence = 0;

function createAnalysisRequestId(): string {
  requestSequence += 1;
  return `analysis-${Date.now()}-${requestSequence}`;
}

function normalizeCommandError(error: unknown): AppError {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return {
      code: error.code,
      detail: "detail" in error && typeof error.detail === "string" && error.detail.trim() ? error.detail : undefined,
    };
  }
  if (typeof error === "string") {
    try {
      return normalizeCommandError(JSON.parse(error));
    } catch {
      return { code: "unknown", detail: error };
    }
  }
  if (error instanceof Error) return { code: "unknown", detail: error.message };
  return { code: "unknown" };
}

export default function App() {
  const locale = usePlayerStore((state) => state.preferences.language);
  return (
    <I18nProvider locale={locale}>
      <PlayerApp />
    </I18nProvider>
  );
}

function PlayerApp() {
  const { t, formatFileCount, formatNumber, formatSeconds, formatSegmentCount } = useI18n();
  const mediaRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const helpButtonRef = useRef<HTMLButtonElement>(null);
  const playlistButtonRef = useRef<HTMLButtonElement>(null);
  const selectionPanelRef = useRef<HTMLElement>(null);
  const loopBusyRef = useRef(false);
  const loopRestartTimerRef = useRef<number | null>(null);
  const loopRestartTokenRef = useRef(0);
  const selectionLoopSessionRef = useRef<SelectionLoopSession | null>(null);
  const autoplayOnLoadRef = useRef(false);
  const analysisInvokedRef = useRef<string | null>(null);
  const mediaOpenTokenRef = useRef(0);
  const playlistRequestTokenRef = useRef(0);
  const ownedBrowserUrlRef = useRef<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [selectionLoopSession, setSelectionLoopSession] = useState<SelectionLoopSession | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [playlistOpen, setPlaylistOpen] = useState(false);
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [cacheClearing, setCacheClearing] = useState(false);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(() => document.fullscreenElement !== null);
  const store = usePlayerStore();
  const isDemo = import.meta.env.DEV && new URLSearchParams(window.location.search).get("demo") === "1";
  const demoPlaying = isDemo && new URLSearchParams(window.location.search).get("playing") === "1";
  const runningInTauri = isTauri();

  useEffect(() => {
    if (!runningInTauri) return;
    let active = true;
    void getVersion()
      .then((version) => { if (active) setAppVersion(version); })
      .catch(() => { if (active) setAppVersion(null); });
    return () => { active = false; };
  }, [runningInTauri]);

  const activeSegment = useMemo(
    () => currentSegmentIndex(store.segments, store.currentTime),
    [store.currentTime, store.segments],
  );
  const currentSegment = activeSegment >= 0 ? store.segments[activeSegment] : null;
  const isVideo = store.mediaPath ? isVideoPath(store.mediaPath) : false;

  const safePlay = useCallback(async (media: HTMLMediaElement): Promise<boolean> => {
    try {
      await media.play();
      return true;
    } catch (error) {
      const actions = usePlayerStore.getState();
      actions.setPlayback({ isPlaying: false });
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        actions.setError({ code: "playback_failed", detail: error instanceof Error ? error.message : undefined });
      }
      return false;
    }
  }, []);

  const replaceOwnedBrowserUrl = useCallback((next: string | null) => {
    const previous = ownedBrowserUrlRef.current;
    if (previous && previous !== next) URL.revokeObjectURL(previous);
    ownedBrowserUrlRef.current = next;
  }, []);

  const clearPendingLoopRestart = useCallback(() => {
    loopRestartTokenRef.current += 1;
    if (loopRestartTimerRef.current !== null) {
      window.clearTimeout(loopRestartTimerRef.current);
      loopRestartTimerRef.current = null;
    }
    loopBusyRef.current = false;
  }, []);

  const scheduleLoopRestart = useCallback((loop: LoopState) => {
    const media = mediaRef.current;
    if (!media) {
      loopBusyRef.current = false;
      return;
    }

    loopBusyRef.current = true;
    const restartToken = ++loopRestartTokenRef.current;
    loopRestartTimerRef.current = window.setTimeout(() => {
      loopRestartTimerRef.current = null;
      if (loopRestartTokenRef.current !== restartToken) return;
      const activeLoop = usePlayerStore.getState().loop;
      if (activeLoop.mode !== loop.mode || activeLoop.start !== loop.start || activeLoop.end !== loop.end) {
        loopBusyRef.current = false;
        return;
      }
      media.currentTime = loop.start;
      usePlayerStore.getState().setPlayback({ currentTime: loop.start });
      void safePlay(media).finally(() => { loopBusyRef.current = false; });
    }, loop.gap * 1000);
  }, [safePlay]);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    settingsButtonRef.current?.focus();
  }, []);

  const closeHelp = useCallback(() => {
    setHelpOpen(false);
    helpButtonRef.current?.focus();
  }, []);

  const closePlaylist = useCallback(() => {
    setPlaylistOpen(false);
    playlistButtonRef.current?.focus();
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // Fullscreen requests can be denied; fullscreenchange remains the source of truth.
    }
  }, []);

  const discardSelectionLoopSession = useCallback(() => {
    clearPendingLoopRestart();
    selectionLoopSessionRef.current = null;
    setSelectionLoopSession(null);
    setSelection(null);
  }, [clearPendingLoopRestart]);

  const finishSelectionLoop = useCallback(() => {
    const session = selectionLoopSessionRef.current;
    if (!session) return;

    clearPendingLoopRestart();
    selectionLoopSessionRef.current = null;
    setSelectionLoopSession(null);
    setSelection(null);

    const actions = usePlayerStore.getState();
    const snapshot = session.snapshot;
    const loopGapChanged = actions.preferences.loopGap !== snapshot.loopGapPreference;
    actions.setLoop(snapshot.loop.mode === "off" || !loopGapChanged
      ? { ...snapshot.loop }
      : { ...snapshot.loop, gap: actions.preferences.loopGap });

    const media = mediaRef.current;
    if (!media) {
      actions.setPlayback({ currentTime: snapshot.currentTime, isPlaying: snapshot.isPlaying });
      return;
    }

    const restoredTime = Math.max(0, Math.min(snapshot.currentTime, media.duration || actions.duration));
    media.currentTime = restoredTime;
    actions.setPlayback({ currentTime: restoredTime, isPlaying: snapshot.isPlaying });
    if (snapshot.isPlaying) {
      void safePlay(media);
    } else {
      media.pause();
    }
  }, [clearPendingLoopRestart, safePlay]);

  useEffect(() => {
    if (!isDemo) return;
    const demoSegments: Segment[] = [
      { id: "demo-1", start: 0.4, end: 3.8, replayStart: 0.25 },
      { id: "demo-2", start: 4.2, end: 7.1, replayStart: 4.05 },
      { id: "demo-3", start: 7.6, end: 11.8, replayStart: 7.45 },
    ];
    const demoPeaks = Array.from({ length: 600 }, (_, index) => 0.08 + Math.abs(Math.sin(index * 0.17) * Math.cos(index * 0.031)) * 0.76);
    store.setMedia("C:\\Demo\\listening-practice.mp3", "data:audio/wav;base64,UklGRg==");
    store.setPlaylist(sortPlaylist([
      { path: "C:\\Demo\\lesson-2.mp3", name: "lesson-2.mp3", kind: "audio" },
      { path: "C:\\Demo\\listening-practice.mp3", name: "listening-practice.mp3", kind: "audio" },
      { path: "C:\\Demo\\lesson-10.mp4", name: "lesson-10.mp4", kind: "video" },
    ]));
    store.setPlayback({ duration: 12, currentTime: 4.8, isPlaying: demoPlaying });
    store.setLoop({ mode: "media", start: 0, end: 12, completed: 0, gap: store.preferences.loopGap });
    store.setWaveform({ duration: 12, sampleRate: 16000, peaksPerSecond: 50, peaks: demoPeaks, segments: demoSegments });
  }, []);

  useEffect(() => {
    if (selectionLoopSession) selectionPanelRef.current?.focus();
  }, [selectionLoopSession]);

  useEffect(() => {
    const syncFullscreenState = () => setIsFullscreen(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", syncFullscreenState);
    syncFullscreenState();
    return () => document.removeEventListener("fullscreenchange", syncFullscreenState);
  }, []);

  useEffect(() => () => {
    clearPendingLoopRestart();
    selectionLoopSessionRef.current = null;
    const requestId = usePlayerStore.getState().analysisRequestId;
    if (requestId && isTauri()) void invoke("cancel_analysis", { requestId });
    replaceOwnedBrowserUrl(null);
  }, [clearPendingLoopRestart, replaceOwnedBrowserUrl]);

  const refreshPlaylist = useCallback(async (path: string) => {
    const fallback: PlaylistItem = {
      path,
      name: path.split(/[\\/]/).pop() ?? path,
      kind: isVideoPath(path) ? "video" : "audio",
    };
    const requestToken = ++playlistRequestTokenRef.current;
    usePlayerStore.getState().setPlaylist([fallback]);
    if (!isTauri()) {
      return;
    }
    try {
      const context = await invoke<MediaContext>("open_media_context", { path });
      const state = usePlayerStore.getState();
      if (playlistRequestTokenRef.current !== requestToken || state.mediaPath !== path) return;
      state.setPlaylist(sortPlaylist(context.playlist.length ? context.playlist : [context.selected]));
    } catch {
      const state = usePlayerStore.getState();
      if (playlistRequestTokenRef.current === requestToken && state.mediaPath === path) state.setPlaylist([fallback]);
    }
  }, []);

  const refreshCacheStats = useCallback(async () => {
    if (!isTauri()) {
      setCacheStats(null);
      return;
    }
    try {
      setCacheStats(await invoke<CacheStats>("get_analysis_cache_stats"));
    } catch {
      setCacheStats(null);
    }
  }, []);

  const runAnalysis = useCallback(async (path: string, durationSeconds: number | null, requestId: string) => {
    if (!isTauri() || analysisInvokedRef.current === requestId) return;
    analysisInvokedRef.current = requestId;
    const onEvent = new Channel<AnalysisEvent>();
    onEvent.onmessage = (event) => {
      if (event.requestId !== requestId) return;
      usePlayerStore.getState().updateAnalysis(requestId, event.progress, true);
    };

    try {
      const result = await invoke<WaveformData>("analyze_audio", {
        path,
        durationSeconds,
        requestId,
        onEvent,
      });
      const state = usePlayerStore.getState();
      if (state.mediaPath === path && state.analysisRequestId === requestId) {
        state.setWaveform(result);
        void refreshCacheStats();
      }
    } catch (error) {
      const state = usePlayerStore.getState();
      if (state.analysisRequestId !== requestId) return;
      const normalized = normalizeCommandError(error);
      state.finishAnalysis(requestId);
      if (normalized.code !== "analysis_cancelled") state.setError(normalized);
    } finally {
      if (analysisInvokedRef.current === requestId) analysisInvokedRef.current = null;
    }
  }, [refreshCacheStats]);

  const startPendingAnalysis = useCallback((duration: number) => {
    const state = usePlayerStore.getState();
    if (!state.isAnalyzing || !state.analysisRequestId || !state.mediaPath) return;
    const durationSeconds = Number.isFinite(duration) && duration > 0 ? duration : null;
    void runAnalysis(state.mediaPath, durationSeconds, state.analysisRequestId);
  }, [runAnalysis]);

  const cancelAnalysis = useCallback(() => {
    const state = usePlayerStore.getState();
    const requestId = state.analysisRequestId;
    if (!requestId) return;
    state.finishAnalysis(requestId);
    if (analysisInvokedRef.current === requestId) analysisInvokedRef.current = null;
    if (isTauri()) void invoke("cancel_analysis", { requestId });
  }, []);

  const retryAnalysis = useCallback(() => {
    if (!isTauri()) return;
    const state = usePlayerStore.getState();
    if (!state.mediaPath) return;
    if (state.analysisRequestId) {
      void invoke("cancel_analysis", { requestId: state.analysisRequestId });
    }
    const requestId = createAnalysisRequestId();
    analysisInvokedRef.current = null;
    state.startAnalysis(requestId);
    const duration = mediaRef.current?.duration;
    if (duration !== undefined && Number.isFinite(duration) && duration > 0) {
      void runAnalysis(state.mediaPath, duration, requestId);
    }
  }, [runAnalysis]);

  const openPath = useCallback(async (path: string, browserUrl?: string, source: OpenSource = "new") => {
    const requestToken = ++mediaOpenTokenRef.current;
    if (!isSupportedMediaPath(path)) {
      usePlayerStore.getState().setError({ code: "unsupported_format" });
      if (browserUrl) URL.revokeObjectURL(browserUrl);
      return;
    }
    let selectedPath = path;
    let playlist: PlaylistItem[] | null = null;
    if (isTauri()) {
      try {
        const context = await invoke<MediaContext>("open_media_context", { path });
        if (mediaOpenTokenRef.current !== requestToken) return;
        selectedPath = context.selected.path;
        playlist = sortPlaylist(context.playlist.length ? context.playlist : [context.selected]);
      } catch (error) {
        if (mediaOpenTokenRef.current === requestToken) usePlayerStore.getState().setError(normalizeCommandError(error));
        return;
      }
    }
    if (mediaOpenTokenRef.current !== requestToken) return;
    const actions = usePlayerStore.getState();
    if (actions.analysisRequestId && isTauri()) {
      void invoke("cancel_analysis", { requestId: actions.analysisRequestId });
    }
    replaceOwnedBrowserUrl(browserUrl ?? null);
    const url = browserUrl ?? convertFileSrc(selectedPath);
    discardSelectionLoopSession();
    autoplayOnLoadRef.current = source === "playlist";
    analysisInvokedRef.current = null;
    if (playlist) actions.setPlaylist(playlist);
    actions.setMedia(selectedPath, url);
    setSelection(null);
    if (source === "new" && !playlist) void refreshPlaylist(selectedPath);
    if (isTauri()) actions.startAnalysis(createAnalysisRequestId());
  }, [discardSelectionLoopSession, refreshPlaylist, replaceOwnedBrowserUrl]);

  useEffect(() => {
    if (import.meta.env.VITE_E2E !== "1") return;
    window.__SYLLOOP_E2E_OPEN_PATH__ = (path) => openPath(path);
    window.__SYLLOOP_E2E_SET_SELECTION__ = (startRatio, endRatio) => {
      const duration = usePlayerStore.getState().duration;
      const start = Math.max(0, Math.min(1, startRatio)) * duration;
      const end = Math.max(0, Math.min(1, endRatio)) * duration;
      if (duration <= 0 || end - start < 0.12) throw new Error("E2E selection requires loaded media and a valid range");
      setSelection({ start, end });
    };
    return () => {
      delete window.__SYLLOOP_E2E_OPEN_PATH__;
      delete window.__SYLLOOP_E2E_SET_SELECTION__;
    };
  }, [openPath]);

  const pickMedia = async () => {
    if (!isTauri()) {
      fileInputRef.current?.click();
      return;
    }
    const path = await open({
      multiple: false,
      directory: false,
      filters: [{ name: t("file.audioVideo"), extensions: [...MEDIA_EXTENSIONS] }],
    });
    if (path) await openPath(path);
  };

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    getCurrentWebviewWindow().onDragDropEvent((event) => {
      if (event.payload.type !== "drop") return;
      const path = event.payload.paths.find(isSupportedMediaPath);
      if (path) void openPath(path);
    }).then((dispose) => { unlisten = dispose; });
    return () => unlisten?.();
  }, [openPath]);

  useEffect(() => {
    try {
      localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(store.preferences));
    } catch {
      // Preferences remain available in memory when persistent storage is unavailable.
    }
    const media = mediaRef.current;
    if (media) {
      media.volume = store.preferences.volume;
      media.playbackRate = store.preferences.speed;
    }
  }, [store.preferences]);

  useEffect(() => {
    if (settingsOpen) void refreshCacheStats();
  }, [refreshCacheStats, settingsOpen]);

  const clearAnalysisCache = useCallback(async () => {
    if (!isTauri() || usePlayerStore.getState().isAnalyzing) return;
    setCacheClearing(true);
    try {
      setCacheStats(await invoke<CacheStats>("clear_analysis_cache"));
    } catch (error) {
      usePlayerStore.getState().setError(normalizeCommandError(error));
    } finally {
      setCacheClearing(false);
    }
  }, []);

  const openExternal = useCallback(async (url: string) => {
    try {
      await openExternalUrl(url);
    } catch (error) {
      usePlayerStore.getState().setError({
        code: "external_link_failed",
        detail: error instanceof Error ? error.message : undefined,
      });
    }
  }, []);

  const updateLoopGap = useCallback((gap: number) => {
    const actions = usePlayerStore.getState();
    actions.setPreferences({ loopGap: gap });
    if (actions.loop.mode === "off") return;

    const updatedLoop = { ...actions.loop, gap };
    const wasWaiting = loopBusyRef.current;
    actions.setLoop(updatedLoop);
    if (wasWaiting) {
      clearPendingLoopRestart();
      mediaRef.current?.pause();
      scheduleLoopRestart(updatedLoop);
    }
  }, [clearPendingLoopRestart, scheduleLoopRestart]);

  const seek = (time: number, play = false, syncSegmentLoop = true) => {
    const media = mediaRef.current;
    if (!media) return;
    media.currentTime = Math.max(0, Math.min(time, media.duration || store.duration));
    const actions = usePlayerStore.getState();
    actions.setPlayback({ currentTime: media.currentTime });

    if (syncSegmentLoop && actions.loop.mode === "segment") {
      const nextIndex = currentSegmentIndex(actions.segments, media.currentTime);
      const nextSegment = actions.segments[nextIndex];
      if (nextSegment) {
        const wasWaiting = loopBusyRef.current;
        if (wasWaiting) clearPendingLoopRestart();
        const updatedLoop: LoopState = {
          ...actions.loop,
          start: nextSegment.replayStart,
          end: nextSegment.end,
          completed: 0,
        };
        actions.setLoop(updatedLoop);
        if (wasWaiting) scheduleLoopRestart(updatedLoop);
      }
    }
    if (play) void safePlay(media);
  };

  const togglePlayback = () => {
    const media = mediaRef.current;
    if (!media) return;
    if (media.paused) {
      if (loopBusyRef.current) {
        const loop = usePlayerStore.getState().loop;
        clearPendingLoopRestart();
        if (loop.mode !== "off") {
          media.currentTime = loop.start;
          usePlayerStore.getState().setPlayback({ currentTime: loop.start });
        }
      }
      void safePlay(media);
    } else {
      media.pause();
    }
  };

  const beginSelectionLoop = (nextSelection: Selection) => {
    const media = mediaRef.current;
    if (!media || selectionLoopSessionRef.current || nextSelection.end - nextSelection.start < 0.12) return;

    const actions = usePlayerStore.getState();
    const session: SelectionLoopSession = {
      selection: nextSelection,
      snapshot: {
        currentTime: actions.currentTime,
        isPlaying: actions.isPlaying,
        loop: { ...actions.loop },
        loopGapPreference: actions.preferences.loopGap,
      },
    };

    clearPendingLoopRestart();
    selectionLoopSessionRef.current = session;
    setSelectionLoopSession(session);
    setSelection(nextSelection);
    actions.setLoop({
      mode: "selection",
      ...nextSelection,
      completed: 0,
      gap: actions.preferences.loopGap,
    });
    media.currentTime = nextSelection.start;
    actions.setPlayback({ currentTime: nextSelection.start, isPlaying: true });
    void safePlay(media);
  };

  const jumpSegment = (delta: number) => {
    if (!store.segments.length) return;
    const nextIndex = Math.max(0, Math.min(store.segments.length - 1, activeSegment + delta));
    const next = store.segments[nextIndex];
    seek(next.replayStart, true, false);
    if (store.loop.mode === "segment") {
      store.setLoop({ ...store.loop, start: next.replayStart, end: next.end, completed: 0 });
    }
  };

  const replay = () => {
    if (currentSegment) seek(currentSegment.replayStart, true, false);
    else seek(Math.max(0, store.currentTime - 2), true);
  };

  const setLoopMode = (mode: StandardLoopMode) => {
    if (store.loop.mode === mode && mode === "media") return;
    const wasWaiting = loopBusyRef.current;
    clearPendingLoopRestart();
    const range = mode === "media"
      ? { start: 0, end: store.duration }
      : currentSegment
        ? { start: currentSegment.replayStart, end: currentSegment.end }
        : null;
    if (!range || range.end <= range.start) return;

    const nextLoop: LoopState = {
      mode,
      ...range,
      completed: 0,
      gap: store.preferences.loopGap,
    };
    store.setLoop(nextLoop);
    if (wasWaiting) scheduleLoopRestart(nextLoop);
    setSelection(null);
  };

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const media = mediaRef.current;
      const loop = usePlayerStore.getState().loop;
      if (media && !media.paused && loop.mode !== "off" && !loopBusyRef.current && media.currentTime >= loop.end - 0.035) {
        media.pause();
        const updatedLoop = { ...loop, completed: loop.completed + 1 };
        usePlayerStore.getState().setLoop(updatedLoop);
        scheduleLoopRestart(updatedLoop);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [scheduleLoopRestart]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (settingsOpen) closeSettings();
        else if (helpOpen) closeHelp();
        else if (playlistOpen) closePlaylist();
        else if (selectionLoopSessionRef.current) finishSelectionLoop();
        else if (selection) setSelection(null);
        return;
      }
      const target = event.target;
      if (settingsOpen || helpOpen || (target instanceof HTMLElement && (target.matches("input, select, textarea") || target.isContentEditable))) return;
      const action = shortcutActionForEvent(store.preferences.shortcuts, event);
      if (!action) return;
      if (selectionLoopSessionRef.current) {
        if (action === "playPause") {
          event.preventDefault();
          if (target instanceof HTMLButtonElement && document.activeElement === target) target.blur();
          togglePlayback();
        }
        return;
      }
      event.preventDefault();
      if (target instanceof HTMLButtonElement && document.activeElement === target) target.blur();
      if (action === "playPause") togglePlayback();
      else if (action === "previousSegment") jumpSegment(-1);
      else if (action === "nextSegment") jumpSegment(1);
      else if (action === "replaySegment") replay();
      else if (action === "toggleLoopRange") setLoopMode(store.loop.mode === "segment" ? "media" : "segment");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const helpDialog = helpOpen ? (
    <HelpModal
      appVersion={appVersion}
      isDevelopmentBuild={!runningInTauri}
      projectUrl={projectUrlForLocale(store.preferences.language)}
      onOpenUrl={(url) => void openExternal(url)}
      onClose={closeHelp}
    />
  ) : null;
  const errorToast = store.error ? (
    <div className="error-toast" role="alert">
      <span>
        <strong>{t(ERROR_MESSAGE_KEYS[store.error.code] ?? "error.unknown")}</strong>
        {store.error.detail && <small>{store.error.detail}</small>}
      </span>
      <button onClick={() => store.setError(null)} aria-label={t("error.dismiss")}>×</button>
    </div>
  ) : null;

  if (!store.mediaPath) {
    return (
      <main className="empty-shell">
        <button ref={helpButtonRef} className="empty-help-button" onClick={() => setHelpOpen(true)} aria-haspopup="dialog" aria-expanded={helpOpen}>
          {t("top.help")}
        </button>
        <BrandMark />
        <h1>Sylloop</h1>
        <p>{t("empty.tagline")}</p>
        <button className="open-primary" onClick={pickMedia}>{t("empty.openMedia")}</button>
        <span className="drop-hint">{t("empty.dropHint")}</span>
        <input
          ref={fileInputRef}
          type="file"
          hidden
          accept={MEDIA_EXTENSIONS.map((ext) => `.${ext}`).join(",")}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void openPath(file.name, URL.createObjectURL(file));
          }}
        />
        {helpDialog}
        {errorToast}
      </main>
    );
  }

  const fallbackPeaks = Array.from({ length: 240 }, (_, index) => 0.1 + Math.abs(Math.sin(index * 0.31)) * 0.2);
  const peaks = store.waveform?.peaks ?? fallbackPeaks;
  const peaksPerSecond = store.waveform?.peaksPerSecond ?? peaks.length / Math.max(store.duration, 0.01);

  return (
    <main className="player-shell">
      <header className="topbar">
        <div className="topbar-primary">
          <span className="wordmark" aria-label="Sylloop">Sylloop</span>
          <button className="open-file-button" onClick={pickMedia} title={t("top.openAnother")}>
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M2.5 5.25h5l1.5 1.5h8.5v8.5a1.5 1.5 0 0 1-1.5 1.5H4a1.5 1.5 0 0 1-1.5-1.5v-10Z" />
              <path d="M2.5 7.25h15" />
            </svg>
            {t("top.openFile")}
          </button>
        </div>
        <div className="file-title" title={store.mediaPath}>{store.mediaName}</div>
        <div className="top-actions">
          <button
            ref={playlistButtonRef}
            className={playlistOpen ? "active" : ""}
            onClick={() => {
              setSettingsOpen(false);
              setHelpOpen(false);
              setPlaylistOpen((open) => !open);
            }}
          >
            {t("top.playlistCount", { count: formatNumber(store.playlist.length || 1) })}
          </button>
          <button
            ref={helpButtonRef}
            className={helpOpen ? "help-button active" : "help-button"}
            onClick={() => {
              setPlaylistOpen(false);
              setSettingsOpen(false);
              setHelpOpen(true);
            }}
            aria-haspopup="dialog"
            aria-expanded={helpOpen}
          >
            {t("top.help")}
          </button>
          <button
            ref={settingsButtonRef}
            className={settingsOpen ? "active" : ""}
            onClick={() => {
              setPlaylistOpen(false);
              setHelpOpen(false);
              setSettingsOpen(true);
            }}
            aria-haspopup="dialog"
            aria-expanded={settingsOpen}
          >
            {t("top.settings")}
          </button>
          <button onClick={() => void toggleFullscreen()}>{isFullscreen ? t("top.exitFullscreen") : t("top.fullscreen")}</button>
        </div>
      </header>

      <section className={isVideo ? "media-stage" : "media-stage audio-only"}>
        {!isVideo && (
          <div className="audio-visual">
            <span className="audio-orbit one" />
            <span className="audio-orbit two" />
            <strong>{store.mediaName.replace(/\.[^.]+$/, "")}</strong>
          </div>
        )}
        <video
          key={store.mediaUrl}
          ref={mediaRef}
          src={store.mediaUrl ?? undefined}
          className={isVideo ? "media-element" : "media-element audio-element"}
          onLoadedMetadata={(event) => {
            const media = event.currentTarget;
            media.volume = store.preferences.volume;
            media.playbackRate = store.preferences.speed;
            store.setPlayback({ duration: media.duration });
            const activeLoop = usePlayerStore.getState().loop;
            if (activeLoop.mode === "off" || activeLoop.mode === "media") {
              store.setLoop({ mode: "media", start: 0, end: media.duration, completed: 0, gap: store.preferences.loopGap });
            }
            if (!store.segments.length) {
              const whole: Segment = { id: "whole", start: 0, end: media.duration, replayStart: 0 };
              store.setSegments([whole]);
            }
            startPendingAnalysis(media.duration);
          }}
          onTimeUpdate={(event) => store.setPlayback({ currentTime: event.currentTarget.currentTime })}
          onPlay={() => store.setPlayback({ isPlaying: true })}
          onPause={() => store.setPlayback({ isPlaying: false })}
          onCanPlay={(event) => {
            if (!autoplayOnLoadRef.current) return;
            autoplayOnLoadRef.current = false;
            void safePlay(event.currentTarget);
          }}
          onEnded={() => store.setPlayback({ isPlaying: false })}
          onError={() => {
            if (!isDemo) {
              cancelAnalysis();
              store.setError({ code: "media_decode_failed" });
            }
          }}
        />
      </section>

      <section className="learning-dock">
        <div className="timeline-meta">
          <span>{formatTime(store.currentTime)}</span>
          <span className="analysis-state">
            {store.isAnalyzing
              ? t("timeline.analyzing")
              : store.waveform
                ? formatSegmentCount(store.segments.length)
                : runningInTauri && store.duration > 0
                  ? <button type="button" onClick={retryAnalysis}>{t("analysis.retry")}</button>
                  : store.segments.length ? formatSegmentCount(store.segments.length) : ""}
          </span>
          <span>{formatTime(store.duration)}</span>
        </div>
        <Waveform
          key={store.mediaUrl}
          duration={Math.max(store.duration, 0.01)}
          peaks={peaks}
          peaksPerSecond={peaksPerSecond}
          currentTime={store.currentTime}
          segments={store.segments}
          activeSegment={activeSegment}
          selection={selection}
          selectionLocked={selectionLoopSession !== null}
          onSeek={seek}
          onSelect={setSelection}
          onSelectionConfirm={beginSelectionLoop}
        />

        {selectionLoopSession ? (
          <section
            className="selection-loop-workbench"
            ref={selectionPanelRef}
            role="region"
            aria-label={t("selection.workbench")}
            tabIndex={-1}
          >
            <div className="selection-loop-summary">
              <span className="selection-loop-kicker">{t("selection.loop")}</span>
              <strong>{formatTime(selectionLoopSession.selection.start)} — {formatTime(selectionLoopSession.selection.end)}</strong>
              <span className="selection-loop-round" aria-live="polite">
                {t("selection.round", { count: formatNumber(store.loop.completed + 1) })} · {t("selection.infinite")} · {store.loop.gap ? t("selection.interval", { duration: formatSeconds(store.loop.gap) }) : t("selection.noPause")}
              </span>
            </div>
            <button
              className="selection-loop-play"
              onClick={togglePlayback}
              title={t("selection.playPauseTitle", { shortcut: formatShortcut(store.preferences.shortcuts.playPause) })}
              aria-label={store.isPlaying ? t("selection.pause") : t("selection.continue")}
            >
              <PlaybackIcon playing={store.isPlaying} />
            </button>
            <button className="selection-loop-exit" onClick={finishSelectionLoop} aria-label={t("selection.exitAria")}>
              {t("selection.exit")}
              <span>Esc</span>
            </button>
          </section>
        ) : (
          <div className="primary-controls">
            <div className="transport-controls">
              <button onClick={() => jumpSegment(-1)} disabled={activeSegment <= 0} title={t("transport.previousTitle", { shortcut: formatShortcut(store.preferences.shortcuts.previousSegment) })}>{t("transport.previous")}</button>
              <button className="replay-button" onClick={replay} title={t("transport.replayTitle", { shortcut: formatShortcut(store.preferences.shortcuts.replaySegment) })}>
                <span>↶</span> {t("transport.replay")}
              </button>
              <button className="play-button" onClick={togglePlayback} title={t("transport.playPauseTitle", { shortcut: formatShortcut(store.preferences.shortcuts.playPause) })} aria-label={store.isPlaying ? t("transport.pause") : t("transport.play")}>
                <PlaybackIcon playing={store.isPlaying} />
              </button>
              <button onClick={() => jumpSegment(1)} disabled={activeSegment >= store.segments.length - 1} title={t("transport.nextTitle", { shortcut: formatShortcut(store.preferences.shortcuts.nextSegment) })}>{t("transport.next")}</button>
            </div>
            <div className="loop-control" role="group" aria-label={t("loop.range")}>
              <div className="loop-control-heading" aria-hidden="true">
                <span>↻</span>
                <strong>{t("loop.range")}</strong>
              </div>
              <div className="loop-options">
                <button
                  type="button"
                  aria-label={isVideo ? t("loop.loopEntireVideo") : t("loop.loopEntireAudio")}
                  aria-pressed={store.loop.mode === "media"}
                  onClick={() => setLoopMode("media")}
                  disabled={store.duration <= 0}
                  title={isVideo ? t("loop.entireVideoTitle") : t("loop.entireAudioTitle")}
                >
                  <span>{isVideo ? t("loop.entireVideo") : t("loop.entireAudio")}</span>
                  <small>
                    <span className="loop-current-marker" aria-hidden={store.loop.mode !== "media"}>{t("loop.current")}</span>
                    {formatTime(store.duration)}
                  </small>
                </button>
                <button
                  type="button"
                  aria-label={t("loop.loopCurrentSegment")}
                  aria-pressed={store.loop.mode === "segment"}
                  onClick={() => setLoopMode("segment")}
                  disabled={!currentSegment}
                  title={t("loop.currentSegmentTitle", { shortcut: formatShortcut(store.preferences.shortcuts.toggleLoopRange) })}
                >
                  <span>{t("loop.currentSegment")}</span>
                  <small>
                    <span className="loop-current-marker" aria-hidden={store.loop.mode !== "segment"}>{t("loop.current")}</span>
                    {currentSegment ? `${formatTime(currentSegment.replayStart)}–${formatTime(currentSegment.end)}` : t("loop.noSegments")}
                  </small>
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="secondary-controls">
          <label>{t("controls.volume")}
            <input type="range" min="0" max="1" step="0.01" value={store.preferences.volume} onChange={(event) => store.setPreferences({ volume: Number(event.target.value) })} />
          </label>
        </div>
      </section>

      {store.isAnalyzing && store.analysisStarted && (
        <AnalysisProgress
          key={store.analysisRequestId}
          fileName={store.mediaName}
          progress={store.analysisProgress}
          onCancel={cancelAnalysis}
        />
      )}

      {helpDialog}

      {settingsOpen && (
        <SettingsModal
          appVersion={appVersion}
          isDevelopmentBuild={!runningInTauri}
          language={store.preferences.language}
          speed={store.preferences.speed}
          loopGap={store.preferences.loopGap}
          shortcuts={store.preferences.shortcuts}
          cacheStats={cacheStats}
          cacheClearing={cacheClearing}
          cacheDisabled={store.isAnalyzing}
          onLanguageChange={(language) => store.setPreferences({ language })}
          onSpeedChange={(speed) => store.setPreferences({ speed })}
          onLoopGapChange={updateLoopGap}
          onShortcutChange={(action, shortcut) => store.setPreferences({ shortcuts: { ...store.preferences.shortcuts, [action]: shortcut } })}
          onResetPreferences={() => {
            store.resetPreferences();
            updateLoopGap(0);
          }}
          onClearCache={() => void clearAnalysisCache()}
          onClose={closeSettings}
        />
      )}

      {playlistOpen && (
        <>
          <div className="playlist-scrim" aria-hidden="true" onPointerDown={closePlaylist} />
          <aside className="playlist-drawer" aria-label={t("playlist.title")}>
            <div className="playlist-header">
              <div><strong>{t("playlist.title")}</strong><span>{formatFileCount(store.playlist.length || 1)}</span></div>
              <div>
                <button onClick={() => { if (store.mediaPath) void refreshPlaylist(store.mediaPath); }} title={t("playlist.refreshTitle")}>{t("playlist.refresh")}</button>
                <button onClick={closePlaylist} aria-label={t("playlist.close")}>×</button>
              </div>
            </div>
            <ol className="playlist-items">
              {(store.playlist.length ? store.playlist : [{ path: store.mediaPath, name: store.mediaName, kind: isVideo ? "video" : "audio" } as PlaylistItem]).map((item, index) => {
                const active = index === store.currentPlaylistIndex || item.path === store.mediaPath;
                return (
                  <li key={item.path}>
                    <button
                      className={active ? "playlist-item active" : "playlist-item"}
                      aria-current={active ? "true" : undefined}
                      onClick={() => {
                        setPlaylistOpen(false);
                        void openPath(item.path, isTauri() ? undefined : store.mediaUrl ?? undefined, "playlist");
                      }}
                    >
                      <span className={`media-kind ${item.kind}`} aria-hidden="true">{item.kind === "video" ? "▰" : "♪"}</span>
                      <span className="playlist-number">{String(index + 1).padStart(2, "0")}</span>
                      <span className="playlist-name" title={item.name}>{item.name}</span>
                      {active && <span className="current-indicator">{t("playlist.current")}</span>}
                    </button>
                  </li>
                );
              })}
            </ol>
          </aside>
        </>
      )}

      {errorToast}
    </main>
  );
}
