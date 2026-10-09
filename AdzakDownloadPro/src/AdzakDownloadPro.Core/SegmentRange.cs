using System;

namespace AdzakDownloadPro.Core
{
    /// <summary>
    /// An inclusive byte range <c>[Start, End]</c>. <see cref="End"/> == <see cref="long.MaxValue"/>
    /// marks an open-ended range ("from <see cref="Start"/> to the end of the file"), used when the
    /// total size is unknown.
    /// </summary>
    public readonly struct SegmentRange : IEquatable<SegmentRange>
    {
        public SegmentRange(long start, long end)
        {
            Start = start;
            End = end;
        }

        public long Start { get; }

        /// <summary>Inclusive end offset, or <see cref="long.MaxValue"/> for an open-ended range.</summary>
        public long End { get; }

        /// <summary>Number of bytes in the range, or -1 when open-ended.</summary>
        public long Length => IsOpenEnded ? -1 : End - Start + 1;

        public bool IsOpenEnded => End == long.MaxValue;

        public bool Contains(long offset) => offset >= Start && (IsOpenEnded || offset <= End);

        public bool Equals(SegmentRange other) => Start == other.Start && End == other.End;

        public override bool Equals(object? obj) => obj is SegmentRange other && Equals(other);

        public override int GetHashCode() => Start.GetHashCode() ^ (End.GetHashCode() << 1);

        public static bool operator ==(SegmentRange left, SegmentRange right) => left.Equals(right);

        public static bool operator !=(SegmentRange left, SegmentRange right) => !left.Equals(right);

        public override string ToString() => IsOpenEnded ? $"{Start}-" : $"{Start}-{End}";
    }
}
