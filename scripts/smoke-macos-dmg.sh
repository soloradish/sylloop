#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 2 ]]; then
  echo "Usage: smoke-macos-dmg.sh DMG_PATH macos-aarch64|macos-x86_64" >&2
  exit 1
fi

dmg="$1"
target="$2"
case "$target" in
  macos-aarch64|macos-x86_64) ;;
  *) echo "Unsupported macOS target: $target" >&2; exit 1 ;;
esac

root="$(cd "$(dirname "$0")/.." && pwd)"
mount_point="$(mktemp -d "${TMPDIR:-/tmp}/sylloop-dmg.XXXXXX")"
app_pid=""

cleanup() {
  if [[ -n "$app_pid" ]] && kill -0 "$app_pid" >/dev/null 2>&1; then
    kill "$app_pid" >/dev/null 2>&1 || true
    wait "$app_pid" 2>/dev/null || true
  fi
  hdiutil detach "$mount_point" >/dev/null 2>&1 || true
  rmdir "$mount_point" >/dev/null 2>&1 || true
}
trap cleanup EXIT

assert_ad_hoc_signature() {
  local path="$1"
  local signature_details
  codesign --verify --strict --verbose=2 "$path"
  signature_details="$(codesign --display --verbose=4 "$path" 2>&1)"
  if ! grep -q '^Signature=adhoc$' <<<"$signature_details"; then
    echo "Expected an ad-hoc code signature on $path" >&2
    echo "$signature_details" >&2
    exit 1
  fi
}

test -f "$dmg"
hdiutil attach -nobrowse -readonly -mountpoint "$mount_point" "$dmg"

app="$mount_point/Sylloop.app"
executable="$app/Contents/MacOS/sylloop"
resource_dir="$app/Contents/Resources/resources"
ffmpeg="$resource_dir/ffmpeg"

test -x "$executable"
test -x "$ffmpeg"
codesign --verify --deep --strict --verbose=2 "$app"
assert_ad_hoc_signature "$app"
assert_ad_hoc_signature "$ffmpeg"
node "$root/scripts/verify-ffmpeg-resource.mjs" \
  --directory "$resource_dir" --layout resource --target "$target"

"$executable" &
app_pid=$!
sleep 5
kill -0 "$app_pid"
kill "$app_pid"
wait "$app_pid" 2>/dev/null || true
app_pid=""

echo "Verified ad-hoc signatures, bundled FFmpeg, and startup for $target."
