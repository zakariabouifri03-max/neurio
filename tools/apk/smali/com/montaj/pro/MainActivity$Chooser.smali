.class public Lcom/montaj/pro/MainActivity$Chooser;
.super Landroid/webkit/WebChromeClient;
.source "MainActivity.java"

.field private activity:Lcom/montaj/pro/MainActivity;

.method public constructor <init>(Lcom/montaj/pro/MainActivity;)V
    .registers 2

    invoke-direct {p0}, Landroid/webkit/WebChromeClient;-><init>()V

    iput-object p1, p0, Lcom/montaj/pro/MainActivity$Chooser;->activity:Lcom/montaj/pro/MainActivity;

    return-void
.end method

# <input type="file"> support — this is what makes media import work
.method public onShowFileChooser(Landroid/webkit/WebView;Landroid/webkit/ValueCallback;Landroid/webkit/WebChromeClient$FileChooserParams;)Z
    .registers 5

    iget-object v0, p0, Lcom/montaj/pro/MainActivity$Chooser;->activity:Lcom/montaj/pro/MainActivity;

    if-nez v0, :no_activity

    invoke-virtual {v0, p1}, Lcom/montaj/pro/MainActivity;->openFileChooserWith(Landroid/webkit/ValueCallback;)V

    const/4 v0, 0x1

    return v0

    :no_activity
    const/4 v0, 0x0

    return v0
.end method

# microphone / camera permission for voiceover recording
.method public onPermissionRequest(Landroid/webkit/PermissionRequest;)V
    .registers 4

    iget-object v0, p0, Lcom/montaj/pro/MainActivity$Chooser;->activity:Lcom/montaj/pro/MainActivity;

    if-nez v0, :end

    invoke-virtual {v0, p1}, Lcom/montaj/pro/MainActivity;->handlePermission(Landroid/webkit/PermissionRequest;)V

    :end
    return-void
.end method

# keep console output for debugging
.method public onConsoleMessage(Landroid/webkit/ConsoleMessage;)Z
    .registers 3

    invoke-super {p0, p1}, Landroid/webkit/WebChromeClient;->onConsoleMessage(Landroid/webkit/ConsoleMessage;)Z

    move-result v0

    return v0
.end method
