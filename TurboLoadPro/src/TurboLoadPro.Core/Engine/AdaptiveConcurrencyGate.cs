namespace TurboLoadPro.Core.Engine;

/// <summary>Dynamic per-download gate: start conservatively, ramp up on healthy responses, back off on throttling.</summary>
internal sealed class AdaptiveConcurrencyGate
{
    private readonly object _sync = new();
    private readonly int _maximum;
    private int _limit;
    private int _active;
    private int _successesSinceIncrease;
    private double _bestObservedBytesPerSecond;
    private TaskCompletionSource<bool> _changed = NewPulse();

    public AdaptiveConcurrencyGate(int maximum)
    {
        _maximum = Math.Clamp(maximum, 1, 32);
        _limit = Math.Min(_maximum, Math.Max(1, (_maximum + 1) / 2));
    }

    public async ValueTask<IDisposable> AcquireAsync(CancellationToken cancellationToken)
    {
        while (true)
        {
            Task waitTask;
            lock (_sync)
            {
                if (_active < _limit)
                {
                    _active++;
                    return new Lease(this);
                }
                waitTask = _changed.Task;
            }
            await waitTask.WaitAsync(cancellationToken).ConfigureAwait(false);
        }
    }

    public void ReportSuccess(long bytes, TimeSpan elapsed)
    {
        var rate = bytes / Math.Max(0.001, elapsed.TotalSeconds);
        lock (_sync)
        {
            // Only ramp when completed ranges sustain or improve the best observed transfer rate.
            if (_bestObservedBytesPerSecond == 0 || rate >= _bestObservedBytesPerSecond * 0.85)
                _successesSinceIncrease++;
            else
                _successesSinceIncrease = 0;
            _bestObservedBytesPerSecond = Math.Max(_bestObservedBytesPerSecond, rate);
            if (_successesSinceIncrease >= 4 && _limit < _maximum)
            {
                _limit++;
                _successesSinceIncrease = 0;
                PulseLocked();
            }
        }
    }

    public void ReportServerThrottle()
    {
        lock (_sync)
        {
            _limit = Math.Max(1, _limit / 2);
            _successesSinceIncrease = 0;
            PulseLocked();
        }
    }

    private void Release()
    {
        lock (_sync)
        {
            _active = Math.Max(0, _active - 1);
            PulseLocked();
        }
    }

    private void PulseLocked()
    {
        var previous = _changed;
        _changed = NewPulse();
        previous.TrySetResult(true);
    }

    private static TaskCompletionSource<bool> NewPulse() =>
        new(TaskCreationOptions.RunContinuationsAsynchronously);

    private sealed class Lease(AdaptiveConcurrencyGate owner) : IDisposable
    {
        private AdaptiveConcurrencyGate? _owner = owner;
        public void Dispose() => Interlocked.Exchange(ref _owner, null)?.Release();
    }
}
