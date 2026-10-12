/**
 * Voice channels, WebRTC signalling relay and call bookkeeping.
 * Two real gateway sockets, real SQLite, real HTTP — the server relays SDP and
 * ICE between peers and keeps voice state; media itself never touches the
 * server (it is peer-to-peer).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiClient, GatewayClient, makeGateway, startHarness, type Harness } from './helpers/harness';
import type { Channel, Guild } from '../shared/types';
import type { VoiceSignalPayload, VoiceSpeakingPayload } from '../shared/protocol';

let harness: Harness;
let alice: ApiClient;
let bob: ApiClient;
let aliceGateway: GatewayClient;
let bobGateway: GatewayClient;
let guild: Guild & { channels: Channel[] };
let voiceChannelId: string;

beforeAll(async () => {
  harness = await startHarness();
  alice = new ApiClient(harness.url);
  bob = new ApiClient(harness.url);
  await alice.register('voicealice');
  await bob.register('voicebob');
  guild = await alice.createGuild('Voice Server');
  voiceChannelId = guild.channels.find((c) => c.type === 'voice')!.id;
  const invite = await alice.post<{ invite: { code: string } }>(`/api/guilds/${guild.id}/invites`, {
    channel_id: guild.channels.find((c) => c.type === 'text')!.id,
  });
  await bob.post(`/api/invites/${invite.body.invite.code}/accept`);
  aliceGateway = await makeGateway(harness.url, alice.token!);
  bobGateway = await makeGateway(harness.url, bob.token!);
});

afterAll(async () => {
  await aliceGateway?.close();
  await bobGateway?.close();
  await harness?.close();
});

describe('voice state', () => {
  it('lets a member join a voice channel and announces it', async () => {
    aliceGateway.send({
      op: 'voice.join',
      d: { channel_id: voiceChannelId, self_mute: false, self_deaf: false, self_video: false, self_stream: false },
    });
    const update = await bobGateway.waitFor((event) => event.t === 'VOICE_STATE_UPDATE');
    const payload = update.d as { channel_id: string; state: { user_id: string } | null };
    expect(payload.channel_id).toBe(voiceChannelId);
    // Either the state arrived directly or as part of the full channel snapshot.
    const states = (update.d as { states?: { user_id: string }[] }).states ?? [];
    const joined = payload.state ?? states.find((s) => s.user_id !== undefined);
    expect(joined).toBeTruthy();

    const roster = await alice.get<{ states: { user_id: string; channel_id: string }[] }>(
      `/api/guilds/${guild.id}/voice-states`,
    );
    expect(roster.body.states.some((s) => s.channel_id === voiceChannelId)).toBe(true);
  });

  it('reports the second participant joining', async () => {
    bobGateway.send({
      op: 'voice.join',
      d: { channel_id: voiceChannelId, self_mute: true, self_deaf: false, self_video: true, self_stream: false },
    });
    const update = await aliceGateway.waitFor((event) => {
      if (event.t !== 'VOICE_STATE_UPDATE') return false;
      const data = event.d as { states?: { self_video: boolean }[] };
      return (data.states ?? []).some((state) => state.self_video === true);
    });
    expect(update.t).toBe('VOICE_STATE_UPDATE');
  });

  it('updates self mute/video flags', async () => {
    aliceGateway.send({
      op: 'voice.state',
      d: { channel_id: voiceChannelId, self_mute: true, self_video: true, self_stream: true },
    });
    const update = await bobGateway.waitFor((event) => {
      if (event.t !== 'VOICE_STATE_UPDATE') return false;
      const data = event.d as { states?: { self_mute: boolean; self_stream: boolean }[] };
      return (data.states ?? []).some((state) => state.self_mute && state.self_stream);
    });
    expect(update.t).toBe('VOICE_STATE_UPDATE');
  });

  it('broadcasts speaking indicators to the channel', async () => {
    bobGateway.send({ op: 'voice.speaking', d: { channel_id: voiceChannelId, speaking: true } });
    const speaking = await aliceGateway.waitFor((event) => event.t === 'VOICE_SPEAKING');
    expect((speaking.d as VoiceSpeakingPayload).speaking).toBe(true);
  });
});

describe('WebRTC signalling relay', () => {
  it('relays an offer to a specific peer', async () => {
    const bobId = (await bob.me()).id;
    aliceGateway.send({
      op: 'voice.signal',
      d: {
        channel_id: voiceChannelId,
        target_user_id: bobId,
        payload: { type: 'offer', sdp: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n' },
      },
    });
    const signal = await bobGateway.waitFor((event) => event.t === 'VOICE_SIGNAL');
    const payload = signal.d as VoiceSignalPayload;
    expect(payload.from_user_id).toBe((await alice.me()).id);
    expect(payload.payload).toMatchObject({ type: 'offer' });
    expect((payload.payload as { sdp: string }).sdp).toContain('v=0');
  });

  it('relays an answer back', async () => {
    aliceGateway.send({
      op: 'voice.signal',
      d: { channel_id: voiceChannelId, target_user_id: (await bob.me()).id, payload: { type: 'offer', sdp: 'offer-2' } },
    });
    await bobGateway.waitFor(
      (event) => event.t === 'VOICE_SIGNAL' && (event.d as VoiceSignalPayload).payload.type === 'offer',
    );
    bobGateway.send({
      op: 'voice.signal',
      d: {
        channel_id: voiceChannelId,
        target_user_id: (await alice.me()).id,
        payload: { type: 'answer', sdp: 'v=0\r\nanswer' },
      },
    });
    const answer = await aliceGateway.waitFor(
      (event) => event.t === 'VOICE_SIGNAL' && (event.d as VoiceSignalPayload).payload.type === 'answer',
    );
    expect((answer.d as VoiceSignalPayload).payload).toMatchObject({ type: 'answer' });
  });

  it('relays ICE candidates', async () => {
    aliceGateway.send({
      op: 'voice.signal',
      d: {
        channel_id: voiceChannelId,
        target_user_id: (await bob.me()).id,
        payload: { type: 'candidate', candidate: { candidate: 'candidate:1 1 udp 2130706431 192.168.1.5 54400 typ host' } },
      },
    });
    const candidate = await bobGateway.waitFor(
      (event) => event.t === 'VOICE_SIGNAL' && (event.d as VoiceSignalPayload).payload.type === 'candidate',
    );
    expect((candidate.d as VoiceSignalPayload).payload).toMatchObject({ type: 'candidate' });
  });

  it('refuses to signal peers outside the voice channel', async () => {
    const carol = new ApiClient(harness.url);
    await carol.register('voicecarol');
    aliceGateway.send({
      op: 'voice.signal',
      d: { channel_id: voiceChannelId, target_user_id: (await carol.me()).id, payload: { type: 'offer', sdp: 'x' } },
    });
    // Give the server a moment; the important part is that nothing is delivered.
    await new Promise((resolve) => setTimeout(resolve, 150));
    const carolGateway = await makeGateway(harness.url, carol.token!);
    try {
      expect(carolGateway.eventNamed('VOICE_SIGNAL')).toBeUndefined();
    } finally {
      await carolGateway.close();
    }
  });
});

describe('leaving a call', () => {
  it('removes the voice state and ends the call record', async () => {
    const calls = harness.app.db.all<{ id: string; started_at: number; ended_at: number | null }>(
      'SELECT id, started_at, ended_at FROM calls WHERE channel_id = ?',
      [voiceChannelId],
    );
    expect(calls.length).toBe(1);
    expect(calls[0].ended_at).toBeNull();

    bobGateway.send({ op: 'voice.leave', d: { channel_id: voiceChannelId } });
    await aliceGateway.waitFor((event) => {
      if (event.t !== 'VOICE_STATE_UPDATE') return false;
      const data = event.d as { state: unknown; states?: { user_id: string }[] };
      return data.state === null || (data.states ?? []).length === 1;
    });
    aliceGateway.send({ op: 'voice.leave', d: { channel_id: voiceChannelId } });
    await new Promise((resolve) => setTimeout(resolve, 200));

    const remaining = harness.app.db.all('SELECT * FROM voice_states WHERE channel_id = ?', [voiceChannelId]);
    expect(remaining).toHaveLength(0);
    const ended = harness.app.db.get<{ ended_at: number | null }>('SELECT ended_at FROM calls WHERE channel_id = ?', [
      voiceChannelId,
    ]);
    expect(ended?.ended_at).not.toBeNull();
  });

  it('drops voice state when the socket disconnects', async () => {
    const client = new ApiClient(harness.url);
    await client.register('voicedave');
    const invite = await alice.post<{ invite: { code: string } }>(`/api/guilds/${guild.id}/invites`, {
      channel_id: guild.channels.find((c) => c.type === 'text')!.id,
    });
    await client.post(`/api/invites/${invite.body.invite.code}/accept`);
    const gateway = await makeGateway(harness.url, client.token!);
    gateway.send({
      op: 'voice.join',
      d: { channel_id: voiceChannelId, self_mute: false, self_deaf: false, self_video: false, self_stream: false },
    });
    await aliceGateway.waitFor((event) => event.t === 'VOICE_STATE_UPDATE');
    await gateway.close();
    await new Promise((resolve) => setTimeout(resolve, 250));
    const states = harness.app.db.all('SELECT * FROM voice_states WHERE channel_id = ?', [voiceChannelId]);
    expect(states).toHaveLength(0);
  });
});
