namespace AdzakLiteBrowser;

/// <summary>
/// Curated ad/tracker host blocklist for the Data Saver.
/// Matching is by host suffix: "doubleclick.net" also blocks "stats.doubleclick.net".
///
/// Deliberately NOT included (website compatibility): social login/embed endpoints
/// such as connect.facebook.net or platform.twitter.com — blocking those breaks
/// "Log in with …" buttons and embedded posts on many legitimate sites.
/// Blocking is user-controllable: toolbar shield or Settings → Data saver.
/// </summary>
public static class Blocklist
{
    private static readonly HashSet<string> Domains = new(StringComparer.OrdinalIgnoreCase)
    {
        // Ad networks / exchanges
        "doubleclick.net", "googlesyndication.com", "googleadservices.com", "adservice.google.com",
        "ads.yahoo.com", "adnxs.com", "adsrvr.org", "advertising.com", "rubiconproject.com",
        "pubmatic.com", "openx.net", "casalemedia.com", "criteo.com", "criteo.net",
        "smartadserver.com", "adform.net", "bidswitch.net", "amazon-adsystem.com", "media.net",
        "yieldmo.com", "sharethrough.com", "gumgum.com", "triplelift.com", "indexexchange.com",
        "sovrn.com", "rhythmone.com", "contextweb.com", "pulsepoint.com", "spotxchange.com",
        "springserve.com", "teads.tv", "unrulymedia.com", "tremorhub.com", "connatix.com",
        "popads.net", "popcash.net", "adcash.com", "propellerads.com",
        // Content-recommendation / native ad widgets
        "taboola.com", "outbrain.com", "mgid.com", "revcontent.com", "content.ad",
        // Analytics / trackers / fingerprinting beacons
        "google-analytics.com", "analytics.google.com", "scorecardresearch.com", "quantserve.com",
        "quantcount.com", "moatads.com", "doubleverify.com", "adsafeprotected.com",
        "hotjar.com", "fullstory.com", "mouseflow.com", "statcounter.com", "chartbeat.com",
        "parsely.com", "nr-data.net", "bam.nr-data.net", "comscore.com"
    };

    public static bool IsBlocked(Uri uri)
    {
        var host = uri.Host;
        if (string.IsNullOrEmpty(host)) return false;
        if (Domains.Contains(host)) return true;
        // Walk parent domains: a.b.example.com -> b.example.com -> example.com
        var dot = host.IndexOf('.');
        while (dot >= 0 && dot < host.Length - 1)
        {
            host = host[(dot + 1)..];
            if (Domains.Contains(host)) return true;
            dot = host.IndexOf('.');
        }
        return false;
    }
}
