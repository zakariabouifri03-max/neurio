# TurboLoad Pro — Windows direct download manager

This repository now includes a native Windows download manager project in [`TurboLoadPro/`](TurboLoadPro/README.md). It uses a WPF client, an asynchronous .NET transfer engine, SQLite recovery state, and a queue scheduler. Start with the [TurboLoad Pro build and architecture guide](TurboLoadPro/README.md).

**Build target:** .NET 10, Windows 10/11 x64, self-contained single-file publish. The app source and automated local-server tests are in `TurboLoadPro/`. A Windows installer script and an opt-in Chromium link handoff example are also included.

> This session runs in a Linux sandbox without the .NET SDK, so a Windows `.exe` cannot be built or test results claimed from this checkout. Run `TurboLoadPro/build.ps1` on a Windows machine with the .NET 10 SDK to restore, test, and publish the executable. The repo includes a Windows CI workflow to build and upload it.

The original browser racing game files in the repository root are retained as legacy content; the new application is isolated under `TurboLoadPro/`.
