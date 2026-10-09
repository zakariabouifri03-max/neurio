using System;
using AdzakDownloadPro.Core;
using AdzakDownloadPro.Tests.TestFramework;

namespace AdzakDownloadPro.Tests
{
    public sealed class SpeedMeterTests
    {
        private sealed class FakeClock
        {
            public DateTimeOffset Now { get; set; } = new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);
            public DateTimeOffset UtcNow() => Now;
            public void Advance(TimeSpan span) => Now += span;
        }

        [Fact]
        public void Current_speed_is_measured_from_real_bytes_over_time()
        {
            var clock = new FakeClock();
            var meter = new SpeedMeter(clock.UtcNow);
            meter.Start();

            clock.Advance(TimeSpan.FromSeconds(1));
            meter.AddBytes(1000); // 1000 bytes in the first second

            clock.Advance(TimeSpan.FromSeconds(1));
            meter.AddBytes(3000); // 3000 more bytes in the second second

            // Window covers the last second: 3000 bytes / 1 second.
            Assert.Equal(3000.0, meter.CurrentSpeed, 0.01);
        }

        [Fact]
        public void Current_speed_is_zero_without_samples()
        {
            var meter = new SpeedMeter();
            meter.Start();
            Assert.Equal(0.0, meter.CurrentSpeed);
        }

        [Fact]
        public void Average_speed_is_total_over_active_time()
        {
            var clock = new FakeClock();
            var meter = new SpeedMeter(clock.UtcNow);
            meter.Start();

            clock.Advance(TimeSpan.FromSeconds(2));
            meter.AddBytes(2000);
            clock.Advance(TimeSpan.FromSeconds(2));
            meter.AddBytes(2000);

            // 4000 bytes over 4 active seconds.
            Assert.Equal(1000.0, meter.AverageSpeed, 0.01);
        }

        [Fact]
        public void Pause_excludes_paused_time_from_average()
        {
            var clock = new FakeClock();
            var meter = new SpeedMeter(clock.UtcNow);
            meter.Start();

            clock.Advance(TimeSpan.FromSeconds(1));
            meter.AddBytes(1000);

            meter.Pause();
            clock.Advance(TimeSpan.FromSeconds(100)); // long pause — must not count
            meter.Resume();

            clock.Advance(TimeSpan.FromSeconds(1));
            meter.AddBytes(1000);

            // 2000 bytes over 2 active seconds.
            Assert.Equal(1000.0, meter.AverageSpeed, 0.01);
        }

        [Fact]
        public void Pause_clears_current_speed_until_new_bytes_arrive()
        {
            var clock = new FakeClock();
            var meter = new SpeedMeter(clock.UtcNow);
            meter.Start();
            clock.Advance(TimeSpan.FromSeconds(1));
            meter.AddBytes(2500);
            clock.Advance(TimeSpan.FromSeconds(1));
            meter.AddBytes(2500);
            Assert.True(meter.CurrentSpeed > 0); // 2500 bytes over the last second

            meter.Pause();
            Assert.Equal(0.0, meter.CurrentSpeed);
        }

        [Fact]
        public void Reset_clears_everything()
        {
            var clock = new FakeClock();
            var meter = new SpeedMeter(clock.UtcNow);
            meter.Start();
            clock.Advance(TimeSpan.FromSeconds(1));
            meter.AddBytes(5000);

            meter.Reset();
            Assert.Equal(0, meter.TotalBytes);
            Assert.Equal(0.0, meter.CurrentSpeed);
            Assert.Equal(0.0, meter.AverageSpeed);
        }

        [Fact]
        public void AddBytes_ignores_non_positive_values()
        {
            var meter = new SpeedMeter();
            meter.Start();
            meter.AddBytes(0);
            meter.AddBytes(-5);
            Assert.Equal(0, meter.TotalBytes);
        }
    }
}
