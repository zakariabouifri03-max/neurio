namespace TurboLoadPro.Core.Engine;

/// <summary>App-wide token scheduling limiter. A zero rate is unlimited.</summary>
public sealed class BandwidthLimiter
{
    private readonly object _sync = new();
    private long _bytesPerSecond;
    private long _nextAvailableTimestamp;

    public BandwidthLimiter(long bytesPerSecond = 0) => SetLimit(bytesPerSecond);

    public void SetLimit(long bytesPerSecond)
    {
        lock (_sync)
        {
            _bytesPerSecond = Math.Max(0, bytesPerSecond);
            if (_bytesPerSecond == 0) _nextAvailableTimestamp = System.Diagnostics.Stopwatch.GetTimestamp();
        }
    }

    public async ValueTask WaitAsync(int byteCount, CancellationToken cancellationToken)
    {
        if (byteCount <= 0) return;
        TimeSpan delay;
        lock (_sync)
        {
            if (_bytesPerSecond <= 0) return;
            var now = System.Diagnostics.Stopwatch.GetTimestamp();
            var start = Math.Max(now, _nextAvailableTimestamp);
            var durationTicks = (long)(byteCount / (double)_bytesPerSecond * System.Diagnostics.Stopwatch.Frequency);
            _nextAvailableTimestamp = start + Math.Max(1, durationTicks);
            delay = TimeSpan.FromSeconds(Math.Max(0, start - now) / (double)System.Diagnostics.Stopwatch.Frequency);
        }
        if (delay > TimeSpan.Zero)
            await Task.Delay(delay, cancellationToken).ConfigureAwait(false);
    }
}
