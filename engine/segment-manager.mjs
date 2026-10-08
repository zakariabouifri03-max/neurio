export function createSegments(size, requestedConnections) {
  if (!Number.isSafeInteger(size) || size < 0) throw new RangeError('A known, non-negative file size is required for segmented downloads.');
  if (size === 0) return [];
  const count = Math.max(1, Math.min(size, Number(requestedConnections) || 1));
  const baseSize = Math.floor(size / count);
  const remainder = size % count;
  const segments = [];
  let start = 0;
  for (let index = 0; index < count; index++) {
    const length = baseSize + (index < remainder ? 1 : 0);
    const end = start + length - 1;
    segments.push({ index, start, end, downloaded: 0, complete: false, failures: 0 });
    start = end + 1;
  }
  return segments;
}

export function segmentBytes(segments = []) {
  return segments.reduce((total, segment) => total + Math.min(Math.max(0, segment.end - segment.start + 1), Math.max(0, segment.downloaded || 0)), 0);
}

export function segmentsCoverFile(segments, size) {
  if (size === 0) return segments.length === 0 || segments.every(segment => segment.complete);
  const ordered = [...segments].sort((a, b) => a.start - b.start);
  let next = 0;
  for (const segment of ordered) {
    const expected = segment.end - segment.start + 1;
    if (segment.start !== next || segment.end < segment.start || !segment.complete || segment.downloaded !== expected) return false;
    next = segment.end + 1;
  }
  return next === size;
}
