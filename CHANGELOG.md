# Changelog

All notable changes to Sylloop are documented here.

## [Unreleased]

- Switched the bundled analyzer on Windows and macOS to pinned `core` builds from `soloradish/ffmpeg-dist`, including exact build metadata and complete FFmpeg license files.
- Added persisted whole-window opacity, always-on-top settings, and a top-bar pin for keeping Sylloop visible above documents.

## [0.4.0] - 2026-07-17

- Added official unsigned macOS 11+ DMGs for Apple Silicon and Intel, including bundled LGPL FFmpeg builds and native release smoke tests.

## [0.3.0] - 2026-07-17

- Fixed installed builds showing that the application version was unavailable.
- Added a machine-readable release manifest for the lowid.me version and direct-download routes.
- Renamed the application, installer, repository tooling, and delivery metadata from Echo Player to Sylloop with a new independent application identity.

## [0.2.0] - 2026-07-17

- Added customizable shortcuts for play/pause, speech-segment navigation, replay, and loop-range switching.
- Added a Settings action that restores playback, language, and keyboard preferences to their defaults.
- Moved the default segment and loop shortcuts to A, D, and S, and prevented player shortcuts from activating or leaving focus on buttons.
- Stabilized the playback controls so switching loop ranges no longer shifts the centered panel horizontally.
- Added a clearly labeled open-file action plus localized Help and Feedback links for bug reports, feature requests, and the Echo Player project page.
- Added structured GitHub Issue Forms and a narrowly scoped Tauri external-link permission.

## [0.1.0] - 2026-07-16

- Added synchronized application version tooling and guarded tagged-release validation.
- Added the installed application version to Settings.
- Added a repository skill that analyzes changes and prepares confirmed version-update pull requests.
- Hardened the Windows installer smoke test for quoted registry paths and packaged executable naming.
- Added local audio and video playback with same-folder playlists.
- Added waveform analysis, pause-based segments, replay, and A–B looping.
- Added English, Simplified Chinese, Traditional Chinese, and French interfaces.
- Bundled a pinned LGPL FFmpeg build for offline analysis.
- Added native Windows E2E, dependency audits, and unsigned installer smoke tests.

[Unreleased]: https://github.com/soloradish/sylloop/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/soloradish/sylloop/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/soloradish/sylloop/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/soloradish/sylloop/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/soloradish/sylloop/tree/v0.1.0
