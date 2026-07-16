# AGENTS.md

## Scope and purpose

These instructions apply to the entire Echo Player repository. They are the default operating rules for AI coding agents working here. Follow more specific instructions only if a future subdirectory contains its own `AGENTS.md`.

Echo Player is a Windows-only Tauri 2 desktop application for language-learning playback. Preserve the existing v0.1.0 product behavior unless a task explicitly changes it.

## Repository map

| Area | Responsibility |
| --- | --- |
| `src/App.tsx` | Main React orchestration: media lifecycle, IPC, playback, loop sessions, shortcuts, playlists, and modal state |
| `src/components/` | UI components and waveform interaction; keep interaction logic covered by colocated tests |
| `src/store.ts` | Zustand state and preference persistence boundaries |
| `src/types.ts` | TypeScript models shared across UI, store, and Rust IPC responses |
| `src/i18n.tsx` | All four locale catalogs, locale detection, and localized formatting |
| `src/lib/` | Pure segment and playlist helpers |
| `src-tauri/src/lib.rs` | Tauri commands, media validation, FFmpeg process management, analysis, cache, and Rust unit tests |
| `src-tauri/capabilities/` | Production and generated E2E Tauri permissions |
| `scripts/` | FFmpeg preparation, generated fixtures, E2E build, and installer smoke testing |
| `e2e/` | Native Windows WebdriverIO tests and capabilities |
| `.github/workflows/` | CI and release behavior; treat these files as executable release policy |

## Toolchain and setup

- Work on Windows and use PowerShell examples in repository documentation.
- Use Node.js 24.16.0 from `.nvmrc`/`package.json`.
- Use Rust 1.96.0 with `rustfmt` and `clippy` from `rust-toolchain.toml`.
- Install JavaScript dependencies with `npm ci`, not `npm install`, unless the task intentionally changes dependencies or the lockfile.
- Prepare FFmpeg with `npm run ffmpeg:prepare`. Do not substitute or upgrade the pinned artifact casually.
- Use commands defined in `package.json` instead of recreating their script logic by hand.

## Product invariants

Unless the task explicitly requests a behavior change, preserve all of the following:

- The supported media allowlist is MP4, M4V, WebM, MP3, M4A, AAC, WAV, FLAC, and OGG.
- Playlist discovery scans only the selected file's directory and never descends into subdirectories.
- Natural playlist ordering and Windows path matching remain case-insensitive.
- Reaching media end stops on the current item; it does not automatically advance.
- Only volume, speed, loop gap, and interface language persist across launches. Do not persist recent files, playlists, media URLs, waveform data, segments, or playback position.
- Opening a new file resets media-specific state and prevents stale analysis progress or completion from replacing the active result.
- Segment replay preserves analyzer-provided preroll. Segment, whole-media, and selection-loop behavior must remain distinct.
- A selection loop starts only after explicit confirmation and restores its captured playback/loop state when it ends.
- Production builds must not contain the WebDriver plugins or E2E test interface.

## Frontend rules

- Keep TypeScript strict. Do not introduce `any` to bypass a model or IPC mismatch.
- Keep pure calculations in `src/lib/` or a focused helper module instead of embedding them in render code.
- Keep global player state in the Zustand store and short-lived interaction/UI state in the owning component.
- Treat the actual media element, fullscreen events, and active Tauri request identity as sources of truth where the existing code already does so.
- Revoke browser object URLs owned by the application and cancel pending timers or analysis tasks during cleanup.
- Preserve keyboard access, focus restoration, focus trapping, accessible labels, and reduced ambiguity between icons and actions.
- Add or update a colocated Vitest test for every observable behavior change.

## Localization rules

- All user-visible application text belongs in `src/i18n.tsx`; do not hard-code new interface text in components.
- Keep all four catalogs synchronized: `zh-CN`, `zh-Hant`, `en`, and `fr`.
- Add new keys to the catalog type and every locale in the same change.
- Keep structured error codes separate from technical details. Map new user-facing error codes through the localized error-message table.
- Use the existing localized number, duration, file-count, and segment-count helpers instead of formatting these values ad hoc.

## Rust, IPC, and analysis rules

The production IPC surface is:

- `open_media_context`
- `get_analysis_capability`
- `analyze_audio`
- `cancel_analysis`
- `get_analysis_cache_stats`
- `clear_analysis_cache`

When changing this boundary:

- Update the Rust request/response type, `src/types.ts`, the frontend call site, and tests together.
- Preserve `#[serde(rename_all = "camelCase")]` on Rust payloads that cross IPC.
- Return structured `CommandError` values with stable codes. Do not expose a raw Rust error as the only user-facing result.
- Keep the Rust and TypeScript media-extension allowlists synchronized and extend both test suites when formats change.
- Preserve request IDs through channel events, cancellation, and completion. A cancelled or superseded analysis must not update current UI state.
- Keep FFmpeg off the UI thread. Retain process cancellation, bounded stderr capture, and window-destroy cleanup.
- Preserve cache fingerprint validation, schema/analysis versioning, serialized cache writes, and the 512 MiB eviction limit unless a task explicitly changes the cache contract.
- Add Rust unit tests for path validation, playlist behavior, analyzer segmentation, process/error handling helpers, or cache behavior changed in `src-tauri/src/lib.rs`.

## Permissions and packaged resources

- Treat changes to `src-tauri/capabilities/`, `src-tauri/tauri.conf.json` security settings, the asset protocol, path canonicalization, or file validation as security-sensitive cross-boundary work.
- Keep production permissions minimal. Do not broaden the capability or CSP merely to work around an implementation problem.
- Grant asset access only after the Rust backend has canonicalized and accepted a media path.
- Keep the packaged FFmpeg build pinned to `scripts/ffmpeg-lock.json`. Preserve SHA-256 verification and the rejection of GPL/nonfree configurations.
- If the FFmpeg artifact changes, update its lock metadata, license/notice material, preparation tests or checks, and release verification as one change.
- Keep the E2E WebDriver dependencies optional and gated by the Rust `e2e` feature.

## Generated and ignored files

- Do not manually edit `src-tauri/gen/schemas/`. These JSON files are tracked Tauri-generated schemas; regenerate them through the appropriate Tauri tooling when a relevant configuration change requires it, then inspect the diff.
- Do not commit downloaded FFmpeg resources from `src-tauri/resources/`.
- Do not commit generated E2E media from `e2e/fixtures/generated/`.
- Do not commit `node_modules/`, `dist/`, `src-tauri/target/`, `.cargo-target-validation/`, `.e2e-target/`, `e2e-results/`, `logs/`, or generated E2E capability output.
- Do not modify generated files to hide a failure in their source configuration or generator.

## Change workflow

1. Read the relevant implementation, colocated tests, manifests, and workflow configuration before editing.
2. Check the working tree and preserve unrelated user changes. Never discard or overwrite them as cleanup.
3. Make the smallest coherent change that satisfies the task and respects the boundaries above.
4. Update tests and documentation in the same change when behavior, commands, interfaces, or supported workflows change.
5. Run the smallest relevant checks during iteration, then the complete required set for the changed areas before handing off.
6. Report commands that were not run and why. Do not claim a check passed without running it.

## Change-to-test matrix

| Changed area | Required verification |
| --- | --- |
| Documentation only | Inspect rendered Markdown structure, relative links, command accuracy, and English/Chinese README parity |
| Pure TypeScript helpers, store, or localization | `npm test` |
| React components or player behavior | `npm test` and `npm run build` |
| Rust backend, analysis, playlist, or cache | Rust format, Clippy, and Rust tests |
| IPC types or calls | Frontend tests/build plus Rust format, Clippy, and tests |
| Tauri capabilities, asset scope, native file flow, FFmpeg integration, or E2E behavior | All frontend and Rust checks plus native Windows E2E |
| Dependency or lockfile changes | Relevant builds/tests plus `npm audit --audit-level=high` and/or `cargo audit` |
| Packaging, installer, or release workflow | Full CI-equivalent checks, production package build, and installer smoke test where available |

### Frontend checks

Run from the repository root:

```powershell
npm test
npm run build
npm audit --audit-level=high
```

### Rust checks

Run from `src-tauri`:

```powershell
cargo fmt --all -- --check
cargo clippy --all-targets --locked -- -D warnings
cargo test --locked
cargo audit
```

`cargo audit` requires `cargo-audit`; CI installs it with `cargo install cargo-audit --locked`.

### Native E2E checks

Run from the repository root:

```powershell
npm run build:e2e
npm run test:e2e:tauri
```

Do not use browser demo mode as evidence that native file access, Tauri IPC, FFmpeg, or packaging works.

## Documentation and release rules

- `README.md` is the canonical English README. `README.zh-CN.md` is its complete Simplified Chinese mirror; keep their structure and technical content synchronized.
- Keep language-switch links on the first line of both README files.
- Keep command documentation synchronized with `package.json`, `rust-toolchain.toml`, Tauri configuration, and GitHub Actions.
- Keep versions identical in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
- Update `CHANGELOG.md` for user-visible release changes.
- Do not create or push a `v*` release tag until the complete CI gate passes.
- Official packages remain unsigned unless the release policy is explicitly changed. Preserve checksum generation and build provenance attestation.
