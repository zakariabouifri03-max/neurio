const MIB = 1024 * 1024;
const MAX_SEGMENTS = 4096;

export function makeSegments(totalBytes, connections, { minimumSize = 8 * MIB, maximumSize = 64 * MIB } = {}) {
  if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0) return [];
  const workers = Math.max(1, Math.min(16, Number(connections) || 1));
  const targetSize = Math.ceil(totalBytes / (workers * 4));
  const segmentSize = Math.max(minimumSize, Math.min(maximumSize, targetSize));
  const count = Math.min(MAX_SEGMENTS, Math.ceil(totalBytes / segmentSize));
  const actualSegmentSize = Math.ceil(totalBytes / count);
  const result = [];
  for (let index = 0; index < count; index += 1) {
    const start = index * actualSegmentSize;
    const end = Math.min(totalBytes - 1, start + actualSegmentSize - 1);
    result.push({ id: index, start, end, downloadedBytes: 0, complete: false, retries: 0 });
  }
  return result;
}

export function normalizeSegments(segments, totalBytes) {
  if (!Array.isArray(segments) || !segments.length || !Number.isSafeInteger(totalBytes)) return null;
  const copy = segments.map((segment, index) => ({
    id: Number.isInteger(segment.id) ? segment.id : index,
    start: Number(segment.start),
    end: Number(segment.end),
    downloadedBytes: Math.max(0, Math.floor(Number(segment.downloadedBytes) || 0)),
    complete: Boolean(segment.complete),
    retries: Math.max(0, Math.floor(Number(segment.retries) || 0)),
  })).sort((a, b) => a.start - b.start);
  let cursor = 0;
  for (const segment of copy) {
    if (segment.start !== cursor || segment.end < segment.start || segment.end >= totalBytes) return null;
    const length = segment.end - segment.start + 1;
    if (segment.downloadedBytes > length) return null;
    if (segment.complete && segment.downloadedBytes !== length) return null;
    cursor = segment.end + 1;
  }
  return cursor === totalBytes ? copy : null;
}

export function sumSegmentBytes(segments = []) {
  return segments.reduce((sum, segment) => sum + Math.max(0, Number(segment.downloadedBytes) || 0), 0);
}

export function rangesForMetadata(segments = []) {
  return segments.map(({ start, end, downloadedBytes, complete }) => ({ start, end, downloadedBytes, complete }));
}
