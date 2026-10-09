using System.Globalization;
using System.Windows;
using Microsoft.Win32;
using TurboLoadPro.Core.Models;

namespace TurboLoadPro;

public partial class SettingsWindow : Window
{
    public DownloadSettings Settings { get; private set; }

    public SettingsWindow(DownloadSettings settings)
    {
        InitializeComponent();
        Settings = settings.Clone().Normalize();
        DirectoryBox.Text = Settings.DownloadDirectory;
        HashCheckBox.IsChecked = Settings.CalculateSha256;
        ClipboardCheckBox.IsChecked = Settings.MonitorClipboard;
        NotificationsCheckBox.IsChecked = Settings.NotifyOnCompletion;
        ResumeCheckBox.IsChecked = Settings.AutoResumeInterrupted;
        StartupCheckBox.IsChecked = Settings.StartWithWindows;

        SimultaneousCombo.ItemsSource = Enumerable.Range(1, 10).Select(value => $"{value} download{(value == 1 ? string.Empty : "s")}").ToArray();
        SimultaneousCombo.SelectedIndex = Settings.MaxSimultaneousDownloads - 1;
        ConnectionsCombo.ItemsSource = new[] { "Auto — 8 / 16 / 32", "1 connection", "8 connections", "16 connections", "32 connections" };
        ConnectionsCombo.SelectedIndex = Settings.ConnectionsPerDownload switch { 1 => 1, 8 => 2, 16 => 3, 32 => 4, _ => 0 };
        BufferCombo.ItemsSource = new[] { "64 KiB", "128 KiB", "256 KiB", "512 KiB", "1 MiB" };
        BufferCombo.SelectedIndex = Settings.BufferSizeKiB switch { 64 => 0, 128 => 1, 512 => 3, 1024 => 4, _ => 2 };
        ThemeCombo.ItemsSource = new[] { "Dark", "Light" };
        ThemeCombo.SelectedItem = Settings.Theme;
        SpeedLimitBox.Text = (Settings.GlobalSpeedLimitBytesPerSecond / (1024d * 1024d)).ToString("0.##", CultureInfo.InvariantCulture);
    }

    private void Browse_Click(object sender, RoutedEventArgs e)
    {
        var picker = new OpenFolderDialog
        {
            Title = "Choose a download folder",
            InitialDirectory = Directory.Exists(DirectoryBox.Text) ? DirectoryBox.Text : Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            Multiselect = false
        };
        if (picker.ShowDialog(this) == true)
            DirectoryBox.Text = picker.FolderName;
    }

    private void Save_Click(object sender, RoutedEventArgs e)
    {
        if (!int.TryParse((SimultaneousCombo.SelectedIndex + 1).ToString(CultureInfo.InvariantCulture), out var maximum))
        {
            MessageBox.Show(this, "Choose a valid simultaneous download limit.", "TurboLoad Pro", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }
        if (!decimal.TryParse(SpeedLimitBox.Text.Trim(), NumberStyles.Number, CultureInfo.InvariantCulture, out var limitMiB) || limitMiB < 0)
        {
            MessageBox.Show(this, "Enter a non-negative speed cap in MiB/s. Use 0 for unlimited.", "TurboLoad Pro", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }
        if (string.IsNullOrWhiteSpace(DirectoryBox.Text))
        {
            MessageBox.Show(this, "Choose a download folder.", "TurboLoad Pro", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        try
        {
            var connectionCount = ConnectionsCombo.SelectedIndex switch { 1 => 1, 2 => 8, 3 => 16, 4 => 32, _ => 0 };
            var bufferKiB = BufferCombo.SelectedIndex switch { 0 => 64, 1 => 128, 3 => 512, 4 => 1024, _ => 256 };
            Settings = Settings.Clone();
            Settings.DownloadDirectory = Path.GetFullPath(DirectoryBox.Text.Trim());
            Settings.MaxSimultaneousDownloads = maximum;
            Settings.ConnectionsPerDownload = connectionCount;
            Settings.GlobalSpeedLimitBytesPerSecond = checked((long)(limitMiB * 1024m * 1024m));
            Settings.BufferSizeKiB = bufferKiB;
            Settings.CalculateSha256 = HashCheckBox.IsChecked == true;
            Settings.MonitorClipboard = ClipboardCheckBox.IsChecked == true;
            Settings.NotifyOnCompletion = NotificationsCheckBox.IsChecked == true;
            Settings.AutoResumeInterrupted = ResumeCheckBox.IsChecked == true;
            Settings.StartWithWindows = StartupCheckBox.IsChecked == true;
            Settings.Theme = ThemeCombo.SelectedItem as string ?? "Dark";
            Settings.Normalize();
            Directory.CreateDirectory(Settings.DownloadDirectory);
            DialogResult = true;
        }
        catch (Exception exception) when (exception is ArgumentException or IOException or UnauthorizedAccessException or OverflowException)
        {
            MessageBox.Show(this, "These settings could not be applied. Verify the folder and speed value.", "TurboLoad Pro", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private void Cancel_Click(object sender, RoutedEventArgs e) => DialogResult = false;
}
