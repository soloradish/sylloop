import { beforeEach, describe, expect, it } from "vitest";
import { playlistIndex, samePath, sortPlaylist } from "./playlist";
import { usePlayerStore } from "../store";
import { OFF_LOOP } from "../types";
import type { PlaylistItem } from "../types";

const items: PlaylistItem[] = [
  { path: "C:\\course\\lesson-10.mp3", name: "lesson-10.mp3", kind: "audio" },
  { path: "C:\\course\\lesson-2.mp3", name: "lesson-2.mp3", kind: "audio" },
  { path: "C:\\course\\Lesson-1.mp4", name: "Lesson-1.mp4", kind: "video" },
];

describe("playlist helpers", () => {
  it("uses case-insensitive natural filename order", () => {
    expect(sortPlaylist(items).map((item) => item.name)).toEqual([
      "Lesson-1.mp4",
      "lesson-2.mp3",
      "lesson-10.mp3",
    ]);
  });

  it("matches Windows paths without case or separator sensitivity", () => {
    expect(samePath("C:/COURSE/Lesson-2.mp3", "c:\\course\\lesson-2.mp3")).toBe(true);
    expect(playlistIndex(items, "c:/course/LESSON-2.mp3")).toBe(1);
  });

  it("keeps POSIX paths case-sensitive", () => {
    expect(samePath("/Users/student/Lesson.mp3", "/Users/student/lesson.mp3")).toBe(false);
    expect(samePath("/Users/student/lesson.mp3", "/Users/student/lesson.mp3")).toBe(true);
  });
});

describe("playlist store", () => {
  beforeEach(() => {
    usePlayerStore.setState({
      mediaPath: null,
      mediaName: "",
      mediaUrl: null,
      playlist: [],
      currentPlaylistIndex: -1,
      waveform: null,
      segments: [],
      loop: OFF_LOOP,
    });
  });

  it("keeps the playlist and synchronizes the current index on media change", () => {
    usePlayerStore.getState().setPlaylist(items);
    usePlayerStore.getState().setMedia(items[1].path, "asset://lesson-2.mp3");
    const state = usePlayerStore.getState();
    expect(state.playlist).toHaveLength(3);
    expect(state.currentPlaylistIndex).toBe(1);
    expect(state.loop).toEqual(OFF_LOOP);
    expect(state.segments).toEqual([]);
  });
});
