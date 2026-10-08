//! Filesystem locations used by the application.
//!
//! Everything lives under `%LOCALAPPDATA%\SwiftLoad` except the downloaded files
//! themselves, which the user chooses. Nothing is written to the registry, to
//! the installation directory, or anywhere else that would require elevation.

use std::path::{Path, PathBuf};

use crate::error::{AppError, Result};

/// Directory inside the destination folder that holds in-progress downloads.
pub const WORK_DIR_NAME: &str = ".swiftload";

#[derive(Debug, Clone)]
pub struct AppPaths {
    /// `%LOCALAPPDATA%\SwiftLoad` — database, logs, caches.
    pub data_dir: PathBuf,
    pub log_dir: PathBuf,
    pub db_path: PathBuf,
    /// Fallback download directory (usually `%USERPROFILE%\Downloads`).
    pub default_download_dir: PathBuf,
    /// Where the installer records its target (used by the uninstaller).
    pub config_dir: PathBuf,
}

impl AppPaths {
    /// Builds the path set, creating directories as needed.
    pub fn resolve(data_dir: PathBuf, config_dir: PathBuf, default_download_dir: PathBuf) -> Result<AppPaths> {
        let log_dir = data_dir.join("logs");
        for dir in [&data_dir, &log_dir] {
            std::fs::create_dir_all(dir)
                .map_err(|e| AppError::Disk(format!("cannot create {dir:?}: {e}")))?;
        }
        std::fs::create_dir_all(&default_download_dir).ok();

        Ok(AppPaths {
            db_path: data_dir.join("swiftload.db"),
            data_dir,
            log_dir,
            default_download_dir,
            config_dir,
        })
    }

    /// Root for temporary downloads when the user overrides the location.
    pub fn temp_root(&self) -> PathBuf {
        self.data_dir.join("parts")
    }

    /// Folder used by the optional browser-integration / URL-drop helper.
    pub fn integration_dir(&self) -> PathBuf {
        self.data_dir.join("integration")
    }

    /// Verifies that a directory is usable as a download target: it exists or
    /// can be created, and it is writable.
    pub fn verify_target_dir(dir: &Path) -> Result<()> {
        if dir.as_os_str().is_empty() {
            return Err(AppError::Disk("no download folder configured".into()));
        }
        if !dir.exists() {
            std::fs::create_dir_all(dir)
                .map_err(|e| AppError::Disk(format!("cannot create folder {dir:?}: {e}")))?;
        }
        if !dir.is_dir() {
            return Err(AppError::Disk(format!("{dir:?} is not a folder")));
        }
        // Probe write access with a real file instead of relying on metadata.
        let probe = dir.join(format!(".swiftload-write-test-{}", crate::util::random_id()));
        match std::fs::write(&probe, b"ok") {
            Ok(()) => {
                let _ = std::fs::remove_file(&probe);
                Ok(())
            }
            Err(e) => Err(AppError::Disk(format!("folder {dir:?} is not writable: {e}"))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_creates_directories() {
        let root = std::env::temp_dir().join(format!("swiftload-paths-{}", crate::util::random_id()));
        let paths = AppPaths::resolve(root.clone(), root.join("cfg"), root.join("DL")).unwrap();
        assert!(paths.data_dir.is_dir());
        assert!(paths.log_dir.is_dir());
        assert_eq!(paths.db_path.file_name().unwrap(), "swiftload.db");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn verify_target_dir_rejects_empty_and_files() {
        assert!(AppPaths::verify_target_dir(Path::new("")).is_err());

        let file = std::env::temp_dir().join(format!("swiftload-file-{}", crate::util::random_id()));
        std::fs::write(&file, b"x").unwrap();
        assert!(AppPaths::verify_target_dir(&file).is_err());
        let _ = std::fs::remove_file(&file);

        let dir = std::env::temp_dir().join(format!("swiftload-dir-{}", crate::util::random_id()));
        assert!(AppPaths::verify_target_dir(&dir).is_ok());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
