.class public Lcom/montaj/pro/MainActivity$AssetClient;
.super Landroid/webkit/WebViewClient;
.source "MainActivity.java"

# serves https://appassets.androidplatform.net/app/... from the bundled assets
# (gives the editor a real secure origin: storage, workers, codecs)

.field private activity:Lcom/montaj/pro/MainActivity;

.field private triedFallback:Z

.method public constructor <init>(Lcom/montaj/pro/MainActivity;)V
    .registers 2

    invoke-direct {p0}, Landroid/webkit/WebViewClient;-><init>()V

    iput-object p1, p0, Lcom/montaj/pro/MainActivity$AssetClient;->activity:Lcom/montaj/pro/MainActivity;

    return-void
.end method

.method public shouldInterceptRequest(Landroid/webkit/WebView;Landroid/webkit/WebResourceRequest;)Landroid/webkit/WebResourceResponse;
    .registers 10

    invoke-interface {p2}, Landroid/webkit/WebResourceRequest;->getUrl()Landroid/net/Uri;

    move-result-object v0

    invoke-virtual {v0}, Landroid/net/Uri;->getPath()Ljava/lang/String;

    move-result-object v0

    if-nez v0, :fail_null

    const/4 v1, 0x1

    invoke-virtual {v0, v1}, Ljava/lang/String;->substring(I)Ljava/lang/String;

    move-result-object v0

    :try_start
    invoke-virtual {p1}, Landroid/webkit/WebView;->getContext()Landroid/content/Context;

    move-result-object v2

    invoke-virtual {v2}, Landroid/content/Context;->getAssets()Landroid/content/res/AssetManager;

    move-result-object v2

    invoke-virtual {v2, v0}, Landroid/content/res/AssetManager;->open(Ljava/lang/String;)Ljava/io/InputStream;

    move-result-object v3

    invoke-static {v0}, Lcom/montaj/pro/MainActivity$AssetClient;->mimeOf(Ljava/lang/String;)Ljava/lang/String;

    move-result-object v4

    new-instance v5, Landroid/webkit/WebResourceResponse;

    const-string v6, "UTF-8"

    invoke-direct {v5, v4, v6, v3}, Landroid/webkit/WebResourceResponse;-><init>(Ljava/lang/String;Ljava/lang/String;Ljava/io/InputStream;)V

    :try_end
    .catch Ljava/lang/Exception; {:try_start .. :try_end} :catch_fail

    return-object v5

    :catch_fail
    move-exception v2

    :fail_null
    const/4 v2, 0x0

    return-object v2
.end method

# last resort: if interception failed, load straight from the assets folder
.method public onReceivedError(Landroid/webkit/WebView;ILjava/lang/String;Ljava/lang/String;)V
    .registers 8

    if-eqz p4, :end

    const-string v0, "appassets"

    invoke-virtual {p4, v0}, Ljava/lang/String;->contains(Ljava/lang/CharSequence;)Z

    move-result v0

    if-eqz v0, :other_url

    iget-boolean v0, p0, Lcom/montaj/pro/MainActivity$AssetClient;->triedFallback:Z

    if-eqz v0, :show_error

    const/4 v0, 0x1

    iput-boolean v0, p0, Lcom/montaj/pro/MainActivity$AssetClient;->triedFallback:Z

    const-string v0, "file:///android_asset/app/index.html"

    invoke-virtual {p1, v0}, Landroid/webkit/WebView;->loadUrl(Ljava/lang/String;)V

    return-void

    :other_url
    const-string v0, "file:///android_asset"

    invoke-virtual {p4, v0}, Ljava/lang/String;->startsWith(Ljava/lang/String;)Z

    move-result v0

    if-nez v0, :end

    :show_error
    new-instance v0, Ljava/lang/StringBuilder;

    invoke-direct {v0}, Ljava/lang/StringBuilder;-><init>()V

    const-string v1, "تعذر تحميل واجهة التطبيق.\n\nرمز الخطأ: "

    invoke-virtual {v0, v1}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    invoke-virtual {v0, p2}, Ljava/lang/StringBuilder;->append(I)Ljava/lang/StringBuilder;

    const-string v1, "\n"

    invoke-virtual {v0, v1}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    invoke-virtual {v0, p3}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    const-string v1, "\n"

    invoke-virtual {v0, v1}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    invoke-virtual {v0, p4}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    const-string v1, "\n\nحدّث Android System WebView من متجر Play ثم أعد تشغيل التطبيق."

    invoke-virtual {v0, v1}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    invoke-virtual {v0}, Ljava/lang/StringBuilder;->toString()Ljava/lang/String;

    move-result-object v0

    iget-object v1, p0, Lcom/montaj/pro/MainActivity$AssetClient;->activity:Lcom/montaj/pro/MainActivity;

    invoke-virtual {v1, v0}, Lcom/montaj/pro/MainActivity;->showErrorText(Ljava/lang/String;)V

    return-void

    :end
    return-void
.end method

.method private static mimeOf(Ljava/lang/String;)Ljava/lang/String;
    .registers 3

    const-string v0, ".js"

    invoke-virtual {p0, v0}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z

    move-result v0

    if-eqz v0, :n1

    const-string v0, "application/javascript"

    return-object v0

    :n1
    const-string v0, ".css"

    invoke-virtual {p0, v0}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z

    move-result v0

    if-eqz v0, :n2

    const-string v0, "text/css"

    return-object v0

    :n2
    const-string v0, ".json"

    invoke-virtual {p0, v0}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z

    move-result v0

    if-eqz v0, :n3

    const-string v0, "application/json"

    return-object v0

    :n3
    const-string v0, ".png"

    invoke-virtual {p0, v0}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z

    move-result v0

    if-eqz v0, :n4

    const-string v0, "image/png"

    return-object v0

    :n4
    const-string v0, ".jpg"

    invoke-virtual {p0, v0}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z

    move-result v0

    if-eqz v0, :n5

    const-string v0, "image/jpeg"

    return-object v0

    :n5
    const-string v0, ".woff2"

    invoke-virtual {p0, v0}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z

    move-result v0

    if-eqz v0, :n6

    const-string v0, "font/woff2"

    return-object v0

    :n6
    const-string v0, ".svg"

    invoke-virtual {p0, v0}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z

    move-result v0

    if-eqz v0, :n7

    const-string v0, "image/svg+xml"

    return-object v0

    :n7
    const-string v0, "text/html"

    return-object v0
.end method
