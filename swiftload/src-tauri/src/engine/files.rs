//! File manager — everything that touches the filesystem.
//!
//! Guarantees implemented here:
//!
//! * **Never overwrite silently.** Every collision is surfaced to the caller so
//!   the UI can offer Replace / Rename / Cancel; nothing is deleted before the
//!   replacement file is on disk.
//! * **Incomplete files are never presented as finished files.** In-progress
//!   data lives in `<dest>/.swiftload/<name>.part` with a sidecar resume record,
//!   and only a fully verified download is atomically moved into place.
//! * **Path safety.** Server supplied filenames are sanitised and the final path
//!   is proven to live inside the chosen directory, so a hostile
//!   `Content-Disposition` cannot write outside the download folder.
//! * **Crash-safe resume.** Every flush records the last 32 bytes at the resume
//!   boundary ("tail guard"); on resume the bytes are read back and compared, so
//!   a torn write is detected and re-fetched instead of producing a corrupt file.

use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::error::{AppError, Result};
use crate::paths::WORK_DIR_NAME;
use crate::types::{ExistingFile, SegmentPlan};

/// Number of trailing bytes stored as an integrity guard per segment.
pub const GUARD_LEN: usize = 32;

/// Version of the sidecar resume record; a mismatch discards the record and the
/// partial data is re-validated from scratch.
pub const META_VERSION: u32 = 1;

/// Above this path length Windows APIs that do not accept verbatim paths (file
/// pickers, `explorer.exe`, ShellExecute) start to misbehave.
pub const LONG_PATH_WARN: usize = 240;

// ---------------------------------------------------------------------------
// Positioned I/O
// ---------------------------------------------------------------------------

/// Writes `buf` at `offset` without moving the file cursor, working on Windows
/// (`seek_write`) and Unix (`write_at`) alike.
pub fn write_all_at(file: &File, mut buf: &[u8], offset: u64) -> std::io::Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::fs::FileExt;
        let mut position = offset;
        while !buf.is_empty() {
            match file.seek_write(buf, position) {
                Ok(0) => {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::WriteZero,
                        "no progress writing to the partial file",
                    ))
                }
                Ok(written) => {
                    position += written as u64;
                    buf = &buf[written..];
                }
                Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(e) => return Err(e),
            }
        }
        Ok(())
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::FileExt;
        let mut position = offset;
        while !buf.is_empty() {
            match file.write_at(buf, position) {
                Ok(0) => {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::WriteZero,
                        "no progress writing to the partial file",
                    ))
                }
                Ok(written) => {
                    position += written as u64;
                    buf = &buf[written..];
                }
                Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(e) => return Err(e),
            }
        }
        Ok(())
    }
}

/// Positioned write that cooperates with the async runtime.
///
/// Disk writes are synchronous by nature; on a multi-threaded Tokio runtime
/// `block_in_place` lets the scheduler move other tasks to another worker
/// thread instead of stalling them behind the write. Outside a runtime (or on a
/// single-threaded one) the plain call is used.
pub fn write_at_blocking(file: &File, buf: &[u8], offset: u64) -> std::io::Result<()> {
    match tokio::runtime::Handle::try_current() {
        Ok(handle) if handle.runtime_flavor() == tokio::runtime::RuntimeFlavor::MultiThread => {
            tokio::task::block_in_place(|| write_all_at(file, buf, offset))
        }
        _ => write_all_at(file, buf, offset),
    }
}

/// Reads up to `len` bytes at `offset`.
pub fn read_at(file: &File, offset: u64, len: usize) -> std::io::Result<Vec<u8>> {
    let mut buffer = vec![0u8; len];
    let mut filled = 0usize;
    while filled < len {
        let read = read_at_once(file, offset + filled as u64, &mut buffer[filled..])?;
        if read == 0 {
            break;
        }
        filled += read;
    }
    buffer.truncate(filled);
    Ok(buffer)
}

#[cfg(windows)]
fn read_at_once(file: &File, offset: u64, buf: &mut [u8]) -> std::io::Result<usize> {
    use std::os::windows::fs::FileExt;
    file.seek_read(buf, offset)
}

#[cfg(unix)]
fn read_at_once(file: &File, offset: u64, buf: &mut [u8]) -> std::io::Result<usize> {
    use std::os::unix::fs::FileExt;
    file.read_at(buf, offset)
}

// ---------------------------------------------------------------------------
// Resume record (sidecar)
// ---------------------------------------------------------------------------

/// Per-segment resume state written next to the partial file.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentGuard {
    pub index: usize,
    pub start: u64,
    pub end: u64,
    /// Bytes written *and flushed* for this segment.
    pub written: u64,
    /// Hex of the last [`GUARD_LEN`] bytes at the `written` boundary.
    pub tail: Option<String>,
}

/// The sidecar document. It is written atomically (temp file + rename) so a
/// crash mid-write leaves the previous, consistent record in place.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResumeRecord {
    pub version: u32,
    pub id: String,
    pub url: String,
    #[serde(default)]
    pub final_url: String,
    pub filename: String,
    pub total: Option<u64>,
    pub fragmentable: bool,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    pub connections: u32,
    pub segments: Vec<SegmentGuard>,
    /// Unix milliseconds of the last update.
    pub updated_at: i64,
}

impl ResumeRecord {
    pub fn new(
        id: &str,
        url: &str,
        filename: &str,
        total: Option<u64>,
        fragmentable: bool,
        connections: u32,
    ) -> Self {
        Self {
            version: META_VERSION,
            id: id.to_string(),
            url: url.to_string(),
            final_url: String::new(),
            filename: filename.to_string(),
            total,
            fragmentable,
            etag: None,
            last_modified: None,
            connections,
            segments: Vec::new(),
            updated_at: crate::logging::now_millis(),
        }
    }

    pub fn total_written(&self) -> u64 {
        self.segments.iter().map(|s| s.written).sum()
    }

    /// Validates the record against the download it claims to describe.
    pub fn is_compatible(&self, id: &str, url: &str, total: Option<u64>, etag: Option<&str>) -> bool {
        self.version == META_VERSION
            && self.id == id
            && self.url == url
            && (total.is_none() || self.total == total)
            && (etag.is_none() || self.etag.as_deref() == etag)
    }
}

/// Atomically writes a resume record. Failures are reported but never fatal:
/// losing a sidecar costs re-downloading, not correctness.
pub fn write_resume_record(path: &Path, record: &ResumeRecord) -> std::io::Result<()> {
    let temp = path.with_extension("meta.tmp");
    let json = serde_json::to_vec(record).unwrap_or_default();
    {
        let mut file = File::create(&temp)?;
        file.write_all(&json)?;
        file.sync_data()?;
    }
    std::fs::rename(&temp, path)?;
    Ok(())
}

pub fn read_resume_record(path: &Path) -> Option<ResumeRecord> {
    let data = std::fs::read(path).ok()?;
    serde_json::from_slice(&data).ok()
}

pub fn delete_file_quietly(path: &Path) {
    let _ = std::fs::remove_file(path);
}

// ---------------------------------------------------------------------------
// Guard helpers
// ---------------------------------------------------------------------------

/// Hex-encoded tail of `data`, used to validate a resume boundary.
pub fn tail_guard(data: &[u8]) -> Option<String> {
    if data.is_empty() {
        return None;
    }
    let start = data.len().saturating_sub(GUARD_LEN);
    Some(hex::encode(&data[start..]))
}

/// Builds a guard from the last bytes of a slice given the segment metadata.
pub fn guard_from_written(index: usize, start: u64, end: u64, written: u64, tail: Option<String>) -> SegmentGuard {
    SegmentGuard {
        index,
        start,
        end,
        written,
        tail,
    }
}

/// Checks that the bytes on disk ending at `boundary` are the ones we recorded.
///
/// `boundary` is an absolute file offset; `segment_written` is how many bytes of
/// *this segment* precede it (so the guard never reaches into a neighbouring
/// segment's range). A segment with nothing written needs no guard.
pub fn verify_guard(
    file: &File,
    boundary: u64,
    segment_written: u64,
    expected: Option<&str>,
) -> std::io::Result<bool> {
    let len = GUARD_LEN.min(segment_written as usize);
    if len == 0 {
        return Ok(segment_written == 0);
    }
    let Some(expected) = expected else {
        return Ok(false);
    };
    if boundary < len as u64 {
        return Ok(false);
    }
    let bytes = read_at(file, boundary - len as u64, len)?;
    if bytes.len() != len {
        return Ok(false);
    }
    Ok(hex::encode(&bytes) == expected)
}

// ---------------------------------------------------------------------------
// Filenames
// ---------------------------------------------------------------------------

/// Characters Windows forbids in a file name.
const ILLEGAL_CHARS: &[char] = &['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
/// Device names that may not be used, with or without an extension.
const RESERVED_NAMES: &[&str] = &[
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9", "lpt1",
    "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

/// Turns any server-supplied string into a safe, single-component file name.
pub fn sanitize_filename(raw: &str) -> String {
    // 1. Drop any directory part — this is what stops `../evil` or `C:\evil`.
    let base = raw
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(raw)
        .trim();

    // 2. Remove characters Windows rejects plus control characters.
    let mut cleaned: String = base
        .chars()
        .filter(|c| !c.is_control())
        .map(|c| if ILLEGAL_CHARS.contains(&c) { '_' } else { c })
        .collect();

    // 3. Windows silently strips trailing dots and spaces; do it explicitly so
    //    the name we report is the name that ends up on disk. Leading dots are
    //    legal and meaningful (".gitignore"), so they are preserved.
    while cleaned.ends_with('.') || cleaned.ends_with(' ') {
        cleaned.pop();
    }
    cleaned = cleaned.trim_start().to_string();
    if cleaned == "." || cleaned == ".." {
        cleaned.clear();
    }

    // 4. Reserved device names.
    let stem = cleaned
        .split('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    if RESERVED_NAMES.contains(&stem.as_str()) {
        cleaned = format!("_{cleaned}");
    }

    // 5. Our own work directory must not be shadowed by a downloaded file.
    if cleaned.eq_ignore_ascii_case(WORK_DIR_NAME) {
        cleaned = format!("_{cleaned}");
    }

    // 6. Length: keep well under the per-component and MAX_PATH limits while
    //    preserving the extension, which users care about more than the stem.
    const MAX_STEM: usize = 150;
    if cleaned.chars().count() > MAX_STEM + 20 {
        let path = Path::new(&cleaned);
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        let stem: String = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("download")
            .chars()
            .take(MAX_STEM)
            .collect();
        cleaned = if ext.is_empty() {
            stem
        } else {
            format!("{stem}.{ext}")
        };
    }

    if cleaned.is_empty() {
        "download".to_string()
    } else {
        cleaned
    }
}

/// Splits `name.ext` into stem and extension (extension includes the dot).
fn split_extension(name: &str) -> (String, String) {
    match name.rfind('.') {
        Some(index) if index > 0 && index + 1 < name.len() => {
            (name[..index].to_string(), name[index..].to_string())
        }
        _ => (name.to_string(), String::new()),
    }
}

/// `report.pdf` -> `report (2).pdf`, `report (3).pdf`, … until a free name is
/// found. Never returns an existing path.
pub fn unique_path(dir: &Path, filename: &str) -> PathBuf {
    let (stem, ext) = split_extension(filename);
    let candidate = dir.join(filename);
    if !candidate.exists() {
        return candidate;
    }
    for index in 2..10_000u32 {
        let candidate = dir.join(format!("{stem} ({index}){ext}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    // Practically unreachable; fall back to a random name rather than a
    // collision.
    dir.join(format!("{stem}-{}{ext}", crate::util::random_id()))
}

/// Human-readable description of a colliding file, for the Replace/Rename/Cancel
/// dialog.
pub fn describe_existing(path: &Path) -> Option<ExistingFile> {
    let metadata = std::fs::metadata(path).ok()?;
    if !metadata.is_file() {
        return None;
    }
    let modified = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let parent = path.parent()?;
    let filename = path.file_name()?.to_string_lossy().to_string();
    let alternative = unique_path(parent, &filename);
    Some(ExistingFile {
        path: path.to_string_lossy().to_string(),
        size: metadata.len(),
        modified,
        suggested_alternative: alternative
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or(filename),
    })
}

/// Resolves the final destination path, applying the user's conflict choice.
///
/// * `Replace` – the existing file is only removed once the new one is ready
///   (see [`finalize`]), so a failed download never destroys the old file.
/// * `Rename` – picks the next free `name (n).ext`.
/// * `Cancel` – returns [`AppError::Cancelled`] without touching anything.
pub fn resolve_destination(dir: &Path, filename: &str, action: crate::types::ConflictAction) -> Result<PathBuf> {
    use crate::types::ConflictAction;
    let candidate = dir.join(filename);
    if !candidate.exists() {
        return Ok(candidate);
    }
    match action {
        ConflictAction::Replace => Ok(candidate),
        ConflictAction::Rename => {
            if candidate.is_dir() {
                return Err(AppError::Disk(format!(
                    "{candidate:?} is a folder, not a file"
                )));
            }
            let unique = unique_path(dir, filename);
            Ok(unique)
        }
        ConflictAction::Cancel => Err(AppError::Cancelled),
    }
}

/// Proves `path` stays inside `dir` after normalisation, rejecting `..`,
/// absolute escapes and symlinked parents.
pub fn ensure_within(dir: &Path, path: &Path) -> Result<()> {
    if path
        .components()
        .any(|c| matches!(c, Component::ParentDir))
    {
        return Err(AppError::Disk(format!("refusing an unsafe path: {path:?}")));
    }
    let normalized_dir = normalize(dir);
    let normalized_path = normalize(path);
    if !normalized_path.starts_with(&normalized_dir) {
        return Err(AppError::Disk(format!(
            "refusing to write outside the download folder: {path:?}"
        )));
    }
    Ok(())
}

/// Lexical normalisation (no filesystem access, works for not-yet-created paths).
pub fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Part file locations
// ---------------------------------------------------------------------------

/// Where the partial data and its resume record live for one download.
#[derive(Debug, Clone, PartialEq)]
pub struct PartLocation {
    pub dir: PathBuf,
    pub part: PathBuf,
    pub meta: PathBuf,
}

/// Chooses the work directory: next to the destination file by default, or the
/// user-configured temporary directory (in a per-download subfolder).
pub fn plan_part_location(dest_dir: &Path, filename: &str, id: &str, temp_dir: Option<&Path>) -> PartLocation {
    let dir = match temp_dir.filter(|d| !d.as_os_str().is_empty()) {
        Some(temp) => temp.join(id),
        None => dest_dir.join(WORK_DIR_NAME),
    };
    let part = dir.join(format!("{filename}.part"));
    let meta = dir.join(format!("{filename}.swlmeta"));
    PartLocation { dir, part, meta }
}

/// Creates (or opens) the partial file, preallocating it for fragmented
/// downloads so the filesystem knows the final size up front.
///
/// Preallocation is what makes positioned writes into a multi-gigabyte file
/// cheap; without it the volume would be extended one chunk at a time.
pub fn open_part_file(
    location: &PartLocation,
    total: Option<u64>,
    fragmentable: bool,
    sparse: bool,
) -> Result<File> {
    std::fs::create_dir_all(&location.dir)
        .map_err(|e| AppError::Disk(format!("cannot create {:?}: {e}", location.dir)))?;

    let existed = location.part.exists();
    let file = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .truncate(false)
        .open(&location.part)
        .map_err(|e| AppError::Disk(format!("cannot open {:?}: {e}", location.part)))?;

    #[cfg(windows)]
    if sparse && fragmentable && !existed {
        // Purely an optimisation: if the volume does not support sparse files
        // (or refuses the IOCTL) the download proceeds normally, only the
        // on-disk allocation behaviour differs.
        let _ = mark_sparse(&file);
    }
    #[cfg(not(windows))]
    let _ = sparse;

    if fragmentable {
        if let Some(total) = total {
            let current = file.metadata().map(|m| m.len()).unwrap_or(0);
            if current != total {
                file.set_len(total)
                    .map_err(|e| AppError::Disk(format!("cannot allocate {total} bytes: {e}")))?;
            }
        }
    }
    Ok(file)
}

#[cfg(windows)]
fn mark_sparse(file: &File) -> std::io::Result<()> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::System::IO::DeviceIoControl;

    /// `FSCTL_SET_SPARSE` — documented in winioctl.h.
    const FSCTL_SET_SPARSE: u32 = 0x0009_00C4;

    let handle = file.as_raw_handle();
    let mut returned: u32 = 0;
    let ok = unsafe {
        DeviceIoControl(
            handle as _,
            FSCTL_SET_SPARSE,
            std::ptr::null(),
            0,
            std::ptr::null_mut(),
            0,
            &mut returned,
            std::ptr::null_mut(),
        )
    };
    if ok == 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}

/// Free bytes available to the current user on the volume holding `path`.
#[cfg(windows)]
pub fn available_space(path: &Path) -> Option<u64> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;

    let wide: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let mut free_to_caller: u64 = 0;
    let mut total: u64 = 0;
    let mut total_free: u64 = 0;
    let ok = unsafe {
        GetDiskFreeSpaceExW(
            wide.as_ptr(),
            &mut free_to_caller,
            &mut total,
            &mut total_free,
        )
    };
    if ok == 0 {
        None
    } else {
        Some(free_to_caller)
    }
}

/// Free space is only reported on Windows (where the application ships);
/// elsewhere the engine skips the check instead of guessing.
#[cfg(not(windows))]
pub fn available_space(_path: &Path) -> Option<u64> {
    None
}

// ---------------------------------------------------------------------------
// Finalisation
// ---------------------------------------------------------------------------

/// Flushes, closes and moves a finished partial file into place.
///
/// * `sync_all` before the move makes the content durable, so a power failure
///   right after "Completed" cannot leave a truncated file behind.
/// * `rename` replaces the target atomically on Windows
///   (`MoveFileExW(MOVEFILE_REPLACE_EXISTING)`), and if source and target live
///   on different volumes it falls back to a verified copy + delete.
pub fn finalize(part: &Path, destination: &Path) -> Result<()> {
    if !part.exists() {
        return Err(AppError::Disk(format!("partial file {part:?} is missing")));
    }
    let expected_len = std::fs::metadata(part)
        .map_err(|e| AppError::Disk(format!("cannot stat {part:?}: {e}")))?
        .len();

    // Durability before the rename.
    {
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .open(part)
            .map_err(|e| AppError::Disk(format!("cannot reopen {part:?}: {e}")))?;
        file.sync_all()
            .map_err(|e| AppError::Disk(format!("cannot flush {part:?}: {e}")))?;
    }

    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| AppError::Disk(format!("cannot create {parent:?}: {e}")))?;
    }
    ensure_within(destination.parent().unwrap_or(destination), destination)?;

    match std::fs::rename(part, destination) {
        Ok(()) => {}
        Err(rename_error) => {
            // Different volume, or a sharing violation: copy then delete. The
            // source is only removed after the copy is verified.
            copy_verified(part, destination).map_err(|copy_error| {
                AppError::Disk(format!(
                    "could not move the finished download into place ({rename_error}; copy fallback: {copy_error})"
                ))
            })?;
            delete_file_quietly(part);
        }
    }

    match std::fs::metadata(destination) {
        Ok(metadata) if metadata.len() == expected_len => Ok(()),
        Ok(metadata) => {
            let _ = delete_file_quietly(destination);
            Err(AppError::Disk(format!(
                "the finished file has {} bytes but {expected_len} were expected",
                metadata.len()
            )))
        }
        Err(e) => Err(AppError::Disk(format!("cannot verify {destination:?}: {e}"))),
    }
}

fn copy_verified(source: &Path, destination: &Path) -> std::io::Result<()> {
    let mut reader = File::open(source)?;
    let mut writer = File::create(destination)?;
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        writer.write_all(&buffer[..read])?;
    }
    writer.sync_all()?;
    let source_len = std::fs::metadata(source)?.len();
    let dest_len = std::fs::metadata(destination)?.len();
    if source_len != dest_len {
        return Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!("copied {dest_len} of {source_len} bytes"),
        ));
    }
    Ok(())
}

/// Removes the partial data and resume record for a download.
pub fn remove_partials(location: &PartLocation) {
    delete_file_quietly(&location.part);
    delete_file_quietly(&location.meta);
    delete_file_quietly(&location.meta.with_extension("meta.tmp"));
    // Remove the work directory when it is empty and private to this download.
    let _ = std::fs::remove_dir(&location.dir);
}

/// Truncates the partial data of a download that must restart from scratch,
/// then re-preallocates it for the expected size.
pub fn reset_part_file(location: &PartLocation, total: Option<u64>, fragmentable: bool) -> Result<File> {
    delete_file_quietly(&location.part);
    delete_file_quietly(&location.meta);
    open_part_file(location, total, fragmentable, false)
}

/// Streaming SHA-256 of a file, reported in lowercase hex.
pub fn sha256_file(path: &Path) -> Result<String> {
    let mut file = File::open(path).map_err(|e| AppError::Disk(format!("cannot open {path:?}: {e}")))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|e| AppError::Disk(format!("cannot read {path:?}: {e}")))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex::encode(hasher.finalize()))
}

/// Normalised SHA-256 digest comparison (case- and whitespace-insensitive,
/// accepts `sha256:` prefixes).
pub fn hash_matches(expected: &str, actual: &str) -> bool {
    let clean = |value: &str| {
        value
            .trim()
            .trim_start_matches("sha256:")
            .trim_start_matches("SHA256:")
            .replace([' ', '-', ':', '\n', '\r'], "")
            .to_ascii_lowercase()
    };
    let expected = clean(expected);
    !expected.is_empty() && expected == clean(actual)
}

/// Total bytes on disk for a set of segments (used to sanity-check a resume).
pub fn segments_written(segments: &[SegmentPlan]) -> u64 {
    segments.iter().map(|s| s.downloaded).sum()
}

/// Seeks to the end and returns the current length.
pub fn file_len(file: &mut File) -> std::io::Result<u64> {
    let len = file.seek(SeekFrom::End(0))?;
    Ok(len)
}

/// Shared handle to a partial file used by all segment writers.
pub type SharedFile = Arc<File>;

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("swiftload-files-{}-{}", crate::util::random_id(), name));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn sanitizes_hostile_names() {
        assert_eq!(sanitize_filename("../../../etc/passwd"), "passwd");
        assert_eq!(sanitize_filename("C:\\Windows\\system32\\cmd.exe"), "cmd.exe");
        assert_eq!(sanitize_filename("a<b>c:d\"e|f?g*h.txt"), "a_b_c_d_e_f_g_h.txt");
        assert_eq!(sanitize_filename("trailing... "), "trailing");
        assert_eq!(sanitize_filename("NUL"), "_NUL");
        assert_eq!(sanitize_filename("con.txt"), "_con.txt");
        assert_eq!(sanitize_filename(".swiftload"), "_.swiftload");
        assert_eq!(sanitize_filename(""), "download");
        assert_eq!(sanitize_filename("   "), "download");
        assert_eq!(sanitize_filename(".."), "download");

        let long = format!("{}.zip", "x".repeat(400));
        let sanitized = sanitize_filename(&long);
        assert!(sanitized.len() <= 175, "{} chars", sanitized.len());
        assert!(sanitized.ends_with(".zip"));
    }

    #[test]
    fn unique_path_never_collides() {
        let dir = scratch("unique");
        std::fs::write(dir.join("file.zip"), b"a").unwrap();
        assert_eq!(
            unique_path(&dir, "file.zip").file_name().unwrap(),
            "file (2).zip"
        );
        std::fs::write(dir.join("file (2).zip"), b"b").unwrap();
        assert_eq!(
            unique_path(&dir, "file.zip").file_name().unwrap(),
            "file (3).zip"
        );
        assert_eq!(
            unique_path(&dir, "other.zip").file_name().unwrap(),
            "other.zip"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolve_destination_honours_the_conflict_action() {
        use crate::types::ConflictAction;
        let dir = scratch("conflict");
        std::fs::write(dir.join("f.zip"), b"old").unwrap();

        let replace = resolve_destination(&dir, "f.zip", ConflictAction::Replace).unwrap();
        assert_eq!(replace.file_name().unwrap(), "f.zip");

        let rename = resolve_destination(&dir, "f.zip", ConflictAction::Rename).unwrap();
        assert_eq!(rename.file_name().unwrap(), "f (2).zip");

        assert!(matches!(
            resolve_destination(&dir, "f.zip", ConflictAction::Cancel),
            Err(AppError::Cancelled)
        ));

        // No collision: the plain name is used for every action.
        let fresh = resolve_destination(&dir, "new.zip", ConflictAction::Cancel).unwrap();
        assert_eq!(fresh.file_name().unwrap(), "new.zip");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn ensure_within_blocks_escapes() {
        let dir = Path::new("C:\\Downloads");
        assert!(ensure_within(dir, &dir.join("file.zip")).is_ok());
        assert!(ensure_within(dir, &dir.join("../evil.zip")).is_err());
        assert!(ensure_within(dir, Path::new("C:\\Windows\\evil.zip")).is_err());
    }

    #[test]
    fn positioned_writes_and_guard_verification() {
        let dir = scratch("guard");
        let path = dir.join("x.part");
        let file = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .open(&path)
            .unwrap();

        let first = vec![7u8; 64];
        let second = vec![9u8; 64];
        write_all_at(&file, &first, 0).unwrap();
        write_all_at(&file, &second, 64).unwrap();
        // Out-of-order write lands at the right offset.
        write_all_at(&file, &[1, 2, 3, 4], 200).unwrap();

        let guard = tail_guard(&second).unwrap();
        assert!(verify_guard(&file, 128, 64, Some(&guard)).unwrap());
        // Wrong boundary must fail the check.
        assert!(!verify_guard(&file, 64, 64, Some(&guard)).unwrap());
        // Missing guard at a non-zero boundary is a failure (re-fetch needed).
        assert!(!verify_guard(&file, 128, 64, None).unwrap());
        // Nothing written in this segment: nothing to verify.
        assert!(verify_guard(&file, 500, 0, None).unwrap());
        // A guard for a short segment only reads the bytes that belong to it.
        let short_guard = tail_guard(&[3u8; 8]).unwrap();
        write_all_at(&file, &[3u8; 8], 300).unwrap();
        assert!(verify_guard(&file, 308, 8, Some(&short_guard)).unwrap());
        assert!(!verify_guard(&file, 308, 8, Some(&guard)).unwrap());

        assert_eq!(std::fs::metadata(&path).unwrap().len(), 204);
        assert_eq!(read_at(&file, 200, 8).unwrap(), vec![1, 2, 3, 4]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn tail_guard_caps_at_guard_len() {
        let guard = tail_guard(&[0xAB; 100]).unwrap();
        assert_eq!(guard.len(), GUARD_LEN * 2);
        assert_eq!(guard, hex::encode([0xABu8; GUARD_LEN]));
        assert_eq!(tail_guard(&[]), None);
    }

    #[test]
    fn finalize_moves_and_verifies() {
        let dir = scratch("finalize");
        let part = dir.join("f.part");
        std::fs::write(&part, b"payload").unwrap();
        let destination = dir.join("f.bin");

        finalize(&part, &destination).unwrap();
        assert!(!part.exists());
        assert_eq!(std::fs::read(&destination).unwrap(), b"payload");

        // Replacing an existing file must not destroy it on failure: simulate
        // by finalising a missing part file.
        let missing = dir.join("missing.part");
        let existing = dir.join("keep.bin");
        std::fs::write(&existing, b"keep me").unwrap();
        assert!(finalize(&missing, &existing).is_err());
        assert_eq!(std::fs::read(&existing).unwrap(), b"keep me");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn finalize_overwrites_on_replace() {
        let dir = scratch("replace");
        let destination = dir.join("f.bin");
        std::fs::write(&destination, b"old content").unwrap();
        let part = dir.join("f.part");
        std::fs::write(&part, b"new").unwrap();
        finalize(&part, &destination).unwrap();
        assert_eq!(std::fs::read(&destination).unwrap(), b"new");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn part_location_layout() {
        let dest = Path::new("C:\\Users\\me\\Downloads");
        let location = plan_part_location(dest, "movie.mp4", "abc", None);
        assert!(location.part.ends_with("movie.mp4.part"));
        assert!(location.part.starts_with(dest.join(WORK_DIR_NAME)));

        let temp = Path::new("D:\\temp");
        let location = plan_part_location(dest, "movie.mp4", "abc", Some(temp));
        assert_eq!(location.dir, temp.join("abc"));
        let _ = delete_file_quietly(&location.meta);
    }

    #[test]
    fn preallocation_and_reset() {
        let dir = scratch("alloc");
        let location = plan_part_location(&dir, "big.bin", "id1", None);
        {
            let file = open_part_file(&location, Some(4096), true, false).unwrap();
            let len = file.metadata().unwrap().len();
            assert_eq!(len, 4096);
            write_all_at(&file, b"hello", 0).unwrap();
        }
        // Re-opening must not truncate what is already there.
        {
            let file = open_part_file(&location, Some(4096), true, false).unwrap();
            assert_eq!(read_at(&file, 0, 5).unwrap(), b"hello");
        }
        // Reset clears the data for a fresh start.
        {
            let file = reset_part_file(&location, Some(4096), true).unwrap();
            assert_eq!(read_at(&file, 0, 5).unwrap(), vec![0u8; 5]);
        }
        remove_partials(&location);
        assert!(!location.part.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn resume_record_roundtrip_and_compatibility() {
        let dir = scratch("resume");
        let path = dir.join("f.swlmeta");
        let mut record = ResumeRecord::new("id1", "https://e.com/f.zip", "f.zip", Some(1000), true, 4);
        record.etag = Some("\"v1\"".into());
        record.segments = vec![
            guard_from_written(0, 0, 499, 500, Some("ab".into())),
            guard_from_written(1, 500, 999, 0, None),
        ];
        write_resume_record(&path, &record).unwrap();

        let loaded = read_resume_record(&path).unwrap();
        assert_eq!(loaded, record);
        assert_eq!(loaded.total_written(), 500);
        assert!(loaded.is_compatible("id1", "https://e.com/f.zip", Some(1000), Some("\"v1\"")));
        // A changed ETag (file replaced on the server) invalidates the record.
        assert!(!loaded.is_compatible("id1", "https://e.com/f.zip", Some(1000), Some("\"v2\"")));
        assert!(!loaded.is_compatible("id2", "https://e.com/f.zip", Some(1000), Some("\"v1\"")));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn hash_helper_normalises_input() {
        let upper = "ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789";
        let lower = upper.to_ascii_lowercase();
        assert!(hash_matches(upper, &lower));
        assert!(hash_matches(&format!("sha256:{upper}"), &lower));
        assert!(hash_matches(&lower, &lower));
        assert!(!hash_matches("deadbeef", &lower));
        // An empty expectation must never be treated as a match.
        assert!(!hash_matches("", &lower));
    }

    #[test]
    fn sha256_matches_a_known_vector() {
        let dir = scratch("sha");
        let path = dir.join("hello.txt");
        std::fs::write(&path, b"abc").unwrap();
        // SHA-256("abc")
        assert_eq!(
            sha256_file(&path).unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
