// ── Menus, HUD, shops, dialogs, touch controls ──────────────────────────────
import { FOOD, PART_CATS, PARTS, FURNITURE, HOUSES, CARS, QUESTS } from './data.js';
import { fmt, fmtMoney, isTouch, hourStr } from './util.js';
import { audio } from './audio.js';

const $ = (id) => document.getElementById(id);

export function ui(game) {
  const G = game;

  // ── main menu ──
  $('btnPlay').onclick = () => {
    audio.unlock(); audio.click();
    if (G.hasSave()) G.continueGame();
    else G.newGame();
  };
  $('btnNew').onclick = () => { audio.unlock(); audio.click(); G.newGame(); };
  $('btnMP').onclick = () => { audio.unlock(); audio.click(); $('mainMenu').classList.remove('on'); $('mpMenu').classList.add('on'); };
  $('btnSettings').onclick = () => { audio.unlock(); audio.click(); openSettings(false); };
  $('btnQuit').onclick = () => { audio.click(); try { window.close(); } catch (e) {} $('quitNote').classList.add('on'); };

  // ── MP menu ──
  $('mpBack').onclick = () => { audio.back(); $('mpMenu').classList.remove('on'); $('mainMenu').classList.add('on'); };
  $('mpHost').onclick = async () => {
    audio.unlock(); audio.click();
    $('mpStatus').textContent = '⏳ creating session…';
    $('mpHostPanel').classList.add('on'); $('mpJoinPanel').classList.remove('on');
    try {
      const code = await G.mpHost();
      $('mpInvite').value = code;
      $('mpStatus').textContent = '1️⃣ send your friend the invite code · 2️⃣ paste their answer code below';
    } catch (e) { $('mpStatus').textContent = '⚠️ ' + e.message; }
  };
  $('mpCopy').onclick = () => { navigator.clipboard?.writeText($('mpInvite').value); $('mpCopy').textContent = '✓ copied!'; setTimeout(() => ($('mpCopy').textContent = '📋 copy'), 1200); audio.click(); };
  $('mpAccept').onclick = async () => {
    $('mpStatus').textContent = '⏳ connecting…';
    try {
      await G.mpAccept($('mpAnswer').value);
      $('mpStatus').textContent = '✅ linked! starting co-op world…';
      setTimeout(() => G.startMP(), 700);
    } catch (e) { $('mpStatus').textContent = '⚠️ bad answer code'; audio.err(); }
  };
  $('mpJoin').onclick = () => { audio.click(); $('mpJoinPanel').classList.add('on'); $('mpHostPanel').classList.remove('on'); $('mpStatus').textContent = 'paste the invite code from your friend'; };
  $('mpMakeAnswer').onclick = async () => {
    $('mpStatus').textContent = '⏳ generating answer code…';
    try {
      const ans = await G.mpJoin($('mpInviteIn').value);
      $('mpAnswerOut').value = ans;
      $('mpStatus').textContent = 'send this answer code back to the host — starting…';
      setTimeout(() => G.startMP(), 1200);
    } catch (e) { $('mpStatus').textContent = '⚠️ bad invite code'; audio.err(); }
  };
  $('mpCopyAns').onclick = () => { navigator.clipboard?.writeText($('mpAnswerOut').value); audio.click(); };

  // ── settings ──
  let settingsInGame = false;
  function openSettings(inGame) {
    settingsInGame = inGame;
    $('settingsMenu').classList.add('on');
    if (inGame) $('pauseMenu').classList.remove('on');
    const s = G.settings;
    $('setMaster').value = s.master; $('setMusic').value = s.music; $('setSfx').value = s.sfx;
    $('setSens').value = s.sens; $('setFov').value = s.fov; $('setQuality').value = s.quality;
  }
  G._openSettings = openSettings;
  const saveSettings = () => {
    const s = G.settings;
    s.master = +$('setMaster').value; s.music = +$('setMusic').value; s.sfx = +$('setSfx').value;
    s.sens = +$('setSens').value; s.fov = +$('setFov').value; s.quality = $('setQuality').value;
    G.applySettings();
  };
  ['setMaster', 'setMusic', 'setSfx', 'setSens', 'setFov'].forEach((id) => ($(id).oninput = saveSettings));
  $('setQuality').onchange = saveSettings;
  $('setBack').onclick = () => {
    audio.back(); saveSettings();
    $('settingsMenu').classList.remove('on');
    if (settingsInGame) $('pauseMenu').classList.add('on');
    else $('mainMenu').classList.add('on');
  };

  // ── pause ──
  $('btnResume').onclick = () => { audio.click(); G.togglePause(false); };
  $('btnPSettings').onclick = () => { audio.click(); openSettings(true); };
  $('btnSaveQuit').onclick = () => { audio.click(); G.persist(); G.quitToMenu(); };

  // ── touch ──
  if (isTouch()) {
    $('touch').classList.add('on');
    const base = $('joyBase'), knob = $('joyKnob');
    let joyId = null;
    const joyMove = (e) => {
      const r = base.getBoundingClientRect();
      let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy), max = r.width / 2;
      if (d > max) { dx = dx / d * max; dy = dy / d * max; }
      knob.style.transform = `translate(${dx}px,${dy}px)`;
      G.touchMove(-dx / max, -dy / max); // x=strafe(right+), y=forward(up+)
    };
    base.addEventListener('touchstart', (e) => { joyId = e.changedTouches[0].identifier; joyMove(e.changedTouches[0]); e.preventDefault(); }, { passive: false });
    base.addEventListener('touchmove', (e) => { for (const t of e.changedTouches) if (t.identifier === joyId) joyMove(t); e.preventDefault(); }, { passive: false });
    const joyEnd = (e) => { for (const t of e.changedTouches) if (t.identifier === joyId) { joyId = null; knob.style.transform = ''; G.touchMove(0, 0); } };
    base.addEventListener('touchend', joyEnd); base.addEventListener('touchcancel', joyEnd);
    $('btnRun').onpointerdown = () => G.setKey('run', true);
    $('btnRun').onpointerup = () => G.setKey('run', false);
    $('btnRun').onpointerleave = () => G.setKey('run', false);
    $('btnPause').onclick = () => G.togglePause(true);
  }

  // ── chat (MP) ──
  $('chatToggle').onclick = () => { $('chatInput').focus(); $('chatRow').classList.add('on'); };
  const sendChat = () => {
    const v = $('chatInput').value.trim();
    if (v) { G.mpSendChat(v); $('chatLog').innerHTML += `<div class="chatLine"><span class="chatName you">you</span> ${v}</div>`; $('chatLog').scrollTop = 99999; }
    $('chatInput').value = '';
    $('chatRow').classList.remove('on');
  };
  $('chatSend').onclick = sendChat;
  $('chatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); e.stopPropagation(); });
  G._chatLog = (name, msg) => {
    $('chatLog').innerHTML += `<div class="chatLine"><span class="chatName">${name}</span> ${msg}</div>`;
    $('chatLog').scrollTop = 99999;
    G.toast(`💬 <b>${name}</b>: ${msg}`);
  };

  // ── HUD ──
  G._updateHUD = () => {
    const s = G.save;
    $('hudMoney').textContent = fmtMoney(s.money);
    $('hudFol').textContent = '👥 ' + fmt(s.followers);
    $('hudDay').textContent = `Day ${s.day} · ${hourStr(s.hour)}`;
    $('hudEnergy').style.width = s.energy + '%';
    $('hudHunger').style.width = s.hunger + '%';
    $('hudLvl').textContent = '⭐ Lv ' + G.level();
    const q = QUESTS.find((qq) => !s.questsDone.includes(qq.id));
    $('hudQuest').innerHTML = q ? `📌 <b>${q.title}</b><br><span>${q.goal}</span>` : '🏆 All done!';
  };

  // ── prompt ──
  G._setPrompt = (txt) => {
    const el = $('prompt');
    if (txt) { el.innerHTML = txt; el.classList.add('on'); }
    else el.classList.remove('on');
  };

  // ── toast ─
  let toastT = null;
  G._toast = (html, warn = false) => {
    const t = $('toast');
    t.innerHTML = html;
    t.classList.toggle('warn', warn);
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show'), 3000);
  };

  // ── generic modal ──
  G._modal = (title, bodyHTML, buttons) => {
    $('modalTitle').innerHTML = title;
    $('modalBody').innerHTML = bodyHTML;
    const row = $('modalBtns');
    row.innerHTML = '';
    buttons.forEach(([label, fn, cls]) => {
      const b = document.createElement('button');
      b.className = 'mBtn ' + (cls || '');
      b.innerHTML = label;
      b.onclick = () => { audio.click(); fn && fn(); };
      row.appendChild(b);
    });
    $('modal').classList.add('on');
  };
  G._closeModal = () => $('modal').classList.remove('on');

  // ── shops ──
  G._openShop = (kind) => {
    audio.click();
    if (kind === 'supermarket') {
      G._modal('🛒 Homestead Foods', `
        <div class="shopGrid">${FOOD.map((f) => `<div class="shopItem"><span class="si">${f.emoji}</span><b>${f.name}</b><i>${f.hunger ? '+' + f.hunger + '🍔' : ''}${f.energy ? ' +' + f.energy + '⚡' : ''}</i><em>${fmtMoney(f.price)}</em><button data-buyfood="${f.id}">buy</button></div>`).join('')}</div>
        <div class="shopNote">🧊 goes into your fridge · eat at home</div>`, [
        ['💼 Work shift +$60', () => G.workShift(), 'gold'],
        ['close', () => G._closeModal(), 'dim'],
      ]);
      document.querySelectorAll('[data-buyfood]').forEach((b) => (b.onclick = () => { G.buyFood(b.dataset.buyfood); G._closeModal(); G._openShop('supermarket'); }));
    } else if (kind === 'tech') {
      G._modal('🖥️ Tech Shack <span class="dim small">(instant, +8%)</span>', `
        <div class="shopGrid">${PART_CATS.map((c) => {
          const next = (PARTS[c.id] || []).find((p) => p.t > G.save.parts[c.id]);
          return `<div class="shopItem"><span class="si">${c.emoji}</span><b>${c.name}</b><i>${next ? 'next: ' + next.name : 'MAX tier'}</i><em>${next ? fmtMoney(Math.ceil(next.price * 1.08)) : ''}</em>${next ? `<button data-buypart="${c.id}:${next.t}">buy</button>` : ''}</div>`;
        }).join('')}</div>`, [['close', () => G._closeModal(), 'dim']]);
      document.querySelectorAll('[data-buypart]').forEach((b) => (b.onclick = () => { const [cat, t] = b.dataset.buypart.split(':'); G.buyPartInstant(cat, +t); G._closeModal(); G._openShop('tech'); }));
    } else if (kind === 'furniture') {
      G._modal('🛋️ Cozy Timber Furniture', `
        <div class="shopGrid">${FURNITURE.map((f) => `<div class="shopItem"><span class="si">${f.emoji}</span><b>${f.name}</b><i>${f.desc}</i><em>${fmtMoney(f.price)}</em><button data-buyfurn="${f.id}">buy</button></div>`).join('')}</div>
        <div class="shopNote">decorate your home with <b>B</b> (or 🎨 button)</div>`, [['close', () => G._closeModal(), 'dim']]);
      document.querySelectorAll('[data-buyfurn]').forEach((b) => (b.onclick = () => { G.buyFurniture(b.dataset.buyfurn); G._closeModal(); G._openShop('furniture'); }));
    } else if (kind === 'realty') {
      G._modal('🏠 Cedar Realty — houses for sale', `
        <div class="shopGrid">${HOUSES.map((h) => {
          const owned = G.save.ownedHouses.includes(h.id);
          return `<div class="shopItem"><span class="si">${h.emoji}</span><b>${h.name}</b><i>${h.desc} · ${h.slots} decor slots${h.rent ? ' · rent $' + h.rent + '/day' : ''}</i><em>${h.price ? fmtMoney(h.price) : 'starter'}</em>${owned ? (G.save.home === h.id ? '<button disabled>home ✔</button>' : `<button data-move="${h.id}">move in</button>`) : `<button data-buyhouse="${h.id}">buy</button>`}</div>`;
        }).join('')}</div>`, [['close', () => G._closeModal(), 'dim']]);
      document.querySelectorAll('[data-buyhouse]').forEach((b) => (b.onclick = () => { G.buyHouse(b.dataset.buyhouse); G._closeModal(); G._openShop('realty'); }));
      document.querySelectorAll('[data-move]').forEach((b) => (b.onclick = () => { G.moveHouse(b.dataset.move); }));
    } else if (kind === 'dealer') {
      G._modal('🚗 Cedar Motors', `
        <div class="shopGrid">${CARS.map((c) => `<div class="shopItem"><span class="si">${c.emoji}</span><b>${c.name}</b><i>${c.desc} · top ${c.speed} m/s</i><em>${fmtMoney(c.price)}</em>${G.save.cars.includes(c.id) ? '<button disabled>owned ✔</button>' : `<button data-buycar="${c.id}">buy</button>`}</div>`).join('')}</div>
        <div class="shopNote">your cars park outside your home</div>`, [['close', () => G._closeModal(), 'dim']]);
      document.querySelectorAll('[data-buycar]').forEach((b) => (b.onclick = () => { G.buyCar(b.dataset.buycar); G._closeModal(); G._openShop('dealer'); }));
    }
  };

  // ── decorate ─
  G._openDecorate = () => {
    const placed = G.save.placed[G.save.home] || {};
    const slots = G.currentSlots();
    const ownedUnplaced = G.save.furniture;
    G._modal('🎨 Decorate — ' + HOUSES.find((h) => h.id === G.save.home).name, `
      <div class="decWrap">${slots.map((s, i) => {
        const cur = placed[i];
        return `<div class="decRow">slot ${i + 1} (${s.kind}) — ${cur ? FURNITURE.find((f) => f.id === cur)?.emoji + ' ' + FURNITURE.find((f) => f.id === cur)?.name : '<i>empty</i>'}
          ${cur ? `<button data-unplace="${i}">remove</button>` : ownedUnplaced.length ? `<select data-slot="${i}"><option value="">place…</option>${ownedUnplaced.map((id) => `<option value="${id}">${FURNITURE.find((f) => f.id === id)?.emoji} ${FURNITURE.find((f) => f.id === id)?.name}</option>`).join('')}</select>` : ''}
        </div>`;
      }).join('')}${ownedUnplaced.length ? `<div class="shopNote">unplaced: ${ownedUnplaced.map((id) => FURNITURE.find((f) => f.id === id)?.emoji).join(' ')}</div>` : '<div class="shopNote">buy furniture at Cozy Timber or Zamazor</div>'}</div>`,
      [['close', () => G._closeModal(), 'dim']]);
    document.querySelectorAll('[data-unplace]').forEach((b) => (b.onclick = () => { G.unplace(+b.dataset.unplace); G._closeModal(); G._openDecorate(); }));
    document.querySelectorAll('select[data-slot]').forEach((sel) => (sel.onchange = () => { if (sel.value) { G.place(+sel.dataset.slot, sel.value); G._closeModal(); G._openDecorate(); } }));
  };

  // ── win ──
  G._showWin = () => {
    G._modal('👑 YOU MADE IT!', `
      <div class="winBody">1,000,000 followers. The Neon Mansion. From a rented room above a noodle shop to the biggest streamer in the world.<br><br>Cedar Creek will never be the same. 🌲<br><br><b>Thanks for playing STREAMER LIFE 2!</b></div>`,
      [['keep playing', () => G._closeModal(), 'gold']]);
  };

  return { openSettings };
}
