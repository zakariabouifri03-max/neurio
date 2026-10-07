.class public Lcom/montaj/pro/MainActivity$Bridge;
.super Ljava/lang/Object;
.source "MainActivity.java"

# JS <-> native bridge used to write the exported video to the device
# (window.MontajBridge.beginSave / saveReady / writeChunk / endSave / lastPath)

.field private activity:Lcom/montaj/pro/MainActivity;

.method public constructor <init>(Lcom/montaj/pro/MainActivity;)V
    .registers 2

    invoke-direct {p0}, Ljava/lang/Object;-><init>()V

    iput-object p1, p0, Lcom/montaj/pro/MainActivity$Bridge;->activity:Lcom/montaj/pro/MainActivity;

    return-void
.end method

.method public beginSave(Ljava/lang/String;Ljava/lang/String;)Z
    .registers 5
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    :try_start
    iget-object v0, p0, Lcom/montaj/pro/MainActivity$Bridge;->activity:Lcom/montaj/pro/MainActivity;

    new-instance v1, Lcom/montaj/pro/MainActivity$SaveRunnable;

    invoke-direct {v1, v0, p1, p2}, Lcom/montaj/pro/MainActivity$SaveRunnable;-><init>(Lcom/montaj/pro/MainActivity;Ljava/lang/String;Ljava/lang/String;)V

    invoke-virtual {v0, v1}, Landroid/app/Activity;->runOnUiThread(Ljava/lang/Runnable;)V

    :try_end
    .catch Ljava/lang/Exception; {:try_start .. :try_end} :catch_err

    const/4 v0, 0x1

    return v0

    :catch_err
    move-exception v0

    const/4 v0, 0x0

    return v0
.end method

.method public saveReady()Z
    .registers 3
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    const/4 v0, 0x0

    :try_start
    iget-object v1, p0, Lcom/montaj/pro/MainActivity$Bridge;->activity:Lcom/montaj/pro/MainActivity;

    invoke-virtual {v1}, Lcom/montaj/pro/MainActivity;->getBridgeStream()Ljava/io/OutputStream;

    move-result-object v1

    if-eqz v1, :not_ready

    const/4 v0, 0x1

    :not_ready
    :try_end
    .catch Ljava/lang/Exception; {:try_start .. :try_end} :catch_err

    return v0

    :catch_err
    move-exception v1

    const/4 v0, 0x0

    return v0
.end method

.method public saveFailed()Z
    .registers 2
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    :try_start
    iget-object v0, p0, Lcom/montaj/pro/MainActivity$Bridge;->activity:Lcom/montaj/pro/MainActivity;

    invoke-virtual {v0}, Lcom/montaj/pro/MainActivity;->isSaveCancelled()Z

    move-result v0

    :try_end
    .catch Ljava/lang/Exception; {:try_start .. :try_end} :catch_err

    return v0

    :catch_err
    move-exception v0

    const/4 v0, 0x0

    return v0
.end method

.method public writeChunk(Ljava/lang/String;)Z
    .registers 5
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    :try_start
    iget-object v0, p0, Lcom/montaj/pro/MainActivity$Bridge;->activity:Lcom/montaj/pro/MainActivity;

    invoke-virtual {v0}, Lcom/montaj/pro/MainActivity;->getBridgeStream()Ljava/io/OutputStream;

    move-result-object v0

    if-nez v0, :fail

    const/4 v1, 0x2

    invoke-static {p1, v1}, Landroid/util/Base64;->decode(Ljava/lang/String;I)[B

    move-result-object v1

    invoke-virtual {v0, v1}, Ljava/io/OutputStream;->write([B)V

    :try_end
    .catch Ljava/lang/Exception; {:try_start .. :try_end} :catch_err

    const/4 v0, 0x1

    return v0

    :catch_err
    move-exception v0

    :fail
    const/4 v0, 0x0

    return v0
.end method

.method public endSave()Z
    .registers 3
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    :try_start
    iget-object v0, p0, Lcom/montaj/pro/MainActivity$Bridge;->activity:Lcom/montaj/pro/MainActivity;

    invoke-virtual {v0}, Lcom/montaj/pro/MainActivity;->getBridgeStream()Ljava/io/OutputStream;

    move-result-object v0

    if-nez v0, :fail

    invoke-virtual {v0}, Ljava/io/OutputStream;->flush()V

    invoke-virtual {v0}, Ljava/io/OutputStream;->close()V

    :try_end
    .catch Ljava/lang/Exception; {:try_start .. :try_end} :catch_err

    const/4 v0, 0x1

    return v0

    :catch_err
    move-exception v0

    :fail
    const/4 v0, 0x0

    return v0
.end method

.method public lastPath()Ljava/lang/String;
    .registers 3
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    :try_start
    iget-object v0, p0, Lcom/montaj/pro/MainActivity$Bridge;->activity:Lcom/montaj/pro/MainActivity;

    invoke-virtual {v0}, Lcom/montaj/pro/MainActivity;->getSaveUri()Ljava/lang/String;

    move-result-object v0

    :try_end
    .catch Ljava/lang/Exception; {:try_start .. :try_end} :catch_err

    return-object v0

    :catch_err
    move-exception v0

    const-string v0, ""

    return-object v0
.end method
