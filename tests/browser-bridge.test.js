import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHROME_EXTENSION_ID, FIREFOX_EXTENSION_ID, NATIVE_HOST_NAME } from '../electron/browser-bridge.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('browser extension uses explicit permissions and a native-host allowlist matching its stable ID', async () => {
  const extension = JSON.parse(await fs.readFile(path.join(root, 'browser-bridge/extension/manifest.json'), 'utf8'));
  const bridgeSource = await fs.readFile(path.join(root, 'electron/browser-bridge.js'), 'utf8');
  assert.deepEqual(extension.permissions, ['contextMenus', 'nativeMessaging', 'activeTab']);
  assert.equal('host_permissions' in extension, false);
  assert.equal(extension.browser_specific_settings.gecko.id, FIREFOX_EXTENSION_ID);
  assert.match(bridgeSource, /name: NATIVE_HOST_NAME/);
  assert.match(bridgeSource, /allowed_origins: \[`chrome-extension:\/\/\$\{CHROME_EXTENSION_ID\}\/`\]/);
  assert.match(bridgeSource, /allowed_extensions: \[FIREFOX_EXTENSION_ID\]/);
  const digest = createHash('sha256').update(Buffer.from(extension.key, 'base64')).digest().subarray(0, 16);
  const calculatedId = [...digest].map((byte) => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15))).join('');
  assert.equal(calculatedId, CHROME_EXTENSION_ID, 'the manifest key must produce the ID allowed by the native host');
  assert.equal(extension.background.service_worker, 'background.js');
  assert.equal(NATIVE_HOST_NAME, 'com.aidownloadmanager.pro');
});
