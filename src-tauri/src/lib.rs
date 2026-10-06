use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
    thread,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct LocalConfig {
    llm_model: Option<String>,
    llm_runtime: Option<String>,
    whisper_model: Option<String>,
    whisper_runtime: Option<String>,
    ffmpeg_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelEntry {
    installed: bool,
    model_path: Option<String>,
    runtime_available: bool,
    runtime_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelStatus {
    desktop: bool,
    llm: ModelEntry,
    whisper: ModelEntry,
    vision: VisionEntry,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VisionEntry {
    installed: bool,
    model_path: Option<String>,
    note: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackendStatus {
    desktop: bool,
    ffmpeg: bool,
    ffprobe: bool,
    whisper: bool,
    llama: bool,
    ffmpeg_path: Option<String>,
    ffprobe_path: Option<String>,
    whisper_path: Option<String>,
    llama_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaInfo {
    media_type: String,
    duration: f64,
    width: u32,
    height: u32,
    fps: f64,
    has_audio: bool,
    size: u64,
}

#[derive(Debug, Clone, Serialize)]
struct TimeRange {
    start: f64,
    end: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SilenceResult {
    intervals: Vec<TimeRange>,
    noise_db: f64,
    analyzed_seconds: f64,
}

#[derive(Debug, Clone, Serialize)]
struct SceneResult {
    times: Vec<f64>,
    threshold: f64,
    analyzed_seconds: f64,
}

#[derive(Debug, Clone, Serialize)]
struct TranscriptSegment {
    start: f64,
    end: f64,
    text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TranscriptResult {
    segments: Vec<TranscriptSegment>,
    language: Option<String>,
    model: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportOptions {
    width: u32,
    height: u32,
    fps: f64,
    codec: String,
    video_bitrate: String,
}

#[derive(Debug, Clone, Serialize)]
struct ExportResult {
    path: String,
    bytes: u64,
    duration: f64,
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let mut path = app.path().app_config_dir().map_err(|error| format!("Cannot resolve application settings folder: {error}"))?;
    fs::create_dir_all(&path).map_err(|error| format!("Cannot create settings folder: {error}"))?;
    path.push("local-tools.json");
    Ok(path)
}

fn read_config(app: &AppHandle) -> LocalConfig {
    config_path(app)
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|raw| serde_json::from_str::<LocalConfig>(&raw).ok())
        .unwrap_or_default()
}

fn write_config(app: &AppHandle, config: &LocalConfig) -> Result<(), String> {
    let path = config_path(app)?;
    let raw = serde_json::to_string_pretty(config).map_err(|error| format!("Could not encode model settings: {error}"))?;
    fs::write(path, raw).map_err(|error| format!("Could not save local model settings: {error}"))
}

fn existing_path(path: &Option<String>) -> Option<PathBuf> {
    path.as_ref().map(PathBuf::from).filter(|candidate| candidate.is_file())
}

fn find_in_path(names: &[&str]) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for folder in std::env::split_paths(&path) {
        for name in names {
            let candidate = folder.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn bundled_binary(app: &AppHandle, name: &str) -> Option<PathBuf> {
    let root = app.path().resource_dir().ok()?;
    let candidates = [root.join(name), root.join("resources").join(name), root.join("bin").join(name)];
    candidates.into_iter().find(|candidate| candidate.is_file())
}

fn ffmpeg_binary(app: &AppHandle) -> Option<PathBuf> {
    let configured = read_config(app).ffmpeg_path.map(PathBuf::from).filter(|path| path.is_file());
    configured
        .or_else(|| bundled_binary(app, if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" }))
        .or_else(|| std::env::var_os("NEXUS_FFMPEG").map(PathBuf::from).filter(|path| path.is_file()))
        .or_else(|| find_in_path(&["ffmpeg.exe", "ffmpeg"]))
}

fn ffprobe_binary(app: &AppHandle) -> Option<PathBuf> {
    let configured = read_config(app).ffmpeg_path.map(PathBuf::from).and_then(|path| {
        let parent = path.parent()?;
        let candidate = parent.join(if cfg!(windows) { "ffprobe.exe" } else { "ffprobe" });
        candidate.is_file().then_some(candidate)
    });
    configured
        .or_else(|| bundled_binary(app, if cfg!(windows) { "ffprobe.exe" } else { "ffprobe" }))
        .or_else(|| find_in_path(&["ffprobe.exe", "ffprobe"]))
}

fn whisper_binary(app: &AppHandle) -> Option<PathBuf> {
    let configured = existing_path(&read_config(app).whisper_runtime);
    configured.or_else(|| find_in_path(&["whisper-cli.exe", "whisper-cli", "main.exe", "main"]))
}

fn llama_binary(app: &AppHandle) -> Option<PathBuf> {
    let configured = existing_path(&read_config(app).llm_runtime);
    configured.or_else(|| find_in_path(&["llama-cli.exe", "llama-cli"]))
}

fn path_string(path: Option<PathBuf>) -> Option<String> {
    path.map(|value| value.to_string_lossy().to_string())
}

fn model_entry(model: Option<String>, runtime: Option<PathBuf>) -> ModelEntry {
    let valid_model = model.filter(|value| Path::new(value).is_file());
    ModelEntry {
        installed: valid_model.is_some(),
        model_path: valid_model,
        runtime_available: runtime.is_some(),
        runtime_path: path_string(runtime),
    }
}

#[tauri::command]
fn get_backend_status(app: AppHandle) -> BackendStatus {
    let ffmpeg = ffmpeg_binary(&app);
    let ffprobe = ffprobe_binary(&app);
    let whisper = whisper_binary(&app);
    let llama = llama_binary(&app);
    BackendStatus {
        desktop: true,
        ffmpeg: ffmpeg.is_some(),
        ffprobe: ffprobe.is_some(),
        whisper: whisper.is_some(),
        llama: llama.is_some(),
        ffmpeg_path: path_string(ffmpeg),
        ffprobe_path: path_string(ffprobe),
        whisper_path: path_string(whisper),
        llama_path: path_string(llama),
    }
}

#[tauri::command]
fn get_model_status(app: AppHandle) -> ModelStatus {
    let config = read_config(&app);
    ModelStatus {
        desktop: true,
        llm: model_entry(config.llm_model, llama_binary(&app)),
        whisper: model_entry(config.whisper_model, whisper_binary(&app)),
        vision: VisionEntry {
            installed: false,
            model_path: None,
            note: "No local vision runtime adapter is configured in this build.".to_string(),
        },
    }
}

#[tauri::command]
fn set_model_path(app: AppHandle, kind: String, path: String) -> Result<ModelStatus, String> {
    let file = PathBuf::from(&path);
    if !file.is_file() {
        return Err("The selected path is not an existing file.".to_string());
    }
    let mut config = read_config(&app);
    match kind.as_str() {
        "llm_model" => config.llm_model = Some(path),
        "llm_runtime" => config.llm_runtime = Some(path),
        "whisper_model" => config.whisper_model = Some(path),
        "whisper_runtime" => config.whisper_runtime = Some(path),
        "ffmpeg" => config.ffmpeg_path = Some(path),
        _ => return Err("Unknown local tool category.".to_string()),
    }
    write_config(&app, &config)?;
    Ok(get_model_status(app))
}

#[tauri::command]
fn pick_media_files() -> Option<Vec<String>> {
    rfd::FileDialog::new()
        .set_title("Import media into NEXUS VIDEO STUDIO")
        .add_filter("Video", &["mp4", "mov", "mkv", "avi", "webm", "m4v"])
        .add_filter("Audio", &["mp3", "wav", "aac", "m4a", "ogg", "flac"])
        .add_filter("Images", &["png", "jpg", "jpeg", "webp", "bmp", "gif"])
        .pick_files()
        .map(|paths| paths.into_iter().map(|path| path.to_string_lossy().to_string()).collect())
}

#[tauri::command]
fn pick_project_file() -> Option<String> {
    rfd::FileDialog::new()
        .set_title("Open a NEXUS project")
        .add_filter("NEXUS Video Project", &["nexusvideo"])
        .pick_file()
        .map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
fn choose_project_save_path() -> Option<String> {
    rfd::FileDialog::new()
        .set_title("Save NEXUS project")
        .add_filter("NEXUS Video Project", &["nexusvideo"])
        .set_file_name("Untitled Project.nexusvideo")
        .save_file()
        .map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
fn choose_export_path(suggested_name: String) -> Option<String> {
    rfd::FileDialog::new()
        .set_title("Export MP4 video")
        .add_filter("MP4 video", &["mp4"])
        .set_file_name(&suggested_name)
        .save_file()
        .map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
fn pick_model_or_runtime_file(kind: String) -> Option<String> {
    let mut dialog = rfd::FileDialog::new().set_title("Choose a local model or runtime file");
    if kind.contains("runtime") || kind == "ffmpeg" {
        dialog = dialog.add_filter("Local executable", &["exe"]);
    } else if kind == "llm_model" {
        dialog = dialog.add_filter("GGUF model", &["gguf"]);
    } else {
        dialog = dialog.add_filter("Whisper model", &["bin", "ggml"]);
    }
    dialog.pick_file().map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
fn read_project_file(path: String) -> Result<String, String> {
    let metadata = fs::metadata(&path).map_err(|error| format!("Cannot read project file: {error}"))?;
    if metadata.len() > 32 * 1024 * 1024 {
        return Err("This project file is unexpectedly large (over 32 MB).".to_string());
    }
    fs::read_to_string(path).map_err(|error| format!("Cannot read project file: {error}"))
}

#[tauri::command]
fn write_project_file(path: String, json: String) -> Result<(), String> {
    if json.len() > 32 * 1024 * 1024 {
        return Err("Project metadata exceeded the 32 MB safety limit.".to_string());
    }
    let destination = PathBuf::from(path);
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("Cannot create project folder: {error}"))?;
    }
    fs::write(destination, json).map_err(|error| format!("Could not save project: {error}"))
}

fn command_output(binary: &Path, args: &[String]) -> Result<Output, String> {
    Command::new(binary)
        .args(args)
        .stdin(Stdio::null())
        .output()
        .map_err(|error| format!("Could not start {}: {error}", binary.display()))
}

fn output_error(output: &Output, operation: &str) -> String {
    let detail = String::from_utf8_lossy(&output.stderr);
    let clipped = if detail.len() > 6000 { &detail[detail.len() - 6000..] } else { detail.as_ref() };
    format!("{operation} failed (exit {:?}).\n{}", output.status.code(), clipped.trim())
}

fn parse_rate(value: Option<&Value>) -> f64 {
    let raw = value.and_then(Value::as_str).unwrap_or_default();
    if let Some((numerator, denominator)) = raw.split_once('/') {
        let a = numerator.parse::<f64>().unwrap_or(0.0);
        let b = denominator.parse::<f64>().unwrap_or(0.0);
        if b.abs() > f64::EPSILON { return a / b; }
    }
    raw.parse::<f64>().unwrap_or(0.0)
}

fn probe_value(app: &AppHandle, path: &str) -> Result<(MediaInfo, Value), String> {
    let file = PathBuf::from(path);
    if !file.is_file() { return Err(format!("Media file does not exist: {path}")); }
    let ffprobe = ffprobe_binary(app).ok_or_else(|| "FFprobe was not found. Add ffprobe.exe to PATH or beside the configured FFmpeg executable.".to_string())?;
    let args = vec![
        "-v".to_string(), "error".to_string(), "-show_streams".to_string(), "-show_format".to_string(),
        "-of".to_string(), "json".to_string(), path.to_string(),
    ];
    let output = command_output(&ffprobe, &args)?;
    if !output.status.success() { return Err(output_error(&output, "Media probe")); }
    let value: Value = serde_json::from_slice(&output.stdout).map_err(|error| format!("FFprobe returned invalid metadata: {error}"))?;
    let streams = value.get("streams").and_then(Value::as_array).cloned().unwrap_or_default();
    let video = streams.iter().find(|stream| stream.get("codec_type").and_then(Value::as_str) == Some("video"));
    let audio = streams.iter().any(|stream| stream.get("codec_type").and_then(Value::as_str) == Some("audio"));
    let format = value.get("format").cloned().unwrap_or_else(|| json!({}));
    let duration = format.get("duration").and_then(Value::as_str).and_then(|raw| raw.parse::<f64>().ok())
        .or_else(|| video.and_then(|stream| stream.get("duration")).and_then(Value::as_str).and_then(|raw| raw.parse::<f64>().ok()))
        .unwrap_or(0.0).max(0.0);
    let width = video.and_then(|stream| stream.get("width")).and_then(Value::as_u64).unwrap_or(0) as u32;
    let height = video.and_then(|stream| stream.get("height")).and_then(Value::as_u64).unwrap_or(0) as u32;
    let fps = video.map(|stream| parse_rate(stream.get("avg_frame_rate").or_else(|| stream.get("r_frame_rate")))).unwrap_or(0.0);
    let extension = file.extension().and_then(|value| value.to_str()).unwrap_or_default().to_ascii_lowercase();
    let still_image = ["png", "jpg", "jpeg", "webp", "bmp", "gif"].contains(&extension.as_str());
    let media_type = if still_image { "image" } else if video.is_some() { "video" } else if audio { "audio" } else { "image" }.to_string();
    let size = fs::metadata(&file).map(|metadata| metadata.len()).unwrap_or(0);
    Ok((MediaInfo { media_type, duration, width, height, fps, has_audio: audio, size }, value))
}

#[tauri::command]
fn probe_media(app: AppHandle, path: String) -> Result<MediaInfo, String> {
    probe_value(&app, &path).map(|(info, _)| info)
}

fn parse_number_after(line: &str, marker: &str) -> Option<f64> {
    let index = line.find(marker)? + marker.len();
    let token = line[index..].trim_start().split(|character: char| !(character.is_ascii_digit() || character == '.' || character == '-')).next()?;
    token.parse::<f64>().ok()
}

#[tauri::command]
async fn analyze_silence(app: AppHandle, path: String, noise_db: f64, min_duration: f64) -> Result<SilenceResult, String> {
    tauri::async_runtime::spawn_blocking(move || analyze_silence_blocking(app, path, noise_db, min_duration))
        .await.map_err(|error| format!("Silence analysis worker stopped: {error}"))?
}

fn analyze_silence_blocking(app: AppHandle, path: String, noise_db: f64, min_duration: f64) -> Result<SilenceResult, String> {
    let (info, _) = probe_value(&app, &path)?;
    if !info.has_audio { return Ok(SilenceResult { intervals: Vec::new(), noise_db, analyzed_seconds: info.duration }); }
    if !noise_db.is_finite() || !(-90.0..=0.0).contains(&noise_db) { return Err("Silence noise threshold must be between -90 and 0 dB.".to_string()); }
    if !min_duration.is_finite() || !(0.05..=120.0).contains(&min_duration) { return Err("Minimum silence duration must be between 0.05 and 120 seconds.".to_string()); }
    let ffmpeg = ffmpeg_binary(&app).ok_or_else(|| "FFmpeg is required for local silence detection. Configure it in AI Model Manager.".to_string())?;
    let filter = format!("silencedetect=noise={noise_db}dB:d={min_duration}");
    let args = vec![
        "-hide_banner".to_string(), "-nostats".to_string(), "-i".to_string(), path,
        "-map".to_string(), "0:a:0".to_string(), "-af".to_string(), filter,
        "-f".to_string(), "null".to_string(), "-".to_string(),
    ];
    let output = command_output(&ffmpeg, &args)?;
    if !output.status.success() { return Err(output_error(&output, "Silence detection")); }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let mut intervals: Vec<TimeRange> = Vec::new();
    let mut active_start: Option<f64> = None;
    for line in stderr.lines() {
        if line.contains("silence_start:") {
            if let Some(start) = parse_number_after(line, "silence_start:") { active_start = Some(start.max(0.0)); }
        }
        if line.contains("silence_end:") {
            if let Some(end) = parse_number_after(line, "silence_end:") {
                let derived = parse_number_after(line, "silence_duration:").map(|duration| (end - duration).max(0.0));
                let start = active_start.take().or(derived).unwrap_or(0.0);
                if end > start { intervals.push(TimeRange { start, end }); }
            }
        }
    }
    if let Some(start) = active_start {
        if info.duration > start { intervals.push(TimeRange { start, end: info.duration }); }
    }
    intervals.sort_by(|a, b| a.start.total_cmp(&b.start));
    let mut merged: Vec<TimeRange> = Vec::new();
    for current in intervals {
        if let Some(last) = merged.last_mut() {
            if current.start <= last.end + 0.035 { last.end = last.end.max(current.end); continue; }
        }
        merged.push(current);
    }
    Ok(SilenceResult { intervals: merged, noise_db, analyzed_seconds: info.duration })
}

#[tauri::command]
async fn detect_scenes(app: AppHandle, path: String, threshold: f64) -> Result<SceneResult, String> {
    tauri::async_runtime::spawn_blocking(move || detect_scenes_blocking(app, path, threshold))
        .await.map_err(|error| format!("Scene analysis worker stopped: {error}"))?
}

fn detect_scenes_blocking(app: AppHandle, path: String, threshold: f64) -> Result<SceneResult, String> {
    let (info, _) = probe_value(&app, &path)?;
    if info.width == 0 || info.height == 0 { return Err("Scene change detection requires a video stream.".to_string()); }
    if !threshold.is_finite() || !(0.01..=0.99).contains(&threshold) { return Err("Scene threshold must be between 0.01 and 0.99.".to_string()); }
    let ffmpeg = ffmpeg_binary(&app).ok_or_else(|| "FFmpeg is required for scene detection. Configure it in AI Model Manager.".to_string())?;
    let filter = format!("select='gt(scene,{threshold:.3})',showinfo");
    let args = vec![
        "-hide_banner".to_string(), "-nostats".to_string(), "-i".to_string(), path,
        "-vf".to_string(), filter, "-an".to_string(), "-f".to_string(), "null".to_string(), "-".to_string(),
    ];
    let output = command_output(&ffmpeg, &args)?;
    if !output.status.success() { return Err(output_error(&output, "Scene detection")); }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let mut times: Vec<f64> = stderr.lines().filter_map(|line| parse_number_after(line, "pts_time:")).filter(|value| value.is_finite() && *value >= 0.0).collect();
    times.sort_by(f64::total_cmp);
    times.dedup_by(|a, b| (*a - *b).abs() < 0.02);
    Ok(SceneResult { times, threshold, analyzed_seconds: info.duration })
}

fn whisper_timestamp(value: &Value) -> Option<f64> {
    if let Some(number) = value.as_f64() { return Some(number); }
    let text = value.as_str()?;
    if let Ok(number) = text.parse::<f64>() { return Some(number); }
    let normalized = text.replace(',', ".");
    let pieces: Vec<&str> = normalized.split(':').collect();
    let mut result = 0.0;
    for piece in pieces { result = result * 60.0 + piece.parse::<f64>().ok()?; }
    Some(result)
}

fn parse_whisper_json(value: &Value) -> Vec<TranscriptSegment> {
    let candidates = value.get("transcription").and_then(Value::as_array)
        .or_else(|| value.get("segments").and_then(Value::as_array));
    let mut result = Vec::new();
    if let Some(items) = candidates {
        for item in items {
            let times = item.get("timestamps").unwrap_or(item);
            let start = whisper_timestamp(times.get("from").or_else(|| times.get("start")).unwrap_or(&Value::Null));
            let end = whisper_timestamp(times.get("to").or_else(|| times.get("end")).unwrap_or(&Value::Null));
            let text = item.get("text").and_then(Value::as_str).unwrap_or_default().trim().to_string();
            if let (Some(start), Some(end)) = (start, end) {
                if end > start && !text.is_empty() { result.push(TranscriptSegment { start, end, text }); }
            }
        }
    }
    result.sort_by(|a, b| a.start.total_cmp(&b.start));
    result
}

fn unique_temp_path(extension: &str) -> PathBuf {
    let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
    std::env::temp_dir().join(format!("nexus-{}-{nonce}.{extension}", std::process::id()))
}

#[tauri::command]
async fn transcribe_media(app: AppHandle, path: String, language: Option<String>) -> Result<TranscriptResult, String> {
    tauri::async_runtime::spawn_blocking(move || transcribe_media_blocking(app, path, language))
        .await.map_err(|error| format!("Whisper worker stopped: {error}"))?
}

fn transcribe_media_blocking(app: AppHandle, path: String, language: Option<String>) -> Result<TranscriptResult, String> {
    let config = read_config(&app);
    let model = config.whisper_model.filter(|model| Path::new(model).is_file())
        .ok_or_else(|| "Local AI model required — install a Whisper-compatible model in AI Model Manager.".to_string())?;
    let whisper = whisper_binary(&app).ok_or_else(|| "Local AI model required — locate the whisper.cpp runtime in AI Model Manager.".to_string())?;
    let ffmpeg = ffmpeg_binary(&app).ok_or_else(|| "FFmpeg is required to prepare local audio for Whisper. Configure it in AI Model Manager.".to_string())?;
    let (info, _) = probe_value(&app, &path)?;
    if !info.has_audio { return Err("This media has no audio stream to transcribe.".to_string()); }
    let wav_path = unique_temp_path("wav");
    let output_prefix = unique_temp_path("transcript");
    let wav_args = vec![
        "-y".to_string(), "-hide_banner".to_string(), "-nostats".to_string(), "-i".to_string(), path,
        "-vn".to_string(), "-ac".to_string(), "1".to_string(), "-ar".to_string(), "16000".to_string(),
        "-c:a".to_string(), "pcm_s16le".to_string(), wav_path.to_string_lossy().to_string(),
    ];
    let extract = command_output(&ffmpeg, &wav_args)?;
    if !extract.status.success() { let _ = fs::remove_file(&wav_path); return Err(output_error(&extract, "Audio extraction for Whisper")); }
    let mut args = vec![
        "-m".to_string(), model.clone(), "-f".to_string(), wav_path.to_string_lossy().to_string(),
        "-oj".to_string(), "-of".to_string(), output_prefix.to_string_lossy().to_string(), "-nt".to_string(),
    ];
    if let Some(language) = language.filter(|value| !value.trim().is_empty()) {
        let lang = language.chars().take(12).collect::<String>();
        args.push("-l".to_string()); args.push(lang);
    }
    let output = command_output(&whisper, &args);
    let json_path = PathBuf::from(format!("{}.json", output_prefix.to_string_lossy()));
    let parsed = match output {
        Ok(result) if result.status.success() => {
            let raw = fs::read(&json_path).map_err(|error| format!("Whisper completed but its timestamped JSON transcript could not be read: {error}"))?;
            let json: Value = serde_json::from_slice(&raw).map_err(|error| format!("Whisper returned invalid transcript JSON: {error}"))?;
            let segments = parse_whisper_json(&json);
            if segments.is_empty() { return Err("Whisper produced no timestamped speech segments.".to_string()); }
            TranscriptResult { segments, language: json.get("result").and_then(|value| value.get("language")).and_then(Value::as_str).map(str::to_string), model }
        }
        Ok(result) => return Err(output_error(&result, "Local Whisper transcription")),
        Err(error) => return Err(error),
    };
    let _ = fs::remove_file(wav_path);
    let _ = fs::remove_file(json_path);
    Ok(parsed)
}

#[tauri::command]
async fn download_model(app: AppHandle, model_id: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || download_model_blocking(app, model_id))
        .await
        .map_err(|error| format!("Model downloader stopped unexpectedly: {error}"))?
}

fn download_model_blocking(app: AppHandle, model_id: String) -> Result<Value, String> {
    let (url, filename, kind) = match model_id.as_str() {
        "whisper-tiny" => (
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
            "ggml-tiny.bin",
            "whisper_model",
        ),
        "qwen-small" => (
            "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf",
            "qwen2.5-0.5b-instruct-q4_k_m.gguf",
            "llm_model",
        ),
        _ => return Err("This model is not in the verified optional download list.".to_string()),
    };
    let mut folder = app.path().app_data_dir().map_err(|error| format!("Cannot resolve local model folder: {error}"))?;
    folder.push("models");
    fs::create_dir_all(&folder).map_err(|error| format!("Cannot create local model folder: {error}"))?;
    let destination = folder.join(filename);
    if destination.is_file() && fs::metadata(&destination).map(|meta| meta.len() > 1024 * 1024).unwrap_or(false) {
        let mut config = read_config(&app);
        if kind == "whisper_model" { config.whisper_model = Some(destination.to_string_lossy().to_string()); }
        else { config.llm_model = Some(destination.to_string_lossy().to_string()); }
        write_config(&app, &config)?;
        return Ok(json!({ "path": destination.to_string_lossy(), "alreadyInstalled": true }));
    }
    let partial = destination.with_extension(format!("{}.partial", destination.extension().and_then(|value| value.to_str()).unwrap_or("model")));
    let response = ureq::get(url)
        .set("User-Agent", "NEXUS-VIDEO-STUDIO/0.1")
        .call()
        .map_err(|error| format!("Could not download the model from its published source: {error}"))?;
    let total = response.header("Content-Length").and_then(|value| value.parse::<u64>().ok()).unwrap_or(0);
    let mut reader = response.into_reader();
    let mut file = File::create(&partial).map_err(|error| format!("Cannot create model download: {error}"))?;
    let mut downloaded = 0u64;
    let mut buffer = vec![0u8; 512 * 1024];
    loop {
        let size = reader.read(&mut buffer).map_err(|error| format!("Model download interrupted: {error}"))?;
        if size == 0 { break; }
        file.write_all(&buffer[..size]).map_err(|error| format!("Cannot write the local model file: {error}"))?;
        downloaded += size as u64;
        let percent = if total > 0 { (downloaded as f64 / total as f64 * 100.0).min(99.0) } else { 0.0 };
        let _ = app.emit("model-download-progress", json!({ "modelId": model_id, "downloaded": downloaded, "total": total, "percent": percent.round() }));
    }
    file.flush().map_err(|error| format!("Cannot finish writing the model file: {error}"))?;
    if downloaded < 1024 * 1024 {
        let _ = fs::remove_file(&partial);
        return Err("The downloaded file is too small to be a valid model. No model was installed.".to_string());
    }
    fs::rename(&partial, &destination).map_err(|error| format!("Could not install the downloaded model: {error}"))?;
    let mut config = read_config(&app);
    if kind == "whisper_model" { config.whisper_model = Some(destination.to_string_lossy().to_string()); }
    else { config.llm_model = Some(destination.to_string_lossy().to_string()); }
    write_config(&app, &config)?;
    let _ = app.emit("model-download-progress", json!({ "modelId": model_id, "downloaded": downloaded, "total": total, "percent": 100.0, "completed": true }));
    Ok(json!({ "path": destination.to_string_lossy(), "bytes": downloaded, "alreadyInstalled": false }))
}

#[tauri::command]
async fn generate_local_plan(app: AppHandle, command: String, project_state: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || generate_local_plan_blocking(app, command, project_state))
        .await.map_err(|error| format!("Local model worker stopped: {error}"))?
}

fn generate_local_plan_blocking(app: AppHandle, command: String, project_state: String) -> Result<String, String> {
    let config = read_config(&app);
    let model = config.llm_model.filter(|path| Path::new(path).is_file())
        .ok_or_else(|| "Local AI model required — choose a local GGUF model in AI Model Manager.".to_string())?;
    let llama = llama_binary(&app).ok_or_else(|| "Local AI model required — locate a llama.cpp CLI runtime in AI Model Manager.".to_string())?;
    let context: Value = serde_json::from_str(&project_state).map_err(|error| format!("Project state could not be prepared for the local model: {error}"))?;
    let prompt = format!(
        "You are the offline tool planner inside NEXUS VIDEO STUDIO. Return only one JSON object with keys summary and actions. Never include shell commands, file paths, executable names, code, or tools outside this allowlist. Allowed actions and exact shapes: {{\"tool\":\"remove_range\",\"arguments\":{{\"start\":number,\"end\":number}}}}, {{\"tool\":\"set_aspect_ratio\",\"arguments\":{{\"ratio\":\"9:16\"|\"16:9\"|\"1:1\"|\"4:5\"}}}}, {{\"tool\":\"set_volume\",\"arguments\":{{\"multiplier\":number,\"trackType\":\"audio\"|null}}}}, {{\"tool\":\"trim_to_duration\",\"arguments\":{{\"duration\":number}}}}, {{\"tool\":\"normalize_audio\",\"arguments\":{{}}}}, {{\"tool\":\"move_clip\",\"arguments\":{{\"clipId\":existing_clip_id,\"startTime\":number}}}}, {{\"tool\":\"split_clip\",\"arguments\":{{\"clipId\":existing_clip_id,\"atTime\":number}}}}. Never invent transcription, silence, or face detections; captions and speech-linked edits must come only from the installed local Whisper analysis, never generated text. Use only clip IDs that exist. A plan is a proposal and the user must confirm it. Project state JSON: {context}. User request: {command}",
    );
    let args = vec![
        "-m".to_string(), model, "-p".to_string(), prompt,
        "-n".to_string(), "700".to_string(), "--temp".to_string(), "0.1".to_string(),
        "--no-display-prompt".to_string(),
    ];
    let output = command_output(&llama, &args)?;
    if !output.status.success() { return Err(output_error(&output, "Local language model inference")); }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() { return Err("The local language model returned an empty plan.".to_string()); }
    Ok(text)
}

fn json_number(value: Option<&Value>, fallback: f64) -> f64 {
    value.and_then(Value::as_f64).filter(|value| value.is_finite()).unwrap_or(fallback)
}
fn json_bool(value: Option<&Value>, fallback: bool) -> bool { value.and_then(Value::as_bool).unwrap_or(fallback) }
fn json_string<'a>(value: Option<&'a Value>, fallback: &'a str) -> &'a str { value.and_then(Value::as_str).unwrap_or(fallback) }
fn fmt_num(value: f64) -> String { format!("{:.6}", value.max(0.0)) }

fn srt_timestamp(seconds: f64) -> String {
    let millis = (seconds.max(0.0) * 1000.0).round() as u64;
    let hours = millis / 3_600_000;
    let minutes = (millis % 3_600_000) / 60_000;
    let secs = (millis % 60_000) / 1000;
    let remainder = millis % 1000;
    format!("{hours:02}:{minutes:02}:{secs:02},{remainder:03}")
}

fn escape_filter_path(path: &Path) -> String {
    let value = path.to_string_lossy().replace('\\', "\\\\").replace(':', "\\:").replace('\'', "\\'").replace(',', "\\,");
    value
}

fn write_subtitle_file(project: &Value, folder: &Path) -> Result<Option<(PathBuf, f64, bool)>, String> {
    let Some(tracks) = project.get("tracks").and_then(Value::as_array) else { return Ok(None); };
    let mut captions: Vec<(f64, f64, String, Value)> = Vec::new();
    for track in tracks.iter().filter(|track| json_string(track.get("type"), "") == "caption" && !json_bool(track.get("muted"), false) && json_bool(track.get("visible"), true)) {
        for clip in track.get("clips").and_then(Value::as_array).into_iter().flatten() {
            let start = json_number(clip.get("startTime"), 0.0);
            let duration = json_number(clip.get("duration"), 0.0);
            let text = json_string(clip.get("text"), "").replace("-->", "→").replace('\0', "").trim().to_string();
            if duration > 0.02 && !text.is_empty() { captions.push((start, start + duration, text, clip.get("style").cloned().unwrap_or_else(|| json!({})))); }
        }
    }
    if captions.is_empty() { return Ok(None); }
    captions.sort_by(|a, b| a.0.total_cmp(&b.0));
    let mut srt = String::new();
    let mut style_size = 34.0;
    let mut raised = false;
    let mut outline = true;
    for (index, (start, end, text, style)) in captions.iter().enumerate() {
        style_size = json_number(style.get("fontSize"), style_size);
        raised = raised || json_string(style.get("position"), "") == "mid-lower";
        outline = outline && json_bool(style.get("outline"), true);
        srt.push_str(&format!("{}\n{} --> {}\n{}\n\n", index + 1, srt_timestamp(*start), srt_timestamp(*end), text));
    }
    let path = folder.join(format!("nexus-captions-{}.srt", SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos()));
    fs::write(&path, srt).map_err(|error| format!("Could not prepare caption track for export: {error}"))?;
    Ok(Some((path, style_size, raised && outline)))
}

fn zoom_intervals(clip: &Value) -> Vec<(f64, f64, f64)> {
    let Some(keys) = clip.get("keyframes").and_then(Value::as_array) else { return Vec::new(); };
    let mut sorted: Vec<(f64, f64)> = keys.iter()
        .filter(|key| json_string(key.get("property"), "") == "scale")
        .map(|key| (json_number(key.get("time"), 0.0), json_number(key.get("value"), 1.0)))
        .collect();
    sorted.sort_by(|a, b| a.0.total_cmp(&b.0));
    let mut active: Option<(f64, f64)> = None;
    let mut intervals = Vec::new();
    for (time, scale) in sorted {
        if scale > 1.005 {
            if active.is_none() { active = Some((time, scale)); }
            else if let Some((start, max_scale)) = active { active = Some((start, max_scale.max(scale))); }
        } else if let Some((start, max_scale)) = active.take() {
            if time > start { intervals.push((start, time, max_scale.min(2.0))); }
        }
    }
    if let Some((start, scale)) = active { intervals.push((start, f64::MAX / 4.0, scale.min(2.0))); }
    intervals
}

fn apply_video_effects(filter: &mut String, clip: &Value) {
    let Some(effects) = clip.get("effects").and_then(Value::as_array) else { return; };
    for effect in effects {
        match json_string(effect.get("type"), "") {
            "brightness" => {
                let value = json_number(effect.get("value"), 0.0).clamp(-1.0, 1.0);
                filter.push_str(&format!(",eq=brightness={value:.4}"));
            }
            "contrast" => {
                let value = json_number(effect.get("value"), 1.0).clamp(0.0, 3.0);
                filter.push_str(&format!(",eq=contrast={value:.4}"));
            }
            "saturation" => {
                let value = json_number(effect.get("value"), 1.0).clamp(0.0, 3.0);
                filter.push_str(&format!(",eq=saturation={value:.4}"));
            }
            "blur" => {
                let value = json_number(effect.get("value"), 2.0).clamp(0.1, 30.0);
                filter.push_str(&format!(",boxblur={value:.2}"));
            }
            "sharpen" => {
                let value = json_number(effect.get("value"), 0.5).clamp(0.0, 2.0);
                filter.push_str(&format!(",unsharp=5:5:{value:.2}"));
            }
            _ => {}
        }
    }
}

fn filter_complex_for_project(
    project: &Value,
    input_indexes: &HashMap<String, usize>,
    options: &ExportOptions,
    duration: f64,
    caption: Option<&(PathBuf, f64, bool)>,
) -> Result<(String, String, Option<PathBuf>), String> {
    let tracks = project.get("tracks").and_then(Value::as_array).ok_or_else(|| "Project has no tracks.".to_string())?;
    let settings = project.get("settings").cloned().unwrap_or_else(|| json!({}));
    let fps = options.fps.clamp(1.0, 120.0);
    let width = options.width.clamp(144, 7680);
    let height = options.height.clamp(144, 7680);
    let color = json_string(settings.get("background"), "#080b11");
    let color = if color.len() == 7 && color.starts_with('#') && color[1..].chars().all(|character| character.is_ascii_hexdigit()) { format!("0x{}", &color[1..]) } else { "0x080b11".to_string() };
    let mut graph = vec![format!("color=c={color}:s={width}x{height}:r={fps}:d={duration:.6},format=yuv420p[vbase0]")];
    let mut current_video = "vbase0".to_string();
    let mut video_index = 0usize;
    let mut audio_sources: Vec<String> = Vec::new();
    let mut next_label = 0usize;

    for track in tracks {
        let track_type = json_string(track.get("type"), "");
        if track_type != "video" || !json_bool(track.get("visible"), true) { continue; }
        let muted = json_bool(track.get("muted"), false);
        let clips = track.get("clips").and_then(Value::as_array).cloned().unwrap_or_default();
        for clip in clips {
            let asset_id = json_string(clip.get("assetId"), "");
            let Some(input_index) = input_indexes.get(asset_id) else { continue; };
            let start = json_number(clip.get("startTime"), 0.0).clamp(0.0, duration);
            let length = json_number(clip.get("duration"), 0.0).clamp(0.0, duration - start);
            if length <= 0.02 { continue; }
            let source_in = json_number(clip.get("sourceIn"), 0.0).max(0.0);
            let volume = json_number(clip.get("volume"), 1.0).clamp(0.0, 4.0);
            let source_end = source_in + length;
            let zoom = json_number(clip.get("transform").and_then(|value| value.get("scale")), 1.0).clamp(1.0, 2.0);
            let video_label = format!("vclip{video_index}");
            let mut filter = format!("[{}:v:0]trim=start={}:end={},setpts=PTS-STARTPTS,scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},setsar=1", input_index, fmt_num(source_in), fmt_num(source_end));
            if zoom > 1.005 { filter.push_str(&format!(",scale=iw*{zoom:.4}:ih*{zoom:.4},crop={width}:{height}")); }
            let intervals = zoom_intervals(&clip);
            if !intervals.is_empty() {
                let mut expression = "1".to_string();
                for (from, to, scale) in intervals {
                    expression = format!("if(between(in_time,{from:.3},{to:.3}),{scale:.4},{expression})");
                }
                filter.push_str(&format!(",zoompan=z='{expression}':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s={width}x{height}:fps={fps}"));
            } else {
                filter.push_str(&format!(",fps={fps}"));
            }
            apply_video_effects(&mut filter, &clip);
            filter.push_str(&format!(",format=rgba,setpts=PTS-STARTPTS+{}/TB[{video_label}]", fmt_num(start)));
            graph.push(filter);
            let next = format!("vbase{}", video_index + 1);
            graph.push(format!("[{}][{}]overlay=0:0:eof_action=pass:shortest=0:repeatlast=0:enable='between(t,{},{})'[{}]", current_video, video_label, fmt_num(start), fmt_num(start + length), next));
            current_video = next;
            video_index += 1;

            let has_audio = project.get("assets").and_then(Value::as_array).into_iter().flatten()
                .find(|asset| json_string(asset.get("id"), "") == asset_id).map(|asset| json_bool(asset.get("hasAudio"), false)).unwrap_or(false);
            if !muted && has_audio && volume > 0.0001 {
                let audio_label = format!("asrc{}", next_label);
                let mut audio_filter = format!("[{}:a:0]atrim=start={}:duration={},asetpts=PTS-STARTPTS,volume={volume:.4}", input_index, fmt_num(source_in), fmt_num(length));
                if clip.get("effects").and_then(Value::as_array).into_iter().flatten().any(|effect| json_string(effect.get("type"), "") == "normalize") {
                    audio_filter.push_str(",loudnorm=I=-16:TP=-1.5:LRA=11");
                }
                let delay = (start * 1000.0).round() as u64;
                audio_filter.push_str(&format!(",apad=pad_dur={duration:.6},adelay={delay}|{delay}[{audio_label}]"));
                graph.push(audio_filter);
                audio_sources.push(format!("[{audio_label}]"));
                next_label += 1;
            }
        }
    }

    for track in tracks {
        if json_string(track.get("type"), "") != "audio" || json_bool(track.get("muted"), false) || !json_bool(track.get("visible"), true) { continue; }
        for clip in track.get("clips").and_then(Value::as_array).into_iter().flatten() {
            let asset_id = json_string(clip.get("assetId"), "");
            let Some(input_index) = input_indexes.get(asset_id) else { continue; };
            let has_audio = project.get("assets").and_then(Value::as_array).into_iter().flatten()
                .find(|asset| json_string(asset.get("id"), "") == asset_id).map(|asset| json_bool(asset.get("hasAudio"), false)).unwrap_or(false);
            if !has_audio { continue; }
            let start = json_number(clip.get("startTime"), 0.0).clamp(0.0, duration);
            let length = json_number(clip.get("duration"), 0.0).clamp(0.0, duration - start);
            let volume = json_number(clip.get("volume"), 1.0).clamp(0.0, 4.0);
            if length <= 0.02 || volume <= 0.0001 { continue; }
            let source_in = json_number(clip.get("sourceIn"), 0.0).max(0.0);
            let label = format!("asrc{}", next_label);
            let mut filter = format!("[{}:a:0]atrim=start={}:duration={},asetpts=PTS-STARTPTS,volume={volume:.4}", input_index, fmt_num(source_in), fmt_num(length));
            if clip.get("effects").and_then(Value::as_array).into_iter().flatten().any(|effect| json_string(effect.get("type"), "") == "normalize") {
                filter.push_str(",loudnorm=I=-16:TP=-1.5:LRA=11");
            }
            let delay = (start * 1000.0).round() as u64;
            filter.push_str(&format!(",apad=pad_dur={duration:.6},adelay={delay}|{delay}[{label}]"));
            graph.push(filter);
            audio_sources.push(format!("[{label}]"));
            next_label += 1;
        }
    }

    if let Some((srt_path, font_size, raised)) = caption {
        let path = escape_filter_path(srt_path);
        let scaled_size = (font_size * height as f64 / 1080.0).round().clamp(14.0, 100.0);
        let margin = if *raised { height / 5 } else { height / 22 };
        let style = format!("FontName=Arial,FontSize={scaled_size:.0},PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=1,Alignment=2,MarginV={margin}");
        let next = format!("vbase_caption");
        graph.push(format!("[{current_video}]subtitles=filename='{path}':force_style='{style}'[{next}]"));
        current_video = next;
    }

    let audio_output = if audio_sources.is_empty() {
        graph.push(format!("anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration={duration:.6}[aout]"));
        "aout".to_string()
    } else {
        let joined = audio_sources.join("");
        graph.push(format!("{joined}amix=inputs={}:duration=longest:dropout_transition=0:normalize=0,atrim=duration={duration:.6},aresample=async=1:first_pts=0[aout]", audio_sources.len()));
        "aout".to_string()
    };
    Ok((graph.join(";"), current_video, Some(PathBuf::from(audio_output))))
}

fn output_video_codec(codec: &str) -> Result<&'static str, String> {
    match codec {
        "h264" => Ok("libx264"),
        "h265" => Ok("libx265"),
        _ => Err("Choose H.264 or H.265 for MP4 export.".to_string()),
    }
}

fn project_duration(project: &Value) -> f64 {
    project.get("tracks").and_then(Value::as_array).into_iter().flatten()
        .flat_map(|track| track.get("clips").and_then(Value::as_array).into_iter().flatten())
        .map(|clip| json_number(clip.get("startTime"), 0.0) + json_number(clip.get("duration"), 0.0))
        .fold(0.0, f64::max)
}

fn collect_input_assets(project: &Value) -> Result<(Vec<(String, PathBuf)>, HashMap<String, usize>), String> {
    let assets = project.get("assets").and_then(Value::as_array).ok_or_else(|| "Project media list is missing.".to_string())?;
    let used: HashSet<String> = project.get("tracks").and_then(Value::as_array).into_iter().flatten()
        .filter(|track| match json_string(track.get("type"), "") {
            "video" => json_bool(track.get("visible"), true),
            "audio" => json_bool(track.get("visible"), true) && !json_bool(track.get("muted"), false),
            _ => false,
        })
        .flat_map(|track| track.get("clips").and_then(Value::as_array).into_iter().flatten())
        .map(|clip| json_string(clip.get("assetId"), "").to_string()).collect();
    let mut result = Vec::new();
    let mut indexes = HashMap::new();
    for asset in assets {
        let id = json_string(asset.get("id"), "");
        if !used.contains(id) { continue; }
        let path = asset.get("path").and_then(Value::as_str).ok_or_else(|| format!("Source “{}” is not linked to a desktop file path. Relink or import it in the desktop app.", json_string(asset.get("name"), "media")))?;
        let source = PathBuf::from(path);
        if !source.is_file() { return Err(format!("Source file is missing: {}", source.display())); }
        indexes.insert(id.to_string(), result.len());
        result.push((id.to_string(), source));
    }
    if result.is_empty() { return Err("The timeline has no video or audio source clips to export.".to_string()); }
    Ok((result, indexes))
}

#[tauri::command]
async fn export_timeline(app: AppHandle, project_json: String, output_path: String, options: ExportOptions) -> Result<ExportResult, String> {
    tauri::async_runtime::spawn_blocking(move || export_timeline_blocking(app, project_json, output_path, options))
        .await.map_err(|error| format!("FFmpeg render worker stopped: {error}"))?
}

fn export_timeline_blocking(app: AppHandle, project_json: String, output_path: String, options: ExportOptions) -> Result<ExportResult, String> {
    if project_json.len() > 32 * 1024 * 1024 { return Err("Project metadata is too large to render safely.".to_string()); }
    let project: Value = serde_json::from_str(&project_json).map_err(|error| format!("Project data is invalid: {error}"))?;
    let ffmpeg = ffmpeg_binary(&app).ok_or_else(|| "FFmpeg was not found. Configure ffmpeg.exe in AI Model Manager.".to_string())?;
    let duration = project_duration(&project);
    if !duration.is_finite() || duration <= 0.02 { return Err("Add a clip to the timeline before exporting.".to_string()); }
    if duration > 8.0 * 60.0 * 60.0 { return Err("Timeline exceeds the 8-hour export safety limit.".to_string()); }
    if !(144..=7680).contains(&options.width) || !(144..=7680).contains(&options.height) { return Err("Export dimensions must be between 144 and 7680 pixels.".to_string()); }
    if !options.fps.is_finite() || !(1.0..=120.0).contains(&options.fps) { return Err("Export frame rate must be between 1 and 120 FPS.".to_string()); }
    let codec = output_video_codec(&options.codec)?;
    let allowed_bitrates = ["6000k", "10000k", "16000k", "25000k"];
    if !allowed_bitrates.contains(&options.video_bitrate.as_str()) { return Err("Unsupported video bitrate preset.".to_string()); }
    let output = PathBuf::from(output_path);
    if output.extension().and_then(|value| value.to_str()).map(|value| !value.eq_ignore_ascii_case("mp4")).unwrap_or(true) {
        return Err("The export destination must use the .mp4 extension.".to_string());
    }
    let (assets, input_indexes) = collect_input_assets(&project)?;
    let output_abs = output.canonicalize().ok();
    for (_, source) in &assets {
        let input_abs = source.canonicalize().ok();
        if output_abs.is_some() && input_abs == output_abs { return Err("Export destination cannot overwrite an original source file.".to_string()); }
        if let (Some(parent), Some(input)) = (output.parent(), source.file_name()) {
            if parent.join(input) == output { return Err("Export destination cannot overwrite an original source file.".to_string()); }
        }
    }
    if let Some(parent) = output.parent() {
        if !parent.exists() { return Err(format!("The export folder does not exist: {}", parent.display())); }
    }
    let subtitle = write_subtitle_file(&project, &std::env::temp_dir())?;
    let (graph, video_label, _audio_label) = filter_complex_for_project(&project, &input_indexes, &options, duration, subtitle.as_ref())?;
    let mut args = vec![
        "-y".to_string(), "-hide_banner".to_string(), "-nostdin".to_string(), "-loglevel".to_string(), "warning".to_string(),
    ];
    for (asset_id, path) in &assets {
        let is_image = project.get("assets").and_then(Value::as_array).into_iter().flatten()
            .find(|asset| json_string(asset.get("id"), "") == asset_id)
            .map(|asset| json_string(asset.get("mediaType"), "") == "image").unwrap_or(false);
        if is_image {
            args.push("-loop".to_string()); args.push("1".to_string());
            args.push("-framerate".to_string()); args.push(format!("{:.3}", options.fps));
        }
        args.push("-i".to_string()); args.push(path.to_string_lossy().to_string());
    }
    args.extend([
        "-filter_complex".to_string(), graph,
        "-map".to_string(), format!("[{video_label}]"),
        "-map".to_string(), "[aout]".to_string(),
        "-c:v".to_string(), codec.to_string(), "-preset".to_string(), "veryfast".to_string(),
        "-b:v".to_string(), options.video_bitrate,
        "-r".to_string(), format!("{:.3}", options.fps), "-pix_fmt".to_string(), "yuv420p".to_string(),
        "-c:a".to_string(), "aac".to_string(), "-b:a".to_string(), "192k".to_string(),
        "-t".to_string(), fmt_num(duration), "-movflags".to_string(), "+faststart".to_string(),
        "-progress".to_string(), "pipe:1".to_string(), "-nostats".to_string(),
        output.to_string_lossy().to_string(),
    ]);
    let mut child = Command::new(&ffmpeg).args(&args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()
        .map_err(|error| format!("Could not start FFmpeg: {error}"))?;
    let stderr = child.stderr.take().ok_or_else(|| "Could not read FFmpeg diagnostics.".to_string())?;
    let stderr_thread = thread::spawn(move || {
        let mut reader = BufReader::new(stderr);
        let mut text = String::new();
        let _ = reader.read_to_string(&mut text);
        text
    });
    let stdout = child.stdout.take().ok_or_else(|| "Could not read FFmpeg progress.".to_string())?;
    let mut progress_reader = BufReader::new(stdout);
    let mut line = String::new();
    let mut out_time = 0.0f64;
    let _ = app.emit("export-progress", json!({ "status": "Rendering locally…", "percent": 0.0, "outTime": "Starting FFmpeg" }));
    loop {
        line.clear();
        let bytes = progress_reader.read_line(&mut line).map_err(|error| format!("Could not read FFmpeg progress: {error}"))?;
        if bytes == 0 { break; }
        if let Some(value) = line.trim().strip_prefix("out_time_ms=") {
            if let Ok(micros) = value.parse::<f64>() { out_time = micros / 1_000_000.0; }
            let percent = (out_time / duration * 100.0).clamp(0.0, 99.0);
            let _ = app.emit("export-progress", json!({ "status": "Rendering locally…", "percent": percent, "outTime": format!("{} / {}", format_seconds(out_time), format_seconds(duration)) }));
        }
    }
    let status = child.wait().map_err(|error| format!("Could not wait for FFmpeg: {error}"))?;
    let diagnostics = stderr_thread.join().unwrap_or_else(|_| "FFmpeg diagnostic thread failed.".to_string());
    if !status.success() {
        if let Some((subtitle_path, _, _)) = &subtitle { let _ = fs::remove_file(subtitle_path); }
        let excerpt = if diagnostics.len() > 6000 { &diagnostics[diagnostics.len() - 6000..] } else { &diagnostics };
        return Err(format!("FFmpeg export failed (exit {:?}).\n{}", status.code(), excerpt.trim()));
    }
    if let Some((subtitle_path, _, _)) = &subtitle { let _ = fs::remove_file(subtitle_path); }
    let metadata = fs::metadata(&output).map_err(|error| format!("FFmpeg exited successfully but the MP4 was not created: {error}"))?;
    if metadata.len() == 0 { return Err("FFmpeg created an empty MP4 file.".to_string()); }
    let result = ExportResult { path: output.to_string_lossy().to_string(), bytes: metadata.len(), duration };
    let _ = app.emit("export-progress", json!({ "status": "Export complete", "percent": 100.0, "outTime": result.path }));
    Ok(result)
}

fn format_seconds(value: f64) -> String {
    let seconds = value.max(0.0) as u64;
    format!("{:02}:{:02}", seconds / 60, seconds % 60)
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_backend_status, get_model_status, set_model_path,
            pick_media_files, pick_project_file, choose_project_save_path, choose_export_path,
            pick_model_or_runtime_file, read_project_file, write_project_file,
            probe_media, analyze_silence, detect_scenes, transcribe_media,
            download_model, generate_local_plan, export_timeline,
        ])
        .run(tauri::generate_context!())
        .expect("NEXUS VIDEO STUDIO failed to start");
}
