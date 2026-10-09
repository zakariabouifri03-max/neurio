using System.Collections.ObjectModel;

namespace AdzakDownloadPro.ViewModels
{
    /// <summary>
    /// Ring buffer of total-speed samples for the live speed graph.
    /// The engine only ever reports measured bytes/second.
    /// </summary>
    public sealed class SpeedGraphViewModel : ViewModelBase
    {
        public const int MaxSamples = 240; // 240 × 500 ms = 2 minutes of history

        private readonly ObservableCollection<double> _samples = new ObservableCollection<double>();
        private double _maxSample;

        public SpeedGraphViewModel()
        {
            for (int i = 0; i < MaxSamples; i++)
                _samples.Add(0);
        }

        /// <summary>Samples in bytes/second, oldest first. Fixed length (<see cref="MaxSamples"/>).</summary>
        public ObservableCollection<double> Samples => _samples;

        /// <summary>Largest sample currently in the window (used to scale the graph).</summary>
        public double MaxSample { get => _maxSample; private set => Set(ref _maxSample, value); }

        public void AddSample(double bytesPerSecond)
        {
            _samples.RemoveAt(0);
            _samples.Add(bytesPerSecond);

            double max = 0;
            foreach (var s in _samples)
                if (s > max)
                    max = s;
            MaxSample = max;
        }

        public void Clear()
        {
            for (int i = 0; i < _samples.Count; i++)
                _samples[i] = 0;
            MaxSample = 0;
        }
    }
}
