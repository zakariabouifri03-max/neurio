/**
 * WebRTC voice engine (mesh topology).
 *
 * • Audio/video/screen media flows **peer-to-peer**; the Neurio server only
 *   relays SDP and ICE candidates.
 * • Each pair of peers negotiates with "perfect negotiation" (polite/impolite
 *   role decided by user-id ordering) so simultaneous renegotiations settle
 *   without glare.
 * • Local speaking detection uses an AnalyserNode; the gateway then broadcasts
 *   speaking indicators so everybody sees the green ring.
 * • ICE servers come from the server config. With none configured this still
 *   works on a LAN (host candidates); across the internet you need STUN/TURN —
 *   see docs/NETWORKING.md.
 */
import type { IceServerConfig, SignalPayload, VoiceState } from './types';
import type { Gateway } from './gateway';

export interface PeerState {
  userId: string;
  stream: MediaStream | null;
  connection: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoringOffer: boolean;
  audio: boolean;
  video: boolean;
  screen: boolean;
  speaking: boolean;
}

export interface VoiceEngineEvents {
  onPeersChanged?: (peers: VoicePeerSnapshot[]) => void;
  onLocalStream?: (stream: MediaStream | null) => void;
  onScreenStream?: (stream: MediaStream | null) => void;
  onSpeaking?: (speaking: boolean) => void;
  onError?: (message: string) => void;
  onMicrophoneLevel?: (level: number) => void;
}

export interface VoicePeerSnapshot {
  userId: string;
  stream: MediaStream | null;
  audio: boolean;
  video: boolean;
  screen: boolean;
  speaking: boolean;
}

export interface JoinOptions {
  channelId: string;
  selfMute: boolean;
  selfDeaf: boolean;
  video: boolean;
  screen: boolean;
}

export class VoiceEngine {
  #gateway: Gateway;
  #events: VoiceEngineEvents;
  #iceServers: IceServerConfig[];
  #channelId: string | null = null;
  #selfId = '';
  #peers = new Map<string, PeerState>();
  #localStream: MediaStream | null = null;
  #screenStream: MediaStream | null = null;
  #audioContext: AudioContext | null = null;
  #analyser: AnalyserNode | null = null;
  #speakingLoop: number | null = null;
  #isSpeaking = false;
  #muted = false;
  #deafened = false;
  #videoEnabled = false;
  #screenEnabled = false;
  #destroyed = false;

  constructor(options: {
    gateway: Gateway;
    userId: string;
    iceServers?: IceServerConfig[];
    events?: VoiceEngineEvents;
  }) {
    this.#gateway = options.gateway;
    this.#selfId = options.userId;
    this.#iceServers = options.iceServers ?? [];
    this.#events = options.events ?? {};
  }

  get channelId(): string | null {
    return this.#channelId;
  }

  get localStream(): MediaStream | null {
    return this.#localStream;
  }

  get screenStream(): MediaStream | null {
    return this.#screenStream;
  }

  get connected(): boolean {
    return this.#channelId !== null;
  }

  get peers(): VoicePeerSnapshot[] {
    return [...this.#peers.values()].map((peer) => ({
      userId: peer.userId,
      stream: peer.stream,
      audio: peer.audio,
      video: peer.video,
      screen: peer.screen,
      speaking: peer.speaking,
    }));
  }

  get microphoneLevel(): number {
    if (!this.#analyser) return 0;
    const data = new Uint8Array(this.#analyser.frequencyBinCount);
    this.#analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const value of data) {
      const centred = (value - 128) / 128;
      sum += centred * centred;
    }
    return Math.sqrt(sum / data.length);
  }

  /* --------------------------------- join --------------------------------- */

  async join(options: JoinOptions): Promise<void> {
    if (this.#channelId === options.channelId) return;
    await this.leave();
    this.#channelId = options.channelId;
    this.#muted = options.selfMute;
    this.#deafened = options.selfDeaf;

    try {
      this.#localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      const track = this.#localStream.getAudioTracks()[0];
      if (track) track.enabled = !this.#muted;
      this.#attachLevelMeter(this.#localStream);
      this.#events.onLocalStream?.(this.#localStream);
    } catch (error) {
      const message = (error as Error).message ?? 'microphone unavailable';
      this.#events.onError?.(
        `Microphone unavailable (${message}) — joining muted. Voice still receives audio.`,
      );
      this.#localStream = null;
      this.#muted = true;
    }

    if (options.video) await this.enableVideo(true).catch(() => undefined);
    if (options.screen) await this.enableScreen(true).catch(() => undefined);

    this.#gateway.joinVoice({
      channelId: options.channelId,
      selfMute: this.#muted,
      selfDeaf: this.#deafened,
      selfVideo: this.#videoEnabled,
      selfStream: this.#screenEnabled,
    });
  }

  async leave(): Promise<void> {
    const channelId = this.#channelId;
    this.#channelId = null;
    for (const peer of this.#peers.values()) {
      try {
        this.#gateway.signal(channelId ?? '', peer.userId, { type: 'bye' });
      } catch {
        /* socket may already be gone */
      }
      peer.connection.onicecandidate = null;
      peer.connection.ontrack = null;
      peer.connection.onnegotiationneeded = null;
      peer.connection.close();
    }
    this.#peers.clear();
    this.#events.onPeersChanged?.([]);

    this.#stopLevelMeter();
    this.#localStream?.getTracks().forEach((track) => track.stop());
    this.#localStream = null;
    this.#events.onLocalStream?.(null);
    this.#stopScreen();
    if (channelId) this.#gateway.leaveVoice(channelId);
    if (this.#isSpeaking) {
      this.#isSpeaking = false;
      this.#events.onSpeaking?.(false);
    }
  }

  /* ------------------------------- controls ------------------------------- */

  setMuted(muted: boolean): void {
    this.#muted = muted;
    for (const track of this.#localStream?.getAudioTracks() ?? []) track.enabled = !muted;
    if (this.#channelId) {
      this.#gateway.updateVoiceState({ channelId: this.#channelId, selfMute: muted });
    }
  }

  setDeafened(deafened: boolean): void {
    this.#deafened = deafened;
    for (const peer of this.#peers.values()) {
      for (const track of peer.stream?.getAudioTracks() ?? []) track.enabled = !deafened;
    }
    if (deafened) this.setMuted(true);
    if (this.#channelId) {
      this.#gateway.updateVoiceState({ channelId: this.#channelId, selfDeaf: deafened, selfMute: deafened ? true : undefined });
    }
  }

  async enableVideo(enabled: boolean): Promise<void> {
    if (!this.#channelId) return;
    if (enabled && !this.#videoEnabled) {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      });
      const track = stream.getVideoTracks()[0];
      this.#videoEnabled = true;
      this.#addTrackToPeers(track, 'video');
      // Keep the local preview in the same stream as the microphone.
      if (this.#localStream) this.#localStream.addTrack(track);
      else {
        this.#localStream = stream;
        this.#events.onLocalStream?.(this.#localStream);
      }
      track.onended = () => void this.enableVideo(false);
    } else if (!enabled && this.#videoEnabled) {
      this.#videoEnabled = false;
      for (const track of [...(this.#localStream?.getVideoTracks() ?? [])]) {
        this.#removeTrackFromPeers(track);
        track.stop();
        this.#localStream?.removeTrack(track);
      }
      this.#events.onLocalStream?.(this.#localStream);
    }
    this.#gateway.updateVoiceState({ channelId: this.#channelId, selfVideo: this.#videoEnabled });
    this.#broadcastStreamState();
  }

  async enableScreen(enabled: boolean): Promise<void> {
    if (!this.#channelId) return;
    if (enabled && !this.#screenEnabled) {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30 } },
        audio: false,
      });
      this.#screenEnabled = true;
      this.#screenStream = stream;
      const track = stream.getVideoTracks()[0];
      this.#addTrackToPeers(track, 'video', true);
      track.onended = () => void this.enableScreen(false);
      this.#events.onScreenStream?.(stream);
    } else if (!enabled && this.#screenEnabled) {
      this.#screenEnabled = false;
      this.#stopScreen();
    }
    this.#gateway.updateVoiceState({ channelId: this.#channelId, selfStream: this.#screenEnabled });
    this.#broadcastStreamState();
  }

  #stopScreen(): void {
    for (const track of this.#screenStream?.getVideoTracks() ?? []) {
      this.#removeTrackFromPeers(track);
      track.stop();
    }
    this.#screenStream = null;
    this.#events.onScreenStream?.(null);
  }

  #broadcastStreamState(): void {
    if (!this.#channelId) return;
    this.#gateway.signal(this.#channelId, null, {
      type: 'stream-state',
      video: this.#videoEnabled,
      screen: this.#screenEnabled,
      audio: !this.#muted,
    });
  }

  /* -------------------------------- roster -------------------------------- */

  /**
   * Called whenever the server sends a VOICE_STATE_UPDATE: bring connections
   * up for new peers, tear them down for people who left.
   */
  syncRoster(states: VoiceState[]): void {
    if (!this.#channelId) return;
    const inChannel = states.filter((state) => state.channel_id === this.#channelId);
    const others = inChannel.filter((state) => state.user_id !== this.#selfId);
    const seen = new Set<string>();

    for (const state of others) {
      seen.add(state.user_id);
      let peer = this.#peers.get(state.user_id);
      if (!peer) {
        peer = this.#createPeer(state.user_id);
        this.#peers.set(state.user_id, peer);
        const initiator = this.#selfId < state.user_id;
        if (initiator) void this.#negotiate(peer);
        this.#emitPeers();
      }
      peer.audio = true;
      peer.video = state.self_video;
      peer.screen = state.self_stream;
    }

    for (const [userId, peer] of [...this.#peers]) {
      if (seen.has(userId)) continue;
      peer.connection.close();
      this.#peers.delete(userId);
      this.#emitPeers();
    }
  }

  applySpeaking(userId: string, speaking: boolean): void {
    const peer = this.#peers.get(userId);
    if (peer) {
      peer.speaking = speaking;
      this.#emitPeers();
    }
  }

  /** Handle an inbound signalling payload from another peer. */
  async handleSignal(fromUserId: string, payload: SignalPayload): Promise<void> {
    if (!this.#channelId) return;
    if (payload.type === 'bye') {
      const peer = this.#peers.get(fromUserId);
      if (peer) {
        peer.connection.close();
        this.#peers.delete(fromUserId);
        this.#emitPeers();
      }
      return;
    }
    let peer = this.#peers.get(fromUserId);
    if (!peer) {
      peer = this.#createPeer(fromUserId);
      this.#peers.set(fromUserId, peer);
      this.#emitPeers();
    }
    const connection = peer.connection;

    try {
      if (payload.type === 'candidate') {
        if (payload.candidate) await connection.addIceCandidate(payload.candidate);
        return;
      }
      if (payload.type === 'stream-state') {
        peer.video = payload.video;
        peer.screen = payload.screen;
        peer.audio = payload.audio;
        this.#emitPeers();
        return;
      }
      if (payload.type === 'renegotiate') {
        if (!peer.makingOffer) await this.#negotiate(peer);
        return;
      }
      if (payload.type === 'offer' || payload.type === 'answer') {
        const description = { type: payload.type, sdp: payload.sdp } as RTCSessionDescriptionInit;
        const offerCollision =
          payload.type === 'offer' && (peer.makingOffer || connection.signalingState !== 'stable');
        peer.ignoringOffer = !peer.polite && offerCollision;
        if (peer.ignoringOffer) return;

        if (offerCollision) {
          await connection.setLocalDescription({ type: 'rollback' } as RTCLocalSessionDescriptionInit);
        }
        await connection.setRemoteDescription(description);
        if (payload.type === 'offer') {
          const answer = await connection.createAnswer();
          await connection.setLocalDescription(answer);
          this.#gateway.signal(this.#channelId, fromUserId, { type: 'answer', sdp: answer.sdp ?? '' });
        }
      }
    } catch (error) {
      this.#events.onError?.(`Signalling error with peer: ${(error as Error).message}`);
    }
  }

  /* -------------------------------- internals ----------------------------- */

  #createPeer(userId: string): PeerState {
    const connection = new RTCPeerConnection({
      iceServers: this.#iceServers,
      iceCandidatePoolSize: 2,
    });
    const peer: PeerState = {
      userId,
      stream: new MediaStream(),
      connection,
      // Deterministic role assignment: the lexicographically larger id yields.
      polite: this.#selfId > userId,
      makingOffer: false,
      ignoringOffer: false,
      audio: false,
      video: false,
      screen: false,
      speaking: false,
    };

    for (const track of this.#localStream?.getTracks() ?? []) {
      connection.addTrack(track, this.#localStream!);
    }
    for (const track of this.#screenStream?.getVideoTracks() ?? []) {
      connection.addTrack(track, this.#screenStream!);
    }

    connection.onicecandidate = (event) => {
      if (!this.#channelId) return;
      const candidate = event.candidate;
      this.#gateway.signal(this.#channelId, userId, {
        type: 'candidate',
        candidate: candidate
          ? {
              candidate: candidate.candidate,
              sdpMid: candidate.sdpMid ?? null,
              sdpMLineIndex: candidate.sdpMLineIndex ?? null,
              usernameFragment: candidate.usernameFragment ?? null,
            }
          : null,
      });
    };

    connection.ontrack = (event) => {
      const [stream] = event.streams;
      const target = peer.stream ?? new MediaStream();
      if (stream) {
        for (const track of stream.getTracks()) {
          if (!target.getTracks().some((existing) => existing.id === track.id)) target.addTrack(track);
        }
      } else if (!target.getTracks().some((existing) => existing.id === event.track.id)) {
        target.addTrack(event.track);
      }
      peer.stream = target;
      if (this.#deafened) {
        for (const track of target.getAudioTracks()) track.enabled = false;
      }
      this.#emitPeers();
    };

    connection.onnegotiationneeded = () => {
      if (!peer.makingOffer) void this.#negotiate(peer);
    };

    connection.onconnectionstatechange = () => {
      if (connection.connectionState === 'failed') {
        try {
          connection.restartIce();
        } catch {
          /* negotiation will retry on the next change */
        }
      }
    };

    return peer;
  }

  async #negotiate(peer: PeerState): Promise<void> {
    if (!this.#channelId) return;
    try {
      peer.makingOffer = true;
      const offer = await peer.connection.createOffer();
      if (peer.connection.signalingState !== 'stable' && !peer.polite) return;
      await peer.connection.setLocalDescription(offer);
      this.#gateway.signal(this.#channelId, peer.userId, { type: 'offer', sdp: peer.connection.localDescription?.sdp ?? '' });
    } catch (error) {
      this.#events.onError?.(`Could not negotiate with peer: ${(error as Error).message}`);
    } finally {
      peer.makingOffer = false;
    }
  }

  #addTrackToPeers(track: MediaStreamTrack, kind: 'audio' | 'video', screen = false): void {
    for (const peer of this.#peers.values()) {
      try {
        peer.connection.addTrack(track, screen ? this.#screenStream ?? new MediaStream([track]) : this.#localStream ?? new MediaStream([track]));
      } catch {
        /* track may already be attached */
      }
    }
    void kind;
  }

  #removeTrackFromPeers(track: MediaStreamTrack): void {
    for (const peer of this.#peers.values()) {
      const sender = peer.connection.getSenders().find((candidate) => candidate.track === track);
      if (sender) {
        try {
          peer.connection.removeTrack(sender);
        } catch {
          /* ignore */
        }
      }
    }
  }

  #emitPeers(): void {
    this.#events.onPeersChanged?.(this.peers);
  }

  /* ------------------------- speaking detection --------------------------- */

  #attachLevelMeter(stream: MediaStream): void {
    this.#stopLevelMeter();
    try {
      const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.#audioContext = new AudioCtor();
      const source = this.#audioContext.createMediaStreamSource(stream);
      this.#analyser = this.#audioContext.createAnalyser();
      this.#analyser.fftSize = 512;
      this.#analyser.smoothingTimeConstant = 0.7;
      source.connect(this.#analyser);
    } catch {
      this.#analyser = null;
      return;
    }

    const tick = (): void => {
      if (this.#destroyed || !this.#analyser) return;
      const level = this.microphoneLevel;
      this.#events.onMicrophoneLevel?.(level);
      const speaking = level > 0.045 && !this.#muted && !!this.#channelId;
      if (speaking !== this.#isSpeaking) {
        this.#isSpeaking = speaking;
        this.#events.onSpeaking?.(speaking);
        if (this.#channelId) this.#gateway.speaking(this.#channelId, speaking);
      }
      this.#speakingLoop = requestAnimationFrame(tick);
    };
    this.#speakingLoop = requestAnimationFrame(tick);
  }

  #stopLevelMeter(): void {
    if (this.#speakingLoop !== null) cancelAnimationFrame(this.#speakingLoop);
    this.#speakingLoop = null;
    this.#analyser = null;
    void this.#audioContext?.close().catch(() => undefined);
    this.#audioContext = null;
  }

  destroy(): void {
    this.#destroyed = true;
    void this.leave();
  }
}
