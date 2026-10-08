//! Settings and logging commands.

use tauri::{AppHandle, State};

use super::{validate_dir, CommandResult, IntoUi};
use crate::logging::{Level, LogRecord};
use crate::platform;
use crate::settings::AppSettings;
use crate::types::UiError;
use crate::AppState;

/// Current settings (already sanitised and with absolute paths).
#[tauri::command]
pub async fn settings_get(state: State<'_, AppState>) -> CommandResult<AppSettings> {
    Ok(state.engine.settings_snapshot().as_ref().clone())
}

/// Replaces the settings. Values are clamped by the engine before they are
/// stored, and the HTTP client is rebuilt when the network section changed.
#[tauri::command]
pub async fn settings_update(
    app: AppHandle,
    state: State<'_, AppState>,
    settings: AppSettings,
) -> CommandResult<AppSettings> {
    if !settings.general.default_download_dir.trim().is_empty() {
        validate_dir(&settings.general.default_download_dir, "Default download folder")?;
    }
    if !settings.advanced.temp_dir.trim().is_empty() {
        validate_dir(&settings.advanced.temp_dir, "Temporary download folder")?;
    }
    let applied = state.engine.apply_settings(settings).ui()?;
    apply_autostart(&app, &state, applied.general.start_with_windows);
    Ok(applied)
}

/// Restores every setting to its default value.
#[tauri::command]
pub async fn settings_reset(app: AppHandle, state: State<'_, AppState>) -> CommandResult<AppSettings> {
    let defaults = AppSettings {
        general: crate::settings::GeneralSettings {
            default_download_dir: state
                .paths
                .default_download_dir
                .to_string_lossy()
                .to_string(),
            ..AppSettings::default().general
        },
        ..AppSettings::default()
    };
    let applied = state.engine.apply_settings(defaults).ui()?;
    apply_autostart(&app, &state, applied.general.start_with_windows);
    Ok(applied)
}

/// Most recent log records for the Advanced → Logs view, newest first.
#[tauri::command]
pub async fn logs_list(
    state: State<'_, AppState>,
    limit: Option<u32>,
    level: Option<String>,
) -> CommandResult<Vec<LogRecord>> {
    let min_level = level.as_deref().map(Level::parse);
    Ok(state
        .logger
        .recent(limit.unwrap_or(300).min(2_000) as usize, min_level))
}

/// Clears the in-memory log buffer (files are kept for support purposes).
#[tauri::command]
pub async fn logs_clear(state: State<'_, AppState>) -> CommandResult<()> {
    state.logger.clear_ring();
    Ok(())
}

/// Path of the log file written today.
#[tauri::command]
pub async fn logs_current_file(state: State<'_, AppState>) -> CommandResult<String> {
    Ok(state
        .logger
        .current_file()
        .to_string_lossy()
        .to_string())
}

/// Opens the log folder in Explorer.
#[tauri::command]
pub async fn logs_open_dir(app: AppHandle, state: State<'_, AppState>) -> CommandResult<()> {
    let dir = state.logger.dir().to_path_buf();
    std::fs::create_dir_all(&dir)
        .map_err(|e| crate::error::AppError::Disk(format!("cannot create {dir:?}: {e}")))
        .ui()?;
    platform::open_directory(&app, &dir).map_err(|e| e.to_ui())
}

/// Writes a line to the log. Used by the UI for user-triggered diagnostics.
#[tauri::command]
pub async fn logs_write(
    state: State<'_, AppState>,
    message: String,
    level: Option<String>,
) -> CommandResult<()> {
    if message.trim().is_empty() {
        return Err(UiError {
            code: "invalid_argument".into(),
            message: "The log message cannot be empty.".into(),
            detail: None,
            retryable: false,
        });
    }
    let level = level.as_deref().map(Level::parse).unwrap_or(Level::Info);
    state
        .logger
        .log(level, crate::logging::Category::App, None, message);
    Ok(())
}

/// Mirrors the "start with Windows" setting into the real OS autostart entry.
///
/// The preference is stored either way. When the OS refuses the change the
/// reason is logged and [`crate::commands::system::app_info`] keeps reporting
/// the live state, so the Settings screen can tell the user the truth instead
/// of showing a switch that only pretends to be on.
fn apply_autostart(app: &AppHandle, state: &State<'_, AppState>, wanted: bool) {
    if platform::autostart_enabled(app) == wanted {
        return;
    }
    match platform::set_autostart(app, wanted) {
        Ok(()) => state.logger.info(
            crate::logging::Category::App,
            None,
            if wanted {
                "SwiftLoad will start with Windows"
            } else {
                "SwiftLoad will no longer start with Windows"
            },
        ),
        Err(error) => state.logger.warn(
            crate::logging::Category::App,
            None,
            format!("Auto-start could not be changed: {error}"),
        ),
    }
}
