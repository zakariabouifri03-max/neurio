//! End-to-end tests for the download engine.
//!
//! Every test runs against a small HTTP/1.1 server that this file implements
//! itself, so the exact server behaviour is under control:
//!
//! * `honor_range` decides whether the server answers ranged requests with a
//!   real `206 Partial Content` (with a `Content-Range` header) or with a plain
//!   `200 OK` that ignores the range — the case that must fall back to a single
//!   stream instead of corrupting the file.
//! * `stall_after` closes the socket early, which is how an interrupted network
//!   is simulated.
//! * `chunk_delay_ms` throttles the body so the bandwidth limiter can be
//!   measured with a real clock.
//!
//! Run them with `cargo test --test engine` on a machine with the Rust
//! toolchain; they need no network access.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use swiftload_lib::db::Database;
use swiftload_lib::engine::{Engine, NullSink};
use swiftload_lib::logging::{Level, Logger};
use swiftload_lib::settings::AppSettings;
use swiftload_lib::types::{AddDownloadArgs, ConflictAction, DownloadRecord, DownloadStatus};

// ---------------------------------------------------------------------------
// Test HTTP server
// ---------------------------------------------------------------------------

#[derive(Clone)]
struct ServerConfig {
    body: Arc<Vec<u8>>,
    /// Answer ranges properly (`206` + `Content-Range`).
    honor_range: bool,
    /// Milliseconds to sleep between body chunks (0 = as fast as possible).
    chunk_delay_ms: u64,
    /// Close the connection after this many body bytes (simulates a drop).
    stall_after: Option<usize>,
    /// Only the first request stalls, so a retry can succeed.
    stall_once: bool,
    /// Answer everything with `404 Not Found`.
    not_found: bool,
    /// Answer everything with `401 Unauthorized`.
    unauthorized: bool,
}

impl ServerConfig {
    fn body(body: Vec<u8>) -> Self {
        Self {
            body: Arc::new(body),
            honor_range: true,
            chunk_delay_ms: 0,
            stall_after: None,
            stall_once: false,
            not_found: false,
            unauthorized: false,
        }
    }

    fn without_ranges(body: Vec<u8>) -> Self {
        Self {
            honor_range: false,
            ..Self::body(body)
        }
    }

    fn throttled(body: Vec<u8>, chunk_delay_ms: u64) -> Self {
        Self {
            chunk_delay_ms,
            ..Self::body(body)
        }
    }

    /// Drops the connection once, like a cable pulled for a moment.
    fn interrupting_once(body: Vec<u8>, after_bytes: usize) -> Self {
        Self {
            stall_after: Some(after_bytes),
            stall_once: true,
            ..Self::body(body)
        }
    }

    /// Drops every connection after `after_bytes`.
    fn interrupting_always(body: Vec<u8>, after_bytes: usize) -> Self {
        Self {
            stall_after: Some(after_bytes),
            stall_once: false,
            ..Self::body(body)
        }
    }
}

struct TestServer {
    addr: SocketAddr,
    requests: Arc<AtomicU32>,
    task: tokio::task::JoinHandle<()>,
}

impl TestServer {
    async fn start(config: ServerConfig) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("addr");
        let requests = Arc::new(AtomicU32::new(0));
        let counter = requests.clone();
        let task = tokio::spawn(async move {
            loop {
                let Ok((socket, _)) = listener.accept().await else {
                    break;
                };
                let config = config.clone();
                let counter = counter.clone();
                tokio::spawn(async move {
                    let _ = serve(socket, config, counter).await;
                });
            }
        });
        Self {
            addr,
            requests,
            task,
        }
    }

    fn url(&self, name: &str) -> String {
        format!("http://{}/{name}", self.addr)
    }

    fn request_count(&self) -> u32 {
        self.requests.load(Ordering::SeqCst)
    }
}

impl Drop for TestServer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn serve(
    mut socket: TcpStream,
    config: ServerConfig,
    counter: Arc<AtomicU32>,
) -> std::io::Result<()> {
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 2048];
    loop {
        let read = socket.read(&mut chunk).await?;
        if read == 0 {
            return Ok(());
        }
        buffer.extend_from_slice(&chunk[..read]);
        if buffer.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
        if buffer.len() > 64 * 1024 {
            return Ok(());
        }
    }

    let text = String::from_utf8_lossy(&buffer).to_string();
    let mut lines = text.split("\r\n");
    let request_line = lines.next().unwrap_or_default();
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("GET").to_string();
    let _target = parts.next().unwrap_or("/").to_string();
    let range = lines
        .clone()
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            if name.eq_ignore_ascii_case("range") {
                Some(value.trim().to_string())
            } else {
                None
            }
        });
    let request_index = counter.fetch_add(1, Ordering::SeqCst);

    let head_only = method.eq_ignore_ascii_case("HEAD");
    let total = config.body.len() as u64;

    if config.not_found {
        return write_all(
            &mut socket,
            "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        )
        .await;
    }
    if config.unauthorized {
        return write_all(
            &mut socket,
            "HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm=\"test\"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        )
        .await;
    }

    let requested = range
        .as_deref()
        .and_then(|value| parse_range(value, total))
        .filter(|_| config.honor_range);

    let (status, start, end) = match requested {
        Some((start, end)) if end < total => ("206 Partial Content", start, end),
        _ => ("200 OK", 0, total.saturating_sub(1)),
    };
    let length = if total == 0 { 0 } else { end - start + 1 };

    let mut head = format!(
        "HTTP/1.1 {status}\r\nContent-Length: {length}\r\nContent-Type: application/octet-stream\r\n\
         Accept-Ranges: bytes\r\nETag: \"swiftload-test-{total}\"\r\n\
         Last-Modified: Wed, 01 Oct 2025 10:00:00 GMT\r\nConnection: close\r\n",
    );
    if status.starts_with("206") {
        head.push_str(&format!("Content-Range: bytes {start}-{end}/{total}\r\n"));
    }
    if let Some(name) = content_disposition(&text) {
        head.push_str(&format!("Content-Disposition: attachment; filename=\"{name}\"\r\n"));
    }
    head.push_str("\r\n");
    write_all(&mut socket, &head).await?;

    if head_only || total == 0 {
        return Ok(());
    }

    let body = config.body.as_ref();
    let slice = &body[start as usize..=end as usize];
    let should_stall = match config.stall_after {
        Some(_) => !config.stall_once || request_index == 0,
        None => false,
    };
    let stall = if should_stall {
        config.stall_after.unwrap_or(slice.len())
    } else {
        slice.len()
    };

    if config.chunk_delay_ms == 0 {
        let send = &slice[..stall.min(slice.len())];
        socket.write_all(send).await?;
        if stall < slice.len() {
            // Simulate a dropped connection: stop mid-body, close the socket.
            return Ok(());
        }
        socket.flush().await?;
        return Ok(());
    }

    // Throttled transfer: 32 KiB chunks with a pause in between.
    let chunk_size = 32 * 1024;
    let mut sent = 0usize;
    while sent < slice.len() && sent < stall {
        let end_index = (sent + chunk_size).min(slice.len()).min(stall);
        socket.write_all(&slice[sent..end_index]).await?;
        socket.flush().await?;
        sent = end_index;
        if sent < slice.len() {
            tokio::time::sleep(Duration::from_millis(config.chunk_delay_ms)).await;
        }
    }
    Ok(())
}

async fn write_all(socket: &mut TcpStream, text: &str) -> std::io::Result<()> {
    socket.write_all(text.as_bytes()).await?;
    socket.flush().await
}

fn parse_range(value: &str, total: u64) -> Option<(u64, u64)> {
    let spec = value.trim().strip_prefix("bytes=")?;
    let (start, end) = spec.split_once('-')?;
    if total == 0 {
        return None;
    }
    let start: u64 = start.trim().parse().ok()?;
    let end: u64 = if end.trim().is_empty() {
        total - 1
    } else {
        end.trim().parse().ok()?
    };
    if start > end || start >= total {
        return None;
    }
    Some((start, end.min(total - 1)))
}

fn content_disposition(request: &str) -> Option<String> {
    // `/with-name/` in the target makes the server send a Content-Disposition
    // header, which is what the engine uses to name the file.
    if request.contains("/with-name/") {
        Some("from-server.bin".to_string())
    } else {
        None
    }
}

/// Deterministic pseudo-random payload so the same bytes are verified twice.
fn payload(len: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(len);
    let mut state: u64 = 0x9E37_79B9_7F4A_7C15;
    while out.len() < len {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        out.extend_from_slice(&state.to_le_bytes());
    }
    out.truncate(len);
    out
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

// ---------------------------------------------------------------------------
// Engine harness
// ---------------------------------------------------------------------------

struct Harness {
    root: PathBuf,
    download_dir: PathBuf,
    engine: Arc<Engine>,
}

impl Harness {
    async fn new(name: &str) -> Self {
        let root = std::env::temp_dir().join(format!(
            "swiftload-test-{name}-{}-{:?}",
            std::process::id(),
            Instant::now()
        ));
        let _ = std::fs::remove_dir_all(&root);
        let download_dir = root.join("downloads");
        std::fs::create_dir_all(&download_dir).expect("create download dir");
        let logs = root.join("logs");
        std::fs::create_dir_all(&logs).expect("create log dir");

        let logger = Logger::new(logs, Level::Debug);
        let db = Arc::new(Database::open(root.join("swiftload.db")).expect("open db"));
        let mut settings = AppSettings::default();
        settings.general.default_download_dir = download_dir.to_string_lossy().to_string();
        settings.downloads.max_concurrent = 2;
        settings.downloads.connections_per_download = 4;
        settings.downloads.max_connections_per_download = 8;
        settings.downloads.max_retries = 3;
        settings.downloads.retry_delay_ms = 150;
        settings.downloads.retry_max_delay_ms = 1_000;
        settings.downloads.verify_on_resume = true;
        settings.advanced.sparse_files = false;
        settings.advanced.checkpoint_interval_ms = 200;
        settings.advanced.ui_refresh_ms = 100;

        let engine = Engine::new(db, logger, settings, Arc::new(NullSink)).expect("engine");
        engine.initialize().expect("initialize");
        tokio::spawn(engine.clone().run());

        Self {
            root,
            download_dir,
            engine,
        }
    }

    /// Reopens the same database and download folder with a fresh engine, which
    /// is what happens when the application is restarted.
    async fn restart(&mut self) {
        self.engine.shutdown();
        let logger = Logger::new(self.root.join("logs"), Level::Debug);
        let db = Arc::new(Database::open(self.root.join("swiftload.db")).expect("reopen db"));
        let mut settings = AppSettings::default();
        settings.general.default_download_dir = self.download_dir.to_string_lossy().to_string();
        settings.downloads.max_concurrent = 2;
        settings.downloads.connections_per_download = 4;
        settings.downloads.max_retries = 3;
        settings.downloads.retry_delay_ms = 150;
        settings.advanced.checkpoint_interval_ms = 200;
        let engine = Engine::new(db, logger, settings, Arc::new(NullSink)).expect("engine");
        engine.initialize().expect("initialize");
        tokio::spawn(engine.clone().run());
        self.engine = engine;
    }

    async fn add(&self, url: &str, connections: u32, conflict: ConflictAction) -> DownloadRecord {
        self.engine
            .add(AddDownloadArgs {
                url: url.to_string(),
                dest_dir: None,
                filename: None,
                connections: Some(connections),
                sha256: None,
                on_conflict: Some(conflict),
                start: Some(true),
            })
            .await
            .expect("add download")
    }

    async fn wait_for(
        &self,
        id: &str,
        wanted: &[DownloadStatus],
        timeout: Duration,
    ) -> DownloadRecord {
        let deadline = Instant::now() + timeout;
        loop {
            let record = self.engine.get(id).expect("record");
            if wanted.contains(&record.status) {
                return record;
            }
            if Instant::now() > deadline {
                panic!(
                    "download {id} stayed {:?} for {:?} (error: {:?})",
                    record.status, timeout, record.error
                );
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }
}

impl Drop for Harness {
    fn drop(&mut self) {
        self.engine.shutdown();
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

fn read_file(path: &std::path::Path) -> Vec<u8> {
    std::fs::read(path).unwrap_or_else(|error| panic!("read {path:?}: {error}"))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn segments_reconstruct_the_file_byte_for_byte() {
    let body = payload(4 * 1024 * 1024);
    let server = TestServer::start(ServerConfig::body(body.clone())).await;
    let harness = Harness::new("segmented").await;

    let record = harness
        .add(&server.url("file.bin"), 4, ConflictAction::Rename)
        .await;
    assert!(record.fragmentable, "the test server advertises ranges");

    let done = harness
        .wait_for(&record.id, &[DownloadStatus::Completed], Duration::from_secs(90))
        .await;
    assert_eq!(done.downloaded, body.len() as u64);
    assert_eq!(done.total, Some(body.len() as u64));
    assert!(
        done.segments.len() >= 2,
        "a 4 MiB file with 4 connections must really be split into segments"
    );
    assert!(done.segments.iter().all(|segment| segment.done));

    let on_disk = read_file(std::path::Path::new(&done.file_path));
    assert_eq!(on_disk.len(), body.len());
    assert_eq!(sha256_hex(&on_disk), sha256_hex(&body), "bytes must match");
    assert!(
        !std::path::Path::new(&done.part_path).exists(),
        "the temporary .part file must be gone after finalising"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_server_without_range_support_falls_back_to_one_stream() {
    let body = payload(2 * 1024 * 1024);
    let server = TestServer::start(ServerConfig::without_ranges(body.clone())).await;
    let harness = Harness::new("no-range").await;

    let record = harness
        .add(&server.url("plain.bin"), 4, ConflictAction::Rename)
        .await;
    assert!(!record.fragmentable, "the server ignores ranges");

    let done = harness
        .wait_for(&record.id, &[DownloadStatus::Completed], Duration::from_secs(90))
        .await;
    assert_eq!(
        done.connections, 1,
        "a non-range server must be downloaded with a single connection"
    );
    let on_disk = read_file(std::path::Path::new(&done.file_path));
    assert_eq!(sha256_hex(&on_disk), sha256_hex(&body));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn pause_keeps_the_bytes_and_resume_continues_from_them() {
    // Throttled so there is time to pause in the middle.
    let body = payload(1024 * 1024);
    let server = TestServer::start(ServerConfig::throttled(body.clone(), 12)).await;
    let harness = Harness::new("pause-resume").await;

    let record = harness
        .add(&server.url("slow.bin"), 2, ConflictAction::Rename)
        .await;

    // Wait until at least 64 KiB arrived on disk, then pause.
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        let progress = harness.engine.progress(&record.id).expect("progress");
        if progress.downloaded >= 64 * 1024 {
            break;
        }
        assert!(Instant::now() < deadline, "no progress while downloading");
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let paused = harness.engine.pause(&record.id).expect("pause").status;
    assert!(matches!(paused, DownloadStatus::Paused | DownloadStatus::Downloading));

    let after_pause = harness
        .wait_for(
            &record.id,
            &[DownloadStatus::Paused],
            Duration::from_secs(30),
        )
        .await;
    let resume_at = after_pause.downloaded;
    assert!(resume_at > 0, "some bytes must have been kept");

    harness.engine.resume(&record.id).expect("resume");
    let done = harness
        .wait_for(
            &record.id,
            &[DownloadStatus::Completed],
            Duration::from_secs(120),
        )
        .await;
    assert!(
        done.downloaded >= resume_at,
        "resuming must never lose bytes ({} < {resume_at})",
        done.downloaded
    );
    assert_eq!(done.retryCount, 0, "a pause is not a failure");
    let on_disk = read_file(std::path::Path::new(&done.file_path));
    assert_eq!(sha256_hex(&on_disk), sha256_hex(&body));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn an_interrupted_connection_is_retried_and_completes() {
    let body = payload(512 * 1024);
    // The first request gets half the body and a closed socket; the retry is
    // served normally — exactly what a flaky connection looks like.
    let server =
        TestServer::start(ServerConfig::interrupting_once(body.clone(), body.len() / 2)).await;
    let harness = Harness::new("interrupted").await;

    let record = harness
        .add(&server.url("flaky.bin"), 1, ConflictAction::Rename)
        .await;
    let done = harness
        .wait_for(&record.id, &[DownloadStatus::Completed], Duration::from_secs(120))
        .await;

    assert!(
        done.retryCount >= 1,
        "the interrupted attempt must be counted as a retry (count: {})",
        done.retryCount
    );
    assert!(
        server.request_count() >= 2,
        "the engine must reconnect and ask for the missing bytes"
    );
    assert_eq!(sha256_hex(&read_file(std::path::Path::new(&done.file_path))), sha256_hex(&body));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_permanently_interrupting_server_gives_up_with_a_reason() {
    let body = payload(512 * 1024);
    let server =
        TestServer::start(ServerConfig::interrupting_always(body.clone(), body.len() / 2)).await;
    let harness = Harness::new("dead-connection").await;

    let record = harness
        .add(&server.url("dead.bin"), 1, ConflictAction::Rename)
        .await;
    let failed = harness
        .wait_for(&record.id, &[DownloadStatus::Failed], Duration::from_secs(120))
        .await;

    assert!(
        failed.retryCount >= 1,
        "a dropped connection is transient and must be retried at least once"
    );
    let error = failed.error.unwrap_or_default().to_lowercase();
    assert!(!error.is_empty(), "the failure must explain what happened");
    assert!(
        !std::path::Path::new(&failed.file_path).exists(),
        "a failed download must never appear under its final name"
    );
    assert!(
        std::path::Path::new(&failed.part_path).exists(),
        "the partial data must be kept so a later retry can resume"
    );

    // The partial file must not be empty: bytes that arrived are preserved.
    let partial = std::fs::metadata(&failed.part_path).expect("partial metadata");
    assert!(partial.len() > 0, "the bytes already received must be on disk");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_404_is_permanent_and_never_retried() {
    let server = TestServer::start(ServerConfig {
        not_found: true,
        ..ServerConfig::body(payload(1024))
    })
    .await;
    let harness = Harness::new("not-found").await;

    let record = harness
        .add(&server.url("missing.bin"), 1, ConflictAction::Rename)
        .await;
    let failed = harness
        .wait_for(
            &record.id,
            &[DownloadStatus::Failed],
            Duration::from_secs(30),
        )
        .await;
    assert_eq!(failed.retryCount, 0, "404 must be treated as permanent");
    let error = failed.error.unwrap_or_default().to_lowercase();
    assert!(
        error.contains("404") || error.contains("not found") || error.contains("missing"),
        "the error must describe the HTTP status, got: {error}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn an_unauthorized_response_carries_a_useful_message() {
    let server = TestServer::start(ServerConfig {
        unauthorized: true,
        ..ServerConfig::body(payload(1024))
    })
    .await;
    let harness = Harness::new("unauthorized").await;

    let record = harness
        .add(&server.url("private.bin"), 1, ConflictAction::Rename)
        .await;
    let failed = harness
        .wait_for(
            &record.id,
            &[DownloadStatus::Failed],
            Duration::from_secs(30),
        )
        .await;
    assert_eq!(failed.retryCount, 0, "401 must not be retried");
    let error = failed.error.unwrap_or_default().to_lowercase();
    assert!(
        error.contains("401") || error.contains("auth") || error.contains("credential"),
        "the error must mention authentication, got: {error}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn an_existing_file_is_never_overwritten_silently() {
    let body = payload(256 * 1024);
    let server = TestServer::start(ServerConfig::body(body.clone())).await;
    let harness = Harness::new("conflict").await;

    // A file with the name the server would suggest already exists.
    let existing = harness.download_dir.join("file.bin");
    std::fs::write(&existing, b"do not touch me").expect("write existing file");

    let record = harness
        .add(&server.url("file.bin"), 2, ConflictAction::Rename)
        .await;
    let done = harness
        .wait_for(&record.id, &[DownloadStatus::Completed], Duration::from_secs(60))
        .await;

    assert_eq!(
        std::fs::read(&existing).expect("read existing"),
        b"do not touch me",
        "the pre-existing file must keep its content"
    );
    assert_ne!(done.filename, "file.bin", "the new download must be renamed");
    assert_eq!(
        sha256_hex(&read_file(std::path::Path::new(&done.file_path))),
        sha256_hex(&body)
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_speed_limit_actually_slows_the_transfer_down() {
    // 1 MiB with no delay would finish in well under a second on a loopback
    // socket; limited to 256 KB/s it has to take at least three seconds.
    let body = payload(1024 * 1024);
    let server = TestServer::start(ServerConfig::body(body.clone())).await;
    let harness = Harness::new("limit").await;

    let record = harness
        .add(&server.url("limited.bin"), 1, ConflictAction::Rename)
        .await;
    harness
        .engine
        .set_speed_limit(&record.id, Some(256 * 1024))
        .expect("set limit");

    let started = Instant::now();
    let done = harness
        .wait_for(&record.id, &[DownloadStatus::Completed], Duration::from_secs(120))
        .await;
    let elapsed = started.elapsed();

    assert_eq!(sha256_hex(&read_file(std::path::Path::new(&done.file_path))), sha256_hex(&body));
    assert!(
        elapsed >= Duration::from_millis(2_500),
        "1 MiB at 256 KB/s must take about four seconds, took {elapsed:?}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_partial_download_survives_an_application_restart() {
    let body = payload(1536 * 1024);
    let server = TestServer::start(ServerConfig::throttled(body.clone(), 10)).await;
    let mut harness = Harness::new("restart").await;

    let record = harness
        .add(&server.url("survivor.bin"), 2, ConflictAction::Rename)
        .await;

    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        let progress = harness.engine.progress(&record.id).expect("progress");
        if progress.downloaded >= 128 * 1024 {
            break;
        }
        assert!(Instant::now() < deadline, "no progress while downloading");
        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    // Restart: shutdown() must have checkpointed the state to SQLite.
    harness.restart().await;

    let restored = harness.engine.get(&record.id).expect("record after restart");
    assert_eq!(
        restored.status,
        DownloadStatus::Paused,
        "a download that was running must come back paused"
    );
    assert!(
        restored.downloaded >= 128 * 1024,
        "the progress from before the restart must be remembered ({} bytes)",
        restored.downloaded
    );
    assert!(!restored.segments.is_empty(), "the segment layout must survive");

    harness.engine.resume(&record.id).expect("resume");
    let done = harness
        .wait_for(&record.id, &[DownloadStatus::Completed], Duration::from_secs(120))
        .await;
    assert_eq!(sha256_hex(&read_file(std::path::Path::new(&done.file_path))), sha256_hex(&body));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn cancelling_keeps_the_partial_file_and_marks_the_record() {
    let body = payload(1536 * 1024);
    let server = TestServer::start(ServerConfig::throttled(body.clone(), 12)).await;
    let harness = Harness::new("cancel").await;

    let record = harness
        .add(&server.url("cancelled.bin"), 2, ConflictAction::Rename)
        .await;
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        let progress = harness.engine.progress(&record.id).expect("progress");
        if progress.downloaded > 32 * 1024 {
            break;
        }
        assert!(Instant::now() < deadline, "no progress while downloading");
        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    harness.engine.cancel(&record.id).expect("cancel");
    let cancelled = harness
        .wait_for(
            &record.id,
            &[DownloadStatus::Cancelled],
            Duration::from_secs(30),
        )
        .await;
    assert!(!std::path::Path::new(&cancelled.file_path).exists());
    assert!(
        std::path::Path::new(&cancelled.part_path).exists(),
        "keep_partial_files is enabled by default, so the .part file stays"
    );

    // Removing the entry always cleans up the partial data.
    harness.engine.remove(&record.id, false).expect("remove");
    assert!(
        !std::path::Path::new(&cancelled.part_path).exists(),
        "removing a download must delete its partial file"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_short_connect_timeout_still_lets_a_local_download_finish() {
    // Guards against a client that treats the connect timeout as a request
    // timeout: with a 500 ms connect timeout a local file must still download.
    let body = payload(64 * 1024);
    let server = TestServer::start(ServerConfig::throttled(body.clone(), 5)).await;
    let harness = Harness::new("timeouts").await;

    let mut settings = harness.engine.settings_snapshot().as_ref().clone();
    settings.network.connect_timeout_ms = 500;
    settings.network.stall_timeout_ms = 10_000;
    harness.engine.apply_settings(settings).expect("apply settings");

    let record = harness
        .add(&server.url("quick.bin"), 1, ConflictAction::Rename)
        .await;
    let done = harness
        .wait_for(&record.id, &[DownloadStatus::Completed], Duration::from_secs(60))
        .await;
    assert_eq!(sha256_hex(&read_file(std::path::Path::new(&done.file_path))), sha256_hex(&body));
    assert!(server.request_count() >= 1);
}
