using System.Windows;
using System.Windows.Media;

namespace TurboLoadPro.Infrastructure;

public static class ThemeManager
{
    public static void Apply(System.Windows.Application application, bool dark)
    {
        Set(application, "AppBackgroundBrush", dark ? "#10131A" : "#F3F5F9");
        Set(application, "SidebarBrush", dark ? "#151923" : "#FFFFFF");
        Set(application, "SurfaceBrush", dark ? "#1B202B" : "#FFFFFF");
        Set(application, "SurfaceAltBrush", dark ? "#222936" : "#F7F8FB");
        Set(application, "BorderBrush", dark ? "#303746" : "#E1E5ED");
        Set(application, "TextBrush", dark ? "#F4F6FB" : "#18202D");
        Set(application, "MutedTextBrush", dark ? "#A0A9B9" : "#737E90");
        Set(application, "AccentBrush", dark ? "#78A4FF" : "#356FE6");
        Set(application, "AccentSoftBrush", dark ? "#243653" : "#E9F0FF");
        Set(application, "SuccessBrush", dark ? "#4BD3A4" : "#168A66");
        Set(application, "WarningBrush", dark ? "#F3BD63" : "#A96800");
        Set(application, "DangerBrush", dark ? "#FF788B" : "#C43B4F");
    }

    private static void Set(System.Windows.Application application, string key, string color)
    {
        var value = (Color)ColorConverter.ConvertFromString(color)!;
        application.Resources[key] = new SolidColorBrush(value);
    }
}
