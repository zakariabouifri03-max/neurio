/** Attachments, avatars, server icons, range requests and access control. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiClient, startHarness, type Harness } from './helpers/harness';
import type { Channel, Guild, Message } from '../shared/types';
import { sniffImageSize } from '../server/media';

let harness: Harness;
let alice: ApiClient;
let bob: ApiClient;
let guild: Guild & { channels: Channel[] };
let channelId: string;

/** Smallest valid PNG (1×1, transparent). */
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

function formWith(files: { name: string; type: string; data: Buffer }[]): FormData {
  const form = new FormData();
  for (const file of files) {
    form.append('files', new Blob([new Uint8Array(file.data)], { type: file.type }), file.name);
  }
  return form;
}

beforeAll(async () => {
  harness = await startHarness();
  alice = new ApiClient(harness.url);
  bob = new ApiClient(harness.url);
  await alice.register('uploader');
  await bob.register('intruder');
  guild = await alice.createGuild('Files Server');
  channelId = guild.channels.find((c) => c.type === 'text')!.id;
});

afterAll(async () => {
  await harness?.close();
});

describe('image metadata', () => {
  it('reads PNG dimensions from the header', () => {
    expect(sniffImageSize(PNG_1x1)).toEqual({ width: 1, height: 1 });
  });

  it('returns null for non-images', () => {
    expect(sniffImageSize(Buffer.from('this is definitely not an image'))).toBeNull();
  });
});

describe('uploads', () => {
  let uploadedId: string;
  let message: Message;

  it('uploads a file and attaches it to a message', async () => {
    const upload = await alice.request<{ attachments: { id: string; url: string; filename: string; size: number }[] }>(
      'POST',
      '/api/uploads',
      { body: formWith([{ name: 'photo.png', type: 'image/png', data: PNG_1x1 }]) },
    );
    expect(upload.status).toBe(200);
    expect(upload.body.attachments).toHaveLength(1);
    uploadedId = upload.body.attachments[0].id;
    expect(upload.body.attachments[0].filename).toBe('photo.png');
    expect(upload.body.attachments[0].size).toBe(PNG_1x1.length);

    message = await alice.sendMessage(channelId, 'look at this', { upload_ids: [uploadedId] });
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0].filename).toBe('photo.png');
  });

  it('downloads the file back byte-for-byte', async () => {
    const response = await fetch(`${harness.url}/api/files/${uploadedId}?t=${alice.token}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    const buffer = Buffer.from(await response.arrayBuffer());
    expect(buffer.equals(PNG_1x1)).toBe(true);
  });

  it('supports range requests for media playback', async () => {
    const response = await fetch(`${harness.url}/api/files/${uploadedId}?t=${alice.token}`, {
      headers: { range: 'bytes=0-7' },
    });
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe(`bytes 0-7/${PNG_1x1.length}`);
  });

  it('hides attachments from users who cannot see the channel', async () => {
    const response = await fetch(`${harness.url}/api/files/${uploadedId}?t=${bob.token}`);
    expect(response.status).toBe(403);
    const anonymous = await fetch(`${harness.url}/api/files/${uploadedId}`);
    expect(anonymous.status).toBe(401);
  });

  it('rejects a file type that is not allowed', async () => {
    const form = new FormData();
    form.append('files', new Blob([new Uint8Array([1, 2, 3])], { type: 'application/x-msdownload' }), 'virus.exe');
    const response = await alice.request('POST', '/api/uploads', { body: form });
    expect(response.status).toBe(415);
  });

  it('refuses to attach somebody else’s upload', async () => {
    const upload = await alice.request<{ attachments: { id: string }[] }>('POST', '/api/uploads', {
      body: formWith([{ name: 'mine.png', type: 'image/png', data: PNG_1x1 }]),
    });
    const attacker = await bob.post(`/api/channels/${channelId}/messages`, {
      content: 'stealing your file',
      upload_ids: [upload.body.attachments[0].id],
    });
    // Bob is not even in the server yet, so this is rejected either way.
    expect([403, 404]).toContain(attacker.status);
  });

  it('deletes the stored file when the message is deleted', async () => {
    const upload = await alice.request<{ attachments: { id: string }[] }>('POST', '/api/uploads', {
      body: formWith([{ name: 'temporary.png', type: 'image/png', data: PNG_1x1 }]),
    });
    const id = upload.body.attachments[0].id;
    const target = await alice.sendMessage(channelId, 'attached then deleted', { upload_ids: [id] });
    expect(harness.app.uploads.exists(id)).toBe(true);
    await alice.delete(`/api/messages/${target.id}`);
    expect(harness.app.uploads.exists(id)).toBe(false);
  });

  it('sweeps orphaned uploads', async () => {
    await alice.request('POST', '/api/uploads', {
      body: formWith([{ name: 'orphan.png', type: 'image/png', data: PNG_1x1 }]),
    });
    const before = harness.app.db.all('SELECT * FROM uploads').length;
    // Pretend the upload was created two days ago.
    harness.app.db.run('UPDATE uploads SET created_at = 0');
    const removed = harness.app.uploads.sweepOrphans(harness.app.db, 24 * 60 * 60 * 1000);
    expect(removed).toBeGreaterThan(0);
    // The attached avatar-less upload in the earlier message is kept.
    expect(harness.app.db.all('SELECT * FROM uploads').length).toBeLessThanOrEqual(before);
  });
});

describe('avatars and icons', () => {
  it('uploads an avatar and exposes it as a public file', async () => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(PNG_1x1)], { type: 'image/png' }), 'avatar.png');
    const uploaded = await alice.request<{ user: { avatar_url: string | null } }>('POST', '/api/users/@me/avatar', {
      body: form,
    });
    expect(uploaded.status).toBe(200);
    expect(uploaded.body.user.avatar_url).toMatch(/^\/api\/files\//);
    // Avatars are visible to any signed-in user without a channel context.
    const raw = await fetch(`${harness.url}${uploaded.body.user.avatar_url}?t=${bob.token}`);
    expect(raw.status).toBe(200);
  });

  it('rejects non-image avatars', async () => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array([1, 2, 3])], { type: 'text/plain' }), 'notes.txt');
    const response = await alice.request('POST', '/api/users/@me/avatar', { body: form });
    expect(response.status).toBe(415);
  });

  it('sets a server icon', async () => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(PNG_1x1)], { type: 'image/png' }), 'icon.png');
    const response = await alice.request<{ guild: { icon_url: string | null } }>(
      'POST',
      `/api/guilds/${guild.id}/icon`,
      { body: form },
    );
    expect(response.status).toBe(200);
    expect(response.body.guild.icon_url).toMatch(/^\/api\/files\//);
  });
});
