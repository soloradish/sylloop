#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
lock="$root/scripts/ffmpeg-lock.json"
version="$(node -e 'const value=require(process.argv[1]); process.stdout.write(value.sourceUrl.match(/ffmpeg-([0-9.]+)\.tar\.xz$/)[1])' "$lock")"
url="$(node -e 'process.stdout.write(require(process.argv[1]).sourceUrl)' "$lock")"
expected_sha="$(node -e 'process.stdout.write(require(process.argv[1]).sourceSha256)' "$lock")"
arch="$(uname -m)"

case "$arch" in
  arm64) target="aarch64-apple-darwin" ;;
  x86_64) target="x86_64-apple-darwin" ;;
  *) echo "Unsupported macOS architecture: $arch" >&2; exit 1 ;;
esac

cache="$root/src-tauri/.cache/ffmpeg/$target"
archive="$cache/ffmpeg-$version.tar.xz"
source="$cache/ffmpeg-$version"
output="$root/src-tauri/resources/ffmpeg"
license="$root/src-tauri/resources/FFMPEG_LICENSE.txt"
mkdir -p "$cache" "$root/src-tauri/resources"

if [[ ! -f "$archive" ]]; then
  curl --fail --location --retry 3 "$url" --output "$archive"
fi
actual_sha="$(shasum -a 256 "$archive" | awk '{print $1}')"
if [[ "$actual_sha" != "$expected_sha" ]]; then
  echo "FFmpeg source SHA-256 mismatch: expected $expected_sha, got $actual_sha" >&2
  exit 1
fi

if [[ ! -x "$cache/ffmpeg" ]]; then
  rm -rf "$source"
  tar -xJf "$archive" -C "$cache"
  pushd "$source" >/dev/null
  ./configure \
    --disable-debug \
    --disable-doc \
    --disable-ffplay \
    --disable-ffprobe \
    --disable-devices \
    --disable-network \
    --disable-autodetect \
    --disable-gpl \
    --disable-nonfree \
    --disable-shared \
    --enable-static \
    --disable-x86asm
  make -j"$(sysctl -n hw.logicalcpu)" ffmpeg
  cp ffmpeg "$cache/ffmpeg"
  popd >/dev/null
fi

cp "$cache/ffmpeg" "$output"
cp "$source/COPYING.LGPLv2.1" "$license"
chmod 755 "$output"

version_output="$($output -version 2>&1)"
buildconf_output="$($output -buildconf 2>&1)"
[[ "$version_output" == ffmpeg\ version\ "$version"* ]] || { echo "Unexpected FFmpeg version" >&2; exit 1; }
[[ "$buildconf_output" != *"--enable-gpl"* && "$buildconf_output" != *"--enable-nonfree"* ]] || {
  echo "FFmpeg build enables GPL or nonfree components" >&2
  exit 1
}
file "$output" | grep -q "$arch" || { echo "FFmpeg architecture does not match $arch" >&2; exit 1; }
unexpected_libraries="$(otool -L "$output" | tail -n +2 | grep -vE '^[[:space:]]+(/usr/lib/|/System/Library/)' || true)"
[[ -z "$unexpected_libraries" ]] || {
  echo "FFmpeg links unexpected non-system libraries:" >&2
  echo "$unexpected_libraries" >&2
  exit 1
}
echo "Prepared FFmpeg $version for $target"
