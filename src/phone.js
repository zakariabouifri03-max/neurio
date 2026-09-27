// ============================================================
// phone.js — diegetic smartphone: messages with typing indicators
// and MMS photos, a notes/tasks app, flashlight toggle, battery,
// signal loss. Pressing T raises it; it lives in your left hand.
// ============================================================
import { el } from './utils.js';

export class Phone {
  constructor(G) {
    this.G = G;
    this.up = false;
    this.threads = new Map();
    this.currentThread = null;
    this.tasks = [];
    this.battery = 87;
    this.signal = true;
    this.typing = null; // {thread, msg, t}
    this.timeStr = '10:58 PM';
    this._bind();
  }

  _bind() {
    const root = el('phone');
    root.querySelectorAll('.ph-app').forEach(a => {
      a.onclick = () => this._openApp(a.dataset.app);
    });
    root.querySelectorAll('[data-back]').forEach(b => {
      b.onclick = () => this._goBack();
    });
    el('ph-home').onclick = () => this._showPage('ph-apps');
  }

  _openApp(app) {
    this.G.audio.latch('ui');
    if (app === 'messages') { this._renderThreads(); this._showPage('ph-messages'); this.page = 'messages'; }
    else if (app === 'tasks') { this._renderTasks(); this._showPage('ph-tasks'); this.page = 'tasks'; el('badge-tsk').classList.add('hidden'); }
    else if (app === 'flash') { this.G.player.toggleFlash(); }
    else if (app === 'cam') { this._showPage('ph-cam'); this.page = 'cam'; }
  }
  _goBack() {
    this.G.audio.latch('ui');
    if (this.page === 'thread') { this._renderThreads(); this._showPage('ph-messages'); this.page = 'messages'; this.currentThread = null; }
    else this._showPage('ph-apps'), this.page = 'home';
  }
  _showPage(id) {
    for (const p of ['ph-apps', 'ph-messages', 'ph-thread', 'ph-tasks', 'ph-cam']) el(p).classList.toggle('hidden', p !== id);
  }

  open() {
    if (this.up) return;
    this.up = true;
    el('phone').classList.remove('hidden', 'nightmode');
    if (this.G.story && this.G.story.flags.powerOut) el('phone').classList.add('nightmode');
    this._showPage('ph-apps'); this.page = 'home';
    this.G.audio.latch('ui');
    if (document.pointerLockElement) document.exitPointerLock();
  }
  close() {
    if (!this.up) return;
    this.up = false;
    el('phone').classList.add('hidden');
    this.G.audio.latch('ui');
  }
  toggle() { this.up ? this.close() : this.open(); }

  // ---------------- threads ----------------
  addThread(id, name, color) {
    if (!this.threads.has(id)) this.threads.set(id, { id, name, color: color || '#8a8f98', messages: [], unread: 0 });
  }
  _updateBadges() {
    let total = 0;
    for (const t of this.threads.values()) total += t.unread;
    const b = el('badge-msg');
    b.classList.toggle('hidden', total === 0);
    b.textContent = total > 9 ? '9+' : total;
  }
  _renderThreads() {
    const cont = el('ph-threads');
    cont.innerHTML = '';
    const arr = [...this.threads.values()].reverse();
    for (const t of arr) {
      if (!t.messages.length) continue;
      const d = document.createElement('div');
      d.className = 'thread';
      const last = t.messages[t.messages.length - 1];
      d.innerHTML = `<div class="thread-av" style="background:${t.color}">${t.name[0]}</div>
        <div><div class="thread-name">${t.name}</div><div class="thread-last">${(last.img ? '📷 photo' : last.text) || ''}</div></div>
        <div class="thread-time">${last.time || ''}</div>`;
      if (t.unread) d.style.background = '#1a2030';
      d.onclick = () => { this._openThread(t.id); };
      cont.appendChild(d);
    }
  }
  _openThread(id) {
    this.currentThread = id;
    const t = this.threads.get(id);
    t.unread = 0; this._updateBadges();
    el('ph-thread-name').textContent = t.name;
    this._renderBubbles();
    this._showPage('ph-thread'); this.page = 'thread';
    this.G.audio.latch('ui');
    // surface staged reply options once the player actually reads the thread
    if (this._stagedReplies && this._stagedReplies.threadId === id) {
      const r = this._stagedReplies; this._stagedReplies = null;
      this.addReplyOptions(id, r.opts);
    }
  }
  _renderBubbles() {
    const t = this.threads.get(this.currentThread);
    const cont = el('ph-bubbles');
    cont.innerHTML = '';
    for (const m of t.messages) {
      const b = document.createElement('div');
      b.className = 'bub ' + (m.out ? 'out' : 'in');
      let html = '';
      if (m.img) html += `<img src="${m.img}" alt="">`;
      if (m.text) html += m.text;
      html += `<span class="btime">${m.time || ''}</span>`;
      b.innerHTML = html;
      cont.appendChild(b);
    }
    if (this.typing) {
      const tp = document.createElement('div');
      tp.className = 'typing'; tp.innerHTML = '<i></i><i></i><i></i>';
      cont.appendChild(tp);
    }
    cont.scrollTop = cont.scrollHeight;
  }

  // story API: inbound message (with typing delay) or outbound (choice)
  inbound(threadId, { text = '', img = null, typing = 1.4, buzz = true } = {}) {
    const t = this.threads.get(threadId);
    if (!t) return;
    const m = { text, img, out: false, time: this.timeStr };
    if (buzz) { this.G.audio.phoneBuzz(); this.G.audio.msgDing(); this.G.ui.notify(t.name, img ? '📷 received a photo' : text); }
    const doAdd = () => {
      t.messages.push(m);
      if (this.currentThread === threadId && this.up) this._renderBubbles();
      else { t.unread++; }
      this._updateBadges();
      if (this.G.story) this.G.story.hook('msgRead', threadId, m); // passive tick
    };
    if (typing && typing > 0) {
      this.typing = { threadId };
      if (this.currentThread === threadId && this.up) this._renderBubbles();
      setTimeout(() => {
        this.typing = null;
        if (this.currentThread === threadId && this.up) this._renderBubbles();
        // message actually lands with second buzz
        this.G.audio.phoneBuzz();
        doAdd();
        // if there were reply options staged, show them now
        if (this._stagedReplies && this._stagedReplies.threadId === threadId) {
          const r = this._stagedReplies; this._stagedReplies = null;
          this.addReplyOptions(threadId, r.opts);
        }
      }, typing * 1000);
    } else doAdd();
  }

  outbound(threadId, text) {
    const t = this.threads.get(threadId);
    if (!t) return;
    t.messages.push({ text, out: true, time: this.timeStr });
    if (this.currentThread === threadId && this.up) this._renderBubbles();
  }

  // present 2 reply buttons in the open thread (or stage them app-wide)
  addReplyOptions(threadId, opts) { // [{text, send, then}]
    if (!this.up || this.currentThread !== threadId) { this._stagedReplies = { threadId, opts }; }
    const cont = el('ph-replies');
    cont.innerHTML = '';
    cont.classList.remove('hidden');
    for (const o of opts) {
      const b = document.createElement('button');
      b.className = 'reply-btn';
      b.textContent = o.text;
      b.onclick = () => {
        cont.classList.add('hidden'); cont.innerHTML = '';
        this.outbound(threadId, o.send || o.text);
        this.G.audio.latch('ui');
        o.then && o.then();
      };
      cont.appendChild(b);
    }
  }

  // ---------------- notes/tasks ----------------
  setTasks(list) { this.tasks = list; this._renderTasks(); }
  addTask(id, text, silent = false) {
    if (this.tasks.some(t => t.id === id)) return;
    this.tasks.push({ id, text, done: false, fresh: true });
    this._renderTasks();
    if (!silent) { el('badge-tsk').classList.remove('hidden'); this.G.audio.latch('ui'); }
  }
  completeTask(id) {
    const t = this.tasks.find(t => t.id === id);
    if (t && !t.done) { t.done = true; this._renderTasks(); this.G.ui.objectiveDone(t.text); return true; }
    return false;
  }
  hasPending(ids) { return this.tasks.some(t => ids.includes(t.id) && !t.done); }
  _renderTasks() {
    const cont = el('ph-tasklist');
    if (!cont) return;
    cont.innerHTML = '';
    for (const t of this.tasks) {
      const d = document.createElement('div');
      d.className = 'task' + (t.done ? ' done' : '') + (t.fresh ? ' new' : '');
      d.innerHTML = `<div class="box"></div><div>${t.text}</div>`;
      cont.appendChild(d);
      t.fresh = false;
    }
  }

  // full reset between runs/checkpoints
  resetState() {
    this.threads.clear();
    this.currentThread = null;
    this.tasks = [];
    this.battery = 87;
    this.typing = null;
    this._stagedReplies = null;
    this.close();
    this.setSignal(true);
    this.setFlashIcon(false);
    this._renderTasks();
    this._updateBadges();
    el('ph-threads').innerHTML = '';
    el('ph-bubbles').innerHTML = '';
    el('ph-replies').innerHTML = ''; el('ph-replies').classList.add('hidden');
  }

  // ---------------- status ----------------
  setClock(str) { this.timeStr = str; el('ph-time').textContent = str; }
  setSignal(on) {
    this.signal = on;
    el('ph-carrier').textContent = on ? 'NORTHSTAR' : 'NO SERVICE';
    el('ph-carrier').style.color = on ? '' : '#e05555';
  }
  setFlashIcon(on) { el('flash-ico').classList.toggle('on', on); }
  update(dt) {
    // slow battery drain across the night
    this.battery = Math.max(4, this.battery - dt * (this.G.player && this.G.player.flashOn ? 0.011 : 0.004));
    const n = Math.ceil(this.battery / 25);
    el('ph-batt').textContent = '▮'.repeat(n) + '▯'.repeat(4 - n);
  }
}
