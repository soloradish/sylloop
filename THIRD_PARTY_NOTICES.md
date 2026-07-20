# Third-party notices

Sylloop is distributed under the MIT License and includes third-party components under their own licenses.

## FFmpeg

Windows, Apple Silicon, and Intel macOS packages include unmodified `core`-profile FFmpeg executables produced by the independent, unofficial [soloradish/ffmpeg-dist](https://github.com/soloradish/ffmpeg-dist) distribution. The pinned release, architecture-specific artifacts, build provenance, and SHA-256 checksums are recorded in `scripts/ffmpeg-lock.json`. Each build is verified as `LGPL-2.1-or-later`, with networking, GPL, nonfree, and version3 components disabled. Its complete `LICENSES/` directory and `BUILD-INFO.json` are included in the application resources.

- Distribution release: https://github.com/soloradish/ffmpeg-dist/releases/tag/v8.1.2-r1
- Exact corresponding-source bundle: https://github.com/soloradish/ffmpeg-dist/releases/download/v8.1.2-r1/ffmpeg-8.1.2-r1-sources.tar.xz
- Build source and scripts: https://github.com/soloradish/ffmpeg-dist/tree/85836456c517da1ec07d95fc30e047e53673951f
- Upstream FFmpeg source: https://ffmpeg.org/releases/ffmpeg-8.1.2.tar.xz
- License information: https://ffmpeg.org/legal.html

Replacement is supported by setting `FFMPEG_PATH` to a compatible FFmpeg executable when running from source. Official packages use the bundled executable by default.

## JavaScript and Rust dependencies

Dependency license metadata remains available in `package-lock.json` and `src-tauri/Cargo.lock`. Release CI also runs npm and RustSec security audits.
