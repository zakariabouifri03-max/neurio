'use strict';
/** Host machine info — used for sizing AVDs and for the Diagnostics page. */
const os = require('os');
const fs = require('fs');
const { run, tryRun, IS_WIN } = require('./proc');

async function diskFree(dir) {
  if (IS_WIN) {
    const drive = (dir || 'C:').slice(0, 2);
    const out = await tryRun('powershell.exe', ['-NoProfile', '-Command',
      `$d=Get-PSDrive -Name '${drive.replace(':', '')}' -ErrorAction SilentlyContinue; if($d){ "{0}|{1}" -f $d.Free,$d.Used } else { "0|0" }`],
    { timeout: 20000 });
    if (out) {
      const [free, used] = out.split('|').map((n) => parseInt(n, 10) || 0);
      return { free, used, total: free + used };
    }
    return { free: 0, used: 0, total: 0 };
  }
  try {
    const st = fs.statfsSync(dir || '/');
    return { free: st.bavail * st.bsize, used: (st.blocks - st.bfree) * st.bsize, total: st.blocks * st.bsize };
  } catch (_) { return { free: 0, used: 0, total: 0 }; }
}

async function gpuList() {
  if (!IS_WIN) return [];
  const out = await tryRun('powershell.exe', ['-NoProfile', '-Command',
    '(Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name + "|" + $_.DriverVersion + "|" + $_.AdapterRAM }) -join ";"'],
  { timeout: 30000 });
  if (!out) return [];
  return out.split(';').filter(Boolean).map((s) => {
    const [name, driverVersion, vram] = s.split('|');
    return { name: (name || '').trim(), driverVersion: (driverVersion || '').trim(), vram: parseInt(vram, 10) || 0 };
  });
}

async function windowsInfo() {
  if (!IS_WIN) return { release: os.release(), caption: os.type() };
  const out = await tryRun('powershell.exe', ['-NoProfile', '-Command',
    '$o=Get-CimInstance Win32_OperatingSystem; "{0}|{1}|{2}" -f $o.Caption,$o.Version,$o.BuildNumber'], { timeout: 30000 });
  if (!out) return { release: os.release(), caption: 'Windows' };
  const [caption, version, build] = out.split('|');
  return { caption: (caption || '').trim(), version: (version || '').trim(), build: (build || '').trim(), release: os.release() };
}

/** Suggest sane AVD defaults from the hardware we found. */
function recommend(cpuCount, totalMemMB, freeDiskBytes, gpus) {
  const cores = Math.max(2, Math.min(8, Math.floor(cpuCount / 2)));
  const ramMB = totalMemMB >= 32768 ? 8192 : totalMemMB >= 16384 ? 6144 : totalMemMB >= 8192 ? 4096 : 2048;
  const dataGB = freeDiskBytes > 60 * 1024 ** 3 ? 16 : freeDiskBytes > 30 * 1024 ** 3 ? 12 : 8;
  const strong = (gpus || []).some((g) => /nvidia|geforce|radeon|rx \d|arc|intel.*iris/i.test(g.name || ''));
  return {
    cores, ramMB, dataGB,
    gpu: strong ? 'host' : 'auto',
    maxInstances: totalMemMB >= 32768 ? 4 : totalMemMB >= 16384 ? 3 : totalMemMB >= 8192 ? 2 : 1,
    enoughDisk: freeDiskBytes > 12 * 1024 ** 3,
    enoughRam: totalMemMB >= 8192,
  };
}

async function collect(paths) {
  const totalMemMB = Math.round(os.totalmem() / 1024 / 1024);
  const freeMemMB = Math.round(os.freemem() / 1024 / 1024);
  const cpuCount = os.cpus().length;
  const [disk, gpus, win] = await Promise.all([
    diskFree(paths ? paths.root : 'C:'),
    gpuList(),
    windowsInfo(),
  ]);
  return {
    platform: process.platform,
    arch: process.arch,
    cpu: os.cpus()[0] ? os.cpus()[0].model : 'unknown',
    cpuCount,
    totalMemMB, freeMemMB,
    disk, gpus, windows: win,
    hostname: os.hostname(),
    node: process.version,
    recommend: recommend(cpuCount, totalMemMB, disk.free, gpus),
  };
}

module.exports = { collect, diskFree, gpuList, windowsInfo, recommend };
