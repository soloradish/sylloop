use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    cmp::Ordering,
    collections::HashMap,
    fs,
    io::{BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering as AtomicOrdering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{ipc::Channel, AppHandle, Manager, State};

const SAMPLE_RATE: usize = 16_000;
const FRAME_SAMPLES: usize = 320;
const FRAME_SECONDS: f64 = FRAME_SAMPLES as f64 / SAMPLE_RATE as f64;
const ANALYSIS_VERSION: u32 = 1;
const CACHE_SCHEMA_VERSION: u32 = 1;
const CACHE_LIMIT_BYTES: u64 = 512 * 1024 * 1024;
const PROGRESS_INTERVAL: Duration = Duration::from_millis(100);
const FFMPEG_STDERR_LIMIT: usize = 64 * 1024;
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    id: String,
    start: f64,
    end: f64,
    replay_start: f64,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WaveformData {
    duration: f64,
    sample_rate: usize,
    peaks_per_second: f64,
    peaks: Vec<f32>,
    segments: Vec<Segment>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisEvent {
    request_id: String,
    phase: &'static str,
    progress: Option<f64>,
    processed_seconds: f64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CacheStats {
    entry_count: usize,
    used_bytes: u64,
    limit_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    code: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    detail: Option<String>,
}

impl CommandError {
    fn new(code: &'static str) -> Self {
        Self { code, detail: None }
    }

    fn with_detail(code: &'static str, detail: impl Into<String>) -> Self {
        Self {
            code,
            detail: Some(detail.into()),
        }
    }
}

#[derive(Clone, Default)]
struct AnalysisManager {
    active: Arc<Mutex<Option<ActiveAnalysis>>>,
}

#[derive(Clone)]
struct ActiveAnalysis {
    request_id: String,
    cancelled: Arc<AtomicBool>,
    child: Arc<Mutex<Option<Child>>>,
}

impl ActiveAnalysis {
    fn new(request_id: String) -> Self {
        Self {
            request_id,
            cancelled: Arc::new(AtomicBool::new(false)),
            child: Arc::new(Mutex::new(None)),
        }
    }

    fn is_cancelled(&self) -> bool {
        self.cancelled.load(AtomicOrdering::Acquire)
    }

    fn cancel(&self) -> bool {
        let newly_cancelled = !self.cancelled.swap(true, AtomicOrdering::AcqRel);
        let mut child = self
            .child
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(child) = child.as_mut() {
            let _ = child.kill();
        }
        newly_cancelled
    }
}

impl AnalysisManager {
    fn replace(&self, next: ActiveAnalysis) {
        let previous = {
            let mut active = self
                .active
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            active.replace(next)
        };
        if let Some(previous) = previous {
            previous.cancel();
        }
    }

    fn cancel(&self, request_id: &str) -> bool {
        let active = self
            .active
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .as_ref()
            .filter(|analysis| analysis.request_id == request_id)
            .cloned();
        active.is_some_and(|analysis| analysis.cancel())
    }

    fn cancel_current(&self) -> bool {
        let active = self
            .active
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .as_ref()
            .cloned();
        active.is_some_and(|analysis| analysis.cancel())
    }

    fn finish(&self, request_id: &str) {
        let mut active = self
            .active
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if active
            .as_ref()
            .is_some_and(|analysis| analysis.request_id == request_id)
        {
            active.take();
        }
    }

    fn is_active(&self) -> bool {
        self.active
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .is_some()
    }
}

#[derive(Clone, Default)]
struct CacheManager {
    io_lock: Arc<Mutex<()>>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct FileFingerprint {
    size: u64,
    modified_nanos: u64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CachedAnalysis {
    schema_version: u32,
    analysis_version: u32,
    fingerprint: FileFingerprint,
    waveform: WaveformData,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CacheIndex {
    entries: HashMap<String, CacheIndexEntry>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CacheIndexEntry {
    bytes: u64,
    last_accessed_millis: u64,
}

#[derive(Debug)]
struct FileIdentity {
    path: PathBuf,
    cache_key: String,
    fingerprint: FileFingerprint,
}

const MEDIA_EXTENSIONS: &[&str] = &[
    "mp4", "m4v", "webm", "mp3", "m4a", "aac", "wav", "flac", "ogg",
];
const VIDEO_EXTENSIONS: &[&str] = &["mp4", "m4v", "webm"];

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistItem {
    path: String,
    name: String,
    kind: &'static str,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MediaContext {
    selected: PlaylistItem,
    playlist: Vec<PlaylistItem>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisCapability {
    available: bool,
    source: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    version: Option<String>,
}

#[derive(Debug, Clone)]
struct FfmpegLocation {
    executable: PathBuf,
    source: &'static str,
}

struct AnalysisJob {
    path: String,
    duration_seconds: Option<f64>,
    request_id: String,
    on_event: Channel<AnalysisEvent>,
    active: ActiveAnalysis,
    ffmpeg: PathBuf,
    cache_root: Option<PathBuf>,
    cache: CacheManager,
}

#[tauri::command]
async fn analyze_audio(
    app: AppHandle,
    manager: State<'_, AnalysisManager>,
    cache: State<'_, CacheManager>,
    path: String,
    duration_seconds: Option<f64>,
    request_id: String,
    on_event: Channel<AnalysisEvent>,
) -> Result<WaveformData, CommandError> {
    let ffmpeg = locate_ffmpeg(&app).ok_or_else(|| CommandError::new("ffmpeg_unavailable"))?;
    let active = ActiveAnalysis::new(request_id.clone());
    let manager = manager.inner().clone();
    let cache = cache.inner().clone();
    let cache_root = app
        .path()
        .app_data_dir()
        .ok()
        .map(|directory| directory.join("analysis-cache").join("v1"));
    manager.replace(active.clone());

    let job = AnalysisJob {
        path,
        duration_seconds,
        request_id: request_id.clone(),
        on_event,
        active,
        ffmpeg: ffmpeg.executable,
        cache_root,
        cache,
    };
    let worker = tauri::async_runtime::spawn_blocking(move || analyze_with_cache(&job)).await;
    manager.finish(&request_id);
    worker.map_err(|error| CommandError::with_detail("analysis_task_failed", error.to_string()))?
}

#[tauri::command]
fn cancel_analysis(manager: State<'_, AnalysisManager>, request_id: String) -> bool {
    manager.cancel(&request_id)
}

#[tauri::command]
fn get_analysis_cache_stats(
    app: AppHandle,
    cache: State<'_, CacheManager>,
) -> Result<CacheStats, CommandError> {
    let root = analysis_cache_root(&app)?;
    let _guard = cache
        .io_lock
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    cache_stats_impl(&root).map_err(|error| CommandError::with_detail("cache_unavailable", error))
}

#[tauri::command]
fn clear_analysis_cache(
    app: AppHandle,
    manager: State<'_, AnalysisManager>,
    cache: State<'_, CacheManager>,
) -> Result<CacheStats, CommandError> {
    if manager.is_active() {
        return Err(CommandError::new("analysis_busy"));
    }
    let root = analysis_cache_root(&app)?;
    let _guard = cache
        .io_lock
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    clear_cache_impl(&root).map_err(|error| CommandError::with_detail("cache_unavailable", error))
}

#[tauri::command]
fn open_media_context(app: AppHandle, path: String) -> Result<MediaContext, CommandError> {
    let context = media_context_impl(Path::new(&path))?;
    let scope = app.asset_protocol_scope();
    for item in &context.playlist {
        scope
            .allow_file(&item.path)
            .map_err(|error| CommandError::with_detail("media_scope_failed", error.to_string()))?;
    }
    Ok(context)
}

fn media_context_impl(path: &Path) -> Result<MediaContext, CommandError> {
    let selected_path = fs::canonicalize(path).map_err(|_| CommandError::new("file_not_found"))?;
    let selected =
        playlist_item(&selected_path).ok_or_else(|| CommandError::new("unsupported_format"))?;
    let playlist = list_directory_media_impl(&selected_path);
    Ok(MediaContext { selected, playlist })
}

fn list_directory_media_impl(selected: &Path) -> Vec<PlaylistItem> {
    let fallback = playlist_item(selected).into_iter().collect::<Vec<_>>();
    let Some(parent) = selected.parent() else {
        return fallback;
    };
    let Ok(entries) = fs::read_dir(parent) else {
        return fallback;
    };

    let items = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let file_type = entry.file_type().ok()?;
            if !file_type.is_file() {
                return None;
            }
            playlist_item(&entry.path())
        })
        .collect::<Vec<_>>();

    if items.is_empty() {
        fallback
    } else {
        items
    }
}

fn playlist_item(path: &Path) -> Option<PlaylistItem> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    if !MEDIA_EXTENSIONS.contains(&extension.as_str()) {
        return None;
    }
    Some(PlaylistItem {
        path: path.to_string_lossy().into_owned(),
        name: path.file_name()?.to_string_lossy().into_owned(),
        kind: if VIDEO_EXTENSIONS.contains(&extension.as_str()) {
            "video"
        } else {
            "audio"
        },
    })
}

fn analyze_with_cache(job: &AnalysisJob) -> Result<WaveformData, CommandError> {
    let identity = file_identity(Path::new(&job.path))?;
    if job.active.is_cancelled() {
        return Err(CommandError::new("analysis_cancelled"));
    }

    if let Some(root) = job.cache_root.as_deref() {
        let _guard = job
            .cache
            .io_lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Ok(Some(waveform)) = load_cached_analysis(root, &identity) {
            return Ok(waveform);
        }
    }

    if job.active.is_cancelled() {
        return Err(CommandError::new("analysis_cancelled"));
    }

    let duration_seconds = job
        .duration_seconds
        .filter(|duration| duration.is_finite() && *duration > 0.0);
    let _ = job.on_event.send(AnalysisEvent {
        request_id: job.request_id.clone(),
        phase: "started",
        progress: duration_seconds.map(|_| 0.0),
        processed_seconds: 0.0,
    });

    let waveform = analyze_file(
        &identity.path,
        duration_seconds,
        &job.request_id,
        &job.on_event,
        &job.active,
        &job.ffmpeg,
    )?;

    if job.active.is_cancelled() {
        return Err(CommandError::new("analysis_cancelled"));
    }
    if let Some(root) = job.cache_root.as_deref() {
        let _guard = job
            .cache
            .io_lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let _ = save_cached_analysis(root, &identity, &waveform);
    }
    Ok(waveform)
}

fn analyze_file(
    path: &Path,
    duration_seconds: Option<f64>,
    request_id: &str,
    on_event: &Channel<AnalysisEvent>,
    active: &ActiveAnalysis,
    ffmpeg: &Path,
) -> Result<WaveformData, CommandError> {
    if !path.is_file() {
        return Err(CommandError::new("file_not_found"));
    }
    if active.is_cancelled() {
        return Err(CommandError::new("analysis_cancelled"));
    }

    let mut command = Command::new(ffmpeg);
    command
        .args(["-v", "error", "-i"])
        .arg(path)
        .args([
            "-map",
            "0:a:0",
            "-vn",
            "-ac",
            "1",
            "-ar",
            &SAMPLE_RATE.to_string(),
            "-f",
            "s16le",
            "pipe:1",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_ffmpeg_command(&mut command);

    let mut child = command
        .spawn()
        .map_err(|error| CommandError::with_detail("ffmpeg_unavailable", error.to_string()))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| CommandError::new("ffmpeg_output_unavailable"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| CommandError::new("ffmpeg_output_unavailable"))?;
    let stderr_thread = thread::spawn(move || read_bounded(stderr, FFMPEG_STDERR_LIMIT));

    {
        let mut child_slot = active
            .child
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *child_slot = Some(child);
    }
    if active.is_cancelled() {
        active.cancel();
    }

    let read_result = read_pcm_frames(
        BufReader::new(stdout),
        duration_seconds,
        request_id,
        on_event,
        &active.cancelled,
    );

    let status = {
        let mut child_slot = active
            .child
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some(mut child) = child_slot.take() else {
            return Err(if active.is_cancelled() {
                CommandError::new("analysis_cancelled")
            } else {
                CommandError::new("ffmpeg_execution_failed")
            });
        };
        if active.is_cancelled() || read_result.is_err() {
            let _ = child.kill();
        }
        child.wait().map_err(|error| {
            CommandError::with_detail("ffmpeg_execution_failed", error.to_string())
        })?
    };
    let stderr = stderr_thread.join().unwrap_or_default();

    if active.is_cancelled() {
        return Err(CommandError::new("analysis_cancelled"));
    }
    let (peaks, levels) = read_result?;
    if !status.success() {
        let message = String::from_utf8_lossy(&stderr);
        return Err(CommandError::with_detail(
            "no_analyzable_audio",
            message.trim(),
        ));
    }

    let waveform = build_analysis(peaks, levels);
    let _ = on_event.send(AnalysisEvent {
        request_id: request_id.to_owned(),
        phase: "progress",
        progress: Some(1.0),
        processed_seconds: waveform.duration,
    });
    Ok(waveform)
}

fn read_bounded<R: Read>(mut reader: R, limit: usize) -> Vec<u8> {
    let mut kept = Vec::with_capacity(limit.min(4096));
    let mut buffer = [0_u8; 4096];
    while let Ok(count) = reader.read(&mut buffer) {
        if count == 0 {
            break;
        }
        let remaining = limit.saturating_sub(kept.len());
        kept.extend_from_slice(&buffer[..count.min(remaining)]);
    }
    kept
}

fn bundled_ffmpeg_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .resource_dir()
        .ok()
        .map(|root| root.join("resources").join("ffmpeg.exe"))
        .filter(|path| path.is_file())
}

fn locate_ffmpeg(app: &AppHandle) -> Option<FfmpegLocation> {
    if let Some(executable) = bundled_ffmpeg_path(app) {
        return Some(FfmpegLocation {
            executable,
            source: "bundled",
        });
    }
    if let Some(executable) = std::env::var_os("FFMPEG_PATH").map(PathBuf::from) {
        if executable.is_file() {
            return Some(FfmpegLocation {
                executable,
                source: "environment",
            });
        }
    }
    let executable = PathBuf::from("ffmpeg");
    ffmpeg_version(&executable).map(|_| FfmpegLocation {
        executable,
        source: "path",
    })
}

fn ffmpeg_version(executable: &Path) -> Option<String> {
    let mut command = Command::new(executable);
    command.arg("-version").stdin(Stdio::null());
    configure_ffmpeg_command(&mut command);
    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let first_line = String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()?
        .to_owned();
    first_line
        .strip_prefix("ffmpeg version ")
        .and_then(|value| value.split_whitespace().next())
        .map(str::to_owned)
}

#[tauri::command]
fn get_analysis_capability(app: AppHandle) -> AnalysisCapability {
    match locate_ffmpeg(&app) {
        Some(location) => AnalysisCapability {
            available: true,
            source: location.source,
            version: ffmpeg_version(&location.executable),
        },
        None => AnalysisCapability {
            available: false,
            source: "unavailable",
            version: None,
        },
    }
}

#[cfg(windows)]
fn configure_ffmpeg_command(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn configure_ffmpeg_command(_command: &mut Command) {}

fn read_pcm_frames<R: Read>(
    mut reader: R,
    duration_seconds: Option<f64>,
    request_id: &str,
    on_event: &Channel<AnalysisEvent>,
    cancelled: &AtomicBool,
) -> Result<(Vec<f32>, Vec<f32>), CommandError> {
    let mut bytes = [0_u8; 64 * 1024];
    let mut carry: Option<u8> = None;
    let mut frame = Vec::with_capacity(FRAME_SAMPLES);
    let mut peaks = Vec::new();
    let mut levels = Vec::new();
    let mut processed_bytes = 0_u64;
    let mut last_progress_at = Instant::now();

    loop {
        if cancelled.load(AtomicOrdering::Acquire) {
            return Err(CommandError::new("analysis_cancelled"));
        }
        let count = reader
            .read(&mut bytes)
            .map_err(|error| CommandError::with_detail("audio_read_failed", error.to_string()))?;
        if count == 0 {
            break;
        }
        processed_bytes = processed_bytes.saturating_add(count as u64);
        let mut index = 0;
        if let Some(low) = carry.take() {
            frame.push(i16::from_le_bytes([low, bytes[0]]));
            index = 1;
            if frame.len() == FRAME_SAMPLES {
                push_frame(&frame, &mut peaks, &mut levels);
                frame.clear();
            }
        }
        while index + 1 < count {
            frame.push(i16::from_le_bytes([bytes[index], bytes[index + 1]]));
            index += 2;
            if frame.len() == FRAME_SAMPLES {
                push_frame(&frame, &mut peaks, &mut levels);
                frame.clear();
            }
        }
        if index < count {
            carry = Some(bytes[index]);
        }

        let now = Instant::now();
        if should_emit_progress(last_progress_at, now) {
            let processed_seconds = processed_seconds_for_bytes(processed_bytes);
            let progress = progress_for_duration(processed_seconds, duration_seconds);
            let _ = on_event.send(AnalysisEvent {
                request_id: request_id.to_owned(),
                phase: "progress",
                progress,
                processed_seconds,
            });
            last_progress_at = now;
        }
    }
    if !frame.is_empty() {
        push_frame(&frame, &mut peaks, &mut levels);
    }
    Ok((peaks, levels))
}

fn processed_seconds_for_bytes(processed_bytes: u64) -> f64 {
    processed_bytes as f64 / 2.0 / SAMPLE_RATE as f64
}

fn progress_for_duration(processed_seconds: f64, duration_seconds: Option<f64>) -> Option<f64> {
    duration_seconds.map(|duration| (processed_seconds / duration).clamp(0.0, 0.99))
}

fn should_emit_progress(last_emit: Instant, now: Instant) -> bool {
    now.saturating_duration_since(last_emit) >= PROGRESS_INTERVAL
}

fn analysis_cache_root(app: &AppHandle) -> Result<PathBuf, CommandError> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join("analysis-cache").join("v1"))
        .map_err(|error| CommandError::with_detail("cache_unavailable", error.to_string()))
}

fn file_identity(path: &Path) -> Result<FileIdentity, CommandError> {
    let path = fs::canonicalize(path).map_err(|_| CommandError::new("file_not_found"))?;
    let metadata = fs::metadata(&path).map_err(|_| CommandError::new("file_not_found"))?;
    if !metadata.is_file() {
        return Err(CommandError::new("file_not_found"));
    }
    let modified_nanos = metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_nanos().min(u64::MAX as u128) as u64)
        .unwrap_or_default();
    let mut normalized = path.to_string_lossy().into_owned();
    #[cfg(windows)]
    {
        normalized = normalized.to_lowercase();
    }
    let cache_key = format!("{:x}", Sha256::digest(normalized.as_bytes()));
    Ok(FileIdentity {
        path,
        cache_key,
        fingerprint: FileFingerprint {
            size: metadata.len(),
            modified_nanos,
        },
    })
}

fn cache_entry_path(root: &Path, cache_key: &str) -> PathBuf {
    root.join(format!("{cache_key}.analysis.json"))
}

fn cache_index_path(root: &Path) -> PathBuf {
    root.join("index.json")
}

fn load_cached_analysis(
    root: &Path,
    identity: &FileIdentity,
) -> Result<Option<WaveformData>, String> {
    let path = cache_entry_path(root, &identity.cache_key);
    if !path.is_file() {
        return Ok(None);
    }

    let cached = fs::File::open(&path)
        .map_err(|error| error.to_string())
        .and_then(|file| {
            serde_json::from_reader::<_, CachedAnalysis>(file).map_err(|error| error.to_string())
        });
    let cached = match cached {
        Ok(cached) => cached,
        Err(_) => {
            let _ = fs::remove_file(&path);
            remove_cache_index_entry(root, &identity.cache_key);
            return Ok(None);
        }
    };

    if cached.schema_version != CACHE_SCHEMA_VERSION
        || cached.analysis_version != ANALYSIS_VERSION
        || cached.fingerprint != identity.fingerprint
    {
        let _ = fs::remove_file(&path);
        remove_cache_index_entry(root, &identity.cache_key);
        return Ok(None);
    }

    fs::create_dir_all(root).map_err(|error| error.to_string())?;
    let mut index = load_cache_index(root);
    let bytes = fs::metadata(&path)
        .map(|metadata| metadata.len())
        .unwrap_or_default();
    index.entries.insert(
        identity.cache_key.clone(),
        CacheIndexEntry {
            bytes,
            last_accessed_millis: now_millis(),
        },
    );
    merge_cache_files(root, &mut index);
    enforce_cache_limit(root, &mut index, CACHE_LIMIT_BYTES);
    let _ = save_cache_index(root, &index);
    Ok(Some(cached.waveform))
}

fn save_cached_analysis(
    root: &Path,
    identity: &FileIdentity,
    waveform: &WaveformData,
) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|error| error.to_string())?;
    let cached = CachedAnalysis {
        schema_version: CACHE_SCHEMA_VERSION,
        analysis_version: ANALYSIS_VERSION,
        fingerprint: identity.fingerprint.clone(),
        waveform: waveform.clone(),
    };
    let bytes = serde_json::to_vec(&cached).map_err(|error| error.to_string())?;
    atomic_write(&cache_entry_path(root, &identity.cache_key), &bytes)?;

    let mut index = load_cache_index(root);
    index.entries.insert(
        identity.cache_key.clone(),
        CacheIndexEntry {
            bytes: bytes.len() as u64,
            last_accessed_millis: now_millis(),
        },
    );
    merge_cache_files(root, &mut index);
    enforce_cache_limit(root, &mut index, CACHE_LIMIT_BYTES);
    save_cache_index(root, &index)
}

fn cache_stats_impl(root: &Path) -> Result<CacheStats, String> {
    fs::create_dir_all(root).map_err(|error| error.to_string())?;
    let mut index = load_cache_index(root);
    merge_cache_files(root, &mut index);
    enforce_cache_limit(root, &mut index, CACHE_LIMIT_BYTES);
    save_cache_index(root, &index)?;
    Ok(stats_from_index(&index))
}

fn clear_cache_impl(root: &Path) -> Result<CacheStats, String> {
    if root.exists() {
        fs::remove_dir_all(root).map_err(|error| error.to_string())?;
    }
    fs::create_dir_all(root).map_err(|error| error.to_string())?;
    let index = CacheIndex::default();
    save_cache_index(root, &index)?;
    Ok(stats_from_index(&index))
}

fn stats_from_index(index: &CacheIndex) -> CacheStats {
    CacheStats {
        entry_count: index.entries.len(),
        used_bytes: index.entries.values().map(|entry| entry.bytes).sum(),
        limit_bytes: CACHE_LIMIT_BYTES,
    }
}

fn load_cache_index(root: &Path) -> CacheIndex {
    fs::File::open(cache_index_path(root))
        .ok()
        .and_then(|file| serde_json::from_reader(file).ok())
        .unwrap_or_default()
}

fn save_cache_index(root: &Path, index: &CacheIndex) -> Result<(), String> {
    let bytes = serde_json::to_vec(index).map_err(|error| error.to_string())?;
    atomic_write(&cache_index_path(root), &bytes)
}

fn remove_cache_index_entry(root: &Path, cache_key: &str) {
    let mut index = load_cache_index(root);
    if index.entries.remove(cache_key).is_some() {
        let _ = save_cache_index(root, &index);
    }
}

fn merge_cache_files(root: &Path, index: &mut CacheIndex) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    let mut present = HashMap::new();
    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        let Some(cache_key) = name.strip_suffix(".analysis.json") else {
            continue;
        };
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        let fallback_accessed = metadata
            .modified()
            .ok()
            .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64)
            .unwrap_or_default();
        let existing_accessed = index
            .entries
            .get(cache_key)
            .map(|cached| cached.last_accessed_millis)
            .unwrap_or(fallback_accessed);
        present.insert(
            cache_key.to_owned(),
            CacheIndexEntry {
                bytes: metadata.len(),
                last_accessed_millis: existing_accessed,
            },
        );
    }
    index.entries = present;
}

fn enforce_cache_limit(root: &Path, index: &mut CacheIndex, limit_bytes: u64) {
    let mut used: u64 = index.entries.values().map(|entry| entry.bytes).sum();
    if used <= limit_bytes {
        return;
    }
    let mut oldest = index
        .entries
        .iter()
        .map(|(key, entry)| (key.clone(), entry.last_accessed_millis, entry.bytes))
        .collect::<Vec<_>>();
    oldest.sort_by_key(|(_, accessed, _)| *accessed);
    for (cache_key, _, bytes) in oldest {
        if used <= limit_bytes {
            break;
        }
        let _ = fs::remove_file(cache_entry_path(root, &cache_key));
        index.entries.remove(&cache_key);
        used = used.saturating_sub(bytes);
    }
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "cache path has no parent".to_owned())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("cache");
    let temporary = parent.join(format!(".{file_name}.{}.tmp", std::process::id()));
    let result = (|| {
        let mut file = fs::File::create(&temporary).map_err(|error| error.to_string())?;
        file.write_all(bytes).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        if path.exists() {
            fs::remove_file(path).map_err(|error| error.to_string())?;
        }
        fs::rename(&temporary, path).map_err(|error| error.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64)
        .unwrap_or_default()
}

fn push_frame(frame: &[i16], peaks: &mut Vec<f32>, levels: &mut Vec<f32>) {
    let mut peak = 0.0_f32;
    let mut energy = 0.0_f64;
    for sample in frame {
        let normalized = *sample as f32 / i16::MAX as f32;
        peak = peak.max(normalized.abs());
        energy += f64::from(normalized) * f64::from(normalized);
    }
    let rms = (energy / frame.len().max(1) as f64).sqrt();
    peaks.push(peak);
    levels.push((20.0 * rms.max(0.000_01).log10()) as f32);
}

fn build_analysis(peaks: Vec<f32>, levels: Vec<f32>) -> WaveformData {
    let duration = peaks.len() as f64 * FRAME_SECONDS;
    let segments = detect_segments(&levels, duration);
    WaveformData {
        duration,
        sample_rate: SAMPLE_RATE,
        peaks_per_second: 1.0 / FRAME_SECONDS,
        peaks,
        segments,
    }
}

fn percentile(values: &[f32], fraction: f32) -> f32 {
    if values.is_empty() {
        return -60.0;
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(Ordering::Equal));
    let index = ((sorted.len() - 1) as f32 * fraction).round() as usize;
    sorted[index]
}

fn detect_segments(levels: &[f32], duration: f64) -> Vec<Segment> {
    if levels.is_empty() {
        return Vec::new();
    }
    let noise = percentile(levels, 0.2);
    let speech = percentile(levels, 0.8);
    let threshold = (noise + (speech - noise) * 0.35).clamp(-50.0, -28.0);
    let min_silence_frames = (0.32 / FRAME_SECONDS).ceil() as usize;
    let mut silence_ranges = Vec::new();
    let mut start = None;

    for (index, level) in levels.iter().enumerate() {
        if *level <= threshold {
            start.get_or_insert(index);
        } else if let Some(silence_start) = start.take() {
            if index - silence_start >= min_silence_frames {
                silence_ranges.push((silence_start, index));
            }
        }
    }
    if let Some(silence_start) = start {
        if levels.len() - silence_start >= min_silence_frames {
            silence_ranges.push((silence_start, levels.len()));
        }
    }

    let mut raw = Vec::new();
    let mut speech_start = 0.0;
    for (silence_start, silence_end) in silence_ranges {
        let end = silence_start as f64 * FRAME_SECONDS;
        if end - speech_start >= 0.25 {
            raw.push((speech_start, end));
        }
        speech_start = silence_end as f64 * FRAME_SECONDS;
    }
    if duration - speech_start >= 0.25 {
        raw.push((speech_start, duration));
    }

    let mut split = Vec::new();
    for range in raw {
        split_long_range(range, levels, &mut split);
    }
    split
        .into_iter()
        .enumerate()
        .map(|(index, (start, end))| Segment {
            id: format!("silence-{index}"),
            start,
            end,
            replay_start: (start - 0.15).max(0.0),
        })
        .collect()
}

fn split_long_range(range: (f64, f64), levels: &[f32], output: &mut Vec<(f64, f64)>) {
    let (mut start, end) = range;
    while end - start > 12.0 {
        let target = start + 7.0;
        let search_start = ((target - 1.5) / FRAME_SECONDS).max(0.0) as usize;
        let search_end = (((target + 1.5) / FRAME_SECONDS) as usize).min(levels.len());
        let split_index = (search_start..search_end)
            .min_by(|a, b| {
                levels[*a]
                    .partial_cmp(&levels[*b])
                    .unwrap_or(Ordering::Equal)
            })
            .unwrap_or((target / FRAME_SECONDS) as usize);
        let split = split_index as f64 * FRAME_SECONDS;
        output.push((start, split));
        start = split;
    }
    if end - start >= 0.25 {
        output.push((start, end));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .manage(AnalysisManager::default())
        .manage(CacheManager::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init());
    #[cfg(feature = "e2e")]
    let builder = builder
        .plugin(tauri_plugin_wdio::init())
        .plugin(tauri_plugin_wdio_webdriver::init());
    builder
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                window.state::<AnalysisManager>().cancel_current();
            }
        })
        .invoke_handler(tauri::generate_handler![
            analyze_audio,
            cancel_analysis,
            get_analysis_cache_stats,
            clear_analysis_cache,
            open_media_context,
            get_analysis_capability
        ])
        .run(tauri::generate_context!())
        .expect("error while running Sylloop");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{create_dir, File};

    fn sample_waveform() -> WaveformData {
        WaveformData {
            duration: 0.04,
            sample_rate: SAMPLE_RATE,
            peaks_per_second: 1.0 / FRAME_SECONDS,
            peaks: vec![0.25, 0.5],
            segments: vec![Segment {
                id: "sample".into(),
                start: 0.0,
                end: 0.04,
                replay_start: 0.0,
            }],
        }
    }

    #[test]
    fn silence_creates_two_segments_with_preroll() {
        let mut levels = vec![-12.0; 100];
        levels.extend(vec![-80.0; 25]);
        levels.extend(vec![-10.0; 100]);
        let segments = detect_segments(&levels, levels.len() as f64 * FRAME_SECONDS);
        assert_eq!(segments.len(), 2);
        assert!(segments[0].end <= 2.01);
        assert!(segments[1].replay_start < segments[1].start);
    }

    #[test]
    fn long_speech_is_split_into_learnable_chunks() {
        let levels = vec![-12.0; 1000];
        let segments = detect_segments(&levels, levels.len() as f64 * FRAME_SECONDS);
        assert!(segments.len() >= 2);
        assert!(segments
            .iter()
            .all(|segment| segment.end - segment.start <= 12.0));
    }

    #[test]
    fn directory_playlist_filters_files_and_ignores_subdirectories() {
        let directory = tempfile::tempdir().unwrap();
        let selected = directory.path().join("lesson-2.mp3");
        File::create(&selected).unwrap();
        File::create(directory.path().join("lesson-10.MP4")).unwrap();
        File::create(directory.path().join("notes.txt")).unwrap();
        let nested = directory.path().join("nested");
        create_dir(&nested).unwrap();
        File::create(nested.join("hidden.mp3")).unwrap();

        let items = list_directory_media_impl(&selected);
        assert_eq!(items.len(), 2);
        assert!(items
            .iter()
            .any(|item| item.name == "lesson-2.mp3" && item.kind == "audio"));
        assert!(items
            .iter()
            .any(|item| item.name == "lesson-10.MP4" && item.kind == "video"));
    }

    #[test]
    fn media_context_canonicalizes_supported_files_and_rejects_other_inputs() {
        let directory = tempfile::tempdir().unwrap();
        let selected = directory.path().join("lesson.wav");
        File::create(&selected).unwrap();
        File::create(directory.path().join("notes.txt")).unwrap();

        let context = media_context_impl(&selected).unwrap();
        assert_eq!(
            Path::new(&context.selected.path),
            fs::canonicalize(&selected).unwrap()
        );
        assert_eq!(context.playlist.len(), 1);
        assert_eq!(context.playlist[0].name, "lesson.wav");

        let unsupported = media_context_impl(&directory.path().join("notes.txt")).unwrap_err();
        assert_eq!(unsupported.code, "unsupported_format");
        let missing = media_context_impl(&directory.path().join("missing.mp3")).unwrap_err();
        assert_eq!(missing.code, "file_not_found");
    }

    #[test]
    fn unreadable_directory_falls_back_to_selected_file() {
        let selected = Path::new("Z:\\definitely-missing\\lesson.mp3");
        let items = list_directory_media_impl(selected);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].name, "lesson.mp3");
    }

    #[test]
    fn analysis_errors_use_stable_serializable_codes() {
        let error = file_identity(Path::new("Z:\\definitely-missing\\lesson.mp3")).unwrap_err();
        assert_eq!(error.code, "file_not_found");
        assert_eq!(error.detail, None);
        assert_eq!(
            serde_json::to_value(error).unwrap(),
            serde_json::json!({ "code": "file_not_found" })
        );
    }

    #[test]
    fn progress_is_monotonic_capped_and_throttled() {
        assert_eq!(processed_seconds_for_bytes((SAMPLE_RATE * 2) as u64), 1.0);
        assert_eq!(progress_for_duration(1.0, Some(4.0)), Some(0.25));
        assert_eq!(progress_for_duration(5.0, Some(4.0)), Some(0.99));
        assert_eq!(progress_for_duration(1.0, None), None);

        let start = Instant::now();
        assert!(!should_emit_progress(
            start,
            start + Duration::from_millis(99)
        ));
        assert!(should_emit_progress(
            start,
            start + Duration::from_millis(100)
        ));
    }

    #[test]
    fn replacing_and_explicitly_cancelling_analysis_updates_only_the_active_request() {
        let manager = AnalysisManager::default();
        let first = ActiveAnalysis::new("first".into());
        let second = ActiveAnalysis::new("second".into());
        manager.replace(first.clone());
        assert!(manager.is_active());
        manager.replace(second.clone());

        assert!(first.is_cancelled());
        assert!(!second.is_cancelled());
        assert!(!manager.cancel("first"));
        assert!(manager.cancel("second"));
        assert!(second.is_cancelled());
        manager.finish("second");
        assert!(!manager.is_active());
        assert!(!manager.cancel_current());
    }

    #[test]
    fn bounded_reader_drains_input_but_keeps_only_the_limit() {
        let input = vec![b'x'; FFMPEG_STDERR_LIMIT + 4096];
        let output = read_bounded(input.as_slice(), FFMPEG_STDERR_LIMIT);
        assert_eq!(output.len(), FFMPEG_STDERR_LIMIT);
        assert!(output.iter().all(|byte| *byte == b'x'));
    }

    #[test]
    fn cache_round_trip_and_file_changes_invalidate_results() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("cache");
        let media = directory.path().join("lesson.mp3");
        std::fs::write(&media, b"first").unwrap();
        let first_identity = file_identity(&media).unwrap();
        assert_eq!(load_cached_analysis(&root, &first_identity).unwrap(), None);

        let waveform = sample_waveform();
        save_cached_analysis(&root, &first_identity, &waveform).unwrap();
        assert_eq!(
            load_cached_analysis(&root, &first_identity).unwrap(),
            Some(waveform)
        );

        std::fs::write(&media, b"a different file size").unwrap();
        let changed_identity = file_identity(&media).unwrap();
        assert_eq!(
            load_cached_analysis(&root, &changed_identity).unwrap(),
            None
        );
        assert!(!cache_entry_path(&root, &changed_identity.cache_key).exists());
    }

    #[test]
    fn corrupt_cache_is_discarded_and_clear_resets_stats() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("cache");
        let media = directory.path().join("lesson.mp3");
        std::fs::write(&media, b"media").unwrap();
        let identity = file_identity(&media).unwrap();
        std::fs::create_dir_all(&root).unwrap();
        let entry_path = cache_entry_path(&root, &identity.cache_key);
        std::fs::write(&entry_path, b"not json").unwrap();

        assert_eq!(load_cached_analysis(&root, &identity).unwrap(), None);
        assert!(!entry_path.exists());
        save_cached_analysis(&root, &identity, &sample_waveform()).unwrap();
        assert_eq!(cache_stats_impl(&root).unwrap().entry_count, 1);
        assert_eq!(clear_cache_impl(&root).unwrap().entry_count, 0);
        assert_eq!(cache_stats_impl(&root).unwrap().used_bytes, 0);
    }

    #[test]
    fn cache_limit_evicts_least_recently_used_entries() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let old_path = cache_entry_path(root, "old");
        let new_path = cache_entry_path(root, "new");
        std::fs::write(&old_path, [0_u8; 8]).unwrap();
        std::fs::write(&new_path, [0_u8; 8]).unwrap();
        let mut index = CacheIndex::default();
        index.entries.insert(
            "old".into(),
            CacheIndexEntry {
                bytes: 8,
                last_accessed_millis: 1,
            },
        );
        index.entries.insert(
            "new".into(),
            CacheIndexEntry {
                bytes: 8,
                last_accessed_millis: 2,
            },
        );

        enforce_cache_limit(root, &mut index, 8);
        assert!(!old_path.exists());
        assert!(new_path.exists());
        assert!(!index.entries.contains_key("old"));
        assert!(index.entries.contains_key("new"));
    }
}
