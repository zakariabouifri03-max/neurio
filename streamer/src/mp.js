// ── 2-player co-op over WebRTC (LAN + online). Manual code exchange ─────────
import { b64enc, b64dec } from './util.js';

const RTC_CFG = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] };

export class MP {
  constructor() {
    this.pc = null; this.dc = null;
    this.role = null;
    this.partner = null;          // {name, seed, x, z, yaw, act, t}
    this.connected = false;
    this.onChat = null; this.onEvent = null; this.onConnect = null; this.onClose = null;
    this._sendAcc = 0;
  }

  _newPC() {
    this.pc = new RTCPeerConnection(RTC_CFG);
    this.pc.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(this.pc.connectionState)) {
        this.connected = false;
        if (this.onClose) this.onClose();
      }
    };
  }
  _wireDC(dc) {
    this.dc = dc;
    dc.onopen = () => { this.connected = true; if (this.onConnect) this.onConnect(); };
    dc.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch (err) { return; }
      if (m.t === 'hello') {
        this.partner = Object.assign(this.partner || {}, { name: m.name, seed: m.seed });
        if (this.onEvent) this.onEvent({ t: 'hello', name: m.name });
      } else if (m.t === 'pos') {
        this.partner = Object.assign(this.partner || {}, m);
        this.partner.t = performance.now();
      } else if (m.t === 'chat') { if (this.onChat) this.onChat(m.msg); }
      else if (this.onEvent) this.onEvent(m);
    };
    dc.onclose = () => { this.connected = false; if (this.onClose) this.onClose(); };
  }

  async _gather() {
    // wait for ICE gathering so the code contains candidates
    if (this.pc.iceGatheringState === 'complete') return;
    await new Promise((res) => {
      const to = setTimeout(res, 2500);
      this.pc.onicegatheringstatechange = () => {
        if (this.pc.iceGatheringState === 'complete') { clearTimeout(to); res(); }
      };
    });
  }

  // HOST
  async host() {
    this.role = 'host';
    this._newPC();
    this._wireDC(this.pc.createDataChannel('sl2', { ordered: true }));
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await this._gather();
    return b64enc(JSON.stringify(this.pc.localDescription));
  }
  async hostAccept(answerCode) {
    const desc = JSON.parse(b64dec(answerCode.trim()));
    await this.pc.setRemoteDescription(desc);
  }

  // GUEST
  async join(inviteCode) {
    this.role = 'guest';
    this._newPC();
    this.pc.ondatachannel = (e) => this._wireDC(e.channel);
    const desc = JSON.parse(b64dec(inviteCode.trim()));
    await this.pc.setRemoteDescription(desc);
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await this._gather();
    return b64enc(JSON.stringify(this.pc.localDescription));
  }

  hello(name, seed) { this.send({ t: 'hello', name, seed }); }

  sendPos(x, z, yaw, act) {
    this._sendAcc++;
    if (this._sendAcc % 3) return; // ~10Hz at 30fps calls
    this.send({ t: 'pos', x, z, yaw, act });
  }

  send(obj) {
    if (this.dc && this.dc.readyState === 'open') {
      try { this.dc.send(JSON.stringify(obj)); } catch (e) {}
    }
  }
  sendChat(msg) { this.send({ t: 'chat', msg }); }
  sendEvent(ev) { this.send(ev); }

  partnerNear(px, pz, dist) {
    if (!this.partner || !this.connected) return 0;
    if (this.partner.x === undefined) return 0;
    if (performance.now() - (this.partner.t || 0) > 4000) return 0;
    return Math.hypot(this.partner.x - px, this.partner.z - pz) < dist ? 1 : 0;
  }

  close() {
    try { this.dc?.close(); this.pc?.close(); } catch (e) {}
    this.connected = false; this.partner = null;
  }
}
