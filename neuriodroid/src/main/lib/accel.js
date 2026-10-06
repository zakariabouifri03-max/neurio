'use strict';
/**
 * Hardware acceleration diagnostics + guided repair.
 *
 * The Android Emulator on Windows needs ONE of:
 *   • WHPX  — Windows Hypervisor Platform (built into Win10 1803+/Win11)
 *   • AEHD  — Android Emulator Hypervisor Driver (Google's HAXM successor)
 * Without acceleration an x86_64 system image is unusably slow (or refuses
 * to boot), so we detect it up-front and offer one-click fixes.
 */
const path = require('path');
const { run, tryRun, elevatedPowerShell, windowsFeature, IS_WIN } = require('./proc');
const { fetchJSON } = require('./download');
const log = require('./logger').scoped('accel');

const AEHD_REPO = 'google/android-emulator-hypervisor-driver';

/** `emulator -accel-check` output parsing. */
function parseAccelCheck(text) {
  const t = String(text || '');
  const lower = t.toLowerCase();
  const result = {
    ok: false, driver: null, message: t.trim(),
    hyperV: /hypervisor.*running|whpx|windows hypervisor/i.test(lower),
    needsInstall: /not installed|must be installed|cannot be installed/i.test(lower),
    aehd: /aehd/i.test(lower),
    haxm: /haxm/i.test(lower),
    vtMissing: /(vt-x|vmx|svm|virtualization).*(not|disabled|unsupported)/i.test(lower),
  };
  if (/accel-check:\s*success/i.test(t) || /is supported and installed/i.test(lower) ||
      (/success/i.test(lower) && !result.needsInstall)) {
    result.ok = true;
  }
  if (/whpx/i.test(lower)) result.driver = 'WHPX';
  else if (/aehd/i.test(lower)) result.driver = 'AEHD';
  else if (/haxm/i.test(lower)) result.driver = 'HAXM';
  if (/Hyper-V.*installed|hypervisor is running/i.test(t) && !result.driver) result.driver = 'WHPX';
  return result;
}

async function check(paths) {
  const out = {
    supported: null, driver: null, ok: false, detail: '', hypervisorPresent: null,
    whpxFeature: null, virtFirmware: null, cpu: null, emulatorInstalled: false, aehd: null,
  };
  if (!IS_WIN) {
    const kvm = await tryRun('sh', ['-c', 'test -w /dev/kvm && echo yes || echo no']);
    out.ok = kvm === 'yes';
    out.driver = 'KVM';
    out.detail = out.ok ? 'KVM available' : 'KVM not available';
    return out;
  }

  out.emulatorInstalled = !!paths.emulatorBin && require('fs').existsSync(paths.emulatorBin);

  // CPU virtualisation support (firmware level).
  const ps = await tryRun('powershell.exe', ['-NoProfile', '-Command',
    '$p=Get-CimInstance Win32_Processor; $c=Get-CimInstance Win32_ComputerSystem; ' +
    '"{0}|{1}|{2}|{3}" -f $p.Name,$p.VirtualizationFirmwareEnabled,$p.SecondLevelAddressTranslationExtensions,$c.HypervisorPresent'],
  { timeout: 30000 });
  if (ps) {
    const [cpu, virtFw, slat, hyper] = ps.split('|');
    out.cpu = (cpu || '').trim();
    out.virtFirmware = virtFw === 'True' ? true : virtFw === 'False' ? false : null; // null when a hypervisor already runs
    out.slat = slat === 'True';
    out.hypervisorPresent = hyper === 'True';
  }

  // Optional feature state (needs no admin to *read* in most builds).
  out.whpxFeature = await windowsFeature('HypervisorPlatform');
  const vmPlatform = await windowsFeature('VirtualMachinePlatform');
  out.vmPlatformFeature = vmPlatform;

  // AEHD service present?
  const svc = await tryRun('powershell.exe', ['-NoProfile', '-Command',
    "(Get-Service -Name aehd -ErrorAction SilentlyContinue).Status"], { timeout: 20000 });
  if (svc) out.aehd = svc.trim();
  const haxmSvc = await tryRun('powershell.exe', ['-NoProfile', '-Command',
    "(Get-Service -Name intelhaxm -ErrorAction SilentlyContinue).Status"], { timeout: 20000 });
  if (haxmSvc) out.haxm = haxmSvc.trim();

  if (out.emulatorInstalled) {
    const r = await run(paths.emulatorBin, ['-accel-check'], { env: paths.env(), timeout: 45000 });
    const parsed = parseAccelCheck(`${r.stdout}\n${r.stderr}`);
    out.supported = parsed.ok || /is supported/i.test(parsed.message);
    out.ok = parsed.ok;
    out.driver = parsed.driver;
    out.detail = parsed.message.split(/\r?\n/).filter(Boolean).slice(0, 4).join(' | ');
    out.vtMissing = parsed.vtMissing;
  } else {
    // Best guess before the emulator is installed.
    out.ok = out.hypervisorPresent === true || out.whpxFeature === 'Enabled' || out.aehd === 'Running';
    out.driver = out.hypervisorPresent || out.whpxFeature === 'Enabled' ? 'WHPX' : (out.aehd === 'Running' ? 'AEHD' : null);
    out.detail = out.ok ? 'Acceleration looks available (emulator not installed yet)'
      : 'Install the emulator to run a full acceleration check';
  }
  return out;
}

/** Human readable recommendation for the UI. */
function diagnose(info) {
  const tips = [];
  let severity = 'ok';
  if (info.vtMissing || info.virtFirmware === false) {
    severity = 'error';
    tips.push({
      id: 'bios',
      title: 'Enable virtualization in BIOS/UEFI',
      body: 'Reboot → BIOS/UEFI (F2/Del/F10) → CPU settings → enable Intel VT-x / AMD-V (SVM). This is mandatory for any Android emulator, including LDPlayer.',
    });
  }
  if (severity !== 'error' && !info.ok) {
    if (info.hypervisorPresent === true) {
      tips.push({ id: 'whpx-ok', title: 'WHPX detected', body: 'Hyper-V is running; the emulator will use WHPX. If it still complains, disable "Memory integrity" (Core isolation) and reboot.' });
    } else {
      severity = 'warn';
      tips.push({
        id: 'enable-whpx',
        title: 'Turn on Windows Hypervisor Platform',
        body: 'Run the one-click fix: it enables the HypervisorPlatform + VirtualMachinePlatform features and asks for a reboot.',
        action: 'enable-whpx',
      });
      tips.push({
        id: 'install-aehd',
        title: 'Or install AEHD (no Hyper-V needed)',
        body: 'AEHD is Google\'s hypervisor driver for the Android Emulator. Recommended if you do not use Hyper-V/WSL2/Docker.',
        action: 'install-aehd',
      });
    }
  }
  if (info.haxm) {
    tips.push({ id: 'haxm-legacy', title: 'HAXM detected', body: 'Intel HAXM is discontinued. Prefer AEHD or WHPX; HAXM conflicts with Hyper-V/WSL2.' });
  }
  return { severity, tips, ok: severity === 'ok' };
}

/** One-click: enable WHPX (elevated, asks for reboot). */
async function enableWhpx() {
  const script = [
    'Enable-WindowsOptionalFeature -Online -FeatureName HypervisorPlatform -All -NoRestart',
    'Enable-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform -All -NoRestart',
    'bcdedit /set hypervisorlaunchtype auto',
    'Write-Host "Done. Please REBOOT your PC, then start NeuroDroid again."',
    'Read-Host "Press Enter to close"',
  ].join('; ');
  return elevatedPowerShell(script);
}

/** Find the latest AEHD release asset (GitHub API). */
async function latestAehd() {
  try {
    const rel = await fetchJSON(`https://api.github.com/repos/${AEHD_REPO}/releases/latest`, { timeout: 25000 });
    const assets = (rel.assets || []).map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size }));
    const exe = assets.find((a) => /windows.*\.(zip|exe|msi)$/i.test(a.name)) || assets[0];
    return { tag: rel.tag_name, name: rel.name, assets, chosen: exe || null, publishedAt: rel.published_at };
  } catch (err) {
    log.warn('AEHD release lookup failed', { err: String(err.message || err) });
    return null;
  }
}

/** Disable Hyper-V launch (helps when AEHD is preferred). */
async function disableHyperV() {
  return elevatedPowerShell('bcdedit /set hypervisorlaunchtype off; Write-Host "Hyper-V disabled. REBOOT required."; Read-Host "Press Enter to close"');
}

module.exports = { check, diagnose, enableWhpx, disableHyperV, latestAehd, parseAccelCheck };
