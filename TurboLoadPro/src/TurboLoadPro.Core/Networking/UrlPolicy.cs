namespace TurboLoadPro.Core.Networking;

public static class UrlPolicy
{
    public static Uri Validate(string value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > 8192)
            throw new ArgumentException("Enter a valid direct HTTP or HTTPS URL.", nameof(value));
        if (!Uri.TryCreate(value.Trim(), UriKind.Absolute, out var uri))
            throw new ArgumentException("Enter a valid direct HTTP or HTTPS URL.", nameof(value));
        return Validate(uri);
    }

    public static Uri ValidateRedirect(Uri current, Uri destination)
    {
        var validated = Validate(destination);
        if (current.Scheme.Equals(Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase) &&
            validated.Scheme.Equals(Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("An HTTPS download cannot be redirected to an insecure HTTP destination.");
        return validated;
    }

    public static bool TryValidate(string? value, out Uri? uri)
    {
        try
        {
            uri = Validate(value ?? string.Empty);
            return true;
        }
        catch (ArgumentException)
        {
            uri = null;
            return false;
        }
    }

    private static Uri Validate(Uri uri)
    {
        if (!uri.IsAbsoluteUri ||
            !(uri.Scheme.Equals(Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase) ||
              uri.Scheme.Equals(Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)) ||
            string.IsNullOrWhiteSpace(uri.Host) || !string.IsNullOrEmpty(uri.UserInfo))
            throw new ArgumentException("Only absolute HTTP/HTTPS URLs without embedded credentials are supported.", nameof(uri));

        var builder = new UriBuilder(uri) { Fragment = string.Empty };
        return builder.Uri;
    }
}
