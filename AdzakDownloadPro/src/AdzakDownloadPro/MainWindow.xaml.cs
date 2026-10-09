using System.ComponentModel;
using System.Windows;
using AdzakDownloadPro.ViewModels;

namespace AdzakDownloadPro
{
    /// <summary>
    /// Main window. The view model owns the download engine; on close we save settings and
    /// leave partial downloads on disk (resume metadata is written continuously), so a
    /// restart resumes where the previous session stopped.
    /// </summary>
    public partial class MainWindow : Window
    {
        private readonly MainViewModel _viewModel;

        public MainWindow()
        {
            InitializeComponent();
            _viewModel = (MainViewModel)DataContext;
        }

        protected override void OnClosing(CancelEventArgs e)
        {
            try
            {
                // Persist settings. Partial downloads stay on disk with their resume metadata;
                // the next launch resumes them automatically.
                _viewModel.SaveSettings();
                _viewModel.Dispose();
            }
            catch (Exception)
            {
                // Shutdown must never throw.
            }
            base.OnClosing(e);
        }
    }
}
