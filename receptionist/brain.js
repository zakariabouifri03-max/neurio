'use strict';
/**
 * Neurio Voice — rule-based receptionist brain.
 * Deterministic, works offline, zero API keys needed.
 * Handles: greetings, hours, directions, services & pricing,
 * multi-turn appointment booking, cancellations, human handoff.
 */

// ---------------------------------------------------------------- helpers

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_ALIASES = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6
};
const STOPWORDS = new Set(('a,an,the,and,or,but,is,are,was,were,be,been,do,did,does,have,has,had,you,your,youre,i,me,my,we,our,it,its,this,that,what,when,where,which,who,whom,how,can,could,would,should,will,shall,may,there,their,with,for,from,about,into,over,after,before,on,at,to,of,in,by,any,all,very,just,so,too,also,if,then,than,like,as,up,out,off,hey,hi,hello,please,tell,know,want,need,get,got,give'.split(',')));

const pad2 = (n) => String(n).padStart(2, '0');
const norm = (s) => (s || '').toLowerCase().trim();

function isoDay(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function parseISODate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function fmtTime(mins) {
  let h = Math.floor(mins / 60);
  const m = mins % 60;
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${pad2(m)} ${ap}`;
}
function parseTimeToMin(str) {
  const m = String(str || '').match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i);
  if (!m) return null;
  let h = parseInt(m[1], 10) % 12;
  if (/pm/i.test(m[3])) h += 12;
  return h * 60 + (m[2] ? parseInt(m[2], 10) : 0);
}
function fmtDateLong(iso) {
  return parseISODate(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}
function weekdayKey(iso) {
  return DAY_KEYS[parseISODate(iso).getDay()];
}
function fill(template, business) {
  return String(template || '')
    .replace('{business}', business.name)
    .replace('{agent}', business.agent.name);
}
function formatPhone(digits) {
  const d = String(digits || '').replace(/\D/g, '');
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return digits;
}
function joinList(items) {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} or ${items[1]}`;
  return items.slice(0, -1).join(', ') + ', or ' + items[items.length - 1];
}

// ---------------------------------------------------------------- intent detection

function detectIntent(text) {
  const t = norm(text);
  if (/^(hi|hey|hello|good morning|good afternoon|good evening|howdy)\b/.test(t) && t.length < 40) return 'greeting';
  if (/\b(human|real person|real human|somebody|someone|agent|representative|rep\b|manager|owner|staff)\b/.test(t) &&
      /\b(talk|speak|human|real|person|transfer|connect|call|reach|handoff|hand off)\b/.test(t)) return 'human';
  if (/\b(cancel|reschedule|change|move|postpone)\b/.test(t) && /\b(appointment|booking|reservation|visit|meeting)\b/.test(t)) return 'cancel_appointment';
  if (/\b(book|booking|appointment|appointments|schedule|scheduling|reservation|reserve|visit|slot|available|availability|opening|come in|sign up)\b/.test(t)) return 'booking';
  if (/\b(hours|hour|open|close|closing|closed|operation|when do you|what time do you)\b/.test(t)) return 'hours';
  if (/\b(where|address|location|located|direction|parking|park|find you|get there)\b/.test(t)) return 'address';
  if (/\b(price|pricing|prices|cost|costs|charge|fee|fees|how much|rate|rates|expensive|cheap)\b/.test(t)) return 'pricing';
  if (/\b(service|services|offer|offers|provide|cleaning|whitening|filling|fillings|braces|extraction|implant|crown|checkup|check-up|exam|emergency|tooth|teeth|dentist)\b/.test(t)) return 'services';
  if (/^(yes|yeah|yep|yup|sure|ok|okay|k\b|correct|right|confirm|confirmed|please do|do it|go ahead|sounds good|perfect|great|works|that works|fine)\b/.test(t)) return 'yes';
  if (/^(no|nope|nah|not really|don't|do not|stop|cancel|never mind|nevermind|not now)\b/.test(t)) return 'no';
  if (/\b(thank|thanks|thx|appreciated)\b/.test(t)) return 'thanks';
  if (/\b(bye|goodbye|good bye|see you|talk later|that's all|that is all|have a good|have a great)\b/.test(t)) return 'bye';
  return 'unknown';
}

// ---------------------------------------------------------------- business summaries

function hoursSummary(business) {
  // Groups consecutive days with identical hours: "Monday through Friday, 9:00 AM to 5:00 PM; Saturday ..."
  const order = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const names = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
  const groups = [];
  let start = 0;
  const key = (d) => { const h = business.hours[d]; return h ? h.join('-') : 'closed'; };
  for (let i = 1; i <= order.length; i++) {
    if (i === order.length || key(order[i]) !== key(order[start])) {
      const label = start === i - 1 ? names[order[start]] : `${names[order[start]]} through ${names[order[i - 1]]}`;
      const h = business.hours[order[start]];
      groups.push(h ? `${label}, ${fmtTime(h[0])} to ${fmtTime(h[1])}` : `${label} we're closed`);
      start = i;
    }
  }
  // Move "closed" groups last for nicer speech
  groups.sort((a, b) => (a.includes('closed') ? 1 : 0) - (b.includes('closed') ? 1 : 0));
  return groups.join('; ');
}

function servicesSummary(business) {
  return business.services.map((s) => `${s.name} for ${s.price}`).join(', ');
}

function greetingFor(business) {
  return fill(business.agent.greeting, business);
}

// ---------------------------------------------------------------- extraction

function matchService(text, services) {
  const t = ' ' + norm(text).replace(/[^a-z0-9 ]/g, ' ') + ' ';
  let best = null, bestScore = 0;
  for (const s of services) {
    const keywords = (s.keywords || []).concat([s.name]);
    let score = 0;
    for (const kw of keywords) {
      const k = norm(kw).replace(/[^a-z0-9 ]/g, '').trim();
      if (k && t.includes(k)) score += k.split(' ').length; // multi-word matches weigh more
    }
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return bestScore > 0 ? best : null;
}

function parseDay(text, now) {
  const t = ' ' + norm(text).replace(/[^a-z ]/g, ' ') + ' ';
  if (t.includes(' today ')) return { date: new Date(now), label: 'today' };
  if (t.includes(' tomorrow ') || t.includes(' tommorow ')) {
    const d = new Date(now); d.setDate(d.getDate() + 1);
    return { date: d, label: 'tomorrow' };
  }
  for (const [alias, idx] of Object.entries(DAY_ALIASES)) {
    if (t.includes(' ' + alias + ' ')) {
      const d = new Date(now);
      const diff = (idx - d.getDay() + 7) % 7; // 0 = today
      d.setDate(d.getDate() + diff);
      return { date: d, label: DAY_NAMES[idx] };
    }
  }
  return null;
}

function assumeMeridiem(h) {
  // Daytime-business heuristic: 9–11 → AM, 12 → PM, 1–7 → PM, 8 → AM
  if (h === 12) return 'PM';
  if (h >= 9 && h <= 11) return 'AM';
  if (h >= 1 && h <= 7) return 'PM';
  if (h === 8) return 'AM';
  return null;
}

function parseTime(text) {
  const t = norm(text);
  if (/\b(morning|mornings)\b/.test(t)) return { part: 'morning' };
  if (/\b(afternoon|afternoons)\b/.test(t)) return { part: 'afternoon' };
  if (/\b(evening|evenings|night)\b/.test(t)) return { part: 'evening' };
  if (/\b(any ?time|anytime|whenever|earliest|first available|asap|as soon as possible|any)\b/.test(t)) return { part: 'any' };
  const m = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|am|pm|o'clock|oclock)?\b/);
  if (m) {
    let h = parseInt(m[1], 10);
    const min = m[2] ? parseInt(m[2], 10) : 0;
    if (min > 59) return null;
    let ap = m[3] ? m[3].replace(/\./g, '').toUpperCase() : null;
    if (ap === "O'CLOCK" || ap === 'OCLOCK') ap = null;
    if (h === 0 || h > 12) {
      if (h > 12 && h <= 23) { ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; }
      else return null;
    }
    if (!ap) ap = assumeMeridiem(h);
    if (!ap) return null;
    let mins = (h % 12) * 60 + min;
    if (ap === 'PM') mins += 12 * 60;
    return { minutes: mins };
  }
  return null;
}

function extractName(text) {
  const t = String(text || '').trim()
    .replace(/^(my name is|this is|i'm|i am|it's|it is|the name's|name is|call me)\s+/i, '')
    .replace(/[.!?]+$/, '').trim();
  const words = t.split(/\s+/).filter((w) => /^[a-zA-Z][a-zA-Z'-]*$/.test(w));
  if (words.length === 0 || words.length > 3) return null;
  const lower = words.map((w) => w.toLowerCase());
  if (['yes', 'no', 'ok', 'okay', 'sure', 'hi', 'hello', 'hey', 'thanks', 'please'].includes(lower[0])) return null;
  if (/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(t)) return null;
  return words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

function extractPhone(text) {
  let d = String(text || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  return d.length === 10 ? d : null;
}

function matchFaq(text, faqs) {
  const words = norm(text).replace(/[^a-z ]/g, ' ').split(/\s+/).filter((w) => w.length > 3 && !STOPWORDS.has(w));
  if (words.length === 0) return null;
  let best = null, bestScore = 0;
  for (const f of faqs) {
    const hay = norm((f.q + ' ' + (f.keywords || []).join(' '))).replace(/[^a-z ]/g, ' ');
    let score = 0;
    for (const w of words) if (hay.includes(w)) score++;
    if (score > bestScore) { bestScore = score; best = f; }
  }
  return bestScore >= 1 ? best : null;
}

// ---------------------------------------------------------------- scheduling

function availableSlots(business, isoDate, appointments, now) {
  const h = business.hours[weekdayKey(isoDate)];
  if (!h) return [];
  const [open, close] = h;
  const booked = new Set(
    (appointments || []).filter((a) => a.date === isoDate && a.status !== 'cancelled').map((a) => a.time)
  );
  const isToday = isoDay(now) === isoDate;
  const nowMin = now.getHours() * 60 + now.getMinutes() + 30; // 30-min buffer
  const slots = [];
  for (let m = open; m + 60 <= close; m += 60) {
    if (isToday && m <= nowMin) continue;
    if (booked.has(fmtTime(m))) continue;
    slots.push(m);
  }
  return slots;
}

function nextOpenDate(business, fromDate) {
  for (let i = 1; i <= 8; i++) {
    const d = new Date(fromDate);
    d.setDate(d.getDate() + i);
    if (business.hours[weekdayKey(isoDay(d))]) return d;
  }
  return null;
}

function resolveTime(business, isoDate, appointments, parsed, now) {
  const slots = availableSlots(business, isoDate, appointments, now);
  if (slots.length === 0) return { ok: false, reason: 'full' };
  if (parsed.minutes != null) {
    if (slots.includes(parsed.minutes)) return { ok: true, minutes: parsed.minutes };
    return { ok: false, reason: 'taken', alternatives: slots.slice(0, 3) };
  }
  const part = parsed.part || 'any';
  const inPart = (m) =>
    part === 'any' ? true :
    part === 'morning' ? m < 12 * 60 :
    part === 'afternoon' ? (m >= 12 * 60 && m < 17 * 60) :
    m >= 17 * 60;
  const found = slots.find(inPart);
  if (found != null) return { ok: true, minutes: found };
  return { ok: false, reason: 'part', alternatives: slots.slice(0, 3), part };
}

function validateBooking(business, appointments, b, now) {
  const service = matchService(b.service || '', business.services);
  if (!service) return { ok: false, reason: `we don't offer "${b.service || 'that'}"` };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || '')) return { ok: false, reason: 'invalid date' };
  if (!business.hours[weekdayKey(b.date)]) return { ok: false, reason: 'closed that day' };
  const mins = parseTimeToMin(b.time || '');
  if (mins == null) return { ok: false, reason: 'invalid time' };
  const slots = availableSlots(business, b.date, appointments, now || new Date());
  if (!slots.includes(mins)) return { ok: false, reason: 'time not available', alternatives: slots.slice(0, 3).map(fmtTime) };
  if (!b.name || String(b.name).trim().length < 2) return { ok: false, reason: 'missing name' };
  const digits = String(b.phone || '').replace(/\D/g, '');
  if (digits.length < 10) return { ok: false, reason: 'missing phone' };
  return { ok: true, service, time: fmtTime(mins), phone: digits };
}

// ---------------------------------------------------------------- slot filling

function tryFillSlots(text, business, collect, appointments, now) {
  const notes = [];
  if (!collect.service) {
    const s = matchService(text, business.services);
    if (s) collect.service = s.name;
  }
  if (collect.service && !collect.day) {
    const p = parseDay(text, now);
    if (p) {
      const iso = isoDay(p.date);
      if (!business.hours[weekdayKey(iso)]) {
        notes.push({ type: 'closed', label: p.label });
      } else {
        collect.day = { iso, label: p.label };
      }
    }
  }
  if (collect.service && collect.day && !collect.time) {
    const p = parseTime(text);
    if (p) {
      const r = resolveTime(business, collect.day.iso, appointments, p, now);
      if (r.ok) collect.time = fmtTime(r.minutes);
      else if (r.reason === 'taken') notes.push({ type: 'taken', alternatives: r.alternatives });
      else if (r.reason === 'part') notes.push({ type: 'part', alternatives: r.alternatives, part: r.part });
      else if (r.reason === 'full') notes.push({ type: 'full' });
    }
  }
  if (collect.service && collect.day && collect.time && !collect.name) {
    const n = extractName(text);
    if (n) collect.name = n;
  }
  if (collect.service && collect.day && collect.time && collect.name && !collect.phone) {
    const ph = extractPhone(text);
    if (ph) collect.phone = ph;
  }
  return notes;
}

function nextMissing(collect) {
  if (!collect.service) return 'service';
  if (!collect.day) return 'day';
  if (!collect.time) return 'time';
  if (!collect.name) return 'name';
  if (!collect.phone) return 'phone';
  return null;
}

function promptFor(slot, business) {
  switch (slot) {
    case 'service': return `What would you like to book? We offer ${servicesSummary(business)}.`;
    case 'day': return `Which day works for you? We're open ${hoursSummary(business)}.`;
    case 'time': return 'What time works best for you?';
    case 'name': return 'Can I get your full name?';
    case 'phone': return 'And what phone number should we send the confirmation to?';
    default: return 'How else can I help?';
  }
}

function upcomingForPhone(appointments, phone) {
  const today = isoDay(new Date());
  return (appointments || [])
    .filter((a) => a.status !== 'cancelled' && a.phone === phone && a.date >= today)
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

// ---------------------------------------------------------------- main entry

function newSession(id, channel) {
  return { id, channel: channel || 'web', state: 'idle', collect: {}, cancel: {}, createdAt: Date.now() };
}

function getReply({ business, session, text, appointments }) {
  const now = new Date();
  const intent = detectIntent(text);
  let reply = '';
  let event = null;

  const sideAnswer = () => {
    // Caller asked a side question mid-flow: answer it, then resume.
    if (intent === 'hours') return `We're open ${hoursSummary(business)}.`;
    if (intent === 'address') return `We're located at ${business.address}.`;
    if (intent === 'pricing') {
      const s = matchService(text, business.services);
      if (s) return `A ${s.name} is ${s.price}${s.duration ? ` and takes about ${s.duration}` : ''}.`;
      return `Our prices: ${servicesSummary(business)}.`;
    }
    if (intent === 'services') return `We offer ${servicesSummary(business)}.`;
    if (intent === 'unknown') {
      const faq = matchFaq(text, business.faqs || []);
      if (faq) return faq.a;
    }
    return null;
  };

  const startBooking = () => {
    if (!business.bookingEnabled) {
      return `You can reach us directly at ${business.phone} to schedule. Is there anything else I can help with?`;
    }
    session.state = 'collect';
    session.collect = {};
    const notes = tryFillSlots(text, business, session.collect, appointments, now);
    return continueCollect(notes);
  };

  const continueCollect = (notes) => {
    notes = notes || [];
    // Surface extraction problems first
    for (const n of notes) {
      if (n.type === 'closed') {
        const next = nextOpenDate(business, now);
        const hint = next ? ` Our next open day is ${fmtDateLong(isoDay(next))}.` : '';
        return `Sorry, we're closed on ${n.label === 'today' || n.label === 'tomorrow' ? n.label : n.label + 's'}.${hint} What other day works for you?`;
      }
      if (n.type === 'taken') {
        return `Sorry, that time is already taken. I have ${joinList(n.alternatives.map(fmtTime))} — which works for you?`;
      }
      if (n.type === 'part') {
        if (n.part === 'evening') {
          const h = business.hours[weekdayKey(session.collect.day.iso)];
          return `We close at ${fmtTime(h[1])}, so no evenings — but I have ${joinList(n.alternatives.map(fmtTime))}. Which works?`;
        }
        return `Nothing in the ${n.part} that day, but I have ${joinList(n.alternatives.map(fmtTime))}. Which works?`;
      }
      if (n.type === 'full') {
        const next = nextOpenDate(business, parseISODate(session.collect.day.iso));
        if (next) {
          session.collect._suggestDay = isoDay(next);
          return `We're fully booked ${session.collect.day.label === 'today' || session.collect.day.label === 'tomorrow' ? session.collect.day.label : 'on ' + fmtDateLong(session.collect.day.iso)}. I can check ${fmtDateLong(isoDay(next))} instead — want me to?`;
        }
        return 'Sorry, that day is fully booked. Which other day works for you?';
      }
    }
    const missing = nextMissing(session.collect);
    if (!missing) {
      session.state = 'confirm';
      const c = session.collect;
      return `Perfect — ${c.service} on ${fmtDateLong(c.day.iso)} at ${c.time}, for ${c.name}. Is that correct?`;
    }
    // Acknowledge partial info gracefully when day+time land together
    return promptFor(missing, business);
  };

  // ------------------------------------------------------------ state machine
  if (session.state === 'collect') {
    if (intent === 'human') {
      session.state = 'idle'; session.collect = {};
      event = { type: 'handoff' };
      reply = `Of course — let me connect you with our team at ${business.agent.handoff}. One moment please.`;
    } else if (intent === 'no' || intent === 'bye') {
      session.state = 'idle'; session.collect = {};
      reply = 'No problem at all! Is there anything else I can help with?';
    } else if (session.collect._suggestDay && (intent === 'yes' || norm(text).includes('yes') || norm(text).includes('sure') || norm(text).includes('ok'))) {
      const iso = session.collect._suggestDay;
      delete session.collect._suggestDay;
      session.collect.day = { iso, label: fmtDateLong(iso) };
      session.collect.time = null;
      const slots = availableSlots(business, iso, appointments, now).slice(0, 3).map(fmtTime);
      reply = slots.length
        ? `Great — on ${fmtDateLong(iso)} I have ${joinList(slots)}. What time works?`
        : `Hmm, that day filled up too. Which other day works for you?`;
      if (!slots.length) delete session.collect.day;
    } else {
      const side = sideAnswer();
      const notes = tryFillSlots(text, business, session.collect, appointments, now);
      const resumed = continueCollect(notes);
      reply = side && session.state === 'collect' ? `${side} ${resumed}` : resumed;
    }
  } else if (session.state === 'confirm') {
    if (intent === 'yes') {
      const c = session.collect;
      event = {
        type: 'booked',
        appointment: { service: c.service, date: c.day.iso, time: c.time, name: c.name, phone: c.phone }
      };
      reply = `You're booked! ${c.service} on ${fmtDateLong(c.day.iso)} at ${c.time}. We'll send a reminder to ${formatPhone(c.phone)}. Anything else I can help with?`;
      session.state = 'idle'; session.collect = {};
    } else if (intent === 'no') {
      session.state = 'collect';
      session.collect.day = null; session.collect.time = null;
      reply = "Got it — let's redo it. Which day works for you?";
    } else if (intent === 'human') {
      session.state = 'idle'; session.collect = {};
      event = { type: 'handoff' };
      reply = `Of course — let me connect you with our team at ${business.agent.handoff}. One moment please.`;
    } else {
      // Maybe they gave a correction like a different day/time — try to apply it
      const c = session.collect;
      const pDay = parseDay(text, now);
      const pTime = parseTime(text);
      if (pDay) {
        const iso = isoDay(pDay.date);
        if (business.hours[weekdayKey(iso)]) {
          c.day = { iso, label: pDay.label }; c.time = null;
          session.state = 'collect';
          reply = `Got it — ${fmtDateLong(iso)}. ${promptFor('time', business)}`;
        } else {
          reply = `Sorry, we're closed ${pDay.label === 'today' || pDay.label === 'tomorrow' ? pDay.label : 'on ' + pDay.label + 's'}. Which other day?`;
          session.state = 'collect'; c.day = null; c.time = null;
        }
      } else if (pTime) {
        const r = resolveTime(business, c.day.iso, appointments, pTime, now);
        if (r.ok) {
          c.time = fmtTime(r.minutes);
          reply = `Updated — ${c.service} on ${fmtDateLong(c.day.iso)} at ${c.time}, for ${c.name}. Is that correct?`;
        } else {
          const alts = (r.alternatives || []).map(fmtTime);
          reply = alts.length ? `That time isn't free, but I have ${joinList(alts)}. Which works?` : 'That time isn\'t free. What other time works?';
          session.state = 'collect'; c.time = null;
        }
      } else {
        reply = `Just to confirm — ${c.service} on ${fmtDateLong(c.day.iso)} at ${c.time}, for ${c.name}. Should I book it?`;
      }
    }
  } else if (session.state === 'cancel_phone') {
    const ph = extractPhone(text);
    if (!ph) {
      reply = "I didn't catch that — what's the 10-digit phone number on the booking?";
    } else {
      const found = upcomingForPhone(appointments, ph);
      if (found.length === 0) {
        session.state = 'idle';
        reply = "I couldn't find an upcoming appointment under that number. Want to book a new one, or should I connect you with our team?";
      } else if (found.length === 1) {
        session.state = 'cancel_confirm';
        session.cancel = { id: found[0].id };
        reply = `I found your ${found[0].service} on ${fmtDateLong(found[0].date)} at ${found[0].time}. Should I cancel it?`;
      } else {
        session.state = 'cancel_pick';
        session.cancel = { options: found.map((a) => a.id) };
        reply = 'I found these upcoming appointments: ' +
          found.map((a, i) => `${i + 1}: ${a.service} on ${fmtDateLong(a.date)} at ${a.time}`).join('; ') +
          '. Which number should I cancel?';
      }
    }
  } else if (session.state === 'cancel_pick') {
    const m = norm(text).match(/\b(\d+)\b|^(one|two|three|four|five)\b/);
    const words = { one: 1, two: 2, three: 3, four: 4, five: 5 };
    const n = m ? (parseInt(m[1], 10) || words[m[2]]) : null;
    const opts = session.cancel.options || [];
    if (n && n >= 1 && n <= opts.length) {
      const appt = (appointments || []).find((a) => a.id === opts[n - 1]);
      session.state = 'cancel_confirm';
      session.cancel = { id: opts[n - 1] };
      reply = appt
        ? `Cancel your ${appt.service} on ${fmtDateLong(appt.date)} at ${appt.time}? Please say yes to confirm.`
        : 'Which one should I cancel?';
    } else {
      reply = 'Which number should I cancel? Say the number, like "number 1".';
    }
  } else if (session.state === 'cancel_confirm') {
    if (intent === 'yes') {
      event = { type: 'cancelled', id: session.cancel.id };
      session.state = 'idle'; session.cancel = {};
      reply = "Done — your appointment has been cancelled. Can I help with anything else?";
    } else {
      session.state = 'idle'; session.cancel = {};
      reply = 'Okay, keeping your appointment as is. Anything else I can help with?';
    }
  } else {
    // -------------------------------------------------------- idle routing
    switch (intent) {
      case 'greeting':
        reply = `${greetingFor(business)}`;
        break;
      case 'hours':
        reply = `We're open ${hoursSummary(business)}. Anything else I can help with?`;
        break;
      case 'address':
        reply = `We're located at ${business.address}. Our phone number is ${business.phone}. Anything else?`;
        break;
      case 'pricing': {
        const s = matchService(text, business.services);
        reply = s
          ? `A ${s.name} is ${s.price}${s.duration ? ` and takes about ${s.duration}` : ''}. Want me to book one for you?`
          : `Our prices: ${servicesSummary(business)}. Want to book anything?`;
        break;
      }
      case 'services':
        reply = `We offer ${servicesSummary(business)}. Want me to book one for you?`;
        break;
      case 'booking':
        reply = startBooking();
        break;
      case 'cancel_appointment':
        session.state = 'cancel_phone';
        reply = "I can help with that. What's the phone number on the booking?";
        break;
      case 'human':
        event = { type: 'handoff' };
        reply = `Of course — let me connect you with our team at ${business.agent.handoff}. One moment please.`;
        break;
      case 'thanks':
        reply = "You're very welcome! Anything else I can help with?";
        break;
      case 'bye':
        reply = `Thanks for calling ${business.name} — have a great day!`;
        break;
      case 'yes':
      case 'no':
        reply = 'I can help with our hours, services and prices, or booking an appointment. What would you like?';
        break;
      default: {
        const faq = matchFaq(text, business.faqs || []);
        if (faq) {
          reply = `${faq.a} Anything else I can help with?`;
        } else if (/\b(book|appointment|schedule)\b/.test(norm(text))) {
          reply = startBooking();
        } else {
          reply = `I can help with our hours, services and prices, or booking an appointment — or I can connect you with our team. What would you like?`;
        }
      }
    }
  }

  return { reply, event };
}

module.exports = {
  getReply,
  newSession,
  greetingFor,
  hoursSummary,
  servicesSummary,
  matchService,
  parseDay,
  parseTime,
  extractName,
  extractPhone,
  availableSlots,
  nextOpenDate,
  validateBooking,
  fmtTime,
  fmtDateLong,
  formatPhone,
  isoDay,
  weekdayKey,
};
