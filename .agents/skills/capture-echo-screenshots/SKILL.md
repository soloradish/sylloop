---
name: capture-echo-screenshots
description: Capture and refresh native Windows screenshots of Echo Player in English and Simplified Chinese from a user-supplied real media file. Use when asked to update README images, replace outdated product screenshots, document player UI states, or inspect which stable Echo Player surfaces need new screenshots.
---

# Capture Echo Player Screenshots

Refresh screenshots from the real Tauri application through its test-only native WebDriver build. Never use browser demo mode as a substitute.

## Inspect before capturing

1. Confirm the repository is Echo Player and read its root `AGENTS.md`.
2. Check `git status --short`; preserve unrelated changes and never clean them up.
3. Read the screenshot blocks in `README.md` and `README.zh-CN.md`.
4. Inspect `src/App.tsx` and relevant files in `src/components/` for distinct, user-visible full pages, dialogs, drawers, workbenches, and important status overlays.
5. Compare those surfaces with `scripts/capture-screenshots.e2e.ts`. Add a supplemental capture only when the state is useful for documentation, deterministically reachable, and free of sensitive technical detail. Do not add fullscreen, error, or unstable transient captures by default.

## Get the media path

Require the user to provide an absolute path to a supported real media file. If the path is missing, ask for it and stop. Do not search the user's machine or choose a private file automatically.

The capture script copies the file into ignored locale-specific fixture directories under the neutral name `Echo-Lesson.<ext>`. The original remains untouched, and its path and filename do not appear in screenshots or tracked files. The waveform still reflects the supplied media content.

## Run the capture

From the repository root, first capture to an ignored preview directory:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/skills/capture-echo-screenshots/scripts/capture-echo-screenshots.ps1 -MediaPath "C:\absolute\path\lesson.mp3" -OutputDirectory "e2e-results\echo-screenshot-preview"
```

Inspect every preview image as described below. Only after all six core images pass visual review, rerun the same command without `-OutputDirectory` to replace the tracked screenshots and migrate the README links as one validated transaction.

Use `-Mode core` to generate only the three README states per locale. The default `smart` mode also captures the empty state, analysis progress when observable, selection draft, playlist, and help dialog.

Use `-OutputDirectory <path>` for a smoke test or preview. A non-default output directory never rewrites README files or removes the legacy images. Never skip the preview run before a tracked-image refresh.

The script builds the existing E2E-only Tauri binary, captures the WebView viewport without desktop or native-title-bar pixels, saves images to an ignored staging directory, verifies all six core images, and only then updates the default screenshot directory. It does not clear the user's analysis cache, stop running Echo Player processes, commit, stage, or push changes.

## Review the result

1. Read the script's capture report and skipped-state warnings.
2. Use an image-viewing tool to inspect every core image for cropping, overlays, private information, readable text, a useful waveform, and the intended language.
3. Confirm these files exist:
   - `waveform-overview.en.png` and `waveform-overview.zh-CN.png`
   - `selection-loop.en.png` and `selection-loop.zh-CN.png`
   - `player-settings.en.png` and `player-settings.zh-CN.png`
4. Confirm `README.md` references `.en.png`, `README.zh-CN.md` references `.zh-CN.png`, and the three legacy unsuffixed images are absent after a default-output capture.
5. Run `git diff --check` and inspect the complete diff. Report any skipped supplemental capture and every check not run.

Do not claim visual quality from file metadata alone. If any core image is poor, keep the previous tracked images, fix the capture state, and rerun the complete transaction.
