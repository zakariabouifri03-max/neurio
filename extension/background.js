/**
 * Hidden Winner Finder - Background Service Worker (Manifest V3)
 */

// Install listener
chrome.runtime.onInstalled.addListener(() => {
  console.log('Hidden Winner Finder installed.');

  // Create Context Menus
  chrome.contextMenus.create({
    id: 'hwf_find_winner',
    title: 'Find Hidden Winner for "%s"',
    contexts: ['selection']
  });

  chrome.contextMenus.create({
    id: 'hwf_analyze_page',
    title: 'Analyze this Marketplace Page with Hidden Winner Finder',
    contexts: ['page']
  });

  // Enable side panel on action click if supported
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
  }
});

// Handle Context Menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'hwf_find_winner' && info.selectionText) {
    // Store selected search query and open side panel or popup
    chrome.storage.local.set({ lastSearchQuery: info.selectionText.trim() }, () => {
      if (chrome.sidePanel && chrome.sidePanel.open && tab && tab.id) {
        chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
      }
    });
  } else if (info.menuItemId === 'hwf_analyze_page' && tab && tab.id) {
    chrome.tabs.sendMessage(tab.id, { action: 'HWF_TRIGGER_PAGE_SCAN' }, (res) => {
      if (chrome.runtime.lastError) {
        console.warn('Page scan trigger:', chrome.runtime.lastError.message);
      }
    });
  }
});

// Handle runtime messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'HWF_PAGE_SIGNALS_DETECTED') {
    // Content script detected marketplace page data
    chrome.storage.local.set({ currentPageSignals: request.data }, () => {
      sendResponse({ status: 'ok' });
    });
    return true;
  }

  if (request.action === 'HWF_GET_ACTIVE_TAB_DATA') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'HWF_GET_PAGE_DATA' }, (res) => {
          if (chrome.runtime.lastError) {
            sendResponse({ data: null });
          } else {
            sendResponse({ data: res });
          }
        });
      } else {
        sendResponse({ data: null });
      }
    });
    return true;
  }
});
