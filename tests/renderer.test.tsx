// @vitest-environment jsdom
/**
 * Renderer integration tests.
 *
 * These drive the real React components against a real Neurio server (the
 * in-process harness): register through the sign-in form, create a server,
 * send a message from the composer, watch another member's message and typing
 * indicator arrive over the WebSocket gateway, then react / edit / delete.
 *
 * Nothing is mocked — the components talk to the same REST API and gateway the
 * desktop app uses.
 */
import { WebSocket as NodeWebSocket } from 'ws';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ApiClient, makeGateway, startHarness, type Harness } from './helpers/harness';
import App from '../src/App';
import { useStore } from '../src/lib/store';

let harness: Harness;

/* ------------------------------ environment ------------------------------ */

beforeAll(async () => {
  // jsdom's WebSocket cannot reach a real server; the `ws` package can.
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = NodeWebSocket;
  if (!('matchMedia' in window)) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }),
    });
  }
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined;
  harness = await startHarness();
});

afterAll(async () => {
  await harness.close();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  resetStore();
});

/** Put the store back into a signed-out state between tests. */
function resetStore(): void {
  const state = useStore.getState();
  state.gateway?.disconnect();
  state.voiceEngine?.destroy();
  useStore.setState({
    api: null,
    token: null,
    user: null,
    authStatus: 'anonymous',
    connection: 'idle',
    lastError: null,
    guilds: {},
    guildOrder: [],
    channels: {},
    dmOrder: [],
    messages: {},
    messageHasMore: {},
    readStates: {},
    presence: {},
    typing: {},
    voiceStates: {},
    relationships: [],
    activeCallChannelId: null,
    callPeers: [],
    localStream: null,
    screenStream: null,
    speakingUsers: {},
    focusedChannelId: null,
    view: 'channels',
    selectedGuildId: null,
    selectedChannelId: null,
    modal: null,
    searchOpen: false,
    toasts: [],
  });
}

/** Create an account with a known password and return a REST client for it. */
async function makeUser(username: string, password: string): Promise<ApiClient> {
  const client = new ApiClient(harness.url);
  await client.register(username, password);
  return client;
}

async function signIn(username: string, password: string, passwordForStore = password): Promise<void> {
  await makeUser(username, password);
  await useStore.getState().login(username, passwordForStore, harness.url);
  await waitFor(() => expect(useStore.getState().connection).toBe('connected'), { timeout: 8000 });
}

/** The default channel the server creates with a guild. */
function firstTextChannel(guildId: string): string {
  const channel = useStore.getState().guilds[guildId]?.channels?.find((entry) => entry.type === 'text');
  if (!channel) throw new Error('the guild has no text channel');
  return channel.id;
}

/* --------------------------------- tests --------------------------------- */

describe('renderer', () => {
  it('registers through the sign-in screen and lands on the app shell', async () => {
    render(<App />);

    // The auth screen appears once the store has probed the server.
    await screen.findByRole('button', { name: 'Sign in' }, { timeout: 8000 });
    fireEvent.click(screen.getByRole('button', { name: 'Create one' }));

    fireEvent.change(screen.getByLabelText('Server address'), { target: { value: harness.url } });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'uiuser' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'ui-password-123' } });
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'UI User' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'ui-password-123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    // Signed in: the guild rail is on screen, and the friends view opens from it.
    await screen.findByRole('navigation', { name: 'Servers' }, { timeout: 10_000 });
    fireEvent.click(screen.getByRole('button', { name: 'Direct messages and friends' }));
    await screen.findByRole('button', { name: 'Add friend' }, { timeout: 10_000 });
    expect(useStore.getState().authStatus).toBe('authenticated');
    expect(useStore.getState().user?.username).toBe('uiuser');
    expect(screen.getByText('UI User')).toBeTruthy();
  }, 40_000);

  it('creates a server, sends a message from the composer and stores it', async () => {
    await signIn('sender', 'sender-password-123');
    render(<App />);
    await screen.findByRole('navigation', { name: 'Servers' }, { timeout: 10_000 });

    let channelId = '';
    await act(async () => {
      const guildId = await useStore.getState().createGuild('Renderer HQ');
      channelId = firstTextChannel(guildId);
      await useStore.getState().selectChannel(channelId);
    });

    const composer = await screen.findByPlaceholderText(/^Message #/, undefined, { timeout: 8000 });
    fireEvent.change(composer, { target: { value: '**Hello** from the composer' } });
    fireEvent.keyDown(composer, { key: 'Enter', code: 'Enter', charCode: 13 });

    // Rendered as markdown (bold text inside a <strong>).
    await screen.findByText('Hello', { selector: 'strong' }, { timeout: 10_000 });

    // …and really persisted by the server.
    const stored = await useStore.getState().api!.messages(channelId, { limit: 10 });
    expect(stored.messages.some((message) => message.content === '**Hello** from the composer')).toBe(true);
  }, 40_000);

  it("receives another member's typing indicator and message over the gateway", async () => {
    await signIn('gwowner', 'gwowner-password-123');

    const guildId = await useStore.getState().createGuild('Gateway Harbour');
    const channelId = firstTextChannel(guildId);
    const invite = await useStore.getState().createInvite(guildId, channelId);

    // A second, independent user joins with the invite code.
    const guest = await makeUser('gwguest', 'gwguest-password-123');
    const joined = await guest.post(`/api/invites/${invite}/accept`);
    expect(joined.status).toBe(200);

    render(<App />);
    await act(async () => {
      await useStore.getState().selectChannel(channelId);
    });
    await waitFor(() => expect(useStore.getState().connection).toBe('connected'), { timeout: 10_000 });

    const guestGateway = await makeGateway(harness.url, guest.token!);
    guestGateway.send({ op: 'typing', d: { channel_id: channelId } });
    await waitFor(
      () => expect(document.querySelector('.typing-indicator')?.textContent ?? '').toMatch(/is typing/),
      { timeout: 10_000 },
    );

    await guest.sendMessage(channelId, 'guest says hello');
    await screen.findByText('guest says hello', undefined, { timeout: 10_000 });
    guestGateway.close();
  }, 40_000);

  it('reacts, edits and deletes a message in the DOM', async () => {
    await signIn('reactor', 'reactor-password-123');
    const guildId = await useStore.getState().createGuild('Reaction Lab');
    const channelId = firstTextChannel(guildId);
    await useStore.getState().selectChannel(channelId);

    render(<App />);
    const composer = await screen.findByPlaceholderText(/^Message #/, undefined, { timeout: 8000 });
    fireEvent.change(composer, { target: { value: 'react to me' } });
    fireEvent.keyDown(composer, { key: 'Enter', code: 'Enter', charCode: 13 });
    await screen.findByText('react to me', undefined, { timeout: 10_000 });

    const messageId = Object.values(useStore.getState().messages)
      .flat()
      .find((message) => message.content === 'react to me')!.id;

    await act(async () => {
      await useStore.getState().toggleReaction(messageId, '🎉', false);
    });
    const pill = await screen.findByText('🎉');
    expect(pill.closest('.reaction')?.textContent).toContain('1');

    await act(async () => {
      await useStore.getState().editMessage(messageId, 'react to me — edited');
    });
    await screen.findByText('react to me — edited', undefined, { timeout: 10_000 });

    await act(async () => {
      await useStore.getState().deleteMessage(messageId);
    });
    await waitFor(() => expect(screen.queryByText('react to me — edited')).toBeNull());
  }, 40_000);


  it('accepts a pasted image in the composer and shows it before sending', async () => {
    await signIn('paster', 'paster-password-123');
    const guildId = await useStore.getState().createGuild('Paste Bay');
    await useStore.getState().selectChannel(firstTextChannel(guildId));

    render(<App />);
    const composer = await screen.findByPlaceholderText(/^Message #/, undefined, { timeout: 8000 });

    const file = new File([new Uint8Array([1, 2, 3, 4])], 'pixel.png', { type: 'image/png' });
    fireEvent.paste(composer, { clipboardData: { files: [file] } });

    // The composer lists the pending attachment and enables Send.
    await waitFor(() => expect(document.querySelectorAll('.composer-file')).toHaveLength(1));
    expect(document.querySelector('.composer-file')?.textContent).toContain('pixel.png');
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(false);
  }, 40_000);

  it('renders an attachment from another client and serves its bytes', async () => {
    await signIn('viewer', 'viewer-password-123');
    const guildId = await useStore.getState().createGuild('Attachment Bay');
    const channelId = firstTextChannel(guildId);
    const invite = await useStore.getState().createInvite(guildId, channelId);

    // A second client uploads a real PNG and posts it (this is the same REST path
    // the composer uses; uploads themselves are covered by server.uploads.test.ts).
    const png = Uint8Array.from(
      atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='),
      (character) => character.charCodeAt(0),
    );
    const photo = new ApiClient(harness.url);
    await photo.register('photographer', 'photo-password-123');
    await photo.post(`/api/invites/${invite}/accept`);

    // jsdom's FormData cannot be handed to Node's fetch, so the multipart body is
    // built as raw bytes — byte-for-byte what a browser would send.
    const boundary = 'neurioTestBoundary';
    const encoder = new TextEncoder();
    const head = encoder.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="pixel.png"\r\nContent-Type: image/png\r\n\r\n`,
    );
    const tail = encoder.encode(`\r\n--${boundary}--\r\n`);
    const body = new Uint8Array(head.length + png.length + tail.length);
    body.set(head, 0);
    body.set(png, head.length);
    body.set(tail, head.length + png.length);

    const uploadResponse = await fetch(`${harness.url}/api/uploads`, {
      method: 'POST',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        authorization: `Bearer ${photo.token}`,
      },
      body,
    });
    expect(uploadResponse.status).toBe(200);
    const attachmentId = ((await uploadResponse.json()) as { attachments: { id: string }[] }).attachments[0].id;
    const sent = await photo.post(`/api/channels/${channelId}/messages`, {
      content: 'here is a picture',
      upload_ids: [attachmentId],
    });
    expect(sent.status).toBe(200);

    render(<App />);
    await act(async () => {
      await useStore.getState().selectChannel(channelId);
    });

    const image = await screen.findByRole('img', { name: 'pixel.png' }, { timeout: 10_000 });
    const src = image.getAttribute('src') ?? '';
    expect(src).toContain('/api/files/');

    // The stored bytes come back byte-for-byte (the renderer builds absolute URLs).
    expect(src.startsWith('http')).toBe(true);
    const response = await fetch(src);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);

    // Clicking the image opens the lightbox.
    fireEvent.click((image.closest('button') ?? image) as HTMLElement);
    await waitFor(() => expect(document.querySelector('.lightbox')).not.toBeNull());
  }, 40_000);

  it('accepts a pending friend request from the friends view', async () => {
    const alice = await makeUser('friendalice', 'alice-password-123');
    await useStore.getState().login('friendalice', 'alice-password-123', harness.url);
    await waitFor(() => expect(useStore.getState().connection).toBe('connected'));

    const bob = await makeUser('friendbob', 'bob-password-123');
    await bob.post('/api/relationships/requests', { username: 'friendalice' });
    expect(alice.token).toBeTruthy();

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Direct messages and friends' }, { timeout: 10_000 }));
    fireEvent.click(await screen.findByRole('button', { name: /^Pending/ }, { timeout: 10_000 }));

    const row = await screen.findByText('FRIENDBOB', undefined, { timeout: 10_000 });
    const listItem = row.closest('li') as HTMLElement;
    fireEvent.click(within(listItem).getByRole('button', { name: 'Accept' }));

    await waitFor(
      () => expect(useStore.getState().relationships.some((entry) => entry.type === 'friend')).toBe(true),
      { timeout: 10_000 },
    );
  }, 40_000);

  it('generates a real invite code in the invite modal', async () => {
    await signIn('inviter', 'inviter-password-123');
    const guildId = await useStore.getState().createGuild('Invite Tower');
    render(<App />);

    await act(async () => {
      useStore.getState().openModal('invite', { guildId, channelId: firstTextChannel(guildId) });
    });

    await screen.findByRole('heading', { name: /Invite people to Invite Tower/ }, { timeout: 8000 });
    fireEvent.click(screen.getByRole('button', { name: 'Generate a new invite' }));

    // The code comes back from the server and is shown in the modal.
    const code = await screen.findByText(/^[a-z0-9]{6,12}$/, { selector: 'code' }, { timeout: 10_000 });
    expect(code.textContent).toMatch(/^[a-z0-9]{6,12}$/);
  }, 40_000);

  it('shows a toast when the server rejects an action', async () => {
    await signIn('tester', 'tester-password-123');
    const guildId = await useStore.getState().createGuild('Toast Town');
    render(<App />);

    await act(async () => {
      // The server rejects an empty channel name; the store must surface that as a toast.
      await useStore.getState().createChannel(guildId, '', 'text').catch(() => undefined);
    });

    await waitFor(() => expect(useStore.getState().toasts.length).toBeGreaterThan(0), { timeout: 10_000 });
    const toast = document.querySelector('.toast');
    expect(toast?.textContent ?? '').not.toBe('');
  }, 40_000);
});
