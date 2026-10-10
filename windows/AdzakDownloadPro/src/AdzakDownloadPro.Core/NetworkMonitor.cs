using System.Net.NetworkInformation;
using System.Threading.Channels;

namespace AdzakDownloadPro.Core;

/// <summary>
/// Event-driven adapter for Windows network changes with a low-frequency polling fallback.
/// A HEAD response from the actual download origin (including auth/404 responses) proves that
/// DNS, routing, TLS and the remote HTTP endpoint are reachable; transient server responses do not.
/// </summary>
public sealed class NetworkMonitor : INetworkMonitor
{
    private readonly HttpClient _httpClient;
    private readonly TimeSpan _probeTimeout;
    private readonly Channel<byte> _changes = Channel.CreateBounded<byte>(new BoundedChannelOptions(1)
    {
        SingleReader = false,
        SingleWriter = false,
        FullMode = BoundedChannelFullMode.DropOldest
    });
    private readonly CancellationTokenSource _pollStop = new();
    private readonly Task _pollTask;
    private int _lastAvailability;
    private volatile bool _disposed;

    public NetworkMonitor(HttpClient httpClient, TimeSpan? probeTimeout = null)
    {
        _httpClient = httpClient;
        _probeTimeout = probeTimeout ?? TimeSpan.FromSeconds(8);
        _lastAvailability = ReadAvailability() ? 1 : 0;
        NetworkChange.NetworkAvailabilityChanged += OnNetworkAvailabilityChanged;
        NetworkChange.NetworkAddressChanged += OnNetworkAddressChanged;
        _pollTask = PollNetworkAvailabilityAsync();
    }

    public bool IsNetworkAvailable => ReadAvailability();
    public event EventHandler? NetworkChanged;

    public async Task<bool> IsInternetReachableAsync(Uri downloadUri, CancellationToken cancellationToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(_probeTimeout);
        using var request = new HttpRequestMessage(HttpMethod.Head, downloadUri);
        request.Headers.AcceptEncoding.ParseAdd("identity");

        try
        {
            using var response = await _httpClient.SendAsync(
                request, HttpCompletionOption.ResponseHeadersRead, timeout.Token).ConfigureAwait(false);

            var status = (int)response.StatusCode;
            if (status is 408 or 425 or 429 || status >= 500)
                return false;

            // 401/403/404 and 405/501 still prove the internet/origin is reachable. The subsequent
            // real GET reports authentication, expiry, missing-resource or unsupported-HEAD errors.
            return true;
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return false;
        }
        catch (HttpRequestException)
        {
            return false;
        }
        catch (IOException)
        {
            return false;
        }
    }

    public async Task WaitForChangeAsync(TimeSpan fallbackInterval, CancellationToken cancellationToken)
    {
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var changeTask = _changes.Reader.ReadAsync(linked.Token).AsTask();
        var pollTask = Task.Delay(fallbackInterval, linked.Token);
        await Task.WhenAny(changeTask, pollTask).ConfigureAwait(false);
        linked.Cancel();

        try { await changeTask.ConfigureAwait(false); }
        catch (OperationCanceledException) { }
        catch (ChannelClosedException) { }

        cancellationToken.ThrowIfCancellationRequested();
    }

    private async Task PollNetworkAvailabilityAsync()
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(10));
        try
        {
            while (await timer.WaitForNextTickAsync(_pollStop.Token).ConfigureAwait(false))
            {
                var current = ReadAvailability() ? 1 : 0;
                var previous = Interlocked.Exchange(ref _lastAvailability, current);
                if (current != previous)
                    NotifyChanged();
            }
        }
        catch (OperationCanceledException) when (_pollStop.IsCancellationRequested) { }
    }

    private bool ReadAvailability()
    {
        try { return NetworkInterface.GetIsNetworkAvailable(); }
        catch (NetworkInformationException) { return false; }
        catch (PlatformNotSupportedException) { return true; }
    }

    private void OnNetworkAvailabilityChanged(object? sender, NetworkAvailabilityEventArgs e)
    {
        Interlocked.Exchange(ref _lastAvailability, e.IsAvailable ? 1 : 0);
        NotifyChanged();
    }

    private void OnNetworkAddressChanged(object? sender, EventArgs e)
    {
        Interlocked.Exchange(ref _lastAvailability, ReadAvailability() ? 1 : 0);
        NotifyChanged();
    }

    private void NotifyChanged()
    {
        if (_disposed)
            return;

        _changes.Writer.TryWrite(0);
        try { NetworkChanged?.Invoke(this, EventArgs.Empty); }
        catch { /* Consumer UI callbacks must not be able to break the OS notification thread. */ }
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed)
            return;

        _disposed = true;
        NetworkChange.NetworkAvailabilityChanged -= OnNetworkAvailabilityChanged;
        NetworkChange.NetworkAddressChanged -= OnNetworkAddressChanged;
        _pollStop.Cancel();
        _changes.Writer.TryComplete();
        try { await _pollTask.ConfigureAwait(false); }
        catch (OperationCanceledException) { }
        _pollStop.Dispose();
    }
}
