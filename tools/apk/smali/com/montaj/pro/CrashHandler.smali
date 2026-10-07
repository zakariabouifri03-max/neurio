.class public Lcom/montaj/pro/CrashHandler;
.super Ljava/lang/Object;
.implements Ljava/lang/Thread$UncaughtExceptionHandler;
.source "CrashHandler.java"

# writes the stack trace of any uncaught throwable to filesDir/montaj-crash.txt
# so the next launch can show it (nothing else survives a dying process)

.field private activity:Landroid/app/Activity;

.method public constructor <init>(Landroid/app/Activity;)V
    .registers 2

    invoke-direct {p0}, Ljava/lang/Object;-><init>()V

    iput-object p1, p0, Lcom/montaj/pro/CrashHandler;->activity:Landroid/app/Activity;

    return-void
.end method

.method public uncaughtException(Ljava/lang/Thread;Ljava/lang/Throwable;)V
    .registers 8

    const/4 v0, 0x0

    :try_start
    invoke-static {p2}, Landroid/util/Log;->getStackTraceString(Ljava/lang/Throwable;)Ljava/lang/String;

    move-result-object v0
    :try_end
    .catch Ljava/lang/Throwable; {:try_start .. :try_end} :catch_fmt

    :catch_fmt
    if-nez v0, :kill

    :try_start_2
    iget-object v1, p0, Lcom/montaj/pro/CrashHandler;->activity:Landroid/app/Activity;

    invoke-virtual {v1}, Landroid/content/Context;->getFilesDir()Ljava/io/File;

    move-result-object v1

    new-instance v2, Ljava/io/File;

    const-string v3, "montaj-crash.txt"

    invoke-direct {v2, v1, v3}, Ljava/io/File;-><init>(Ljava/io/File;Ljava/lang/String;)V

    new-instance v1, Ljava/io/FileOutputStream;

    invoke-direct {v1, v2}, Ljava/io/FileOutputStream;-><init>(Ljava/io/File;)V

    invoke-virtual {v0}, Ljava/lang/String;->getBytes()[B

    move-result-object v0

    invoke-virtual {v1, v0}, Ljava/io/FileOutputStream;->write([B)V

    invoke-virtual {v1}, Ljava/io/FileOutputStream;->close()V
    :try_end_2
    .catch Ljava/lang/Throwable; {:try_start_2 .. :try_end_2} :catch_write

    :catch_write

    :kill
    invoke-static {}, Landroid/os/Process;->myPid()I

    move-result v0

    invoke-static {v0}, Landroid/os/Process;->killProcess(I)V

    return-void
.end method
