//! Tauri command layer — the only bridge between the webview and the engine.
//!
//! Rules followed by every command:
//!
//! * **no business logic** — commands validate their arguments, call the engine
//!   and translate the result; the engine stays UI independent and testable;
//! * **structured errors** — every failure is returned as a [`UiError`]
//!   (`code`, human message, optional detail, whether retrying makes sense);
//! * **no panics across FFI** — arguments are validated and errors are mapped,
//!   so a malformed request can never take the application down.

pub mod downloads;
pub mod files;
pub mod settings;
pub mod system;

use crate::error::AppError;
use crate::types::UiError;

/// Result type used by every command.
pub type CommandResult<T> = std::result::Result<T, UiError>;

/// Converts an engine error into the structured error the UI understands.
pub fn to_ui(error: AppError) -> UiError {
    error.to_ui()
}

/// Convenience wrapper so commands can use `?` on engine results.
pub trait IntoUi<T> {
    fn ui(self) -> CommandResult<T>;
}

impl<T> IntoUi<T> for crate::error::Result<T> {
    fn ui(self) -> CommandResult<T> {
        self.map_err(to_ui)
    }
}

/// Validates that a string is a usable, absolute filesystem path.
///
/// The frontend is untrusted input: an empty or relative path must never reach
/// the file manager.
pub fn validate_dir(value: &str, field: &str) -> CommandResult<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(UiError {
            code: "invalid_path".into(),
            message: format!("{field} cannot be empty."),
            detail: None,
            retryable: false,
        });
    }
    let path = std::path::Path::new(trimmed);
    if !path.is_absolute() {
        return Err(UiError {
            code: "invalid_path".into(),
            message: format!("{field} must be an absolute path."),
            detail: Some(trimmed.to_string()),
            retryable: false,
        });
    }
    Ok(trimmed.to_string())
}
