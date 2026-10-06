'use strict';
/**
 * Discovery of Google's Android repository metadata.
 *
 * We never hard-code a single download URL as the only option: the app reads
 * the official repository XMLs (the same ones Android Studio uses) and picks
 * the newest Windows archives at runtime, with pinned fall-backs for offline
 * hosts / changed URLs.
 *
 *   https://dl.google.com/android/repository/repository2-3.xml          (sdk pkgs)
 *   https://dl.google.com/android/repository/sys-img/<tag>/sys-img2-1.xml (images)
 */
const fs = require('fs');
const { XMLParser } = require('fast-xml-parser');
const { fetchText } = require('./download');

const BASE = 'https://dl.google.com/android/repository/';

const SDK_REPO_URLS = [
  BASE + 'repository2-3.xml',
  BASE + 'repository2-1.xml',
  BASE + 'repository.xml',
];

const SYSIMG_TAGS = [
  'google_apis_playstore',
  'google_apis',
  'android',
  'android-tv',
  'android-wear',
  'aosp_atd',
  'google_apis_playstore_xr',
];

/** Pinned fall-backs (tried in order) if the XML cannot be reached. */
const FALLBACK_CMDLINE_TOOLS = [
  'commandlinetools-win-13114758_latest.zip',
  'commandlinetools-win-11076708_latest.zip',
  'commandlinetools-win-10406996_latest.zip',
  'commandlinetools-win-9477386_latest.zip',
];
const FALLBACK_PLATFORM_TOOLS = 'platform-tools-latest-windows.zip';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  isArray: (name) => ['remotePackage', 'archive', 'localPackage'].includes(name),
});

function asArray(v) { return v == null ? [] : Array.isArray(v) ? v : [v]; }
function text(v) { return v == null ? '' : String(typeof v === 'object' ? (v['#text'] || '') : v).trim(); }

/** Pick the archive that matches the host OS. */
function pickArchive(pkg, platform) {
  const archives = asArray(pkg.archives && pkg.archives.archive);
  let best = null;
  for (const a of archives) {
    const c = a.complete;
    if (!c) continue;
    const url = text(c.url);
    if (!url) continue;
    const hostOs = text(a['host-os']) || text(a.hostOs) || '';
    let os = hostOs.toLowerCase();
    if (!os) {
      if (/-win(_|\d|\.|-|latest)|windows/i.test(url)) os = 'windows';
      else if (/macosx|darwin|-mac/i.test(url)) os = 'macosx';
      else if (/linux/i.test(url)) os = 'linux';
      else os = 'any';
    }
    const match = os === 'any' || os === platform ||
      (platform === 'win32' && os.startsWith('win')) ||
      (platform === 'darwin' && os.startsWith('mac')) ||
      (platform === 'linux' && os.startsWith('linux'));
    if (!match) continue;
    const entry = {
      url: /^https?:/.test(url) ? url : BASE + url,
      size: parseInt(text(c.size), 10) || 0,
      sha1: text(c.checksum && c.checksum['#text'] || c.checksum) || '',
      obsolete: a.obsolete === true || a.obsolete === 'true',
    };
    if (!best || entry.size > best.size) best = entry; // prefer full archives
  }
  return best;
}

function revisionOf(pkg) {
  const r = pkg.revision;
  if (!r) return { major: 0, minor: 0, micro: 0, str: '0' };
  const major = parseInt(text(r.major), 10) || 0;
  const minor = parseInt(text(r.minor), 10) || 0;
  const micro = parseInt(text(r.micro), 10) || 0;
  return { major, minor, micro, str: [major, minor, micro].filter((_, i, a) => i === 0 || a[i] !== undefined).join('.') };
}

/** Parse an SDK repository XML. */
function parseSdkRepo(xml, platform) {
  const doc = parser.parse(xml);
  const root = doc['sdk-repository'] || doc.repository || doc;
  const out = { cmdlineTools: [], platformTools: null, emulator: null, platforms: [], buildTools: [], extras: [] };

  for (const pkg of asArray(root.remotePackage)) {
    const p = String(pkg['@_path'] || '');
    const rev = revisionOf(pkg);
    const display = text(pkg['display-name']);
    const obsolete = pkg.obsolete === true || pkg.obsolete === 'true';
    const archive = pickArchive(pkg, platform);
    if (!archive || obsolete) continue;

    if (p.startsWith('cmdline-tools;')) {
      out.cmdlineTools.push({ path: p, version: p.split(';')[1], revision: rev, display, archive });
    } else if (p === 'platform-tools') {
      out.platformTools = { path: p, revision: rev, display, archive };
    } else if (p === 'emulator') {
      out.emulator = { path: p, revision: rev, display, archive };
    } else if (p.startsWith('platforms;')) {
      const api = parseInt(String(p.split(';')[1]).replace('android-', ''), 10);
      out.platforms.push({ path: p, api, revision: rev, display, archive });
    } else if (p.startsWith('build-tools;')) {
      out.buildTools.push({ path: p, revision: rev, display, archive });
    }
  }

  out.cmdlineTools.sort((a, b) => (b.revision.major - a.revision.major) || (b.revision.minor - a.revision.minor));
  out.platforms.sort((a, b) => b.api - a.api);
  return out;
}

/** Parse a sys-img XML into a flat list of downloadable system images. */
function parseSysImgRepo(xml, tagHint) {
  const doc = parser.parse(xml);
  const root = doc['sys-img-sysimg'] || doc['sdk-sys-img'] || doc.repository || doc;
  const images = [];
  for (const pkg of asArray(root.remotePackage)) {
    const p = String(pkg['@_path'] || '');
    if (!p.startsWith('sys-img;')) continue;
    const td = pkg['type-details'] || {};
    const api = parseInt(text(td['api-level']), 10) || 0;
    const codename = text(td.codename);
    const tagEl = td.tag || {};
    const tag = text(tagEl.id) || tagHint || '';
    const tagDisplay = text(tagEl.display);
    const abi = text(td.abi);
    const archive = pickArchive(pkg, 'any');
    if (!archive) continue;
    const obsolete = pkg.obsolete === true || pkg.obsolete === 'true';
    images.push({
      path: p,                       // sys-img;android-34;google_apis_playstore;x86_64
      package: p.replace('sys-img;', 'system-images;'),
      api, codename, tag, tagDisplay, abi,
      display: text(pkg['display-name']),
      obsolete,
      size: archive.size,
      url: archive.url,
      sha1: archive.sha1,
    });
  }
  return images;
}

const ANDROID_NAMES = {
  36: 'Android 16', 35: 'Android 15', 34: 'Android 14', 33: 'Android 13',
  32: 'Android 12L', 31: 'Android 12', 30: 'Android 11', 29: 'Android 10',
  28: 'Android 9', 27: 'Android 8.1', 26: 'Android 8.0', 25: 'Android 7.1',
  24: 'Android 7.0', 23: 'Android 6.0', 22: 'Android 5.1', 21: 'Android 5.0',
};

/**
 * Fetch everything, with cache. Never throws: returns {ok:false,...} so the UI
 * can offer the pinned fallbacks.
 */
async function discover({ platform = process.platform, cacheFile = null, ttlMs = 12 * 3600e3, log = null, force = false } = {}) {
  const winPlatform = platform === 'win32' ? 'windows' : platform;

  if (cacheFile && !force) {
    try {
      const st = fs.statSync(cacheFile);
      if (Date.now() - st.mtimeMs < ttlMs) {
        const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        if (cached && cached.sdk) { cached.fromCache = true; return cached; }
      }
    } catch (_) {}
  }

  const result = {
    ok: false, sdk: null, images: [], errors: [], fetchedAt: Date.now(), fromCache: false,
    fallback: false,
  };

  // --- SDK packages -------------------------------------------------------
  for (const url of SDK_REPO_URLS) {
    try {
      const xml = await fetchText(url, { timeout: 30000 });
      result.sdk = parseSdkRepo(xml, winPlatform);
      result.sdk.source = url;
      break;
    } catch (err) {
      result.errors.push(`${url}: ${err.message || err}`);
      if (log) log.warn('repository fetch failed', { url, err: String(err.message || err) });
    }
  }
  if (!result.sdk) {
    result.fallback = true;
    result.sdk = {
      source: 'pinned-fallback',
      cmdlineTools: FALLBACK_CMDLINE_TOOLS.map((f) => ({
        path: 'cmdline-tools;' + (f.match(/-(\d+)_latest/) || [, '0'])[1],
        version: (f.match(/-(\d+)_latest/) || [, '0'])[1],
        revision: { major: 0, minor: 0, micro: 0, str: '0' },
        display: f,
        archive: { url: BASE + f, size: 0, sha1: '' },
      })),
      platformTools: {
        path: 'platform-tools', revision: { major: 0, minor: 0, micro: 0, str: '0' },
        display: 'Android SDK Platform-Tools',
        archive: { url: BASE + FALLBACK_PLATFORM_TOOLS, size: 0, sha1: '' },
      },
      emulator: null, platforms: [], buildTools: [], extras: [],
    };
  }

  // --- System images ------------------------------------------------------
  for (const tag of SYSIMG_TAGS) {
    const url = `${BASE}sys-img/${tag}/sys-img2-1.xml`;
    try {
      const xml = await fetchText(url, { timeout: 30000 });
      result.images.push(...parseSysImgRepo(xml, tag));
    } catch (err) {
      result.errors.push(`${url}: ${err.message || err}`);
    }
  }
  result.images = result.images.filter((i) => !i.obsolete);

  result.ok = !!result.sdk;
  if (cacheFile) {
    try { fs.mkdirSync(require('path').dirname(cacheFile), { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(result, null, 1)); } catch (_) {}
  }
  return result;
}

/**
 * Choose the best system image for a gaming profile.
 * Preference: Play Store image (so users get the real Play Store like LDPlayer),
 * x86_64 ABI (with ARM translation on API >= 30), newest supported API.
 */
function recommendImage(images, { abi = 'x86_64', maxApi = 35, minApi = 28, tagPreference } = {}) {
  const prefs = tagPreference || ['google_apis_playstore', 'google_apis', 'aosp_atd', 'android'];
  const candidates = images.filter((i) => i.abi === abi && i.api >= minApi && i.api <= maxApi);
  for (const tag of prefs) {
    const list = candidates.filter((i) => i.tag === tag).sort((a, b) => b.api - a.api);
    if (list.length) return list[0];
  }
  const any = candidates.sort((a, b) => b.api - a.api);
  return any[0] || null;
}

/** Group images for the picker UI: by API desc, then tag. */
function groupImages(images, { abi = 'x86_64' } = {}) {
  const filtered = images.filter((i) => i.abi === abi || i.abi === 'x86');
  const byApi = new Map();
  for (const img of filtered) {
    if (!byApi.has(img.api)) byApi.set(img.api, []);
    byApi.get(img.api).push(img);
  }
  return [...byApi.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([api, list]) => ({
      api,
      name: ANDROID_NAMES[api] || `API ${api}`,
      images: list.sort((a, b) => (a.tag === 'google_apis_playstore' ? -1 : 0) - (b.tag === 'google_apis_playstore' ? -1 : 0)),
    }));
}

module.exports = {
  BASE, discover, parseSdkRepo, parseSysImgRepo, recommendImage, groupImages,
  ANDROID_NAMES, FALLBACK_CMDLINE_TOOLS, SDK_REPO_URLS, SYSIMG_TAGS,
};
