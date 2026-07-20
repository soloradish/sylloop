[English](README.md)

# Sylloop

Sylloop 是一款面向 Windows 和 macOS 的桌面媒体播放器，专门服务于需要快速重听和精确循环的语言学习场景。它支持本地音视频，通过 FFmpeg 生成波形和基于停顿的片段，并提供多种片段或任意区间循环方式。

## 界面截图

![Sylloop 波形与重听控制界面](docs/images/sylloop/waveform-overview.zh-CN.png)

| 专注选区循环 | 播放器设置 |
| --- | --- |
| ![Sylloop 正在重复选定的波形范围](docs/images/sylloop/selection-loop.zh-CN.png) | ![Sylloop 的语言、循环间隔、缓存和播放速度设置](docs/images/sylloop/player-settings.zh-CN.png) |

## 主要功能

- 打开或拖放 MP4、M4V、WebM、MP3、M4A、AAC、WAV、FLAC 和 OGG 文件。
- 根据所选文件所在目录中的支持格式文件建立临时播放列表。
- 使用内置 FFmpeg 分析器生成波形和基于停顿的片段。
- 带前置缓冲重听当前片段、在片段间跳转、循环当前片段或完整媒体，以及创建波形 A-B 循环。
- 自定义播放/暂停、上一或下一语音片段、重播和循环范围切换等核心快捷键。
- 调整 0.5×–2.0× 播放速度、音量、全屏模式、窗口透明度、始终置顶行为和循环间隔。
- 从顶部栏将播放器固定在 PDF 上方，或在设置中配置透明度和窗口行为。
- 在设置中将播放、窗口、语言和快捷键偏好还原为默认值。
- 通过顶部清晰的按钮打开另一个文件，并在“帮助”中报告问题、提出建议或访问项目主页。
- 使用英语、简体中文、繁体中文或法语界面。

播放列表只扫描当前目录，不递归扫描子目录。媒体播放结束后会停止，不会自动切换到下一项。应用重启后只保留音量、倍速、循环间隔、窗口透明度、始终置顶、语言和快捷键偏好。

## 环境要求

### 运行应用

- Windows 10 或 Windows 11
- Microsoft Edge WebView2 Runtime，受支持的 Windows 版本通常已经包含
- Apple Silicon 或 Intel 处理器上的 macOS 11 或更高版本

正式安装包包含锁定的 LGPL FFmpeg 可执行文件。安装包目前未进行代码签名：Windows 可能显示 SmartScreen 警告，macOS 可能在首次启动时拦截应用。在 macOS 上，请在 Finder 中按住 Control 点击 Sylloop，再选择**打开**并确认信任。请从 [GitHub Releases](https://github.com/soloradish/sylloop/releases) 获取安装包，使用发布的 `SHA256SUMS.txt` 进行校验，并在重建内置分析器时使用[精确对应的 FFmpeg 源码包](https://github.com/soloradish/ffmpeg-dist/releases/download/v8.1.2-r1/ffmpeg-8.1.2-r1-sources.tar.xz)。

### 开发应用

- Windows 或 macOS，以及 Tauri 2 所需的原生构建环境
- Node.js 24.16.0，由 `.nvmrc` 和 `package.json` 固定
- Rust 1.96.0，以及 `rustfmt` 和 `clippy`，由 `rust-toolchain.toml` 固定
- Windows 上的 PowerShell，或 macOS 上的 POSIX shell

## 项目主页与反馈

访问 [Sylloop 项目主页](https://lowid.me/zh/sylloop/) 查看产品与下载信息。问题报告和功能建议通过公开的 [GitHub Issues](https://github.com/soloradish/sylloop/issues/new/choose) 处理。提交需要 GitHub 账号；请先搜索已有 Issue，提供应用版本、操作系统版本和可复现步骤，并且不要上传私人媒体或敏感信息。

## 架构

| 层级 | 技术 | 职责 |
| --- | --- | --- |
| 桌面外壳 | Tauri 2 | 窗口生命周期、文件对话框、资源访问、打包和 IPC |
| 用户界面 | React 19 + TypeScript | 播放控制、波形交互、播放列表、设置和本地化 |
| 客户端状态 | Zustand | 播放、分析、循环、播放列表状态和持久化偏好 |
| 原生后端 | Rust | 文件校验、目录播放列表、FFmpeg 执行、取消分析和分析缓存 |
| 分析器 | FFmpeg | 将媒体解码为 16 kHz 音频，用于生成波形和检测停顿片段 |
| 测试 | Vitest + WebdriverIO | 前端行为、Rust 逻辑、Windows 原生端到端测试和 macOS 安装包冒烟测试 |

### 媒体与分析流程

1. React 应用接收选择或拖入的媒体路径，并调用 Tauri 命令 `open_media_context`。
2. Rust 对路径进行规范化和校验，只扫描父目录中的支持格式媒体，并为得到的播放列表授予资源协议访问权限。
3. WebView 播放选中的资源，同时 `analyze_audio` 在后台任务中运行 FFmpeg。
4. 分析进度通过 Tauri channel 传递；只有仍然属于当前请求的最终波形和片段才会被接受。
5. 成功的分析结果会缓存在应用数据目录中。带版本号的缓存上限为 512 MiB，并在必要时淘汰较旧的条目。

原生 IPC 接口在 `src-tauri/src/lib.rs` 中注册，目前包含：

- `open_media_context`
- `get_analysis_capability`
- `analyze_audio`
- `cancel_analysis`
- `get_analysis_cache_stats`
- `clear_analysis_cache`

Rust 响应类型使用 camelCase 序列化，与 `src/types.ts` 中的 TypeScript 类型保持一致。

## 项目结构

| 路径 | 用途 |
| --- | --- |
| `src/App.tsx` | 播放器主流程、媒体生命周期、键盘行为、循环和 IPC 调用 |
| `src/components/` | 波形、设置、进度、图标和错误边界界面 |
| `src/store.ts` | Zustand store 和持久化偏好校验 |
| `src/i18n.tsx` | 语言检测、翻译目录和本地化格式 |
| `src/lib/` | 纯播放列表和片段辅助逻辑 |
| `src-tauri/src/lib.rs` | Tauri 命令、FFmpeg 分析、缓存、文件访问和 Rust 测试 |
| `src-tauri/capabilities/` | 正式应用使用的 Tauri 权限 |
| `scripts/` | FFmpeg 准备、E2E 测试素材生成、E2E 构建和安装包冒烟测试 |
| `e2e/` | Windows 原生 WebdriverIO 配置、capability、测试素材和测试用例 |
| `.github/workflows/` | Windows/macOS CI 和标签发布工作流 |

前端单元测试与被测模块放在一起。Rust 单元测试位于 `src-tauri/src/lib.rs`，原生应用测试位于 `e2e/specs/`。

## 开始开发

安装锁定的依赖并准备指定的 FFmpeg 构建：

```powershell
npm ci
npm run ffmpeg:prepare
```

FFmpeg 准备脚本会下载 `scripts/ffmpeg-lock.json` 中记录的精确、与平台及架构匹配的 `soloradish/ffmpeg-dist` 产物，校验其 SHA-256、构建元数据、架构和 `core` 配置，并拒绝启用 GPL、nonfree、version3 或网络功能的构建。

启动原生 Tauri 开发应用：

```powershell
npm run tauri:dev
```

## 开发模式

### Tauri 原生开发

使用 `npm run tauri:dev` 测试真实文件对话框、拖放、资源权限、媒体播放和 FFmpeg 分析。这是开发 React/Rust 边界行为时的常规模式。

### 浏览器布局预览

进行快速界面开发时，运行：

```powershell
npm run dev
```

然后打开 `http://127.0.0.1:1420/?demo=1`。添加 `&playing=1` 可以渲染正在播放的演示状态。演示模式提供确定性的媒体、波形、片段和播放列表数据，但不提供原生文件访问或真实 FFmpeg 分析。

### Windows 原生 E2E

E2E 构建只通过 Rust 的 `e2e` feature 启用 WebDriver 插件。正式构建不包含测试接口。

```powershell
npm run build:e2e
npm run test:e2e:tauri
```

`build:e2e` 会在构建专用测试应用之前准备 FFmpeg 和生成的媒体测试素材。

## 命令参考

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动 Vite 开发服务器 |
| `npm run tauri:dev` | 启动原生开发应用 |
| `npm test` | 单次运行全部 Vitest 前端测试 |
| `npm run build` | 进行类型检查并构建前端 |
| `npm run version:check` | 检查所有应用版本来源是否同步 |
| `npm run version:check -- --tag vX.Y.Z` | 检查同步版本是否与发布 tag 一致 |
| `npm run version:set -- X.Y.Z` | 在所有清单和锁文件中设置稳定应用版本 |
| `npm run release:manifest -- --windows PATH --macos-aarch64 PATH --macos-x86-64 PATH --tag vX.Y.Z --source-commit SHA --published-at RFC3339 --output PATH` | 根据全部平台安装包生成经校验的网站发布清单 |
| `npm run ffmpeg:prepare` | 下载并校验锁定的 FFmpeg 产物 |
| `npm run build:e2e` | 生成测试素材并构建启用 E2E 的应用 |
| `npm run test:e2e:tauri` | 运行 Windows 原生 WebdriverIO 测试 |
| `npm run tauri:build` | 根据宿主平台构建正式 NSIS 安装包或 macOS DMG |

## 进行修改

- 保持 `src/i18n.tsx` 中四种语言的用户可见消息同步。
- 保持前端与 Rust 的媒体扩展名白名单同步。
- IPC 载荷发生变化时，同时更新 Rust 序列化类型和 TypeScript 接口。
- 为行为变更增加或更新同目录测试。无法由单元测试覆盖的跨边界行为还应增加原生 E2E 测试。
- 不要手工修改下载的 FFmpeg 资源、生成的测试素材、Tauri schema 输出或构建结果。
- 保持英文和简体中文 README 同步。

AI coding agent 使用的完整仓库规则和“改动—测试”矩阵见 [AGENTS.md](AGENTS.md)。

## 验证

在仓库根目录运行前端检查：

```powershell
npm test
npm run build
npm audit --audit-level=high
```

在 `src-tauri` 目录运行 Rust 检查：

```powershell
cargo fmt --all -- --check
cargo clippy --all-targets --locked -- -D warnings
cargo test --locked
cargo audit
```

`cargo audit` 需要 `cargo-audit`；CI 使用 `cargo install cargo-audit --locked` 安装。修改 IPC、文件访问、分析、打包或其他仅能在 Tauri 中运行的行为时，还应执行原生 E2E 命令。

## FFmpeg、缓存与应用权限

Windows、Apple Silicon 和 Intel macOS 安装包均包含由独立、非官方的 [soloradish/ffmpeg-dist](https://github.com/soloradish/ffmpeg-dist) 发行项目生成且未经修改、版本锁定的 `core` 构建。精确 release、各架构产物 URL、对应源码包、构建溯源、版本和预期校验值都记录在 `scripts/ffmpeg-lock.json` 中。准备流程会校验归档、`BUILD-INFO.json`、可执行文件架构、版本和 LGPL 兼容配置，并打包完整许可证目录。开发者可以通过 `FFMPEG_PATH` 让源码构建使用兼容的可执行文件；正式安装包使用内置文件。

分析结果使用应用数据目录中的版本化缓存。设置对话框会显示缓存用量，并允许在没有分析任务运行时清理缓存。

主 Tauri capability 只授予应用版本读取、事件监听/取消监听、主窗口置顶切换、文件对话框以及打开明确列入允许列表的支持链接所需权限。只有经过 Rust 后端规范化并接受的媒体文件才会向资源协议开放。对 capability、内容安全策略、资源范围或文件校验的改动应作为跨边界变更处理并进行相应测试。

## 发布流程

Sylloop 使用稳定的 `MAJOR.MINOR.PATCH` 版本，首个使用 Sylloop 品牌的版本为 `0.3.0`。在 `0.x` 阶段，Bug、安全、性能、翻译、依赖和安装包修复升级 `PATCH`；用户功能和破坏性行为变化升级 `MINOR`。`1.0.0` 表示进入稳定兼容阶段，之后的破坏性兼容变化升级 `MAJOR`。只有文档、测试或不影响交付物的 CI 变化时不需要发布。当前暂不接受预发布标识符。

使用仓库 skill 分析 `main` 上的变化并推荐下一个版本：

```text
$bump-sylloop-version 分析 main 并推荐 Sylloop 的下一个版本。
```

在使用类似 `$bump-sylloop-version 确认 0.3.0，基于 b509b75` 的回复确认精确版本号和分析所基于的提交前，skill 不会修改仓库。确认后，它会创建 `codex/release-vX.Y.Z` 分支、同步版本、更新 `CHANGELOG.md`、运行本地检查并创建 draft 发布 PR。它不会合并 PR、创建 tag 或发布 Release。

`src-tauri/tauri.conf.json` 是产品版本的权威来源。`npm run version:set -- X.Y.Z` 会将其与 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml` 和 `src-tauri/Cargo.lock` 同步。提交发布改动前运行 `npm run version:check`。

所有改动都通过受必需检查 `CI / gate` 保护的 PR 进入 `main`。普通 PR 会运行完整的 Windows 检查，以及 Apple Silicon 和 Intel macOS 原生构建。标准的 `codex/release-vX.Y.Z` PR 只有在 diff 恰好包含同步后的应用版本字段和 `CHANGELOG.md` 时才走轻量路径；任何其他改动都会回退到完整检查。已通过检查的 PR 合并后不会在 `main` 上重复运行 CI。

CI 会恢复可信的 FFmpeg、Cargo 下载和 E2E 依赖缓存，但绝不依赖缓存命中来保证正确性。Rust toolchain、依赖锁文件或 `scripts/ffmpeg-lock.json` 发生变化后，在 `main` 上手动运行一次 CI workflow，以刷新默认分支缓存。

发布 PR 合并后，在该 `main` 提交上创建并推送 annotated `vX.Y.Z` tag。发布工作流会拒绝版本不一致、轻量 tag、未包含在 `main` 中的 tag，以及已经存在 GitHub Release 的版本。随后它会构建未签名的 Windows NSIS 安装包，以及分别面向 Apple Silicon 和 Intel 的两个未签名 macOS DMG；每个下载后的安装包都会在对应原生架构上接受冒烟测试，随后与 SHA-256 校验和、供 lowid.me 使用的增量兼容 `sylloop-release-v1.json` 清单及 GitHub artifact attestation 一起发布。

不要移动已发布 tag 或替换已发布附件。临时故障应使用 **Re-run failed jobs**，以复用已经成功的构建 job 及其安装包 artifact；如果必须修改源码，则准备下一个 patch 版本。

## 许可证

Sylloop 使用 [MIT License](LICENSE)。FFmpeg 归属、重建信息和第三方许可详情记录在 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 和 `scripts/ffmpeg-lock.json` 中。
