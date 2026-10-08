//! Thin, isolated wrappers around the platform-facing plugins and the Windows
//! APIs SwiftLoad uses directly.
//!
//! Everything the application needs from the operating system goes through this
//! module, which keeps the engine free of UI/OS dependencies and gives one place
//! to audit the security-relevant calls:
//!
//! * opening a file / revealing it in Explorer — never *executes* a download,
//!   it hands the path to Windows exactly like Explorer would;
//! * desktop notifications;
//! * the folder/file pickers;
//! * auto-start registration (HKCU Run key, no elevation);
//! * the optional `swiftload:` URL handler ("Download with SwiftLoad"), written
//!   under `HKCU\Software\Classes` so that it needs no administrator rights and
//!   can be removed again at any time.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::error::AppError;

/// Registry key holding the optional URL protocol handler.
#[cfg(windows)]
pub const URL_SCHEME: &str = "swiftload";

/// Opens a file with its default application.
pub fn open_file(app: &AppHandle, path: &Path) -> Result<(), AppError> {
    ensure_exists(path)?;
    tauri_plugin_opener::OpenerExt::opener(app)
        .open_path(path.to_string_lossy().to_string(), None::<Vec<&str>>)
        .map_err(|e| AppError::Io(format!("could not open {path:?}: {e}")))
}

/// Opens an Explorer window with the file selected.
pub fn reveal_in_folder(app: &AppHandle, path: &Path) -> Result<(), AppError> {
    if path.exists() {
        tauri_plugin_opener::OpenerExt::opener(app)
            .reveal_item_in_dir(path)
            .map_err(|e| AppError::Io(format!("could not reveal {path:?}: {e}")))?;
        return Ok(());
    }
    // Fall back to the containing folder, which may still exist.
    match path.parent() {
        Some(parent) if parent.is_dir() => open_directory(app, parent),
        _ => Err(AppError::NotFound(format!("{path:?}"))),
    }
}

/// Opens a folder in Explorer.
pub fn open_directory(app: &AppHandle, path: &Path) -> Result<(), AppError> {
    if !path.is_dir() {
        return Err(AppError::NotFound(format!("folder {path:?}")));
    }
    tauri_plugin_opener::OpenerExt::opener(app)
        .open_path(path.to_string_lossy().to_string(), None::<Vec<&str>>)
        .map_err(|e| AppError::Io(format!("could not open {path:?}: {e}")))
}

/// Opens an http(s) link in the default browser.
pub fn open_url(app: &AppHandle, url: &str) -> Result<(), AppError> {
    let parsed = crate::net::validate_url(url)?;
    tauri_plugin_opener::OpenerExt::opener(app)
        .open_url(parsed.to_string(), None::<Vec<&str>>)
        .map_err(|e| AppError::Io(format!("could not open the link: {e}")))
}

/// Shows a desktop notification. Failure is not an error the user must see.
pub fn notify(app: &AppHandle, title: &str, body: &str) -> Result<(), AppError> {
    use tauri_plugin_notification::NotificationExt;
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| AppError::Io(format!("notification failed: {e}")))
}

fn ensure_exists(path: &Path) -> Result<(), AppError> {
    if path.exists() {
        Ok(())
    } else {
        Err(AppError::NotFound(format!("{path:?}")))
    }
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

/// Native folder picker. Returns `None` when the user cancels.
pub async fn pick_folder(app: AppHandle, start: Option<PathBuf>, title: &str) -> Option<PathBuf> {
    let title = title.to_string();
    // The blocking dialog API must not run on the main thread: Tauri's async
    // command handlers run on a worker thread, and the blocking pool guarantees
    // we never block the UI thread while the dialog is open.
    tauri::async_runtime::spawn_blocking(move || {
        use tauri_plugin_dialog::DialogExt;
        let mut builder = app.dialog().file().set_title(title);
        if let Some(dir) = start.filter(|dir| dir.is_dir()) {
            builder = builder.set_directory(dir);
        }
        builder
            .blocking_pick_folder()
            .and_then(|path| path.into_path().ok())
    })
    .await
    .ok()
    .flatten()
}

/// "Save as" picker used by the New Download dialog.
pub async fn pick_save_path(
    app: AppHandle,
    start_dir: Option<PathBuf>,
    default_name: Option<String>,
    title: &str,
) -> Option<PathBuf> {
    let title = title.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        use tauri_plugin_dialog::DialogExt;
        let mut builder = app.dialog().file().set_title(title);
        if let Some(dir) = start_dir.filter(|dir| dir.is_dir()) {
            builder = builder.set_directory(dir);
        }
        if let Some(name) = default_name.filter(|name| !name.trim().is_empty()) {
            builder = builder.set_file_name(name);
        }
        builder
            .blocking_save_file()
            .and_then(|path| path.into_path().ok())
    })
    .await
    .ok()
    .flatten()
}

// ---------------------------------------------------------------------------
// Auto-start
// ---------------------------------------------------------------------------

pub fn autostart_enabled(app: &AppHandle) -> bool {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().unwrap_or(false)
}

pub fn set_autostart(app: &AppHandle, enabled: bool) -> Result<(), AppError> {
    use tauri_plugin_autostart::ManagerExt;
    let manager = app.autolaunch();
    let result = if enabled {
        manager.enable()
    } else {
        manager.disable()
    };
    result.map_err(|e| AppError::Io(format!("could not change the auto-start setting: {e}")))
}

// ---------------------------------------------------------------------------
// Clipboard
// ---------------------------------------------------------------------------

/// Reads the clipboard and returns it when it looks like a download URL.
///
/// This is the only clipboard access in the application: it happens when the
/// user asks for it (New Download dialog, or clipboard monitoring if enabled)
/// and the text is never sent anywhere — it only pre-fills a field.
pub fn clipboard_url(app: &AppHandle) -> Option<String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    let text = app.clipboard().read_text().ok()?;
    let candidate = text.trim();
    if candidate.is_empty() || candidate.len() > crate::net::MAX_URL_LEN {
        return None;
    }
    // Only accept text that is a single URL and nothing else.
    if candidate.split_whitespace().count() != 1 {
        return None;
    }
    match crate::net::validate_url(candidate) {
        Ok(url) => Some(url.to_string()),
        Err(_) => None,
    }
}

// ---------------------------------------------------------------------------
// Optional browser integration ("Download with SwiftLoad")
// ---------------------------------------------------------------------------

/// `true` when the `swiftload:` handler is registered for the current user.
pub fn integration_registered() -> bool {
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::Registry::{RegOpenKeyExW, HKEY_CURRENT_USER, KEY_READ};
        let subkey = wide(&format!("Software\\Classes\\{URL_SCHEME}"));
        let mut handle = std::ptr::null_mut();
        let status = unsafe {
            RegOpenKeyExW(
                HKEY_CURRENT_USER,
                subkey.as_ptr(),
                0,
                KEY_READ,
                &mut handle,
            )
        };
        if status == 0 {
            unsafe {
                windows_sys::Win32::System::Registry::RegCloseKey(handle);
            }
            return true;
        }
        false
    }
    #[cfg(not(windows))]
    {
        false
    }
}

/// Registers `swiftload:<url>` for the current user.
///
/// Deliberately *not* an HTTP/HTTPS interception: SwiftLoad never becomes the
/// default browser and never touches another application's settings. A page or
/// an application can hand a URL over explicitly with
/// `swiftload:https://example.com/file.zip`.
pub fn register_integration(executable: &Path) -> Result<(), AppError> {
    #[cfg(windows)]
    {
        let exe = executable.to_string_lossy().to_string();
        if !executable.exists() {
            return Err(AppError::NotFound(format!(
                "the application executable {exe} was not found"
            )));
        }
        let base = format!("Software\\Classes\\{URL_SCHEME}");
        write_registry_string(HKEY_CURRENT_USER_LOCAL, &base, None, "URL:SwiftLoad download link")?;
        write_registry_string(HKEY_CURRENT_USER_LOCAL, &base, Some("URL Protocol"), "")?;
        let command = format!("\"{exe}\" \"%1\"");
        write_registry_string(
            HKEY_CURRENT_USER_LOCAL,
            &format!("{base}\\shell\\open\\command"),
            None,
            &command,
        )?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = executable;
        Err(AppError::Server(
            "URL handler registration is only implemented on Windows".into(),
        ))
    }
}

/// Removes the `swiftload:` handler again.
pub fn unregister_integration() -> Result<(), AppError> {
    #[cfg(windows)]
    {
        let subkey = wide(&format!("Software\\Classes\\{URL_SCHEME}"));
        let status = unsafe {
            windows_sys::Win32::System::Registry::RegDeleteTreeW(
                HKEY_CURRENT_USER_LOCAL,
                subkey.as_ptr(),
            )
        };
        if status == 0 || status == 2 {
            // 0 = removed, 2 = ERROR_FILE_NOT_FOUND (already gone).
            Ok(())
        } else {
            Err(AppError::Io(format!(
                "could not remove the URL handler (Windows error {status})"
            )))
        }
    }
    #[cfg(not(windows))]
    {
        Ok(())
    }
}

/// Extracts a download URL from a command line argument produced by the
/// `swiftload:` handler (`swiftload:https://…`, `swiftload://https://…`).
pub fn url_from_command_line(argument: &str) -> Option<String> {
    let trimmed = argument.trim().trim_matches('"');
    let lower = trimmed.to_ascii_lowercase();
    let prefix = format!("{URL_SCHEME}:");
    if !lower.starts_with(&prefix) {
        return None;
    }
    let mut rest = &trimmed[prefix.len()..];
    // Tolerate `swiftload://https://…` and `swiftload:?url=…` shapes as well.
    rest = rest.trim_start_matches('/');
    if let Some(stripped) = rest.strip_prefix('?') {
        if let Some(encoded) = stripped
            .split('&')
            .find_map(|pair| pair.strip_prefix("url="))
        {
            let decoded = percent_encoding::percent_decode_str(encoded)
                .decode_utf8_lossy()
                .to_string();
            return crate::net::validate_url(&decoded).ok().map(|u| u.to_string());
        }
        return None;
    }
    crate::net::validate_url(rest).ok().map(|u| u.to_string())
}

#[cfg(windows)]
const HKEY_CURRENT_USER_LOCAL: windows_sys::Win32::System::Registry::HKEY = 0x8000_0001u32 as _;

#[cfg(windows)]
fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(windows)]
fn write_registry_string(
    root: windows_sys::Win32::System::Registry::HKEY,
    subkey: &str,
    name: Option<&str>,
    value: &str,
) -> Result<(), AppError> {
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyExW, RegSetValueExW, KEY_WRITE, REG_SZ,
    };

    let subkey = wide(subkey);
    let mut handle = std::ptr::null_mut();
    let status = unsafe {
        RegCreateKeyExW(
            root,
            subkey.as_ptr(),
            0,
            std::ptr::null(),
            0,
            KEY_WRITE,
            std::ptr::null(),
            &mut handle,
            std::ptr::null_mut(),
        )
    };
    if status != 0 {
        return Err(AppError::Io(format!(
            "could not create the registry key (Windows error {status})"
        )));
    }

    let name_wide = name.map(wide);
    let data: Vec<u16> = value.encode_utf16().chain(std::iter::once(0)).collect();
    let bytes = data.len() * 2;
    let status = unsafe {
        RegSetValueExW(
            handle,
            name_wide.as_ref().map(|n| n.as_ptr()).unwrap_or(std::ptr::null()),
            0,
            REG_SZ,
            data.as_ptr() as *const u8,
            bytes as u32,
        )
    };
    unsafe {
        RegCloseKey(handle);
    }
    if status != 0 {
        return Err(AppError::Io(format!(
            "could not write the registry value (Windows error {status})"
        )));
    }
    Ok(())
}

/// Application executable path (used for the URL handler command line).
pub fn executable_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    std::env::current_exe()
        .map_err(|e| AppError::Io(format!("could not determine the executable path: {e}")))
        .or_else(|_| {
            app.path()
                .app_config_dir()
                .map_err(|e| AppError::Io(e.to_string()))
                .map(|_| PathBuf::new())
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_urls_from_the_command_line() {
        assert_eq!(
            url_from_command_line("swiftload:https://example.com/file.zip"),
            Some("https://example.com/file.zip".to_string())
        );
        assert_eq!(
            url_from_command_line("\"swiftload:https://example.com/a.zip?x=1\""),
            Some("https://example.com/a.zip?x=1".to_string())
        );
        assert_eq!(
            url_from_command_line("swiftload://https://example.com/b.zip"),
            Some("https://example.com/b.zip".to_string())
        );
        assert_eq!(
            url_from_command_line("swiftload:?url=https%3A%2F%2Fexample.com%2Fc.zip"),
            Some("https://example.com/c.zip".to_string())
        );
        // Anything that is not one of our links is ignored.
        assert_eq!(url_from_command_line("https://example.com/file.zip"), None);
        assert_eq!(url_from_command_line("swiftload:"), None);
        assert_eq!(url_from_command_line("swiftload:not-a-url"), None);
        assert_eq!(url_from_command_line("--flag"), None);
    }
}
