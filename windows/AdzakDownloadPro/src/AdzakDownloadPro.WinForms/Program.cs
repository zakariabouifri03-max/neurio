using AdzakDownloadPro.Core;

namespace AdzakDownloadPro.WinForms;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();

        var queuePath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "AdzakDownloadPro",
            "downloads.json");
        var coordinator = DownloadCoordinator.CreateDefault(new DownloadQueueStore(queuePath));

        try
        {
            coordinator.InitializeAsync().GetAwaiter().GetResult();
            Application.Run(new MainForm(coordinator));
        }
        catch (Exception exception)
        {
            MessageBox.Show(
                "Adzak Download Pro could not start.\r\n\r\n" + exception.Message,
                "Startup error",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
        finally
        {
            coordinator.DisposeAsync().AsTask().GetAwaiter().GetResult();
        }
    }
}
