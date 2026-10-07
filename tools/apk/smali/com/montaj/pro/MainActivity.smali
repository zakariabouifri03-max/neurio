.class public Lcom/montaj/pro/MainActivity;
.super Landroid/app/Activity;
.source "MainActivity.java"

# ---------------------------------------------------------------------------
#  Montaj Pro — Android shell: fullscreen WebView + native file chooser
#  + "save to device" bridge + mic permission for voiceover
# ---------------------------------------------------------------------------

.field private static final REQ_FILE:I = 0x3e9

.field private static final REQ_SAVE:I = 0x3ea

.field private static final REQ_MIC:I = 0x3eb

.field private webView:Landroid/webkit/WebView;

.field private loadingView:Landroid/widget/TextView;

.field private filePathCallback:Landroid/webkit/ValueCallback;

.field private saveStream:Ljava/io/OutputStream;

.field private saveName:Ljava/lang/String;

.field private saveUri:Landroid/net/Uri;

.field private saveCancelled:Z

.field private permRequest:Landroid/webkit/PermissionRequest;

.method public constructor <init>()V
    .registers 1

    invoke-direct {p0}, Landroid/app/Activity;-><init>()V

    return-void
.end method

.method public onCreate(Landroid/os/Bundle;)V
    .registers 6

    invoke-super {p0, p1}, Landroid/app/Activity;->onCreate(Landroid/os/Bundle;)V

    :try_start
    invoke-virtual {p0}, Lcom/montaj/pro/MainActivity;->buildUi()V

    :try_end
    .catch Ljava/lang/Throwable; {:try_start .. :try_end} :catch_err

    return-void

    :catch_err
    move-exception v0

    new-instance v1, Ljava/lang/StringBuilder;

    invoke-direct {v1}, Ljava/lang/StringBuilder;-><init>()V

    const-string v2, "تعذر تشغيل التطبيق.\n\n"

    invoke-virtual {v1, v2}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    invoke-virtual {v0}, Ljava/lang/Throwable;->toString()Ljava/lang/String;

    move-result-object v2

    invoke-virtual {v1, v2}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    const-string v2, "\n\nتأكد أن Android System WebView مفعّل ومحدّث من إعدادات النظام."

    invoke-virtual {v1, v2}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    invoke-virtual {v1}, Ljava/lang/StringBuilder;->toString()Ljava/lang/String;

    move-result-object v0

    invoke-virtual {p0, v0}, Lcom/montaj/pro/MainActivity;->showErrorText(Ljava/lang/String;)V

    return-void
.end method

# actual UI construction (kept apart so any failure can be shown on screen)
.method public buildUi()V
    .registers 5

    const/4 v0, 0x1

    invoke-virtual {p0, v0}, Landroid/app/Activity;->requestWindowFeature(I)Z

    invoke-virtual {p0}, Landroid/app/Activity;->getWindow()Landroid/view/Window;
    move-result-object v0

    const/16 v1, 0x80

    invoke-virtual {v0, v1}, Landroid/view/Window;->addFlags(I)V

    new-instance v0, Landroid/webkit/WebView;

    invoke-direct {v0, p0}, Landroid/webkit/WebView;-><init>(Landroid/content/Context;)V

    iput-object v0, p0, Lcom/montaj/pro/MainActivity;->webView:Landroid/webkit/WebView;

    invoke-virtual {v0}, Landroid/webkit/WebView;->getSettings()Landroid/webkit/WebSettings;
    move-result-object v0

    const/4 v1, 0x1

    invoke-virtual {v0, v1}, Landroid/webkit/WebSettings;->setJavaScriptEnabled(Z)V

    invoke-virtual {v0, v1}, Landroid/webkit/WebSettings;->setDomStorageEnabled(Z)V

    invoke-virtual {v0, v1}, Landroid/webkit/WebSettings;->setDatabaseEnabled(Z)V

    invoke-virtual {v0, v1}, Landroid/webkit/WebSettings;->setAllowFileAccess(Z)V

    invoke-virtual {v0, v1}, Landroid/webkit/WebSettings;->setAllowFileAccessFromFileURLs(Z)V

    const/4 v2, 0x0

    invoke-virtual {v0, v2}, Landroid/webkit/WebSettings;->setMediaPlaybackRequiresUserGesture(Z)V

    invoke-virtual {v0, v1}, Landroid/webkit/WebSettings;->setLoadWithOverviewMode(Z)V

    invoke-virtual {v0, v1}, Landroid/webkit/WebSettings;->setUseWideViewPort(Z)V

    iget-object v0, p0, Lcom/montaj/pro/MainActivity;->webView:Landroid/webkit/WebView;

    const/4 v1, 0x0

    invoke-virtual {v0, v1}, Landroid/webkit/WebView;->setBackgroundColor(I)V

    iget-object v0, p0, Lcom/montaj/pro/MainActivity;->webView:Landroid/webkit/WebView;

    new-instance v1, Lcom/montaj/pro/MainActivity$AssetClient;

    invoke-direct {v1, p0}, Lcom/montaj/pro/MainActivity$AssetClient;-><init>(Lcom/montaj/pro/MainActivity;)V

    invoke-virtual {v0, v1}, Landroid/webkit/WebView;->setWebViewClient(Landroid/webkit/WebViewClient;)V

    iget-object v0, p0, Lcom/montaj/pro/MainActivity;->webView:Landroid/webkit/WebView;

    new-instance v1, Lcom/montaj/pro/MainActivity$Chooser;

    invoke-direct {v1, p0}, Lcom/montaj/pro/MainActivity$Chooser;-><init>(Lcom/montaj/pro/MainActivity;)V

    invoke-virtual {v0, v1}, Landroid/webkit/WebView;->setWebChromeClient(Landroid/webkit/WebChromeClient;)V

    iget-object v0, p0, Lcom/montaj/pro/MainActivity;->webView:Landroid/webkit/WebView;

    new-instance v1, Lcom/montaj/pro/MainActivity$Bridge;

    invoke-direct {v1, p0}, Lcom/montaj/pro/MainActivity$Bridge;-><init>(Lcom/montaj/pro/MainActivity;)V

    const-string v2, "MontajBridge"

    invoke-virtual {v0, v1, v2}, Landroid/webkit/WebView;->addJavascriptInterface(Ljava/lang/Object;Ljava/lang/String;)V

    # visible label behind the WebView: if the page never renders the user sees
    # this instead of an unexplained black screen
    new-instance v0, Landroid/widget/TextView;

    invoke-direct {v0, p0}, Landroid/widget/TextView;-><init>(Landroid/content/Context;)V

    const-string v1, "جاري تحميل المحرر…"

    invoke-virtual {v0, v1}, Landroid/widget/TextView;->setText(Ljava/lang/CharSequence;)V

    const v1, 0xffe8eefc

    invoke-virtual {v0, v1}, Landroid/widget/TextView;->setTextColor(I)V

    const/high16 v1, 0x41a00000

    invoke-virtual {v0, v1}, Landroid/widget/TextView;->setTextSize(F)V

    const/16 v1, 0x11

    invoke-virtual {v0, v1}, Landroid/widget/TextView;->setGravity(I)V

    iput-object v0, p0, Lcom/montaj/pro/MainActivity;->loadingView:Landroid/widget/TextView;

    new-instance v1, Landroid/widget/FrameLayout;

    invoke-direct {v1, p0}, Landroid/widget/FrameLayout;-><init>(Landroid/content/Context;)V

    const v2, 0xff0b0e14

    invoke-virtual {v1, v2}, Landroid/view/View;->setBackgroundColor(I)V

    invoke-virtual {v1, v0}, Landroid/view/ViewGroup;->addView(Landroid/view/View;)V

    const/4 v0, -0x1

    new-instance v2, Landroid/widget/FrameLayout$LayoutParams;

    invoke-direct {v2, v0, v0}, Landroid/widget/FrameLayout$LayoutParams;-><init>(II)V

    iget-object v3, p0, Lcom/montaj/pro/MainActivity;->webView:Landroid/webkit/WebView;

    invoke-virtual {v1, v3, v2}, Landroid/view/ViewGroup;->addView(Landroid/view/View;Landroid/view/ViewGroup$LayoutParams;)V

    # PRIMARY load: straight from the assets folder — no synthetic origin, no
    # interception, just the plain path every WebView app uses.
    iget-object v2, p0, Lcom/montaj/pro/MainActivity;->webView:Landroid/webkit/WebView;

    const-string v3, "file:///android_asset/app/index.html"

    invoke-virtual {v2, v3}, Landroid/webkit/WebView;->loadUrl(Ljava/lang/String;)V

    invoke-virtual {p0, v1}, Landroid/app/Activity;->setContentView(Landroid/view/View;)V

    return-void
.end method

# called from the WebView client once the page is rendered
.method public hideLoading()V
    .registers 3

    iget-object v0, p0, Lcom/montaj/pro/MainActivity;->loadingView:Landroid/widget/TextView;

    if-nez v0, :end

    :try_start
    const/16 v1, 0x8

    invoke-virtual {v0, v1}, Landroid/widget/TextView;->setVisibility(I)V
    :try_end
    .catch Ljava/lang/Exception; {:try_start .. :try_end} :catch_err

    goto :end

    :catch_err
    move-exception v0

    :end
    return-void
.end method

.method public showErrorText(Ljava/lang/String;)V
    .registers 8

    new-instance v0, Landroid/widget/TextView;

    invoke-direct {v0, p0}, Landroid/widget/TextView;-><init>(Landroid/content/Context;)V

    const v1, 0xffe8ecf4

    invoke-virtual {v0, v1}, Landroid/widget/TextView;->setTextColor(I)V

    const v1, 0xff0b0e14

    invoke-virtual {v0, v1}, Landroid/view/View;->setBackgroundColor(I)V

    const/high16 v1, 0x41800000

    invoke-virtual {v0, v1}, Landroid/widget/TextView;->setTextSize(F)V

    const/16 v1, 0x30

    const/16 v2, 0x78

    const/16 v3, 0x30

    invoke-virtual {v0, v1, v2, v3, v1}, Landroid/view/View;->setPadding(IIII)V

    const/4 v1, 0x1

    invoke-virtual {v0, v1}, Landroid/widget/TextView;->setTextIsSelectable(Z)V

    invoke-virtual {v0, p1}, Landroid/widget/TextView;->setText(Ljava/lang/CharSequence;)V

    invoke-virtual {p0, v0}, Landroid/app/Activity;->setContentView(Landroid/view/View;)V

    return-void
.end method

.method public onBackPressed()V
    .registers 2

    iget-object v0, p0, Lcom/montaj/pro/MainActivity;->webView:Landroid/webkit/WebView;

    if-eqz v0, :cond_finish

    iget-object v0, p0, Lcom/montaj/pro/MainActivity;->webView:Landroid/webkit/WebView;

    invoke-virtual {v0}, Landroid/webkit/WebView;->canGoBack()Z

    move-result v0

    if-eqz v0, :cond_finish

    iget-object v0, p0, Lcom/montaj/pro/MainActivity;->webView:Landroid/webkit/WebView;

    invoke-virtual {v0}, Landroid/webkit/WebView;->goBack()V

    return-void

    :cond_finish
    invoke-virtual {p0}, Landroid/app/Activity;->finish()V

    return-void
.end method

.method protected onActivityResult(IILandroid/content/Intent;)V
    .registers 11

    const/16 v0, 0x3e9

    if-ne p1, v0, :cond_after_file

    iget-object v0, p0, Lcom/montaj/pro/MainActivity;->filePathCallback:Landroid/webkit/ValueCallback;

    if-nez v0, :cond_have_cb

    return-void

    :cond_have_cb
    const/4 v1, 0x0

    const/4 v2, -0x1

    if-ne p2, v2, :cond_null_result

    if-eqz p3, :cond_null_result

    invoke-virtual {p3}, Landroid/content/Intent;->getClipData()Landroid/content/ClipData;

    move-result-object v2

    if-nez v2, :cond_clip

    invoke-virtual {p3}, Landroid/content/Intent;->getData()Landroid/net/Uri;

    move-result-object v2

    if-eqz v2, :cond_null_result

    const/4 v3, 0x1

    new-array v3, v3, [Landroid/net/Uri;

    const/4 v4, 0x0

    aput-object v2, v3, v4

    move-object v1, v3

    goto :done_file

    :cond_clip
    invoke-virtual {v2}, Landroid/content/ClipData;->getItemCount()I

    move-result v3

    new-array v3, v3, [Landroid/net/Uri;

    const/4 v4, 0x0

    :goto_clip_loop
    array-length v5, v3

    if-ge v4, v5, :cond_clip_done

    invoke-virtual {v2, v4}, Landroid/content/ClipData;->getItemAt(I)Landroid/content/ClipData$Item;

    move-result-object v5

    invoke-virtual {v5}, Landroid/content/ClipData$Item;->getUri()Landroid/net/Uri;

    move-result-object v5

    aput-object v5, v3, v4

    add-int/lit8 v4, v4, 0x1

    goto :goto_clip_loop

    :cond_clip_done
    move-object v1, v3

    :cond_null_result
    :done_file
    iget-object v0, p0, Lcom/montaj/pro/MainActivity;->filePathCallback:Landroid/webkit/ValueCallback;

    invoke-interface {v0, v1}, Landroid/webkit/ValueCallback;->onReceiveValue(Ljava/lang/Object;)V

    const/4 v0, 0x0

    iput-object v0, p0, Lcom/montaj/pro/MainActivity;->filePathCallback:Landroid/webkit/ValueCallback;

    return-void

    :cond_after_file
    const/16 v0, 0x3ea

    if-ne p1, v0, :cond_end

    const/4 v2, 0x0

    iput-object v2, p0, Lcom/montaj/pro/MainActivity;->saveStream:Ljava/io/OutputStream;

    iput-object v2, p0, Lcom/montaj/pro/MainActivity;->saveUri:Landroid/net/Uri;

    const/4 v2, 0x1

    iput-boolean v2, p0, Lcom/montaj/pro/MainActivity;->saveCancelled:Z

    const/4 v0, -0x1

    if-ne p2, v0, :cond_end

    if-eqz p3, :cond_end

    const/4 v2, 0x0

    iput-boolean v2, p0, Lcom/montaj/pro/MainActivity;->saveCancelled:Z

    :try_start
    invoke-virtual {p3}, Landroid/content/Intent;->getData()Landroid/net/Uri;

    move-result-object v0

    iput-object v0, p0, Lcom/montaj/pro/MainActivity;->saveUri:Landroid/net/Uri;

    invoke-virtual {p0}, Landroid/app/Activity;->getContentResolver()Landroid/content/ContentResolver;

    move-result-object v1

    invoke-virtual {v1, v0}, Landroid/content/ContentResolver;->openOutputStream(Landroid/net/Uri;)Ljava/io/OutputStream;

    move-result-object v0

    iput-object v0, p0, Lcom/montaj/pro/MainActivity;->saveStream:Ljava/io/OutputStream;

    :try_end
    .catch Ljava/lang/Exception; {:try_start .. :try_end} :catch_save

    goto :cond_end

    :catch_save
    move-exception v0

    goto :cond_end

    :cond_end
    return-void
.end method

# file chooser is opened from the UI thread by the chooser client
.method public openFileChooserWith(Landroid/webkit/ValueCallback;)V
    .registers 6

    iput-object p1, p0, Lcom/montaj/pro/MainActivity;->filePathCallback:Landroid/webkit/ValueCallback;

    new-instance v0, Landroid/content/Intent;

    const-string v1, "android.intent.action.GET_CONTENT"

    invoke-direct {v0, v1}, Landroid/content/Intent;-><init>(Ljava/lang/String;)V

    const-string v1, "android.intent.category.OPENABLE"

    invoke-virtual {v0, v1}, Landroid/content/Intent;->addCategory(Ljava/lang/String;)Landroid/content/Intent;

    const/4 v1, 0x1

    invoke-virtual {v0, v1}, Landroid/content/Intent;->addFlags(I)Landroid/content/Intent;

    const-string v1, "*/*"

    invoke-virtual {v0, v1}, Landroid/content/Intent;->setType(Ljava/lang/String;)Landroid/content/Intent;

    const-string v1, "android.intent.extra.ALLOW_MULTIPLE"

    const/4 v2, 0x1

    invoke-virtual {v0, v1, v2}, Landroid/content/Intent;->putExtra(Ljava/lang/String;Z)Landroid/content/Intent;

    const/16 v1, 0x3e9

    :try_start
    const/4 v2, 0x0

    invoke-static {v0, v2}, Landroid/content/Intent;->createChooser(Landroid/content/Intent;Ljava/lang/CharSequence;)Landroid/content/Intent;

    move-result-object v0

    invoke-virtual {p0, v0, v1}, Landroid/app/Activity;->startActivityForResult(Landroid/content/Intent;I)V

    :try_end
    .catch Landroid/content/ActivityNotFoundException; {:try_start .. :try_end} :catch_none

    goto :done

    :catch_none
    move-exception v0

    const/4 v0, 0x0

    iput-object v0, p0, Lcom/montaj/pro/MainActivity;->filePathCallback:Landroid/webkit/ValueCallback;

    :done
    return-void
.end method

# permission request coming from the WebView (camera / mic)
.method public handlePermission(Landroid/webkit/PermissionRequest;)V
    .registers 6

    iput-object p1, p0, Lcom/montaj/pro/MainActivity;->permRequest:Landroid/webkit/PermissionRequest;

    const/4 v0, 0x1

    new-array v0, v0, [Ljava/lang/String;

    const/4 v1, 0x0

    const-string v2, "android.permission.RECORD_AUDIO"

    aput-object v2, v0, v1

    sget v2, Landroid/os/Build$VERSION;->SDK_INT:I

    const/16 v3, 0x17

    if-ge v2, v3, :modern

    # API < 23: RECORD_AUDIO is granted at install time, just accept the request
    invoke-virtual {p1}, Landroid/webkit/PermissionRequest;->getResources()[Ljava/lang/String;

    move-result-object v0

    invoke-virtual {p1, v0}, Landroid/webkit/PermissionRequest;->grant([Ljava/lang/String;)V

    return-void

    :modern
    const/16 v1, 0x3eb

    invoke-virtual {p0, v0, v1}, Landroid/app/Activity;->requestPermissions([Ljava/lang/String;I)V

    return-void
.end method

.method public onRequestPermissionsResult(I[Ljava/lang/String;[I)V
    .registers 8

    const/16 v0, 0x3eb

    if-ne p1, v0, :cond_end

    iget-object v0, p0, Lcom/montaj/pro/MainActivity;->permRequest:Landroid/webkit/PermissionRequest;

    if-nez v0, :cond_have

    return-void

    :cond_have
    const/4 v1, 0x0

    array-length v2, p3

    if-lez v2, :cond_deny

    aget v2, p3, v1

    if-nez v2, :cond_deny

    invoke-virtual {v0}, Landroid/webkit/PermissionRequest;->grant([Ljava/lang/String;)V

    goto :cond_end

    :cond_deny
    invoke-virtual {v0}, Landroid/webkit/PermissionRequest;->deny()V

    :cond_end
    return-void
.end method

.method public isSaveCancelled()Z
    .registers 2

    iget-boolean v0, p0, Lcom/montaj/pro/MainActivity;->saveCancelled:Z

    return v0
.end method

.method public getBridgeStream()Ljava/io/OutputStream;
    .registers 2

    iget-object v0, p0, Lcom/montaj/pro/MainActivity;->saveStream:Ljava/io/OutputStream;

    return-object v0
.end method

.method public startSave(Ljava/lang/String;Ljava/lang/String;)V
    .registers 6

    new-instance v0, Landroid/content/Intent;

    const-string v1, "android.intent.action.CREATE_DOCUMENT"

    invoke-direct {v0, v1}, Landroid/content/Intent;-><init>(Ljava/lang/String;)V

    const-string v1, "android.intent.category.OPENABLE"

    invoke-virtual {v0, v1}, Landroid/content/Intent;->addCategory(Ljava/lang/String;)Landroid/content/Intent;

    invoke-virtual {v0, p2}, Landroid/content/Intent;->setType(Ljava/lang/String;)Landroid/content/Intent;

    const-string v1, "android.intent.extra.TITLE"

    invoke-virtual {v0, v1, p1}, Landroid/content/Intent;->putExtra(Ljava/lang/String;Ljava/lang/String;)Landroid/content/Intent;

    const/16 v1, 0x3ea

    invoke-virtual {p0, v0, v1}, Landroid/app/Activity;->startActivityForResult(Landroid/content/Intent;I)V

    return-void
.end method

.method public getSaveUri()Ljava/lang/String;
    .registers 2

    iget-object v0, p0, Lcom/montaj/pro/MainActivity;->saveUri:Landroid/net/Uri;

    if-nez v0, :null_uri

    const-string v0, ""

    return-object v0

    :null_uri
    invoke-virtual {v0}, Landroid/net/Uri;->toString()Ljava/lang/String;

    move-result-object v0

    return-object v0
.end method
