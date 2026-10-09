using System;
using System.Collections.Generic;

namespace AdzakDownloadPro.Core
{
    /// <summary>
    /// Honest throughput measurement.
    /// <list type="bullet">
    /// <item><see cref="CurrentSpeed"/>: real bytes transferred per second over a recent sliding window.</item>
    /// <item><see cref="AverageSpeed"/>: total bytes divided by the time the download was actually active
    /// (paused time is excluded).</item>
    /// </list>
    /// No estimates, no smoothing tricks, no invented numbers: every figure comes from bytes that
    /// actually moved over the wire.
    /// </summary>
    public sealed class SpeedMeter
    {
        private readonly struct Sample
        {
            public Sample(DateTimeOffset time, long cumulativeBytes)
            {
                Time = time;
                CumulativeBytes = cumulativeBytes;
            }

            public DateTimeOffset Time { get; }
            public long CumulativeBytes { get; }
        }

        private readonly object _gate = new object();
        private readonly Queue<Sample> _window = new Queue<Sample>();
        private readonly Func<DateTimeOffset> _clock;

        private long _totalBytes;
        private Sample _lastSample;
        private DateTimeOffset _startedAt;
        private DateTimeOffset _lastResumeAt;
        private DateTimeOffset _activeEnd;
        private TimeSpan _pausedTotal;
        private bool _running;

        public SpeedMeter(Func<DateTimeOffset>? clock = null)
        {
            _clock = clock ?? (() => DateTimeOffset.UtcNow);
        }

        /// <summary>Length of the sliding window used for <see cref="CurrentSpeed"/>, in seconds.</summary>
        public double WindowSeconds { get; set; } = 1.0;

        /// <summary>Total bytes observed since <see cref="Start"/> (or the last <see cref="Reset"/>).</summary>
        public long TotalBytes
        {
            get { lock (_gate) return _totalBytes; }
        }

        public bool IsRunning
        {
            get { lock (_gate) return _running; }
        }

        /// <summary>Begins (or restarts after <see cref="Reset"/>) the measurement.</summary>
        public void Start()
        {
            lock (_gate)
            {
                if (_running)
                    return;
                var now = _clock();
                if (_totalBytes == 0 && _window.Count == 0)
                {
                    _startedAt = now;
                    _pausedTotal = TimeSpan.Zero;
                }
                _running = true;
                _lastResumeAt = now;
                _activeEnd = now;
            }
        }

        /// <summary>Records that <paramref name="bytes"/> were actually transferred.</summary>
        public void AddBytes(long bytes)
        {
            if (bytes <= 0)
                return;
            lock (_gate)
            {
                _totalBytes += bytes;
                var now = _clock();
                var sample = new Sample(now, _totalBytes);
                _lastSample = sample;
                _window.Enqueue(sample);
                Evict(now);
            }
        }

        /// <summary>Excludes the paused interval from the average speed.</summary>
        public void Pause()
        {
            lock (_gate)
            {
                if (!_running)
                    return;
                _activeEnd = _clock();
                _running = false;
                _window.Clear();
            }
        }

        /// <summary>Resumes the measurement after <see cref="Pause"/>.</summary>
        public void Resume()
        {
            lock (_gate)
            {
                if (_running)
                    return;
                var now = _clock();
                _pausedTotal += now - _activeEnd;
                _running = true;
                _lastResumeAt = now;
                _activeEnd = now;
            }
        }

        /// <summary>
        /// Bytes per second measured over the recent sliding window.
        /// Returns 0 when there is not enough data yet.
        /// </summary>
        public double CurrentSpeed
        {
            get
            {
                lock (_gate)
                {
                    var now = _clock();
                    Evict(now);
                    if (_window.Count == 0)
                        return 0;

                    var first = _window.Peek();
                    double seconds = (_lastSample.Time - first.Time).TotalSeconds;
                    if (seconds <= 0.001)
                        return 0;
                    double bytes = _lastSample.CumulativeBytes - first.CumulativeBytes;
                    return bytes / seconds;
                }
            }
        }

        /// <summary>
        /// Total bytes divided by the time the download was actually transferring
        /// (paused time excluded). 0 until the download has been active for a moment.
        /// </summary>
        public double AverageSpeed
        {
            get
            {
                lock (_gate)
                {
                    var end = _running ? _clock() : _activeEnd;
                    double activeSeconds = (end - _startedAt - _pausedTotal).TotalSeconds;
                    if (activeSeconds <= 0.05)
                        return 0;
                    return _totalBytes / activeSeconds;
                }
            }
        }

        public void Reset()
        {
            lock (_gate)
            {
                _window.Clear();
                _totalBytes = 0;
                _lastSample = default;
                _startedAt = default;
                _lastResumeAt = default;
                _activeEnd = default;
                _pausedTotal = TimeSpan.Zero;
                _running = false;
            }
        }

        private void Evict(DateTimeOffset now)
        {
            var cutoff = now - TimeSpan.FromSeconds(WindowSeconds);
            while (_window.Count > 0 && _window.Peek().Time < cutoff)
                _window.Dequeue();
        }
    }
}
