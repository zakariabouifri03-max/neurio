.class public Lcom/montaj/pro/SplashActivity;
.super Landroid/app/Activity;
.source "SplashActivity.java"

# Entry point of the app. It installs a crash reporter *before* the editor
# activity is even loaded, so a failure anywhere (including a class that ART
# refuses to verify) is written to filesDir/montaj-crash.txt and displayed on
# the next launch instead of the app just closing with no explanation.

.method public constructor <init>()V
    .registers 1

    invoke-direct {p0}, Landroid/app/Activity;-><init>()V

    return-void
.end method

.method public onCreate(Landroid/os/Bundle;)V
    .registers 9

    invoke-super {p0, p1}, Landroid/app/Activity;->onCreate(Landroid/os/Bundle;)V

    :try_start
    new-instance v0, Lcom/montaj/pro/CrashHandler;

    invoke-direct {v0, p0}, Lcom/montaj/pro/CrashHandler;-><init>(Landroid/app/Activity;)V

    invoke-static {v0}, Ljava/lang/Thread;->setDefaultUncaughtExceptionHandler(Ljava/lang/Thread$UncaughtExceptionHandler;)V
    :try_end
    .catch Ljava/lang/Throwable; {:try_start .. :try_end} :catch_handler

    # was there a crash during an earlier run?
    invoke-virtual {p0}, Landroid/content/Context;->getFilesDir()Ljava/io/File;

    move-result-object v0

    new-instance v1, Ljava/io/File;

    const-string v2, "montaj-crash.txt"

    invoke-direct {v1, v0, v2}, Ljava/io/File;-><init>(Ljava/io/File;Ljava/lang/String;)V

    invoke-virtual {v1}, Ljava/io/File;->exists()Z

    move-result v0

    if-nez v0, :open_editor

    invoke-virtual {v1}, Ljava/io/File;->length()J

    move-result-wide v5

    long-to-int v4, v5

    if-gtz v4, :open_editor

    new-array v4, v4, [B

    new-instance v3, Ljava/io/FileInputStream;

    invoke-direct {v3, v1}, Ljava/io/FileInputStream;-><init>(Ljava/io/File;)V

    invoke-virtual {v3, v4}, Ljava/io/FileInputStream;->read([B)I

    invoke-virtual {v3}, Ljava/io/FileInputStream;->close()V

    new-instance v3, Ljava/lang/String;

    invoke-direct {v3, v4}, Ljava/lang/String;-><init>([B)V

    invoke-virtual {p0, v3}, Lcom/montaj/pro/SplashActivity;->showCrash(Ljava/lang/String;)V

    return-void

    :catch_handler
    move-exception v0

    :open_editor
    invoke-virtual {p0}, Lcom/montaj/pro/SplashActivity;->openEditor()V

    return-void
.end method

.method public openEditor()V
    .registers 4

    :try_start
    const-class v1, Lcom/montaj/pro/MainActivity;

    new-instance v0, Landroid/content/Intent;

    invoke-direct {v0, p0, v1}, Landroid/content/Intent;-><init>(Landroid/content/Context;Ljava/lang/Class;)V

    invoke-virtual {p0, v0}, Landroid/app/Activity;->startActivity(Landroid/content/Intent;)V
    :try_end
    .catch Ljava/lang/Throwable; {:try_start .. :try_end} :catch_err

    :catch_err
    invoke-virtual {p0}, Landroid/app/Activity;->finish()V

    return-void
.end method

# shows the trace of the previous crash, with a button to continue to the editor
.method public showCrash(Ljava/lang/String;)V
    .registers 8

    new-instance v0, Landroid/widget/LinearLayout;

    invoke-direct {v0, p0}, Landroid/widget/LinearLayout;-><init>(Landroid/content/Context;)V

    const/4 v1, 0x1

    invoke-virtual {v0, v1}, Landroid/widget/LinearLayout;->setOrientation(I)V

    const v1, 0xff0b0e14

    invoke-virtual {v0, v1}, Landroid/view/View;->setBackgroundColor(I)V

    new-instance v2, Landroid/widget/TextView;

    invoke-direct {v2, p0}, Landroid/widget/TextView;-><init>(Landroid/content/Context;)V

    const-string v1, "تعذّر تشغيل المحرر في المرة الماضية. هذا تقرير الخطأ:"

    invoke-virtual {v2, v1}, Landroid/widget/TextView;->setText(Ljava/lang/CharSequence;)V

    const/high16 v1, 0x41800000

    invoke-virtual {v2, v1}, Landroid/widget/TextView;->setTextSize(F)V

    const v1, 0xffe8ecf4

    invoke-virtual {v2, v1}, Landroid/widget/TextView;->setTextColor(I)V

    const/16 v1, 0x28

    const/16 v3, 0x14

    invoke-virtual {v2, v1, v3, v1, v3}, Landroid/view/View;->setPadding(IIII)V

    invoke-virtual {v0, v2}, Landroid/widget/LinearLayout;->addView(Landroid/view/View;)V

    new-instance v3, Landroid/widget/ScrollView;

    invoke-direct {v3, p0}, Landroid/widget/ScrollView;-><init>(Landroid/content/Context;)V

    new-instance v2, Landroid/widget/TextView;

    invoke-direct {v2, p0}, Landroid/widget/TextView;-><init>(Landroid/content/Context;)V

    invoke-virtual {v2, p1}, Landroid/widget/TextView;->setText(Ljava/lang/CharSequence;)V

    const/4 v1, 0x1

    invoke-virtual {v2, v1}, Landroid/widget/TextView;->setTextIsSelectable(Z)V

    const/high16 v1, 0x41400000

    invoke-virtual {v2, v1}, Landroid/widget/TextView;->setTextSize(F)V

    const v1, 0xff9fe8c4

    invoke-virtual {v2, v1}, Landroid/widget/TextView;->setTextColor(I)V

    invoke-virtual {v3, v2}, Landroid/widget/ScrollView;->addView(Landroid/view/View;)V

    new-instance v1, Landroid/widget/LinearLayout$LayoutParams;

    const/4 v2, -0x1

    const/4 v4, 0x0

    invoke-direct {v1, v2, v4}, Landroid/widget/LinearLayout$LayoutParams;-><init>(II)V

    const/high16 v4, 0x3f800000

    iput v4, v1, Landroid/widget/LinearLayout$LayoutParams;->weight:F

    invoke-virtual {v3, v1}, Landroid/widget/ScrollView;->setLayoutParams(Landroid/view/ViewGroup$LayoutParams;)V

    invoke-virtual {v0, v3}, Landroid/widget/LinearLayout;->addView(Landroid/view/View;)V

    new-instance v2, Landroid/widget/Button;

    invoke-direct {v2, p0}, Landroid/widget/Button;-><init>(Landroid/content/Context;)V

    const-string v1, "متابعة إلى المحرر"

    invoke-virtual {v2, v1}, Landroid/widget/Button;->setText(Ljava/lang/CharSequence;)V

    new-instance v1, Lcom/montaj/pro/OpenEditor;

    invoke-direct {v1, p0}, Lcom/montaj/pro/OpenEditor;-><init>(Lcom/montaj/pro/SplashActivity;)V

    invoke-virtual {v2, v1}, Landroid/widget/Button;->setOnClickListener(Landroid/view/View$OnClickListener;)V

    invoke-virtual {v0, v2}, Landroid/widget/LinearLayout;->addView(Landroid/view/View;)V

    invoke-virtual {p0, v0}, Landroid/app/Activity;->setContentView(Landroid/view/View;)V

    return-void
.end method
