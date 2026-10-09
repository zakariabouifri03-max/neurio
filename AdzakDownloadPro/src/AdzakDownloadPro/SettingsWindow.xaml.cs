using System;
using System.Globalization;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using AdzakDownloadPro.Core;
using AdzakDownloadPro.Services;
using AdzakDownloadPro.ViewModels;
using Microsoft.Win32;

namespace AdzakDownloadPro
{
    /// <summary>
    /// Settings dialog. Values are validated and clamped before being applied; the engine reads
    /// the (shared) options object live, so changes take effect immediately.
    /// </summary>
    public partial class SettingsWindow : Window
    {
        private readonly AppSettings _settings;
        private readonly MainViewModel _mainViewModel;

        public SettingsWindow(AppSettings settings, MainViewModel mainViewModel)
        {
            _settings = settings;
            _mainViewModel = mainViewModel;

            InitializeComponent();

            ThemeCombo.SelectedIndex = settings.Theme == "Light" ? 1 : 0;
            ModeCombo.SelectedIndex = settings.DefaultMode switch
            {
                DownloadMode.Low => 0,
                DownloadMode.Medium => 1,
                _ => 2,
            };

            FolderBox.Text = settings.DestinationFolder;
            LowConnectionsBox.Text = settings.LowConnections.ToString(CultureInfo.InvariantCulture);
            MediumConnectionsBox.Text = settings.MediumConnections.ToString(CultureInfo.InvariantCulture);
            ProConnectionsBox.Text = settings.ProConnections.ToString(CultureInfo.InvariantCulture);
            MaxConnectionsBox.Text = settings.MaxConnections.ToString(CultureInfo.InvariantCulture);
            MaxSimultaneousBox.Text = settings.MaxSimultaneousDownloads.ToString(CultureInfo.InvariantCulture);
            MinSegmentBox.Text = (settings.MinSegmentSizeBytes / 1024).ToString(CultureInfo.InvariantCulture);
            MaxRetriesBox.Text = settings.MaxRetries.ToString(CultureInfo.InvariantCulture);
            IdleTimeoutBox.Text = settings.IdleTimeoutSeconds.ToString(CultureInfo.InvariantCulture);
            ResponseTimeoutBox.Text = settings.ResponseTimeoutSeconds.ToString(CultureInfo.InvariantCulture);
            BufferSizeBox.Text = (settings.BufferSizeBytes / 1024).ToString(CultureInfo.InvariantCulture);
            VerifyChecksumBox.IsChecked = settings.VerifyChecksums;
        }

        private void OnBrowseFolder(object sender, RoutedEventArgs e)
        {
            var dialog = new OpenFolderDialog
            {
                Title = "Choose the download folder",
                InitialDirectory = Directory.Exists(FolderBox.Text)
                    ? FolderBox.Text
                    : Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            };
            if (dialog.ShowDialog() == true)
                FolderBox.Text = dialog.FolderName;
        }

        private void OnCancel(object sender, RoutedEventArgs e) => Close();

        private void OnSave(object sender, RoutedEventArgs e)
        {
            ErrorText.Text = string.Empty;

            if (!TryReadInt(LowConnectionsBox, 1, 64, out int low) ||
                !TryReadInt(MediumConnectionsBox, 1, 64, out int medium) ||
                !TryReadInt(ProConnectionsBox, 1, 64, out int pro) ||
                !TryReadInt(MaxConnectionsBox, 1, 64, out int max) ||
                !TryReadInt(MaxSimultaneousBox, 1, 32, out int simultaneous) ||
                !TryReadInt(MinSegmentBox, 16, 65536, out int minSegmentKb) ||
                !TryReadInt(MaxRetriesBox, 0, 20, out int retries) ||
                !TryReadInt(IdleTimeoutBox, 5, 600, out int idle) ||
                !TryReadInt(ResponseTimeoutBox, 3, 300, out int response) ||
                !TryReadInt(BufferSizeBox, 4, 4096, out int bufferKb))
            {
                ErrorText.Text = "Please enter valid numbers (see the ranges in the tooltips).";
                return;
            }

            var folder = FolderBox.Text.Trim();
            if (folder.Length == 0)
            {
                ErrorText.Text = "Please choose a destination folder.";
                return;
            }

            // Apply theme immediately so the user sees the change behind the dialog.
            var theme = ThemeCombo.SelectedIndex == 1 ? "Light" : "Dark";
            ThemeService.Apply(theme);

            _settings.Theme = theme;
            _settings.DefaultMode = ModeCombo.SelectedIndex switch
            {
                0 => DownloadMode.Low,
                1 => DownloadMode.Medium,
                _ => DownloadMode.Pro,
            };
            _settings.DestinationFolder = folder;
            _settings.LowConnections = low;
            _settings.MediumConnections = medium;
            _settings.ProConnections = pro;
            _settings.MaxConnections = max;
            _settings.MaxSimultaneousDownloads = simultaneous;
            _settings.MinSegmentSizeBytes = (long)minSegmentKb * 1024;
            _settings.MaxRetries = retries;
            _settings.IdleTimeoutSeconds = idle;
            _settings.ResponseTimeoutSeconds = response;
            _settings.BufferSizeBytes = bufferKb * 1024;
            _settings.VerifyChecksums = VerifyChecksumBox.IsChecked == true;

            // Push the values into the live engine options and the main view model.
            _mainViewModel.DestinationFolder = folder;
            _mainViewModel.SelectedMode = _settings.DefaultMode;
            _mainViewModel.ApplySettings();

            Close();
        }

        private static bool TryReadInt(TextBox box, int min, int max, out int value)
        {
            if (int.TryParse(box.Text.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out value)
                && value >= min && value <= max)
                return true;
            value = min;
            return false;
        }
    }
}
