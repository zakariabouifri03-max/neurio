/* Neurio Voice — owner dashboard */
(function () {
  'use strict';

  let business = null;
  const DAYS = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];

  const $ = (id) => document.getElementById(id);

  function toast(msg, kind) {
    $('save-msg').innerHTML = `<div class="notice ${kind || 'ok'}">${msg}</div>`;
    setTimeout(() => { $('save-msg').innerHTML = ''; }, 3500);
  }
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // ---------- tabs ----------
  document.querySelectorAll('.side button').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.side button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      document.querySelectorAll('.tab').forEach((t) => (t.style.display = 'none'));
      $('tab-' + b.dataset.tab).style.display = 'block';
      if (b.dataset.tab === 'calls') loadCalls();
      if (b.dataset.tab === 'appointments') loadAppointments();
      if (b.dataset.tab === 'overview') loadOverview();
    });
  });

  // ---------- load/save business ----------
  const toMin = (s) => {
    const m = String(s || '').trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  };
  const toHM = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

  function renderHours() {
    $('b-hours').innerHTML = DAYS.map(([k, label]) => {
      const h = business.hours[k];
      return `<div class="day"><b>${label}</b><input data-day="${k}" data-p="0" placeholder="open" value="${h ? toHM(h[0]) : ''}"><input data-day="${k}" data-p="1" placeholder="close" value="${h ? toHM(h[1]) : ''}"></div>`;
    }).join('');
  }
  function readHours() {
    const hours = {};
    for (const [k] of DAYS) {
      const o = document.querySelector(`input[data-day="${k}"][data-p="0"]`).value;
      const c = document.querySelector(`input[data-day="${k}"][data-p="1"]`).value;
      const om = toMin(o), cm = toMin(c);
      hours[k] = om != null && cm != null && cm > om ? [om, cm] : null;
    }
    return hours;
  }

  async function loadBusiness() {
    business = await (await fetch('/api/business')).json();
    $('b-name').value = business.name || '';
    $('b-phone').value = business.phone || '';
    $('b-address').value = business.address || '';
    $('b-tz').value = business.timezone || 'America/Chicago';
    $('b-booking').value = business.bookingEnabled ? '1' : '0';
    renderHours();
    $('a-name').value = business.agent.name || '';
    $('a-greeting').value = business.agent.greeting || '';
    $('a-handoff').value = business.agent.handoff || '';
    $('s-services').value = (business.services || []).map((s) => `${s.name} | ${s.price} | ${s.duration || ''} | ${(s.keywords || []).join(', ')}`).join('\n');
    $('s-faqs').value = (business.faqs || []).map((f) => `${f.q} | ${f.a}`).join('\n');
  }

  async function saveBusiness(patch, msg) {
    business = { ...business, ...patch };
    const r = await fetch('/api/business', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(business) });
    if (r.ok) { business = await r.json(); toast(msg || 'Saved ✓'); }
    else toast('Save failed: ' + (await r.json()).error, 'warn');
  }

  $('b-save').addEventListener('click', () => saveBusiness({
    name: $('b-name').value.trim(), phone: $('b-phone').value.trim(), address: $('b-address').value.trim(),
    timezone: $('b-tz').value, bookingEnabled: $('b-booking').value === '1', hours: readHours(),
  }, 'Business profile saved ✓ — the demo & phone AI use it immediately.'));

  $('a-save').addEventListener('click', () => saveBusiness({
    agent: { name: $('a-name').value.trim(), greeting: $('a-greeting').value.trim(), handoff: $('a-handoff').value.trim() },
  }, 'Agent saved ✓'));

  $('s-save').addEventListener('click', () => {
    const services = $('s-services').value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const [name, price, duration, kw] = l.split('|').map((x) => (x || '').trim());
      return { name, price: price || '', duration: duration || '', keywords: kw ? kw.split(',').map((x) => x.trim()).filter(Boolean) : [] };
    }).filter((s) => s.name);
    const faqs = $('s-faqs').value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const i = l.indexOf('|');
      return i > 0 ? { q: l.slice(0, i).trim(), a: l.slice(i + 1).trim() } : null;
    }).filter(Boolean);
    saveBusiness({ services, faqs }, `Saved ✓ (${services.length} services, ${faqs.length} FAQs)`);
  });

  // ---------- overview ----------
  async function loadOverview() {
    const [calls, appts, status] = await Promise.all([
      fetch('/api/calls').then((r) => r.json()),
      fetch('/api/appointments').then((r) => r.json()),
      fetch('/api/status').then((r) => r.json()),
    ]);
    const booked = calls.filter((c) => c.appointmentId).length;
    $('st-calls').textContent = calls.length;
    $('st-booked').textContent = booked;
    $('st-rate').textContent = calls.length ? Math.round((booked / calls.length) * 100) + '%' : '–';
    $('st-upcoming').textContent = appts.length;
    $('ov-sub').textContent = `${status.businessName} · answered by ${status.agentName} (${status.brain === 'built-in' ? 'built-in AI' : status.brain})`;
    $('nav-brain').textContent = '🧠 ' + status.brain;
    $('go-brain').textContent = status.brain === 'built-in' ? 'running on the built-in offline brain' : 'running on ' + status.brain;
    $('ov-recent').innerHTML = calls.length ? `<table class="tbl"><tr><th>When</th><th>Channel</th><th>First message</th><th></th></tr>` +
      calls.slice(0, 5).map((c) => {
        const first = (c.transcript.find((t) => t.role === 'user') || {}).text || '—';
        return `<tr><td>${new Date(c.updatedAt).toLocaleString()}</td><td><span class="pill ${c.channel}">${c.channel}</span></td><td>${esc(first.slice(0, 80))}</td><td>${c.appointmentId ? '<span class="pill booked">📅 booked</span>' : ''}</td></tr>`;
      }).join('') + `</table>` : '<p class="muted">No calls yet — try the <a href="/demo">live demo</a>!</p>';
  }

  // ---------- calls ----------
  async function loadCalls() {
    const calls = await (await fetch('/api/calls')).json();
    if (!calls.length) { $('calls-list').innerHTML = '<p class="muted">No calls yet.</p>'; return; }
    $('calls-list').innerHTML = `<table class="tbl"><tr><th>When</th><th>Channel</th><th>Summary</th><th></th></tr>` +
      calls.map((c, i) => {
        const first = (c.transcript.find((t) => t.role === 'user') || {}).text || '(greeting only)';
        const thread = c.transcript.map((t) => `<p><b class="${t.role === 'user' ? 'u' : 'a'}">${t.role === 'user' ? '📞 Caller' : '🤖 AI'}:</b> ${esc(t.text)}</p>`).join('');
        return `<tr><td style="white-space:nowrap">${new Date(c.updatedAt).toLocaleString()}${c.from ? `<br><span class="muted">${esc(c.from)}</span>` : ''}</td>` +
          `<td><span class="pill ${c.channel}">${c.channel}</span>${c.appointmentId ? '<br><span class="pill booked">📅 booked</span>' : ''}</td>` +
          `<td>${esc(first.slice(0, 120))}<div class="thread" id="th-${i}">${thread}</div></td>` +
          `<td><button class="linklike" data-th="th-${i}">View</button></td></tr>`;
      }).join('') + `</table>`;
    document.querySelectorAll('[data-th]').forEach((b) =>
      b.addEventListener('click', () => $(b.dataset.th).classList.toggle('open')));
  }

  // ---------- appointments ----------
  const fmtDate = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  async function loadAppointments() {
    const appts = await (await fetch('/api/appointments')).json();
    if (!appts.length) { $('appt-list').innerHTML = '<p class="muted">No upcoming appointments.</p>'; return; }
    $('appt-list').innerHTML = `<table class="tbl"><tr><th>Date</th><th>Time</th><th>Service</th><th>Name</th><th>Phone</th><th>Source</th><th></th></tr>` +
      appts.map((a) => `<tr><td><b>${fmtDate(a.date)}</b></td><td>${esc(a.time)}</td><td>${esc(a.service)}</td><td>${esc(a.name)}</td><td>${esc(a.phone)}</td><td><span class="pill ${a.source === 'phone' ? 'phone' : 'web'}">${esc(a.source || 'web')}</span></td><td><button class="danger-link" data-cancel="${a.id}">Cancel</button></td></tr>`).join('') + `</table>`;
    document.querySelectorAll('[data-cancel]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!confirm('Cancel this appointment?')) return;
        await fetch('/api/appointments/' + b.dataset.cancel, { method: 'DELETE' });
        loadAppointments();
        toast('Appointment cancelled.');
      }));
  }

  // ---------- misc ----------
  $('demo-reset').addEventListener('click', async () => {
    if (!confirm('Reset calls & appointments to demo samples?')) return;
    await fetch('/api/demo/reset', { method: 'POST' });
    loadOverview();
    toast('Demo data reset ✓');
  });
  $('go-webhook').textContent = 'POST ' + location.origin + '/voice/incoming';

  loadBusiness().then(loadOverview);
})();
