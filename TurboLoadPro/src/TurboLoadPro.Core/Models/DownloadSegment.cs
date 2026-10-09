namespace TurboLoadPro.Core.Models;

/// <summary>Inclusive byte offsets into the temporary output file.</summary>
public sealed class DownloadSegment
{
    public int Index { get; set; }
    public long Start { get; set; }
    public long End { get; set; }
    public long BytesReceived { get; set; }

    public long Length => checked(End - Start + 1);
    public bool IsComplete => BytesReceived == Length;

    public DownloadSegment Clone() => new()
    {
        Index = Index,
        Start = Start,
        End = End,
        BytesReceived = BytesReceived
    };
}
