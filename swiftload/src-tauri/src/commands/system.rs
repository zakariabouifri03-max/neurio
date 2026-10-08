//! Application-level commands: metadata, diagnostics, auto-start, clipboard
//! detection and the optional `swiftload:` URL handler.

use serde::Serialize;
use tauri::{AppHandle, State};

use super::{CommandResult, IntoUi};
use crate::platform;
use crate::AppState;

/// Static application metadata for the About panel and the diagnostics view.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub tauri_version: String,
    pub engine_version: String,
    pub os: String,
    pub arch: String,
    pub data_dir: String,
    pub log_dir: String,
    pub database_path: String,
    pub default_download_dir: String,
    pub autostart_enabled: bool,
    pub integration_registered: bool,
    pub executable: String,
}

#[tauri::command]
pub async fn app_info(app: AppHandle, state: State<'_, AppState>) -> CommandResult<AppInfo> {
    let settings = state.engine.settings_snapshot();
    Ok(AppInfo {
        name: "SwiftLoad".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        tauri_version: tauri::VERSION.to_string(),
        engine_version: env!("CARGO_PKG_VERSION").to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        data_dir: state.paths.data_dir.to_string_lossy().to_string(),
        log_dir: state.logger.dir().to_string_lossy().to_string(),
        database_path: state.paths.db_path.to_string_lossy().to_string(),
        default_download_dir: settings.general.default_download_dir.clone(),
        autostart_enabled: platform::autostart_enabled(&app),
        integration_registered: platform::integration_registered(),
        executable: std::env::current_exe()
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_default(),
    })
}

/// Live diagnostics: queue counters, database health, partial data on disk.
#[tauri::command]
pub async fn app_diagnostics(state: State<'_, AppState>) -> CommandResult<serde_json::Value> {
    let mut value = state.engine.diagnostics();
    let integrity = state
        .db
        .integrity_check()
        .unwrap_or_else(|error| format!("unavailable: {error}"));
    if let Some(object) = value.as_object_mut() {
        object.insert("integrity".into(), serde_json::Value::String(integrity));
        object.insert(
            "logFilesEnabled".into(),
            serde_json::Value::Bool(state.logger.files_enabled()),
        );
        object.insert(
            "maxConcurrent".into(),
            serde_json::json!(state.engine.settings_snapshot().downloads.max_concurrent),
        );
    }
    Ok(value)
}

/// `true` when the clipboard currently holds a download URL.
#[tauri::command]
pub async fn clipboard_detect_url(app: AppHandle) -> CommandResult<Option<String>> {
    Ok(platform::clipboard_url(&app))
}

/// Whether the `swiftload:` URL handler is registered for this user.
#[tauri::command]
pub async fn integration_status() -> CommandResult<bool> {
    Ok(platform::integration_registered())
}

/// Registers or removes the `swiftload:` handler ("Download with SwiftLoad").
///
/// This never touches HTTP/HTTPS associations, never installs a browser
/// extension and never runs with administrator rights: it writes one key under
/// `HKCU\Software\Classes` for the current user only.
#[tauri::command]
pub async fn integration_set(enabled: bool) -> CommandResult<bool> {
    if enabled {
        let executable = std::env::current_exe()
            .map_err(|e| crate::error::AppError::Io(format!("cannot locate the executable: {e}")))
            .ui()?;
        platform::register_integration(&executable).map_err(|e| e.to_ui())?;
    } else {
        platform::unregister_integration().map_err(|e| e.to_ui())?;
    }
    Ok(platform::integration_registered())
}

/// Opens an external link in the default browser (About / help links).
#[tauri::command]
pub async fn app_open_url(app: AppHandle, url: String) -> CommandResult<()> {
    platform::open_url(&app, &url).map_err(|e| e.to_ui())
}

/// Returns (and clears) URLs handed to the application through the `swiftload:`
/// handler or as a command-line argument.
#[tauri::command]
pub async fn app_take_launch_urls(state: State<'_, AppState>) -> CommandResult<Vec<String>> {
    Ok(state.take_pending_urls())
}
