/* Etsy Insight Pro — background/service-worker.js (MV3 module worker)
 * Responsibilities: seed defaults on install, context menus, badge state,
 * pruning of old observations (alarm), and message relay.
 * Note: content scripts + pages talk to chrome.storage directly; the worker
 * only helps with tasks that need a background context.
 */
importScriptsSafe();

function importScriptsSafe() {
  // In MV3 module workers importScripts is unavailable; use dynamic import
  // of the shared libs instead. Wrapped so unit tests (Node) don't crash.
  try {
    if (typeof importScripts === 'function') {
      importScripts(
        '../lib/namespace.js',
        '../lib/utils.js',
        '../lib/settings.js',
        '../lib/storage.js'
      );
    }
  } catch (e) { /* ignore — handled below */ }
}

const EIP = globalThis.EIP || {};

async function ensureLibs() {
  if (EIP.storage && EIP.settings) return;
  try {
    await import('../lib/namespace.js');
    await import('../lib/utils.js');
    await import('../lib/settings.js');
    await import('../lib/storage.js');
  } catch (e) {
    console.warn('[EtsyInsightPro] worker lib import failed:', e);
  }
}

const PRUNE_ALARM = 'eip-prune';
const MENU_ANALYZE = 'eip-analyze';

try {
  chrome.runtime.onInstalled.addListener((details) => {
    (async () => {
      await ensureLibs();
      try {
        if (EIP.storage) {
          const settings = await EIP.storage.loadSettings();
          await EIP.storage.saveSettings(settings); // persists defaults on first run
          await EIP.storage.loadMeta();
        }
      } catch (e) { /* ignore */ }
      try {
        chrome.contextMenus.removeAll(() => {
          try {
            chrome.contextMenus.create({
              id: MENU_ANALYZE,
              title: 'Analyze with Etsy Insight Pro',
              contexts: ['page'],
              documentUrlPatterns: ['https://*.etsy.com/*']
            });
          } catch (e) { /* ignore */ }
        });
      } catch (e) { /* ignore */ }
      try { chrome.alarms.create(PRUNE_ALARM, { periodInMinutes: 60 * 24 }); } catch (e) { /* ignore */ }
      if (details && details.reason === 'install') {
        try { chrome.tabs.create({ url: chrome.runtime.getURL('src/dashboard/dashboard.html#/overview') }); } catch (e) { /* ignore */ }
      }
    })();
  });
} catch (e) { /* non-extension environment */ }

try {
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === MENU_ANALYZE && tab && tab.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'EIP_OPEN_PANEL' }).catch(() => {});
      chrome.tabs.sendMessage(tab.id, { type: 'EIP_ANALYZE' }).catch(() => {});
    }
  });
} catch (e) { /* ignore */ }

try {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm && alarm.name === PRUNE_ALARM) pruneOldData().catch(() => {});
  });
} catch (e) { /* ignore */ }

try {
  // Badge: show a dot while on Etsy entity pages.
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete' || !tab || !tab.url) return;
    updateBadge(tabId, tab.url).catch(() => {});
  });
  chrome.tabs.onActivated.addListener((info) => {
    chrome.tabs.get(info.tabId).then(tab => updateBadge(info.tabId, tab && tab.url)).catch(() => {});
  });
} catch (e) { /* ignore */ }

async function updateBadge(tabId, url) {
  try {
    const u = String(url || '');
    const onEtsy = /https:\/\/([^/]*\.)?etsy\.com\//.test(u);
    const entity = /\/(listing|shop|search|market)\b/.test(u);
    if (onEtsy && entity) {
      await chrome.action.setBadgeText({ tabId, text: '●' });
      await chrome.action.setBadgeBackgroundColor({ tabId, color: '#ea580c' });
    } else {
      await chrome.action.setBadgeText({ tabId, text: '' });
    }
  } catch (e) { /* ignore */ }
}

async function pruneOldData() {
  await ensureLibs();
  if (!EIP.storage) return;
  const settings = await EIP.storage.loadSettings();
  const retention = (settings && settings.historyRetentionDays) || 365;
  const cutoff = Date.now() - retention * 86400000;
  try {
    const products = await EIP.storage.loadProducts();
    let changed = false;
    for (const rec of Object.values(products)) {
      if (rec && Array.isArray(rec.observations)) {
        const before = rec.observations.length;
        rec.observations = rec.observations.filter(o => o && o.t >= cutoff).slice(-500);
        if (rec.observations.length !== before) changed = true;
      }
    }
    if (changed) await EIP.storage.saveProducts(products);
  } catch (e) { /* ignore */ }
  try {
    const shops = await EIP.storage.loadShops();
    let changed = false;
    for (const rec of Object.values(shops)) {
      if (rec && Array.isArray(rec.observations)) {
        const before = rec.observations.length;
        rec.observations = rec.observations.filter(o => o && o.t >= cutoff).slice(-500);
        if (rec.observations.length !== before) changed = true;
      }
    }
    if (changed) await EIP.storage.saveShops(shops);
  } catch (e) { /* ignore */ }
}

try {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async () => {
      if (!msg || !msg.type) return null;
      if (msg.type === 'EIP_PRUNE_NOW') {
        await pruneOldData();
        return { ok: true };
      }
      if (msg.type === 'EIP_OPEN_DASHBOARD') {
        const url = chrome.runtime.getURL('src/dashboard/dashboard.html' + (msg.hash || ''));
        await chrome.tabs.create({ url });
        return { ok: true };
      }
      return null;
    })().then(sendResponse).catch(err => sendResponse({ error: String(err && err.message || err) }));
    return true;
  });
} catch (e) { /* ignore */ }
