using System;
using System.Threading;
using System.Threading.Tasks;

namespace AdzakDownloadPro.Core
{
    /// <summary>
    /// Mutable state of one byte-range segment: its position in the file, how much of it has been
    /// downloaded, where the partial data lives on disk, and its runtime handles.
    /// </summary>
    public sealed class SegmentState
    {
        public int Index { get; set; }

        /// <summary>First byte of the segment (inclusive).</summary>
        public long StartByte { get; set; }

        /// <summary>Last byte of the segment (inclusive), or <see cref="long.MaxValue"/> when open-ended.</summary>
        public long EndByte { get; set; }

        /// <summary>Bytes of this segment already stored in <see cref="TempFilePath"/>.</summary>
        public long DownloadedBytes { get; set; }

        /// <summary>File holding the segment's partial data.</summary>
        public string TempFilePath { get; set; } = string.Empty;

        public bool IsComplete { get; set; }

        /// <summary>How many download attempts this segment has needed.</summary>
        public int Attempts { get; set; }

        /// <summary>How many times this segment has been split by the adaptive controller.</summary>
        public int SplitCount { get; set; }

        public DateTimeOffset LastSplitAt { get; set; }

        /// <summary>Length of the segment in bytes, or -1 when open-ended.</summary>
        public long RangeLength => EndByte == long.MaxValue ? -1 : EndByte - StartByte + 1;

        /// <summary>Absolute file offset of the next byte to download.</summary>
        public long CurrentOffset => StartByte + DownloadedBytes;

        public SegmentRange Range => new SegmentRange(StartByte, EndByte);

        // ---- runtime-only state (not persisted) ----

        internal CancellationTokenSource? LinkedCts;
        internal Task? Task;
        internal long BytesInWindow;
        internal bool Superseded;
    }
}
