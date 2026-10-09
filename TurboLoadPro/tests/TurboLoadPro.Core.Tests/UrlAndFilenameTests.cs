using TurboLoadPro.Core.Networking;
using TurboLoadPro.Core.Services;
using Xunit;

namespace TurboLoadPro.Core.Tests;

public sealed class UrlAndFilenameTests
{
    [Theory]
    [InlineData("https://downloads.example.org/file.zip")]
    [InlineData("http://127.0.0.1:8080/archive.iso?sig=abc")]
    public void AllowsDirectHttpAndHttpsUrls(string value)
    {
        var uri = UrlPolicy.Validate(value);
        Assert.True(uri.IsAbsoluteUri);
        Assert.True(uri.Scheme is "http" or "https");
        Assert.Equal(string.Empty, uri.UserInfo);
    }

    [Theory]
    [InlineData("ftp://downloads.example.org/file.zip")]
    [InlineData("file:///C:/Windows/win.ini")]
    [InlineData("https://user:password@example.org/file.zip")]
    public void RejectsUnsupportedSchemesAndEmbeddedCredentials(string value)
    {
        Assert.Throws<ArgumentException>(() => UrlPolicy.Validate(value));
    }

    [Fact]
    public void RejectsHttpsRedirectDowngrade()
    {
        var source = new Uri("https://downloads.example.org/start");
        var destination = new Uri("http://downloads.example.org/file.zip");
        Assert.Throws<InvalidOperationException>(() => UrlPolicy.ValidateRedirect(source, destination));
    }

    [Theory]
    [InlineData("../../private/CON.txt", "_CON.txt")]
    [InlineData("..\\..\\safe:name?.zip", "safename.zip")]
    public void SanitizesTraversalReservedAndWindowsInvalidCharacters(string input, string expected)
    {
        Assert.Equal(expected, FileNamePolicy.Sanitize(input));
    }
}
