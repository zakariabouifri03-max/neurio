//! File and path commands: opening downloads, deleting them, and the pickers
//! used by the settings and the New Download dialog.

use std::path::PathBuf;

use tauri::{AppHandle, State};

use super::{validate_dir, CommandResult, IntoUi};
use crate::engine::files;
use crate::platform;
use crate::types::UiError;
use crate::AppState;

/// Opens the downloaded file with the default application.
///
/// SwiftLoad never *executes* a download itself: it hands the path to Windows,
/// exactly like double-clicking the file in Explorer would.
#[tauri::command]
pub async fn file_open(app: AppHandle, state: State<'_, AppState>, id: String) -> CommandResult<()> {
    let path = state.engine.file_path_of(&id).ui()?;
    platform::open_file(&app, &path).map_err(|e| e.to_ui())
}

/// Opens the folder that contains the downloaded file.
#[tauri::command]
pub async fn file_open_folder(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> CommandResult<()> {
    let record = state.engine.get(&id).ui()?;
    let file = PathBuf::from(&record.file_path);
    if file.exists() {
        platform::reveal_in_folder(&app, &file).map_err(|e| e.to_ui())
    } else {
        // The file is still downloading: open the folder it will land in.
        let folder = state.engine.folder_path_of(&id).ui()?;
        platform::open_directory(&app, &folder).map_err(|e| e.to_ui())
    }
}

/// Deletes the finished file of a download. Always an explicit user action.
#[tauri::command]
pub async fn file_delete(state: State<'_, AppState>, id: String) -> CommandResult<()> {
    let record = state.engine.get(&id).ui()?;
    state
        .engine
        .delete_downloaded_file(&record)
        .ui()
}

/// Opens an arbitrary folder in Explorer, after checking that it exists and is
/// a directory. Used by “Open download folder” and the Advanced settings.
#[tauri::command]
pub async fn path_open_dir(
    app: AppHandle,
    state: State<'_, AppState>,
    dir: String,
) -> CommandResult<()> {
    let raw = validate_dir(&dir, "Folder")?;
    let path = PathBuf::from(&raw);
    if !path.is_dir() {
        return Err(UiError {
            code: "not_found".into(),
            message: format!("{raw} is not a folder that exists."),
            detail: None,
            retryable: false,
        });
    }
    state.logger.debug(
        crate::logging::Category::File,
        None,
        format!("opening folder {raw}"),
    );
    platform::open_directory(&app, &path).map_err(|e| e.to_ui())
}

/// Reports whether the finished file still exists on disk.
#[tauri::command]
pub async fn file_exists(state: State<'_, AppState>, id: String) -> CommandResult<bool> {
    let record = state.engine.get(&id).ui()?;
    Ok(PathBuf::from(&record.file_path).is_file())
}

/// Native folder picker; returns `null` when the user cancels.
#[tauri::command]
pub async fn path_pick_folder(
    app: AppHandle,
    state: State<'_, AppState>,
    start: Option<String>,
) -> CommandResult<Option<String>> {
    let start = match start {
        Some(value) if !value.trim().is_empty() => Some(PathBuf::from(value)),
        _ => Some(state.engine.settings_snapshot().default_download_dir_path()),
    };
    let picked = platform::pick_folder(app, start, "Choose a download folder").await;
    Ok(picked.map(|path| path.to_string_lossy().to_string()))
}

/// "Save as" picker; accepts either a folder or a full file name.
#[tauri::command]
pub async fn path_pick_save_file(
    app: AppHandle,
    state: State<'_, AppState>,
    start_dir: Option<String>,
    default_name: Option<String>,
) -> CommandResult<Option<String>> {
    let start = start_dir
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .or_else(|| Some(state.engine.settings_snapshot().default_download_dir_path()));
    let picked = platform::pick_save_path(app, start, default_name, "Save the download as").await;
    Ok(picked.map(|path| path.to_string_lossy().to_string()))
}

/// The configured default download folder.
#[tauri::command]
pub async fn path_default_download(state: State<'_, AppState>) -> CommandResult<String> {
    Ok(state
        .engine
        .settings_snapshot()
        .general
        .default_download_dir
        .clone())
}

/// Free space on the volume that holds `dir` (bytes), when the OS reports it.
#[tauri::command]
pub async fn path_free_space(state: State<'_, AppState>, dir: String) -> CommandResult<Option<u64>> {
    let dir = validate_dir(&dir, "Folder")?;
    let path = PathBuf::from(dir);
    if !path.is_dir() {
        return Err(UiError {
            code: "not_found".into(),
            message: format!("{} is not an existing folder.", path.display()),
            detail: None,
            retryable: false,
        });
    }
    Ok(files::available_space(&path))
}

/// Opens the folder holding the log files.
#[tauri::command]
pub async fn path_open_logs(app: AppHandle, state: State<'_, AppState>) -> CommandResult<()> {
    let dir = state.logger.dir().to_path_buf();
    std::fs::create_dir_all(&dir)
        .map_err(|e| crate::error::AppError::Disk(format!("cannot create {dir:?}: {e}")))
        .ui()?;
    platform::open_directory(&app, &dir).map_err(|e| e.to_ui())
}

/// Opens the application data folder (database, logs, partial downloads).
#[tauri::command]
pub async fn path_open_data_dir(app: AppHandle, state: State<'_, AppState>) -> CommandResult<()> {
    let dir = state.paths.data_dir.clone();
    platform::open_directory(&app, &dir).map_err(|e| e.to_ui())
}

/// Verifies a folder before the user commits to it (New Download dialog).
#[tauri::command]
pub async fn path_check_folder(dir: String) -> CommandResult<()> {
    let dir = validate_dir(&dir, "Save to")?;
    crate::paths::AppPaths::verify_target_dir(std::path::Path::new(&dir)).ui()
}
