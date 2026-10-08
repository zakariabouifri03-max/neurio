//! Download commands: the whole lifecycle, plus statistics and history.

use std::sync::Arc;

use tauri::State;

use super::{validate_dir, CommandResult, IntoUi};
use crate::db::downloads::{HistoryFilter, HistoryScope};
use crate::engine::Engine;
use crate::types::{
    AddDownloadArgs, DownloadRecord, HistoryEntry, ProgressInfo, ProbeResult, UiError,
};
use crate::AppState;

fn engine(state: &State<'_, AppState>) -> Arc<Engine> {
    state.engine.clone()
}

/// Full, ordered download list.
#[tauri::command]
pub async fn download_list(state: State<'_, AppState>) -> CommandResult<Vec<DownloadRecord>> {
    Ok(engine(&state).list())
}

/// One download by id.
#[tauri::command]
pub async fn download_get(
    state: State<'_, AppState>,
    id: String,
) -> CommandResult<DownloadRecord> {
    engine(&state).get(&id).ui()
}

/// Live measurements for one download.
#[tauri::command]
pub async fn download_progress(
    state: State<'_, AppState>,
    id: String,
) -> CommandResult<ProgressInfo> {
    engine(&state).progress(&id).ui()
}

/// Live measurements for every download (used when the UI reconnects).
#[tauri::command]
pub async fn download_progress_all(
    state: State<'_, AppState>,
) -> CommandResult<Vec<crate::engine::DownloadProgress>> {
    Ok(engine(&state).all_progress())
}

/// Dashboard counters.
#[tauri::command]
pub async fn download_stats(
    state: State<'_, AppState>,
) -> CommandResult<crate::types::StatsSnapshot> {
    Ok(engine(&state).stats())
}

/// Probes a URL for the "New Download" dialog: size, range support, filename
/// and whether the target file already exists.
#[tauri::command]
pub async fn download_probe(
    state: State<'_, AppState>,
    url: String,
    dest_dir: Option<String>,
) -> CommandResult<ProbeResult> {
    if let Some(dir) = dest_dir.as_deref() {
        validate_dir(dir, "Save to")?;
    }
    engine(&state)
        .probe(&url, dest_dir.as_deref())
        .await
        .ui()
}

/// Adds a download and (by default) starts it.
#[tauri::command]
pub async fn download_add(
    state: State<'_, AppState>,
    mut args: AddDownloadArgs,
) -> CommandResult<DownloadRecord> {
    if let Some(dir) = args.dest_dir.clone() {
        args.dest_dir = Some(validate_dir(&dir, "Save to")?);
    }
    if let Some(limit) = args.connections {
        if limit == 0 {
            return Err(UiError {
                code: "invalid_argument".into(),
                message: "Connections must be at least 1.".into(),
                detail: None,
                retryable: false,
            });
        }
    }
    engine(&state).add(args).await.ui()
}

#[tauri::command]
pub async fn download_start(
    state: State<'_, AppState>,
    id: String,
) -> CommandResult<DownloadRecord> {
    engine(&state).start(&id).ui()
}

#[tauri::command]
pub async fn download_pause(
    state: State<'_, AppState>,
    id: String,
) -> CommandResult<DownloadRecord> {
    engine(&state).pause(&id).ui()
}

#[tauri::command]
pub async fn download_resume(
    state: State<'_, AppState>,
    id: String,
) -> CommandResult<DownloadRecord> {
    engine(&state).resume(&id).ui()
}

#[tauri::command]
pub async fn download_cancel(
    state: State<'_, AppState>,
    id: String,
) -> CommandResult<DownloadRecord> {
    engine(&state).cancel(&id).await.ui()
}

#[tauri::command]
pub async fn download_retry(
    state: State<'_, AppState>,
    id: String,
) -> CommandResult<DownloadRecord> {
    engine(&state).retry(&id).ui()
}

/// Deletes the partial data and starts the download again from byte zero.
#[tauri::command]
pub async fn download_restart(
    state: State<'_, AppState>,
    id: String,
) -> CommandResult<DownloadRecord> {
    engine(&state).restart(&id).ui()
}

/// Removes a download from the list; `delete_file` also removes the finished
/// file from disk (never done implicitly).
#[tauri::command]
pub async fn download_remove(
    state: State<'_, AppState>,
    id: String,
    delete_file: Option<bool>,
) -> CommandResult<()> {
    engine(&state)
        .remove(&id, delete_file.unwrap_or(false))
        .await
        .ui()
}

#[tauri::command]
pub async fn download_move_up(state: State<'_, AppState>, id: String) -> CommandResult<()> {
    engine(&state).move_up(&id).ui()
}

#[tauri::command]
pub async fn download_move_down(state: State<'_, AppState>, id: String) -> CommandResult<()> {
    engine(&state).move_down(&id).ui()
}

#[tauri::command]
pub async fn download_reorder(
    state: State<'_, AppState>,
    id: String,
    position: u32,
) -> CommandResult<()> {
    engine(&state).reorder_to(&id, position as usize).ui()
}

#[tauri::command]
pub async fn download_start_all(state: State<'_, AppState>) -> CommandResult<()> {
    engine(&state).start_all();
    Ok(())
}

#[tauri::command]
pub async fn download_pause_all(state: State<'_, AppState>) -> CommandResult<()> {
    engine(&state).pause_all();
    Ok(())
}

/// Removes every completed/cancelled download; optionally deletes their files.
#[tauri::command]
pub async fn download_remove_finished(
    state: State<'_, AppState>,
    delete_files: Option<bool>,
) -> CommandResult<u32> {
    engine(&state)
        .remove_finished(delete_files.unwrap_or(false))
        .await
        .ui()
}

/// Per-download speed limit in bytes/second; `null` follows the global setting.
#[tauri::command]
pub async fn download_set_speed_limit(
    state: State<'_, AppState>,
    id: String,
    limit_bps: Option<u64>,
) -> CommandResult<()> {
    if let Some(limit) = limit_bps {
        if limit == 0 {
            return Err(UiError {
                code: "invalid_argument".into(),
                message: "A speed limit of 0 bytes/second is not usable; choose unlimited instead."
                    .into(),
                detail: None,
                retryable: false,
            });
        }
    }
    engine(&state).set_speed_limit(&id, limit_bps).ui()
}

/// Persisted history (Completed / Failed tabs).
#[tauri::command]
pub async fn history_list(
    state: State<'_, AppState>,
    filter: Option<HistoryFilter>,
) -> CommandResult<Vec<HistoryEntry>> {
    let engine = engine(&state);
    engine.history(filter.unwrap_or_default()).ui()
}

#[tauri::command]
pub async fn history_delete(state: State<'_, AppState>, id: String) -> CommandResult<()> {
    engine(&state).history_delete(&id).ui()
}

/// Clears history; `scope` is `all`, `completed` or `failed`.
#[tauri::command]
pub async fn history_clear(
    state: State<'_, AppState>,
    scope: Option<String>,
) -> CommandResult<u64> {
    let scope = match scope.as_deref() {
        Some("completed") => HistoryScope::Completed,
        Some("failed") => HistoryScope::Failed,
        _ => HistoryScope::All,
    };
    engine(&state).history_clear(scope).ui()
}
