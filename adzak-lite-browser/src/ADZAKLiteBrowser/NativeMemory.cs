using System.Runtime.InteropServices;

namespace AdzakLiteBrowser;

/// <summary>Real system-memory figures (GlobalMemoryStatusEx) — used to show
/// honest RAM pressure on 8 GB PCs instead of fake "boost" numbers.</summary>
public static class NativeMemory
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    private sealed class MemoryStatusEx
    {
        public uint Length = (uint)Marshal.SizeOf<MemoryStatusEx>();
        public uint MemoryLoad;
        public ulong TotalPhys;
        public ulong AvailPhys;
        public ulong TotalPageFile;
        public ulong AvailPageFile;
        public ulong TotalVirtual;
        public ulong AvailVirtual;
        public ulong AvailExtendedVirtual;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GlobalMemoryStatusEx([In, Out] MemoryStatusEx status);

    /// <returns>(totalGB, usedPercent) or (0,0) if unavailable.</returns>
    public static (double TotalGB, int UsedPercent) GetSystemMemory()
    {
        try
        {
            var status = new MemoryStatusEx();
            if (!GlobalMemoryStatusEx(status)) return (0, 0);
            return (status.TotalPhys / 1073741824.0, (int)status.MemoryLoad);
        }
        catch
        {
            return (0, 0);
        }
    }
}
