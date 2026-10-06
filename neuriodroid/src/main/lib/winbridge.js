'use strict';
/**
 * Tiny persistent PowerShell bridge for the few things Node cannot do on
 * Windows: find the emulator window rectangle (for "mouse = touch") and
 * bring it to the front. Everything degrades gracefully — if PowerShell is
 * missing or slow, the feature is simply disabled.
 */
const { spawn } = require('child_process');
const log = require('./logger').scoped('winbridge');

const PS_SCRIPT = `
$ErrorActionPreference = 'Continue'
try {
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class NdWin {
  public struct RECT { public int Left, Top, Right, Bottom; }
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int cmd);
}
"@
} catch {}

$script:wantPid = 0
$script:wantTitle = ""

function Enum-Windows {
  $found = New-Object System.Collections.ArrayList
  $cb = [NdWin+EnumProc]{
    param($h, $l)
    try {
      $wpid = 0
      [void][NdWin]::GetWindowThreadProcessId($h, [ref]$wpid)
      $sb = New-Object System.Text.StringBuilder 512
      [void][NdWin]::GetWindowTextW($h, $sb, 512)
      $title = $sb.ToString()
      $pidMatch = ($script:wantPid -gt 0 -and $wpid -eq $script:wantPid)
      $titleMatch = ($script:wantTitle -ne "" -and $title -like ("*" + $script:wantTitle + "*"))
      if (($pidMatch -or $titleMatch) -and [NdWin]::IsWindowVisible($h)) {
        $r = New-Object NdWin+RECT
        [void][NdWin]::GetWindowRect($h, [ref]$r)
        [void]$found.Add(@{ hwnd = $h.ToInt64(); pid = $wpid; title = $title
                            left = $r.Left; top = $r.Top; right = $r.Right; bottom = $r.Bottom })
      }
    } catch {}
    return $true
  }
  [void][NdWin]::EnumWindows($cb, [IntPtr]::Zero)
  return $found
}

[Console]::Out.WriteLine('{"ready":true}')
[Console]::Out.Flush()

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line.Trim() -eq "") { continue }
  $res = @{}
  try {
    $req = $line | ConvertFrom-Json
    $res.id = $req.id
    switch ($req.op) {
      'windows' {
        $script:wantPid = [int]$req.pid
        $script:wantTitle = [string]$req.title
        $res.windows = @(Enum-Windows)
      }
      'foreground' {
        $h = [NdWin]::GetForegroundWindow()
        $sb = New-Object System.Text.StringBuilder 512
        [void][NdWin]::GetWindowTextW($h, $sb, 512)
        $r = New-Object NdWin+RECT
        [void][NdWin]::GetWindowRect($h, [ref]$r)
        $res.hwnd = $h.ToInt64(); $res.title = $sb.ToString()
        $res.left = $r.Left; $res.top = $r.Top; $res.right = $r.Right; $res.bottom = $r.Bottom
      }
      'focus' {
        $h = [IntPtr]$req.hwnd
        if ([NdWin]::IsIconic($h)) { [void][NdWin]::ShowWindowAsync($h, 9) }
        $res.ok = [NdWin]::SetForegroundWindow($h)
      }
      'ping' { $res.pong = $true }
      default { $res.error = "unknown op" }
    }
  } catch { $res.error = $_.Exception.Message }
  [Console]::Out.WriteLine(($res | ConvertTo-Json -Compress -Depth 5))
  [Console]::Out.Flush()
}
`;

class WinBridge {
  constructor() {
    this.child = null;
    this.ready = false;
    this.pending = new Map();
    this.seq = 0;
    this.buf = '';
    this.broken = false;
  }

  start() {
    if (process.platform !== 'win32' || this.broken) return false;
    if (this.child) return true;
    try {
      this.child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_SCRIPT], {
        windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      log.warn('cannot spawn powershell', { err: String(err.message || err) });
      this.broken = true;
      return false;
    }
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (d) => this._onData(d));
    this.child.stderr.on('data', () => {});
    this.child.on('error', () => { this.broken = true; this._failAll('bridge error'); });
    this.child.on('exit', () => { this.child = null; this.ready = false; this._failAll('bridge exited'); });
    return true;
  }

  _onData(chunk) {
    this.buf += chunk;
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line || !line.startsWith('{')) continue;
      let msg;
      try { msg = JSON.parse(line); } catch (_) { continue; }
      if (msg.ready) { this.ready = true; continue; }
      const p = msg.id != null ? this.pending.get(msg.id) : null;
      if (p) { this.pending.delete(msg.id); clearTimeout(p.timer); p.resolve(msg); }
    }
  }

  _failAll(reason) {
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error(reason)); }
    this.pending.clear();
  }

  call(op, args = {}, timeoutMs = 4000) {
    if (!this.start() || !this.child) return Promise.resolve(null);
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`winbridge timeout: ${op}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.child.stdin.write(JSON.stringify(Object.assign({ id, op }, args)) + '\n');
      } catch (err) { clearTimeout(timer); this.pending.delete(id); reject(err); }
    });
  }

  /**
   * Window rect of an emulator instance (search by pid, fall back to the AVD
   * name that always appears in the emulator window title).
   */
  async emulatorWindow(pid, titleHint) {
    const waitForReady = async () => {
      for (let i = 0; i < 40 && !this.ready; i++) await new Promise((r) => setTimeout(r, 100));
      return this.ready;
    };
    if (!(await waitForReady())) return null;
    try {
      const r = await this.call('windows', { pid: pid || 0, title: titleHint || '' }, 6000);
      const list = (r && r.windows) || [];
      if (!list.length) return null;
      // Prefer a window whose title looks like the emulator's.
      const best = list.find((w) => /emulator|android/i.test(w.title || '')) || list[0];
      return best;
    } catch (err) {
      log.debug('emulatorWindow failed', { err: String(err.message || err) });
      return null;
    }
  }

  async focus(hwnd) {
    try { return await this.call('focus', { hwnd }, 3000); } catch (_) { return null; }
  }

  async foreground() {
    try { return await this.call('foreground', {}, 2000); } catch (_) { return null; }
  }

  stop() {
    if (this.child) { try { this.child.stdin.end(); } catch (_) {} try { this.child.kill(); } catch (_) {} }
    this.child = null; this.ready = false; this._failAll('stopped');
  }
}

module.exports = { WinBridge };
