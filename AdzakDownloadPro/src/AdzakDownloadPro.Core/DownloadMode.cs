namespace AdzakDownloadPro.Core
{
    /// <summary>
    /// Download strategy selected by the user.
    /// </summary>
    public enum DownloadMode
    {
        /// <summary>One connection, minimal CPU/memory. For weak machines and unstable lines.</summary>
        Low = 0,

        /// <summary>Configurable parallel connections when the server supports HTTP ranges; automatic retries and resume.</summary>
        Medium = 1,

        /// <summary>Full segmented downloading: splits compatible files into byte ranges, downloads them
        /// concurrently, adapts concurrency to real performance, resumes across restarts and verifies size/checksum.</summary>
        Pro = 2,
    }
}
