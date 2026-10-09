using System;
using System.Globalization;

namespace AdzakDownloadPro.Core
{
    /// <summary>Human-readable formatting for sizes, speeds and ETAs (1024-based units, as is customary for download managers).</summary>
    public static class ByteFormatter
    {
        private static readonly string[] Units = { "B", "KB", "MB", "GB", "TB", "PB" };

        /// <summary>Formats a byte count, e.g. <c>83.4 KB</c>, <c>12.0 MB</c>.</summary>
        public static string FormatSize(double bytes)
        {
            if (double.IsNaN(bytes) || double.IsInfinity(bytes))
                return "—";
            if (bytes < 0)
                bytes = 0;

            int unit = 0;
            double value = bytes;
            while (value >= 1024 && unit < Units.Length - 1)
            {
                value /= 1024;
                unit++;
            }

            string number;
            if (unit == 0)
                number = value.ToString("0", CultureInfo.InvariantCulture);
            else if (value < 10)
                number = value.ToString("0.00", CultureInfo.InvariantCulture);
            else if (value < 100)
                number = value.ToString("0.0", CultureInfo.InvariantCulture);
            else
                number = value.ToString("0", CultureInfo.InvariantCulture);

            return unit == 0 ? number + " B" : number + " " + Units[unit];
        }

        /// <summary>Formats a throughput, e.g. <c>834 KB/s</c>, <c>12.4 MB/s</c>.</summary>
        public static string FormatSpeed(double bytesPerSecond) => FormatSize(bytesPerSecond) + "/s";

        /// <summary>Formats an ETA in seconds, e.g. <c>42s</c>, <c>3m 12s</c>, <c>1h 05m</c>. Null/unknown → <c>--:--</c>.</summary>
        public static string FormatEta(double? seconds)
        {
            if (seconds == null || double.IsNaN(seconds.Value) || double.IsInfinity(seconds.Value) || seconds.Value < 0)
                return "--:--";

            var ts = TimeSpan.FromSeconds(Math.Min(seconds.Value, TimeSpan.MaxValue.TotalSeconds));
            if (ts.TotalHours >= 1)
                return string.Format(CultureInfo.InvariantCulture, "{0}h {1:D2}m", (int)ts.TotalHours, ts.Minutes);
            if (ts.TotalMinutes >= 1)
                return string.Format(CultureInfo.InvariantCulture, "{0}m {1:D2}s", (int)ts.TotalMinutes, ts.Seconds);
            return string.Format(CultureInfo.InvariantCulture, "{0}s", (int)ts.TotalSeconds);
        }

        /// <summary>Formats a 0..1 fraction as a percentage. Null → <c>--</c>.</summary>
        public static string FormatPercent(double? fraction)
        {
            if (fraction == null || double.IsNaN(fraction.Value))
                return "--";
            return fraction.Value.ToString("0.#%", CultureInfo.InvariantCulture);
        }
    }
}
