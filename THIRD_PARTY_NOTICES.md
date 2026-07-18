# Third-party notices

Sylloop is distributed under the MIT License and includes third-party components under their own licenses.

## FFmpeg

Windows packages include an unmodified FFmpeg executable from the BtbN FFmpeg Builds project. The pinned artifact and SHA-256 checksum are recorded in `scripts/ffmpeg-lock.json`. The build is verified to be LGPL-only before packaging, and its license text is included beside the executable as `FFMPEG_LICENSE.txt`.

macOS packages include an FFmpeg executable built on the matching Apple Silicon or Intel runner from the pinned official source release. The source archive SHA-256 is locked, the build explicitly disables GPL and nonfree components, and CI verifies the resulting build configuration before packaging.

- FFmpeg source: https://ffmpeg.org/download.html
- Build source and scripts: https://github.com/BtbN/FFmpeg-Builds
- License information: https://ffmpeg.org/legal.html

Replacement is supported by setting `FFMPEG_PATH` to a compatible FFmpeg executable when running from source. Official packages use the bundled executable by default.

## JavaScript and Rust dependencies

Dependency license metadata remains available in `package-lock.json` and `src-tauri/Cargo.lock`. Release CI also runs npm and RustSec security audits.
