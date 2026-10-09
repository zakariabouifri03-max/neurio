namespace AdzakDownloadPro.Core
{
    /// <summary>Lifecycle state of a single download.</summary>
    public enum DownloadStatus
    {
        /// <summary>Waiting for a free download slot (simultaneous-download limit reached).</summary>
        Queued = 0,

        /// <summary>Probing the server (size, range support, redirects, checksum headers).</summary>
        Probing = 1,

        /// <summary>Actively transferring bytes.</summary>
        Downloading = 2,

        /// <summary>Merging downloaded segments into the final file.</summary>
        Merging = 3,

        /// <summary>Verifying final file size and checksum.</summary>
        Verifying = 4,

        /// <summary>Pause requested; waiting for transfers to stop.</summary>
        Pausing = 5,

        /// <summary>Stopped by the user. Progress is kept on disk and can be resumed.</summary>
        Paused = 6,

        /// <summary>Finished successfully and verified.</summary>
        Completed = 7,

        /// <summary>Failed. See <see cref="DownloadItem.ErrorMessage"/>.</summary>
        Failed = 8,

        /// <summary>Canceled by the user. Temporary files were removed.</summary>
        Canceled = 9,
    }
}
