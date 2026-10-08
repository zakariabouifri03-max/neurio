//! SwiftLoad — lightweight professional download manager.
//!
//! This crate is both the Tauri application (`src/main.rs` calls [`run`]) and a
//! normal library, so the download engine can be tested and driven without a
//! webview (`tests/engine.rs`).
//!
//! Layering, from the inside out:
//!
//! ```text
//! net::HttpClient      transport: URL validation, TLS, proxies, probe
//! engine::*            policy: queue, ranges, resume, retry, integrity, limits
//! db::Database         persistence: SQLite (WAL), downloads / history / settings
//! commands::*          Tauri IPC surface (this file wires it together)
//! src/ (TypeScript)    the UI, which only ever sees the command + event API
//! ```

pub mod commands;
pub mod db;
pub mod engine;
pub mod error;
pub mod logging;
pub mod net;
pub mod paths;
pub mod platform;
pub mod settings;
pub mod types;
pub mod util;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter, Manager, RunEvent};

use crate::db::Database;
use crate::engine::{Engine, EngineEvent, EventSink};
use crate::logging::{Category, Level, Logger};
use crate::paths::AppPaths;
use crate::settings::AppSettings;

/// Shared application state handed to every command.
pub struct AppState {
    pub engine: Arc<Engine>,
    pub db: Arc<Database>,
    pub logger: Logger,
    pub paths: Arc<AppPaths>,
    /// URLs received from the `swiftload:` handler before the UI asked for them.
    pending_urls: Mutex<Vec<String>>,
}

impl AppState {
    pub fn push_url(&self, url: String) {
        let mut pending = util::lock(&self.pending_urls);
        if !pending.contains(&url) {
            pending.push(url);
        }
    }

    pub fn take_pending_urls(&self) -> Vec<String> {
        std::mem::take(&mut *util::lock(&self.pending_urls))
    }
}

/// Bridges engine events to the frontend (and to Windows notifications).
struct TauriSink {
    app: AppHandle,
}

impl EventSink for TauriSink {
    fn emit(&self, event: EngineEvent) {
        // Event payloads are plain serde structures; a failing emit (window
        // already closed) must never break the download engine.
        match event {
            EngineEvent::Records(records) => {
                let _ = self.app.emit("downloads:list", records);
            }
            EngineEvent::Record(record) => {
                let _ = self.app.emit("downloads:record", record);
            }
            EngineEvent::Removed { id } => {
                let _ = self.app.emit("downloads:removed", id);
            }
            EngineEvent::Progress(progress) => {
                let _ = self.app.emit("downloads:progress", progress);
            }
            EngineEvent::Stats(stats) => {
                let _ = self.app.emit("downloads:stats", stats);
            }
            EngineEvent::Notify { title, body } => {
                let _ = platform::notify(&self.app, &title, &body);
            }
            EngineEvent::FocusWindow => {
                if let Some(window) = self.app.get_webview_window("main") {
                    let _ = window.set_focus();
                    let _ = window.unminimize();
                }
            }
        }
    }
}

/// Builds and runs the application.
pub fn run() {
    let builder = tauri::Builder::default()
        // Must be registered first: it decides whether this process is the
        // primary instance before any other plugin starts up.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            let mut received = false;
            for argument in argv.iter() {
                if let Some(url) = platform::url_from_command_line(argument) {
                    receive_url(app, url);
                    received = true;
                }
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
            if !received {
                if let Some(state) = app.try_state::<AppState>() {
                    state
                        .logger
                        .debug(Category::App, None, "second instance forwarded its arguments");
                }
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .setup(|app| {
            let handle = app.handle().clone();

            // --- paths, database, settings, logger ---------------------------
            let data_dir = resolve_data_dir(&handle);
            let config_dir = handle
                .path()
                .app_config_dir()
                .unwrap_or_else(|_| data_dir.clone());
            let default_downloads = handle
                .path()
                .download_dir()
                .unwrap_or_else(|_| data_dir.join("Downloads"));
            let paths = Arc::new(AppPaths::resolve(data_dir, config_dir, default_downloads)?);

            let logger = Logger::new(paths.log_dir.clone(), Level::Info);
            logger.info(
                Category::App,
                None,
                format!(
                    "SwiftLoad {} starting (os {}, arch {})",
                    env!("CARGO_PKG_VERSION"),
                    std::env::consts::OS,
                    std::env::consts::ARCH
                ),
            );

            let db = Arc::new(Database::open(&paths.db_path)?);
            let settings = AppSettings::load(&db, &logger, &paths.default_download_dir)?;
            logger.set_min_level(settings.advanced.log_level);
            logger.debug(
                Category::Settings,
                None,
                format!(
                    "settings loaded (theme {:?}, max concurrent {}, connections {})",
                    settings.general.theme,
                    settings.downloads.max_concurrent,
                    settings.downloads.connections_per_download
                ),
            );

            // --- engine ------------------------------------------------------
            let engine = Engine::new(
                db.clone(),
                logger.clone(),
                settings,
                Arc::new(TauriSink { app: handle.clone() }),
            )?;
            engine.initialize()?;

            app.manage(AppState {
                engine: engine.clone(),
                db,
                logger: logger.clone(),
                paths,
                pending_urls: Mutex::new(Vec::new()),
            });

            // --- URLs that started this process (file association / CLI) -----
            for argument in std::env::args().skip(1) {
                if let Some(url) = platform::url_from_command_line(&argument) {
                    receive_url(&handle, url);
                }
            }

            // --- engine dispatcher ------------------------------------------
            tauri::async_runtime::spawn(engine.clone().run());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // downloads
            commands::downloads::download_list,
            commands::downloads::download_get,
            commands::downloads::download_progress,
            commands::downloads::download_progress_all,
            commands::downloads::download_stats,
            commands::downloads::download_probe,
            commands::downloads::download_add,
            commands::downloads::download_start,
            commands::downloads::download_pause,
            commands::downloads::download_resume,
            commands::downloads::download_cancel,
            commands::downloads::download_retry,
            commands::downloads::download_restart,
            commands::downloads::download_remove,
            commands::downloads::download_move_up,
            commands::downloads::download_move_down,
            commands::downloads::download_reorder,
            commands::downloads::download_start_all,
            commands::downloads::download_pause_all,
            commands::downloads::download_remove_finished,
            commands::downloads::download_set_speed_limit,
            commands::downloads::history_list,
            commands::downloads::history_delete,
            commands::downloads::history_clear,
            // files & paths
            commands::files::file_open,
            commands::files::file_open_folder,
            commands::files::file_delete,
            commands::files::file_exists,
            commands::files::path_pick_folder,
            commands::files::path_pick_save_file,
            commands::files::path_default_download,
            commands::files::path_free_space,
            commands::files::path_open_logs,
            commands::files::path_open_data_dir,
            commands::files::path_check_folder,
            commands::files::path_open_dir,
            // settings & logs
            commands::settings::settings_get,
            commands::settings::settings_update,
            commands::settings::settings_reset,
            commands::settings::logs_list,
            commands::settings::logs_clear,
            commands::settings::logs_current_file,
            commands::settings::logs_open_dir,
            commands::settings::logs_write,
            // system
            commands::system::app_info,
            commands::system::app_diagnostics,
            commands::system::clipboard_detect_url,
            commands::system::integration_status,
            commands::system::integration_set,
            commands::system::app_open_url,
            commands::system::app_take_launch_urls,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build the SwiftLoad application")
        .run(|app_handle, event| {
            if let RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<AppState>() {
                    state
                        .logger
                        .info(Category::App, None, "SwiftLoad is shutting down");
                    // Pauses and checkpoints every running download before the
                    // process disappears, so nothing has to be recovered later.
                    state.engine.shutdown();
                    state.logger.flush();
                }
            }
        });
}

/// Stores a URL that arrived from outside and tells the UI about it.
fn receive_url(app: &AppHandle, url: String) {
    if let Some(state) = app.try_state::<AppState>() {
        state.push_url(url.clone());
    }
    let _ = app.emit("app:launch-url", url);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// `%LOCALAPPDATA%\SwiftLoad` on Windows, the Tauri per-user data directory
/// everywhere else. Nothing is ever written to the installation folder.
fn resolve_data_dir(app: &AppHandle) -> PathBuf {
    if let Some(base) = std::env::var_os("LOCALAPPDATA") {
        if !base.is_empty() {
            return PathBuf::from(base).join("SwiftLoad");
        }
    }
    app.path()
        .app_local_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("SwiftLoad"))
}
