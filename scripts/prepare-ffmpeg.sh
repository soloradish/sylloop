#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
lock="$root/scripts/ffmpeg-lock.json"
arch="$(uname -m)"

case "$arch" in
  arm64) target="macos-aarch64"; file_arch="arm64" ;;
  x86_64) target="macos-x86_64"; file_arch="x86_64" ;;
  *) echo "Unsupported macOS architecture: $arch" >&2; exit 1 ;;
esac

IFS=$'\t' read -r archive_name package_directory url expected_sha < <(
  node -e '
    const lock = require(process.argv[1]);
    const asset = lock.assets[process.argv[2]];
    if (!asset) throw new Error(`Missing FFmpeg asset for ${process.argv[2]}`);
    process.stdout.write(`${[asset.archiveName, asset.packageDirectory, asset.url, asset.sha256].join("\t")}\n`);
  ' "$lock" "$target"
)

cache="$root/src-tauri/.cache/ffmpeg/$target"
archive="$cache/$archive_name"
expanded="$cache/expanded"
resources="$root/src-tauri/resources"
output="$resources/ffmpeg"
build_info_output="$resources/FFMPEG_BUILD_INFO.json"
licenses_output="$resources/FFMPEG_LICENSES"
legacy_license="$resources/FFMPEG_LICENSE.txt"
mkdir -p "$cache" "$resources"

if [[ ! -f "$archive" ]]; then
  curl --fail --location --retry 3 "$url" --output "$archive"
fi
actual_sha="$(shasum -a 256 "$archive" | awk '{print $1}')"
if [[ "$actual_sha" != "$expected_sha" ]]; then
  echo "FFmpeg archive SHA-256 mismatch: expected $expected_sha, got $actual_sha" >&2
  exit 1
fi

stage_required=false
if [[ ! -x "$output" || ! -f "$build_info_output" || ! -d "$licenses_output" ]]; then
  stage_required=true
elif ! node "$root/scripts/verify-ffmpeg-resource.mjs" \
    --directory "$resources" --layout resource --target "$target" >/dev/null 2>&1; then
  echo "Restaging FFmpeg because the packaged resources do not match the lock."
  stage_required=true
fi

if [[ "$stage_required" == true ]]; then
  rm -rf "$expanded"
  mkdir -p "$expanded"
  tar -xJf "$archive" -C "$expanded"

  top_level_count="$(find "$expanded" -mindepth 1 -maxdepth 1 -print | wc -l | tr -d ' ')"
  top_level_entry="$(find "$expanded" -mindepth 1 -maxdepth 1 -print | sed -n '1p')"
  if [[ "$top_level_count" != "1" || "$(basename "$top_level_entry")" != "$package_directory" ]]; then
    echo "The pinned archive must contain only the expected '$package_directory' package directory." >&2
    exit 1
  fi

  package_root="$expanded/$package_directory"
  node "$root/scripts/verify-ffmpeg-resource.mjs" \
    --directory "$package_root" --layout package --target "$target"
  file "$package_root/bin/ffmpeg" | grep -q "$file_arch" || {
    echo "FFmpeg architecture does not match $arch" >&2
    exit 1
  }
  unexpected_libraries="$(otool -L "$package_root/bin/ffmpeg" | tail -n +2 | grep -vE '^[[:space:]]+(/usr/lib/|/System/Library/)' || true)"
  if [[ -n "$unexpected_libraries" ]]; then
    echo "FFmpeg links unexpected non-system libraries:" >&2
    echo "$unexpected_libraries" >&2
    exit 1
  fi

  cp "$package_root/bin/ffmpeg" "$output"
  cp "$package_root/BUILD-INFO.json" "$build_info_output"
  rm -rf "$licenses_output"
  cp -R "$package_root/LICENSES" "$licenses_output"
  chmod 755 "$output"
fi

is_ad_hoc_signed() {
  local executable="$1"
  local signature_details
  codesign --verify --strict "$executable" >/dev/null 2>&1 || return 1
  signature_details="$(codesign --display --verbose=4 "$executable" 2>&1)" || return 1
  grep -q '^Signature=adhoc$' <<<"$signature_details"
}

if ! is_ad_hoc_signed "$output"; then
  codesign --force --sign - "$output"
fi
codesign --verify --strict --verbose=2 "$output"

rm -f "$legacy_license"
node "$root/scripts/verify-ffmpeg-resource.mjs" \
  --directory "$resources" --layout resource --target "$target"
