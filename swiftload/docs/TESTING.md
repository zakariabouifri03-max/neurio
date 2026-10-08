# SwiftLoad — test plan

Two layers:

1. **Automated tests** — `cargo test` runs ~90 unit tests (range arithmetic,
   resume boundaries, retry policy, limiter maths, filename collisions, settings
   clamping, database round-trips) plus the end-to-end suite in
   `src-tauri/tests/engine.rs`, which drives the real engine against a local HTTP
   server that the test file implements (ranged, non-ranged, throttled,
   interrupting, 404 and 401 variants).

   ```powershell
   cd src-tauri
   cargo test          # unit + integration
   cargo test --test engine
   ```

2. **Manual checklist** — the acceptance list below. Each row names the
   automated test that covers it, and the manual steps for the cases that need a
   real browser-facing server, a real restart or the installer.

A useful local server for the manual steps is Python’s `http.server` (no ranges,
good for the fallback case) and any static host that supports byte ranges
(most CDNs, GitHub release assets, S3) for the segmented case.

| # | Scenario | Automated | Manual steps & expected result |
|---|----------|-----------|--------------------------------|
| 1 | Small file (< 100 KB) | `segments_reconstruct_the_file_byte_for_byte` (4 MiB), `a_short_connect_timeout...` (64 KiB) | Add a small file. It finishes immediately; the size in the row equals the file on disk; the `.part` file disappears. |
| 2 | Large file (≥ 1 GB) | partially (4 MiB) | Download a 1 GB+ file from a range-capable host. Progress, speed, ETA and connection count update continuously; RAM stays flat; pause and resume work in the middle. |
| 3 | HTTPS | — | Download any `https://` file. The certificate is verified (no `danger_accept_invalid_certs`): a site with a broken certificate must fail with a TLS error rather than download. |
| 4 | Pause | `pause_keeps_the_bytes_and_resume_continues_from_them` | Press Pause: status becomes *Paused*, speed drops to 0, bytes stay on disk, the socket closes immediately (watch the server log if available). |
| 5 | Resume | same test | Press Resume: the download continues from the stored offset (the server sees a `Range: bytes=<offset>-` request), the final file matches the source. |
| 6 | Cancel | `cancelling_keeps_the_partial_file_and_marks_the_record` | Cancel: status *Cancelled*, the `.part` file remains (setting: keep partial files). Removing the entry deletes the partial data. |
| 7 | Network interruption | `an_interrupted_connection_is_retried_and_completes`, `a_permanently_interrupting_server_gives_up_with_a_reason` | Unplug the network / disable Wi-Fi while downloading: the row shows *Retrying* with the attempt counter, then continues automatically when the connection is back. |
| 8 | No `Accept-Ranges` | `a_server_without_range_support_falls_back_to_one_stream` | Download from `python -m http.server`: the engine falls back to a single connection, the file is byte-identical, and the row says “single connection”. |
| 9 | Range-capable server | `segments_reconstruct_the_file_byte_for_byte` | Download a large file from a CDN: the connection pills show several live connections and the segment map shows the byte ranges. |
| 10 | Several downloads at once | manual (concurrency is a queue policy) | Start 4 downloads with “Maximum simultaneous downloads” = 2: exactly two run, the others wait; pausing one lets the next start immediately. |
| 11 | Retry | `an_interrupted_connection_is_retried_and_completes` | Let a download fail; press Retry in the row or in the Failures view: it restarts and keeps whatever bytes were already on disk. |
| 12 | Existing filename | `an_existing_file_is_never_overwritten_silently` | Start a download into a folder that already contains the file: the dialog/report offers Replace / Keep both / Cancel, and the pre-existing file keeps its content unless Replace was chosen. |
| 13 | Invalid URL | `net::validate_url` unit tests | Type `htp:/x` or `javascript:alert(1)` in the New Download dialog: it is rejected before any request with a clear message. |
| 14 | 404 | `a_404_is_permanent_and_never_retried` | Download a missing path: the row shows *Failed* with “404 Not Found”, no automatic retries are attempted. |
| 15 | Restart during download | `a_partial_download_survives_an_application_restart` | Kill the app in the middle of a download (Task Manager). On start the download is *Paused* with its previous byte count and can be resumed; the final file is correct. |
| 16 | History persistence | database unit tests + `history` table | Finish a download, close and reopen the app: the Completed view still lists it with size, average speed and timestamp; search finds it by name; deleting the entry does not delete the file. |
| 17 | Speed limit | `the_speed_limit_actually_slows_the_transfer_down` | Set 500 KB/s globally (or 100 KB/s per download): the observed speed in Task Manager’s network graph and in the row settles around the limit, and stopping the limit restores full speed. |
| 18 | Segmented reconstruction | `segments_reconstruct_the_file_byte_for_byte` | Compare the SHA-256 of a segmented download with the source (`certutil -hashfile <file> SHA256`); enable “Compute SHA-256” to have SwiftLoad verify it as well. |
| 19 | Corrupted/incomplete segments | `resume.rs` unit tests (`apply_verified_boundary`, tail hashes) | Interrupt a download mid-write (kill the process), truncate an unrelated file next to it, then resume: verified tails are re-fetched, the delivered file still matches the source. A wrong byte range is detected by the size/coverage check before finalising. |
| 20 | Installer / uninstaller | manual | Build with `tools\build-installer.ps1`. Verify: `SwiftLoad-Setup.exe` installs per user without admin rights, creates a Start Menu entry, asks about a desktop shortcut, lists SwiftLoad in Apps & Features with icon/version/publisher, and uninstalls cleanly (shortcuts and files removed, `%LOCALAPPDATA%\SwiftLoad` is left so history is not destroyed silently — delete it manually to wipe data). |

## Additional checks worth doing once

* **Idle cost** — leave the app open with no downloads: CPU 0 %, no network
  activity, memory flat (the UI only repaints on engine events).
* **Clipboard** — copy a `.zip` URL, switch back to SwiftLoad: the dashboard
  offers it; no timer-based polling happens (the check runs on window focus).
* **Long paths / reserved names** — start a download named `CON` or with `?` in
  it: the name is sanitised instead of failing at the filesystem call.
* **Disk full / read-only folder** — point the download at a full volume: the
  error names the folder and no partial file is left behind under the final name.
* **Two instances** — launching a second copy focuses the existing window
  (single-instance plugin) instead of starting a second engine on the same DB.
