/**
 * Hidden Winner Finder - Storage & Environment Adapter
 * Provides a seamless interface whether running inside Chrome Extension (MV3)
 * or in web dev/preview mode.
 */

const StorageAdapter = {
  isExtension() {
    return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
  },

  async get(keys) {
    if (this.isExtension()) {
      return new Promise((resolve) => {
        chrome.storage.local.get(keys, (res) => {
          if (chrome.runtime.lastError) {
            console.warn('Storage get error:', chrome.runtime.lastError);
            resolve({});
          } else {
            resolve(res || {});
          }
        });
      });
    }

    // Fallback: localStorage
    const result = {};
    if (typeof keys === 'string') {
      try {
        const item = localStorage.getItem('hwf_' + keys);
        result[keys] = item !== null ? JSON.parse(item) : undefined;
      } catch (e) {
        result[keys] = undefined;
      }
    } else if (Array.isArray(keys)) {
      keys.forEach((k) => {
        try {
          const item = localStorage.getItem('hwf_' + k);
          result[k] = item !== null ? JSON.parse(item) : undefined;
        } catch (e) {
          result[k] = undefined;
        }
      });
    } else if (typeof keys === 'object' && keys !== null) {
      Object.keys(keys).forEach((k) => {
        try {
          const item = localStorage.getItem('hwf_' + k);
          result[k] = item !== null ? JSON.parse(item) : keys[k];
        } catch (e) {
          result[k] = keys[k];
        }
      });
    }
    return result;
  },

  async set(items) {
    if (this.isExtension()) {
      return new Promise((resolve) => {
        chrome.storage.local.set(items, () => {
          if (chrome.runtime.lastError) {
            console.warn('Storage set error:', chrome.runtime.lastError);
          }
          resolve();
        });
      });
    }

    // Fallback: localStorage
    Object.keys(items).forEach((k) => {
      try {
        localStorage.setItem('hwf_' + k, JSON.stringify(items[k]));
      } catch (e) {
        console.warn('LocalStorage error:', e);
      }
    });
  },

  async remove(keys) {
    if (this.isExtension()) {
      return new Promise((resolve) => {
        chrome.storage.local.remove(keys, resolve);
      });
    }

    const keyList = Array.isArray(keys) ? keys : [keys];
    keyList.forEach((k) => localStorage.removeItem('hwf_' + k));
  }
};

if (typeof module !== 'undefined') {
  module.exports = StorageAdapter;
}
