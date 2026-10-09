using System;
using System.Windows;

namespace AdzakDownloadPro.Services
{
    /// <summary>
    /// Applies the dark/light theme by swapping the merged ResourceDictionary that holds the
    /// theme brushes. All controls reference theme values through DynamicResource, so the whole
    /// UI updates instantly.
    /// </summary>
    public static class ThemeService
    {
        private const string DarkThemePath = "Themes/Dark.xaml";
        private const string LightThemePath = "Themes/Light.xaml";

        public static string CurrentTheme { get; private set; } = "Dark";

        public static event EventHandler? ThemeChanged;

        public static void Apply(string theme)
        {
            var app = Application.Current;
            if (app == null)
                return;

            var newPath = theme == "Light" ? LightThemePath : DarkThemePath;
            var newDict = new ResourceDictionary { Source = new Uri(newPath, UriKind.Relative) };

            // Remove the old theme dictionary (the one whose source ends with Themes/*.xaml).
            ResourceDictionary? oldTheme = null;
            foreach (var dict in app.Resources.MergedDictionaries)
            {
                if (dict.Source != null && dict.Source.OriginalString.Contains("Themes/"))
                {
                    oldTheme = dict;
                    break;
                }
            }
            if (oldTheme != null)
                app.Resources.MergedDictionaries.Remove(oldTheme);

            app.Resources.MergedDictionaries.Add(newDict);
            CurrentTheme = theme == "Light" ? "Light" : "Dark";
            ThemeChanged?.Invoke(null, EventArgs.Empty);
        }

        public static void Toggle()
            => Apply(CurrentTheme == "Dark" ? "Light" : "Dark");
    }
}
