using System;
using System.Collections.Specialized;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Shapes;
using AdzakDownloadPro.Core;
using AdzakDownloadPro.ViewModels;

namespace AdzakDownloadPro.Controls
{
    /// <summary>
    /// Live total-speed graph. Draws a filled area + line from the sample ring buffer.
    /// All values come from the engine's measured throughput — nothing is simulated.
    /// </summary>
    public partial class SpeedGraphControl : UserControl
    {
        private readonly Polyline _line = new Polyline { StrokeThickness = 2 };
        private readonly Polygon _area = new Polygon();
        private bool _subscribed;

        public SpeedGraphControl()
        {
            InitializeComponent();

            var lineBrush = (Brush?)TryFindResource("GraphLineBrush") ?? Brushes.DeepSkyBlue;
            var fillBrush = (Brush?)TryFindResource("GraphFillBrush") ?? new SolidColorBrush(Color.FromArgb(0x44, 0x00, 0xAA, 0xFF));

            _line.Stroke = lineBrush;
            _area.Fill = fillBrush;

            GraphCanvas.Children.Add(_area);
            GraphCanvas.Children.Add(_line);
        }

        /// <summary>The view model providing the samples (bytes/second), via DataContext.</summary>
        public SpeedGraphViewModel? ViewModel => DataContext as SpeedGraphViewModel;

        protected override void OnPropertyChanged(DependencyPropertyChangedEventArgs e)
        {
            base.OnPropertyChanged(e);
            if (e.Property != DataContextProperty)
                return;

            if (_subscribed && e.OldValue is SpeedGraphViewModel oldVm)
                oldVm.Samples.CollectionChanged -= OnSamplesChanged;

            if (e.NewValue is SpeedGraphViewModel newVm)
            {
                newVm.Samples.CollectionChanged += OnSamplesChanged;
                _subscribed = true;
            }
            else
            {
                _subscribed = false;
            }
            Redraw();
        }

        private void OnSamplesChanged(object? sender, NotifyCollectionChangedEventArgs e) => Redraw();

        private void OnCanvasSizeChanged(object sender, SizeChangedEventArgs e) => Redraw();

        private void Redraw()
        {
            var vm = ViewModel;
            if (vm == null)
                return;

            double width = GraphCanvas.ActualWidth;
            double height = GraphCanvas.ActualHeight;
            if (width < 10 || height < 10)
                return;

            var samples = vm.Samples;
            int count = samples.Count;
            if (count < 2)
                return;

            double max = vm.MaxSample;
            if (max <= 0)
                max = 1;

            // Nice ceiling: round the max up to a readable value.
            double ceiling = NiceCeiling(max);
            MaxLabel.Text = ByteFormatter.FormatSpeed(ceiling) + "/s";

            double stepX = width / (count - 1);
            double baseline = height - 2;

            var linePoints = new PointCollection(count);
            var areaPoints = new PointCollection(count + 2);

            for (int i = 0; i < count; i++)
            {
                double x = i * stepX;
                double normalized = Math.Min(1.0, samples[i] / ceiling);
                double y = baseline - normalized * (height - 8);
                linePoints.Add(new Point(x, y));
                areaPoints.Add(new Point(x, y));
            }

            areaPoints.Add(new Point(width, baseline));
            areaPoints.Add(new Point(0, baseline));

            _line.Points = linePoints;
            _area.Points = areaPoints;
        }

        private static double NiceCeiling(double value)
        {
            if (value <= 0)
                return 1;
            double magnitude = Math.Pow(10, Math.Floor(Math.Log10(value)));
            double normalized = value / magnitude;
            double nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
            return nice * magnitude;
        }
    }
}
