const SIGNAL_PREFIX = 'NEURIO-LAN:';

export function encodeSignal(description) {
  const bytes = new TextEncoder().encode(JSON.stringify(description));
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + 0x8000, bytes.length)));
  return SIGNAL_PREFIX + btoa(binary);
}

export function decodeSignal(value) {
  const text = String(value || '').trim();
  const encoded = text.startsWith(SIGNAL_PREFIX) ? text.slice(SIGNAL_PREFIX.length) : text;
  const binary = atob(encoded.replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  const parsed = JSON.parse(new TextDecoder().decode(bytes));
  if (!parsed || !['offer', 'answer'].includes(parsed.type) || typeof parsed.sdp !== 'string' || parsed.sdp.length > 250000) throw new Error('That does not look like a valid Neurio LAN code.');
  return parsed;
}

function waitForIce(peer, timeout = 18000) {
  if (peer.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return; done = true;
      clearTimeout(timer); peer.removeEventListener('icegatheringstatechange', check); resolve();
    };
    const check = () => { if (peer.iceGatheringState === 'complete') finish(); };
    const timer = setTimeout(finish, timeout);
    peer.addEventListener('icegatheringstatechange', check);
  });
}

export class LanConnection {
  constructor({ onMessage = () => {}, onStatus = () => {}, onOpen = () => {} } = {}) {
    if (!('RTCPeerConnection' in window)) throw new Error('This browser does not support WebRTC. Try current Chrome on Android.');
    this.pc = new RTCPeerConnection({ iceServers: [] }); // host candidates only: direct, same-Wi-Fi/LAN connection; no relay server.
    this.channel = null;
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.onOpen = onOpen;
    this.role = null;
    this.parts = new Map();
    this.partBytes = 0;
    this.sequence = 0;
    this.closed = false;
    this.pc.onconnectionstatechange = () => {
      const s = this.pc.connectionState;
      if (s === 'connected') this.onStatus('connected', 'Connected directly over the local network.');
      else if (s === 'connecting') this.onStatus('connecting', 'Connecting to your friend…');
      else if (s === 'disconnected') this.onStatus('disconnected', 'Connection paused. Checking the local network…');
      else if (s === 'failed') this.onStatus('failed', 'Could not connect. Check both devices are on the same Wi-Fi and try fresh codes.');
      else if (s === 'closed') this.onStatus('closed', 'Connection closed.');
    };
    this.pc.oniceconnectionstatechange = () => {
      if (this.pc.iceConnectionState === 'failed') this.onStatus('failed', 'LAN connection failed. Both devices should be on the same Wi-Fi network.');
    };
    this.pc.ondatachannel = (event) => this._attachChannel(event.channel);
  }

  _attachChannel(channel) {
    this.channel = channel;
    channel.onopen = () => {
      this.onStatus('connected', 'Connected directly over the local network.');
      this.onOpen();
    };
    channel.onclose = () => this.onStatus('disconnected', 'LAN connection closed.');
    channel.onerror = () => this.onStatus('failed', 'The local data channel reported an error.');
    channel.onmessage = (event) => this._receive(event.data);
  }

  async createHostOffer() {
    this.role = 'host';
    this._attachChannel(this.pc.createDataChannel('neurio-world', { ordered: true }));
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.onStatus('waiting', 'Share this offer code with a player on the same Wi-Fi.');
    await waitForIce(this.pc);
    return encodeSignal(this.pc.localDescription);
  }

  async createJoinAnswer(code) {
    this.role = 'guest';
    const offer = decodeSignal(code);
    if (offer.type !== 'offer') throw new Error('Paste the host offer, not an answer code.');
    await this.pc.setRemoteDescription(offer);
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    this.onStatus('waiting', 'Send this answer code back to the host.');
    await waitForIce(this.pc);
    return encodeSignal(this.pc.localDescription);
  }

  async acceptAnswer(code) {
    const answer = decodeSignal(code);
    if (answer.type !== 'answer') throw new Error('Paste the player answer code here.');
    await this.pc.setRemoteDescription(answer);
    this.onStatus('connecting', 'Answer received. Connecting…');
  }

  _receive(raw) {
    if (typeof raw !== 'string' || raw.length > 14000) return;
    let message;
    try { message = JSON.parse(raw); } catch { return; }
    if (message?.type === 'fragment') {
      if (!Number.isInteger(message.total) || message.total < 1 || message.total > 30000 || !Number.isInteger(message.index) || message.index < 0 || message.index >= message.total || typeof message.data !== 'string') return;
      let record = this.parts.get(message.id);
      if (!record) this.parts.set(message.id, record = { total: message.total, values: new Array(message.total), count: 0, bytes: 0 });
      if (record.total !== message.total || record.values[message.index] !== undefined) return;
      record.values[message.index] = message.data; record.count++; record.bytes += message.data.length; this.partBytes += message.data.length;
      if (record.bytes > 12000000 || this.partBytes > 16000000) { this.parts.clear(); this.partBytes = 0; return; }
      if (record.count === record.total) {
        this.parts.delete(message.id); this.partBytes -= record.bytes;
        try { this.onMessage(JSON.parse(record.values.join(''))); } catch { /* malformed packet */ }
      }
      return;
    }
    this.onMessage(message);
  }

  send(message) {
    if (!this.channel || this.channel.readyState !== 'open') return false;
    const raw = JSON.stringify(message);
    if (raw.length <= 11000) { this.channel.send(raw); return true; }
    const id = `p${Date.now().toString(36)}${this.sequence++}`;
    const size = 8500, total = Math.ceil(raw.length / size);
    for (let index = 0; index < total; index++) {
      const data = raw.slice(index * size, (index + 1) * size);
      this.channel.send(JSON.stringify({ type: 'fragment', id, index, total, data }));
    }
    return true;
  }

  close() {
    this.closed = true;
    try { this.channel?.close(); } catch { /* already closed */ }
    try { this.pc?.close(); } catch { /* already closed */ }
    this.parts.clear();
    this.onStatus('closed', 'LAN session ended.');
  }
}
