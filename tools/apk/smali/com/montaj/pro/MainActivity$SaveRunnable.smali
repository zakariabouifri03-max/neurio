.class public Lcom/montaj/pro/MainActivity$SaveRunnable;
.super Ljava/lang/Object;
.implements Ljava/lang/Runnable;
.source "MainActivity.java"

.field private activity:Lcom/montaj/pro/MainActivity;

.field private mime:Ljava/lang/String;

.field private name:Ljava/lang/String;

.method public constructor <init>(Lcom/montaj/pro/MainActivity;Ljava/lang/String;Ljava/lang/String;)V
    .registers 4

    invoke-direct {p0}, Ljava/lang/Object;-><init>()V

    iput-object p1, p0, Lcom/montaj/pro/MainActivity$SaveRunnable;->activity:Lcom/montaj/pro/MainActivity;

    iput-object p2, p0, Lcom/montaj/pro/MainActivity$SaveRunnable;->name:Ljava/lang/String;

    iput-object p3, p0, Lcom/montaj/pro/MainActivity$SaveRunnable;->mime:Ljava/lang/String;

    return-void
.end method

.method public run()V
    .registers 4

    :try_start
    iget-object v0, p0, Lcom/montaj/pro/MainActivity$SaveRunnable;->activity:Lcom/montaj/pro/MainActivity;

    if-nez v0, :end

    iget-object v1, p0, Lcom/montaj/pro/MainActivity$SaveRunnable;->name:Ljava/lang/String;

    iget-object v2, p0, Lcom/montaj/pro/MainActivity$SaveRunnable;->mime:Ljava/lang/String;

    invoke-virtual {v0, v1, v2}, Lcom/montaj/pro/MainActivity;->startSave(Ljava/lang/String;Ljava/lang/String;)V

    :try_end
    .catch Ljava/lang/Exception; {:try_start .. :try_end} :catch_err

    goto :end

    :catch_err
    move-exception v0

    :end
    return-void
.end method
