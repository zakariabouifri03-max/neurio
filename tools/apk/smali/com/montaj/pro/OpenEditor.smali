.class public Lcom/montaj/pro/OpenEditor;
.super Ljava/lang/Object;
.implements Landroid/view/View$OnClickListener;
.source "OpenEditor.java"

# "continue to the editor" button of the crash screen

.field private splash:Lcom/montaj/pro/SplashActivity;

.method public constructor <init>(Lcom/montaj/pro/SplashActivity;)V
    .registers 2

    invoke-direct {p0}, Ljava/lang/Object;-><init>()V

    iput-object p1, p0, Lcom/montaj/pro/OpenEditor;->splash:Lcom/montaj/pro/SplashActivity;

    return-void
.end method

.method public onClick(Landroid/view/View;)V
    .registers 6

    iget-object v0, p0, Lcom/montaj/pro/OpenEditor;->splash:Lcom/montaj/pro/SplashActivity;

    :try_start
    invoke-virtual {v0}, Landroid/content/Context;->getFilesDir()Ljava/io/File;

    move-result-object v1

    new-instance v2, Ljava/io/File;

    const-string v3, "montaj-crash.txt"

    invoke-direct {v2, v1, v3}, Ljava/io/File;-><init>(Ljava/io/File;Ljava/lang/String;)V

    invoke-virtual {v2}, Ljava/io/File;->delete()Z
    :try_end
    .catch Ljava/lang/Throwable; {:try_start .. :try_end} :catch_err

    :catch_err
    invoke-virtual {v0}, Lcom/montaj/pro/SplashActivity;->openEditor()V

    return-void
.end method
