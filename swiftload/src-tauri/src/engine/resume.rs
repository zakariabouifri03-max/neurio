//! Resume manager — decides *what* still has to be downloaded.
//!
//! Two situations produce a plan:
//!
//! 1. **Fresh download.** The plan is derived from the total size and the
//!    connection count, splitting the file into equal, contiguous, gap-free
//!    ranges. If the server does not support byte ranges — or the size is
//!    unknown — the plan is a single open-ended segment, because fragmenting
//!    without range support would silently corrupt the output.
//!
//! 2. **Resume.** The stored plan is reused *verbatim* when it is still valid
//!    (it may have been produced by the adaptive controller, which splits ranges
//!    while a download runs). Every segment's resume boundary is then validated
//!    against the bytes actually on disk using the recorded 32-byte tail guard;
//!    a boundary that does not match is re-fetched rather than trusted. That is
//!    what keeps a crash from turning into a corrupt file.

use std::fs::File;

use crate::error::Result;
use crate::settings::DownloadSettings;
pub use crate::types::OPEN_END;

use crate::types::{DownloadRecord, ResourceMeta, SegmentPlan};

use super::files::{guard_from_written, verify_guard, ResumeRecord, SegmentGuard};

/// Fraction of a file below which fragmenting is pointless overhead.
pub const MIN_FRAGMENT_BYTES: u64 = 1024 * 1024;

/// Result of planning: the segment layout plus everything the engine and the UI
/// need to know about how it came to be.
#[derive(Debug, Clone, PartialEq)]
pub struct PlanOutcome {
    pub segments: Vec<SegmentPlan>,
    pub total: Option<u64>,
    pub fragmentable: bool,
    /// `true` when previously downloaded bytes had to be discarded.
    pub restart: bool,
    /// Explanations surfaced in the log ("segment 2 failed its integrity check").
    pub notes: Vec<String>,
    /// Bytes that survived validation.
    pub retained_bytes: u64,
}

impl PlanOutcome {
    pub fn is_open_ended(&self) -> bool {
        self.segments.iter().any(|s| s.end == OPEN_END)
    }
}

/// Builds a fresh plan.
///
/// `connections` is clamped so that no segment is smaller than
/// `min_segment_bytes` (a 2 MiB file gets one connection, not sixteen).
pub fn fresh_plan(
    total: Option<u64>,
    fragmentable: bool,
    connections: u32,
    min_segment_bytes: u64,
) -> PlanOutcome {
    let connections = connections.max(1);
    match total {
        Some(total) if fragmentable && total > 0 => {
            let min_segment = min_segment_bytes.max(MIN_FRAGMENT_BYTES);
            let by_size = (total / min_segment).max(1) as u32;
            let count = connections.min(by_size).max(1);
            PlanOutcome {
                segments: split_evenly(total, count),
                total: Some(total),
                fragmentable: count > 1,
                restart: false,
                notes: Vec::new(),
                retained_bytes: 0,
            }
        }
        _ => PlanOutcome {
            segments: vec![SegmentPlan {
                index: 0,
                start: 0,
                end: total.map(|t| t.saturating_sub(1)).unwrap_or(OPEN_END),
                downloaded: 0,
                done: false,
            }],
            total,
            fragmentable: false,
            restart: false,
            notes: Vec::new(),
            retained_bytes: 0,
        },
    }
}

/// Splits `[0, total)` into `count` contiguous, gap-free, equal-sized ranges.
///
/// Uses integer division on absolute offsets (`start = i * total / count`) so the
/// union of all segments is exactly `[0, total)` for every combination of
/// `total` and `count`, with no rounding holes and no overlapping bytes.
pub fn split_evenly(total: u64, count: u32) -> Vec<SegmentPlan> {
    let count = count.max(1) as u64;
    let mut segments = Vec::with_capacity(count as usize);
    for index in 0..count {
        let start = index * total / count;
        let end = (index + 1) * total / count;
        segments.push(SegmentPlan::new(
            index as usize,
            start,
            end.saturating_sub(1),
        ));
    }
    if let Some(last) = segments.last_mut() {
        last.end = total.saturating_sub(1);
    }
    segments
}

/// Input for a resume decision.
pub struct ResumeInput<'a> {
    pub record: &'a DownloadRecord,
    pub meta: &'a ResourceMeta,
    pub file: Option<&'a File>,
    pub resume: Option<&'a ResumeRecord>,
    pub settings: &'a DownloadSettings,
}

/// Decides how a (possibly partially downloaded) file continues.
pub fn build_plan(input: ResumeInput<'_>) -> Result<PlanOutcome> {
    let ResumeInput {
        record,
        meta,
        file,
        resume,
        settings,
    } = input;

    // The freshly probed size wins: if the file grew or shrank on the server the
    // old plan is meaningless.
    let total = meta.total_bytes.or(record.total);
    let fragmentable = meta.accepts_ranges;
    let mut notes = Vec::new();

    // 1. The server lost range support (or never had it): single stream.
    if !fragmentable {
        let existing = existing_bytes(file);
        // Without ranges we can only continue from the end of the partial file.
        let downloaded = existing.min(total.unwrap_or(existing));
        let mut segments = vec![SegmentPlan {
            index: 0,
            start: 0,
            end: total.map(|t| t.saturating_sub(1)).unwrap_or(OPEN_END),
            downloaded,
            done: false,
        }];
        if downloaded > 0 && total.is_some() && downloaded >= total.unwrap_or(0) {
            segments[0].done = true;
            segments[0].downloaded = total.unwrap_or(downloaded);
        }
        if record.is_fragmented() {
            notes.push(
                "the server no longer advertises byte ranges; continuing with a single connection"
                    .to_string(),
            );
        }
        let retained = segments[0].downloaded;
        return Ok(PlanOutcome {
            segments,
            total,
            fragmentable: false,
            restart: false,
            notes,
            retained_bytes: retained,
        });
    }

    // 2. Range support confirmed: reuse the stored layout when it is still valid.
    let stored_layout: Vec<SegmentGuard> = match resume {
        Some(record) if !record.segments.is_empty() => record.segments.clone(),
        _ => record
            .segments
            .iter()
            .map(|s| guard_from_written(s.index, s.start, s.end, s.downloaded, None))
            .collect(),
    };

    let layout_valid = !stored_layout.is_empty() && covers_exactly(&stored_layout, total);

    if !layout_valid {
        if total.is_none() {
            // Fragmenting without a known size cannot be verified afterwards.
            return Ok(fresh_plan(total, false, 1, settings.min_segment_bytes));
        }
        let mut outcome = fresh_plan(
            total,
            true,
            settings.connections_per_download,
            settings.min_segment_bytes,
        );
        if !stored_layout.is_empty() {
            notes.push(
                "the stored segment plan did not match the file, so the download restarts from the beginning"
                    .to_string(),
            );
            outcome.restart = true;
        }
        return Ok(outcome);
    }

    // 3. Validate every resume boundary against the bytes on disk.
    let mut segments = Vec::with_capacity(stored_layout.len());
    let mut restart = false;
    let mut retained = 0u64;

    for guard in &stored_layout {
        let mut plan = SegmentPlan {
            index: guard.index,
            start: guard.start,
            end: guard.end,
            downloaded: guard.written.min(guard.end.saturating_sub(guard.start).saturating_add(1)),
            done: false,
        };
        let length = guard.end.saturating_sub(guard.start).saturating_add(1);
        if plan.downloaded >= length {
            plan.downloaded = length;
            plan.done = true;
            retained += length;
            segments.push(plan);
            continue;
        }

        if plan.downloaded > 0 {
            let boundary = guard.start + plan.downloaded;
            let verified = match file {
                Some(file) => verify_guard(file, boundary, plan.downloaded, guard.tail.as_deref())?,
                None => false,
            };
            if verified {
                retained += plan.downloaded;
            } else if settings.verify_on_resume {
                notes.push(format!(
                    "segment {} failed its integrity check at byte {}; it will be downloaded again",
                    guard.index, boundary
                ));
                plan.downloaded = 0;
                restart = true;
            } else {
                // Integrity checks disabled by the user: trust the record but
                // still make sure the bytes exist on disk.
                if let Some(file) = file {
                    let len = file.metadata().map(|m| m.len()).unwrap_or(0);
                    if boundary > len && guard.end != OPEN_END {
                        notes.push(format!(
                            "segment {} was recorded past the end of the partial file; re-downloading it",
                            guard.index
                        ));
                        plan.downloaded = 0;
                        restart = true;
                    } else {
                        retained += plan.downloaded;
                    }
                }
            }
        }

        if !plan.done {
            plan.done = plan.downloaded >= length;
        }
        segments.push(plan);
    }

    Ok(PlanOutcome {
        segments,
        total,
        fragmentable: true,
        restart,
        notes,
        retained_bytes: retained,
    })
}

/// True when the layout covers `[0, total)` exactly once, without gaps.
pub fn covers_exactly(layout: &[SegmentGuard], total: Option<u64>) -> bool {
    if layout.is_empty() {
        return false;
    }
    let mut sorted: Vec<&SegmentGuard> = layout.iter().collect();
    sorted.sort_by_key(|s| s.start);
    if sorted[0].start != 0 {
        return false;
    }
    let mut expected_next = 0u64;
    for segment in &sorted {
        if segment.start != expected_next || segment.end < segment.start {
            return false;
        }
        expected_next = match segment.end.checked_add(1) {
            Some(next) => next,
            None => return total.is_none(), // open-ended tail
        };
    }
    match total {
        Some(total) => expected_next == total,
        None => true,
    }
}

/// Sum of `written` over a stored layout.
pub fn layout_written(layout: &[SegmentGuard]) -> u64 {
    layout.iter().map(|s| s.written).sum()
}

fn existing_bytes(file: Option<&File>) -> u64 {
    file.and_then(|f| f.metadata().ok())
        .map(|m| m.len())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::files::{write_all_at, PartLocation};
    use crate::types::DownloadStatus;

    fn settings() -> DownloadSettings {
        DownloadSettings {
            max_concurrent: 3,
            connections_per_download: 4,
            max_connections_per_download: 8,
            adaptive_connections: true,
            min_segment_bytes: 4 * 1024 * 1024,
            max_retries: 5,
            retry_delay_ms: 1000,
            retry_max_delay_ms: 60_000,
            speed_limit_bps: None,
            verify_on_resume: true,
            keep_partial_files: true,
            verify_ranges: true,
            compute_sha256: false,
            check_free_space: true,
        }
    }

    fn meta(total: Option<u64>, ranges: bool) -> ResourceMeta {
        ResourceMeta {
            final_url: "https://example.com/f.bin".into(),
            filename: "f.bin".into(),
            total_bytes: total,
            accepts_ranges: ranges,
            http_status: if ranges { 206 } else { 200 },
            ..Default::default()
        }
    }

    fn record(segments: Vec<SegmentPlan>, total: Option<u64>, fragmentable: bool) -> DownloadRecord {
        DownloadRecord {
            id: "id".into(),
            url: "https://example.com/f.bin".into(),
            final_url: "https://example.com/f.bin".into(),
            filename: "f.bin".into(),
            dest_dir: "C:\\DL".into(),
            file_path: "C:\\DL\\f.bin".into(),
            part_path: "C:\\DL\\.swiftload\\f.bin.part".into(),
            status: DownloadStatus::Paused,
            error: None,
            fragmentable,
            connections: 4,
            segments,
            downloaded: 0,
            total,
            etag: None,
            last_modified: None,
            content_type: None,
            sha256: None,
            created_at: 0,
            started_at: None,
            completed_at: None,
            elapsed_secs: 0.0,
            position: 0,
            retry_count: 0,
            speed_limit_bps: None,
            category: "other".into(),
        }
    }

    #[test]
    fn split_evenly_covers_everything_exactly_once() {
        for total in [1u64, 2, 7, 1000, 1024 * 1024 + 13, 5_000_000_000] {
            for count in 1u32..=16 {
                let segments = split_evenly(total, count);
                assert_eq!(segments.len(), count as usize);
                assert_eq!(segments[0].start, 0);
                assert_eq!(segments.last().unwrap().end, total - 1);
                let mut expected_next = 0u64;
                for segment in &segments {
                    assert_eq!(segment.start, expected_next);
                    expected_next = segment.end + 1;
                    assert!(segment.end >= segment.start);
                }
                assert_eq!(expected_next, total);
                let sum: u64 = segments.iter().map(|s| s.len()).sum();
                assert_eq!(sum, total);
            }
        }
    }

    #[test]
    fn fresh_plan_respects_minimum_segment_size() {
        let outcome = fresh_plan(Some(2 * 1024 * 1024), true, 16, 4 * 1024 * 1024);
        assert_eq!(outcome.segments.len(), 1);
        assert!(!outcome.fragmentable);

        let outcome = fresh_plan(Some(64 * 1024 * 1024), true, 4, 4 * 1024 * 1024);
        assert_eq!(outcome.segments.len(), 4);
        assert!(outcome.fragmentable);

        // Unknown size or no range support: exactly one open-ended segment.
        let outcome = fresh_plan(None, true, 8, 4 * 1024 * 1024);
        assert_eq!(outcome.segments.len(), 1);
        assert_eq!(outcome.segments[0].end, OPEN_END);
        assert!(outcome.is_open_ended());

        let outcome = fresh_plan(Some(10_000_000), false, 8, 4 * 1024 * 1024);
        assert_eq!(outcome.segments.len(), 1);
        assert_eq!(outcome.segments[0].end, 9_999_999);
    }

    #[test]
    fn resume_keeps_a_valid_layout_and_validates_boundaries() {
        let dir = std::env::temp_dir().join(format!("swiftload-resume-{}", crate::util::random_id()));
        std::fs::create_dir_all(&dir).unwrap();
        let location = PartLocation {
            dir: dir.clone(),
            part: dir.join("f.part"),
            meta: dir.join("f.swlmeta"),
        };
        let total = 4096u64;
        let segments = split_evenly(total, 2);

        // Segment 0 fully written, segment 1 half written.
        let data0 = vec![0xA1u8; 2048];
        let data1 = vec![0xB2u8; 1024];
        {
            let file = super::files::open_part_file(&location, Some(total), true, false).unwrap();
            write_all_at(&file, &data0, 0).unwrap();
            write_all_at(&file, &data1, 2048).unwrap();
            file.sync_all().unwrap();
        }
        let file = std::fs::OpenOptions::new().read(true).write(true).open(&location.part).unwrap();

        let guards = vec![
            guard_from_written(0, segments[0].start, segments[0].end, 2048, super::files::tail_guard(&data0)),
            guard_from_written(1, segments[1].start, segments[1].end, 1024, super::files::tail_guard(&data1)),
        ];
        let resume = ResumeRecord {
            version: super::files::META_VERSION,
            id: "id".into(),
            url: "https://example.com/f.bin".into(),
            final_url: String::new(),
            filename: "f.bin".into(),
            total: Some(total),
            fragmentable: true,
            etag: None,
            last_modified: None,
            connections: 2,
            segments: guards.clone(),
            updated_at: 0,
        };

        let outcome = build_plan(ResumeInput {
            record: &record(segments.clone(), Some(total), true),
            meta: &meta(Some(total), true),
            file: Some(&file),
            resume: Some(&resume),
            settings: &settings(),
        })
        .unwrap();

        assert!(outcome.segments[0].done);
        assert_eq!(outcome.segments[0].downloaded, 2048);
        assert_eq!(outcome.segments[1].downloaded, 1024);
        assert!(!outcome.restart);
        assert_eq!(outcome.retained_bytes, 3072);
        assert!(outcome.notes.is_empty());

        // Now corrupt segment 1's boundary: the guard must catch it.
        write_all_at(&file, &[0xFFu8; 64], 2048).unwrap();
        let outcome = build_plan(ResumeInput {
            record: &record(segments.clone(), Some(total), true),
            meta: &meta(Some(total), true),
            file: Some(&file),
            resume: Some(&resume),
            settings: &settings(),
        })
        .unwrap();
        assert_eq!(outcome.segments[1].downloaded, 0, "corrupt boundary was trusted");
        assert!(outcome.restart);
        assert_eq!(outcome.notes.len(), 1);
        // Segment 0 is untouched and stays complete.
        assert!(outcome.segments[0].done);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn resume_without_sidecar_restarts_unverifiable_segments() {
        let dir = std::env::temp_dir().join(format!("swiftload-resume-{}", crate::util::random_id()));
        std::fs::create_dir_all(&dir).unwrap();
        let total = 4096u64;
        let segments = split_evenly(total, 2);
        let location = PartLocation {
            dir: dir.clone(),
            part: dir.join("f.part"),
            meta: dir.join("f.swlmeta"),
        };
        let file = super::files::open_part_file(&location, Some(total), true, false).unwrap();
        write_all_at(&file, &vec![1u8; 2048], 0).unwrap();

        // DB says 2048 bytes were written, but there is no tail guard to prove it.
        let mut stored = segments.clone();
        stored[0].downloaded = 2048;
        let outcome = build_plan(ResumeInput {
            record: &record(stored, Some(total), true),
            meta: &meta(Some(total), true),
            file: Some(&file),
            resume: None,
            settings: &settings(),
        })
        .unwrap();
        assert_eq!(outcome.segments[0].downloaded, 0);
        assert!(outcome.notes[0].contains("integrity check"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn resume_falls_back_to_single_stream_without_range_support() {
        let dir = std::env::temp_dir().join(format!("swiftload-resume-{}", crate::util::random_id()));
        std::fs::create_dir_all(&dir).unwrap();
        let location = PartLocation {
            dir: dir.clone(),
            part: dir.join("f.part"),
            meta: dir.join("f.swlmeta"),
        };
        let file = std::fs::OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .open(&location.part)
            .unwrap();
        write_all_at(&file, &[9u8; 500], 0).unwrap();
        file.sync_all().unwrap();

        let outcome = build_plan(ResumeInput {
            record: &record(split_evenly(1000, 2), Some(1000), true),
            meta: &meta(Some(1000), false),
            file: Some(&file),
            resume: None,
            settings: &settings(),
        })
        .unwrap();
        assert!(!outcome.fragmentable);
        assert_eq!(outcome.segments.len(), 1);
        assert_eq!(outcome.segments[0].downloaded, 500);
        assert_eq!(outcome.notes.len(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn changed_total_invalidates_the_layout() {
        let outcome = build_plan(ResumeInput {
            record: &record(split_evenly(1000, 2), Some(1000), true),
            meta: &meta(Some(5000), true),
            file: None,
            resume: None,
            settings: &settings(),
        })
        .unwrap();
        assert_eq!(outcome.total, Some(5000));
        assert_eq!(outcome.segments.last().unwrap().end, 4999);
        assert!(outcome.restart);
    }

    #[test]
    fn coverage_check_rejects_gaps_and_overlaps() {
        let good = vec![
            guard_from_written(0, 0, 499, 0, None),
            guard_from_written(1, 500, 999, 0, None),
        ];
        assert!(covers_exactly(&good, Some(1000)));
        assert!(!covers_exactly(&good, Some(1001)));

        let gap = vec![
            guard_from_written(0, 0, 499, 0, None),
            guard_from_written(1, 501, 999, 0, None),
        ];
        assert!(!covers_exactly(&gap, Some(1000)));

        let overlap = vec![
            guard_from_written(0, 0, 600, 0, None),
            guard_from_written(1, 500, 999, 0, None),
        ];
        assert!(!covers_exactly(&overlap, Some(1000)));

        assert!(!covers_exactly(&[], Some(1000)));
    }
}
