import type { PlaylistItem } from "../types";

const collator = new Intl.Collator("zh-CN", {
  numeric: true,
  sensitivity: "base",
});

export function sortPlaylist(items: PlaylistItem[]): PlaylistItem[] {
  return [...items].sort((left, right) => collator.compare(left.name, right.name));
}

export function samePath(left: string, right: string): boolean {
  if (left === right) return true;
  const windowsPath = /^(?:[a-z]:[\\/]|\\\\)/i;
  if (!windowsPath.test(left) || !windowsPath.test(right)) return false;
  return left.replaceAll("/", "\\").toLocaleLowerCase() === right.replaceAll("/", "\\").toLocaleLowerCase();
}

export function playlistIndex(items: PlaylistItem[], path: string | null): number {
  if (!path) return -1;
  return items.findIndex((item) => samePath(item.path, path));
}
