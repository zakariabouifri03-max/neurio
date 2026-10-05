'use strict';
/**
 * Neurio Voice — AI receptionist server.
 * - Serves landing page, voice demo, owner dashboard
 * - JSON API for chat, business config, calls, appointments
 * - Twilio voice webhooks so the AI answers REAL phone calls
 * - Optional GPT brain when OPENAI_API_KEY is set (else built-in rule brain)
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const brain = require('./brain');
const { openAiReply } = require('./openai');

const PORT = process.env.PORT || 3000;
const BIND = process.env.BIND || '0.0.0.0';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const USE_OPENAI = Boolean(OPENAI_API_KEY);

// ---------------------------------------------------------------- database (JSON file)
const DB_PATH = path.join(__dirname, 'db.json');
const SEED_PATH = path.join(__dirname, 'db.seed.json');

function loadDb() {
  if (!fs.existsSync(DB_PATH)) {
    fs.copyFileSync(SEED_PATH, DB_PATH);
  }
  const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  db.calls = db.calls || [];
  db.appointments = db.appointments || [];
  // Seed demo content on a fresh DB so the dashboard isn't empty
  if (!db.seededDemo) {
    seedDemoContent(db);
    db.seededDemo = true;
    saveDb(db);
  }
  return db;
}
function saveDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}
function seedDemoContent(db) {
  const d1 = new Date(); d1.setDate(d1.getDate() + 1);
  const d2 = new Date(); d2.setDate(d2.getDate() + 2);
  // push to weekdays if landing on Sunday (business closed)
  for (const d of [d1, d2]) if (d.getDay() === 0) d.setDate(d.getDate() + 1);
  const id1 = crypto.randomUUID(), id2 = crypto.randomUUID();
  db.appointments.push(
    { id: id1, service: 'Cleaning & Checkup', date: brain.isoDay(d1), time: '10:00 AM', name: 'Sarah Johnson', phone: '5125550119', status: 'confirmed', source: 'phone', createdAt: Date.now() - 86400000 },
    { id: id2, service: 'Teeth Whitening', date: brain.isoDay(d2), time: '2:00 PM', name: 'Mike Torres', phone: '5125550134', status: 'confirmed', source: 'web', createdAt: Date.now() - 3600000 }
  );
  db.calls.push({
    id: 'seed-call-1', channel: 'phone', startedAt: Date.now() - 86400000, updatedAt: Date.now() - 86300000,
    appointmentId: id1,
    transcript: [
      { role: 'ai', text: brain.greetingFor(db.business), at: Date.now() - 86400000 },
      { role: 'user', text: 'Hi, do you have any openings for a cleaning tomorrow?', at: Date.now() - 86395000 },
      { role: 'ai', text: 'Let me check… yes! What time works best for you?', at: Date.now() - 86390000 },
      { role: 'user', text: 'Morning, around 10?', at: Date.now() - 86385000 },
      { role: 'ai', text: 'You\'re booked! Anything else I can help with?', at: Date.now() - 86300000 }
    ]
  });
}

let db = loadDb();

// In-memory conversation sessions (per web visitor / phone call)
const sessions = new Map();

// ---------------------------------------------------------------- app
const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

const getBusiness = () => db.business;
const upcomingAppointments = () => {
  const today = brain.isoDay(new Date());
  return db.appointments
    .filter((a) => a.status !== 'cancelled' && a.date >= today)
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
};

function getCall(sessionId, channel) {
  let call = db.calls.find((c) => c.id === sessionId);
  if (!call) {
    call = { id: sessionId, channel, startedAt: Date.now(), updatedAt: Date.now(), transcript: [] };
    db.calls.push(call);
  }
  return call;
}

// Core: one user message in → AI reply out (shared by web chat, voice demo & phone calls)
async function handleMessage(sessionId, channel, text) {
  let session = sessions.get(sessionId);
  if (!session) {
    session = brain.newSession(sessionId, channel);
    sessions.set(sessionId, session);
  }
  const call = getCall(sessionId, channel);
  call.transcript.push({ role: 'user', text, at: Date.now() });

  let result;
  if (USE_OPENAI) {
    try {
      result = await openAiReply({
        apiKey: OPENAI_API_KEY, model: OPENAI_MODEL,
        business: getBusiness(), transcript: call.transcript, appointments: db.appointments,
      });
      // Validate any GPT-produced booking so we never double-book
      if (result.event && result.event.type === 'booked') {
        const v = brain.validateBooking(getBusiness(), db.appointments, result.event.appointment);
        if (!v.ok) {
          const retry = await openAiReply({
            apiKey: OPENAI_API_KEY, model: OPENAI_MODEL,
            business: getBusiness(), transcript: call.transcript, appointments: db.appointments,
            correction: `SYSTEM: your last booking failed validation (${v.reason}${v.alternatives ? '; alternatives: ' + v.alternatives.join(', ') : ''}). Apologize briefly and offer a valid alternative. Do NOT emit the BOOKING token in this message.`,
          });
          result = { reply: retry.reply, event: null };
        } else {
          result.event.appointment = {
            service: v.service.name, date: result.event.appointment.date,
            time: v.time, name: result.event.appointment.name.trim(), phone: v.phone,
          };
        }
      }
    } catch (err) {
      console.error('OpenAI failed, falling back to rule brain:', err.message);
      result = brain.getReply({ business: getBusiness(), session, text, appointments: db.appointments });
    }
  } else {
    result = brain.getReply({ business: getBusiness(), session, text, appointments: db.appointments });
  }

  call.transcript.push({ role: 'ai', text: result.reply, at: Date.now() });
  call.updatedAt = Date.now();

  // Apply side-effect events
  let appointment = null;
  if (result.event && result.event.type === 'booked') {
    const a = result.event.appointment;
    appointment = {
      id: crypto.randomUUID(), service: a.service, date: a.date, time: a.time,
      name: a.name, phone: a.phone, status: 'confirmed', source: channel,
      sourceCallId: sessionId, createdAt: Date.now(),
    };
    db.appointments.push(appointment);
    call.appointmentId = appointment.id;
  } else if (result.event && result.event.type === 'cancelled') {
    const appt = db.appointments.find((x) => x.id === result.event.id);
    if (appt) appt.status = 'cancelled';
  }
  saveDb(db);
  return { reply: result.reply, event: result.event ? result.event.type : null, appointment, handoff: result.event && result.event.type === 'handoff' };
}

// ---------------------------------------------------------------- REST API

app.get('/api/status', (req, res) => {
  res.json({
    brain: USE_OPENAI ? 'openai:' + OPENAI_MODEL : 'built-in',
    businessName: getBusiness().name,
    agentName: getBusiness().agent.name,
  });
});

app.get('/api/greeting', (req, res) => {
  const b = getBusiness();
  res.json({ greeting: brain.greetingFor(b), agentName: b.agent.name, businessName: b.name, phone: b.phone });
});

app.post('/api/chat', async (req, res) => {
  try {
    const { sessionId, text, start } = req.body || {};
    if (start) {
      const id = sessionId || ('web-' + crypto.randomUUID());
      const session = brain.newSession(id, 'web');
      sessions.set(id, session);
      const call = getCall(id, 'web');
      const greeting = brain.greetingFor(getBusiness());
      call.transcript.push({ role: 'ai', text: greeting, at: Date.now() });
      saveDb(db);
      return res.json({ sessionId: id, reply: greeting, event: null });
    }
    if (!text || !String(text).trim()) return res.status(400).json({ error: 'text required' });
    const id = sessionId || ('web-' + crypto.randomUUID());
    const out = await handleMessage(id, 'web', String(text).slice(0, 1000));
    res.json({ sessionId: id, ...out });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'chat failed' });
  }
});

app.get('/api/business', (req, res) => res.json(getBusiness()));

app.put('/api/business', (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.agent || !b.agent.name) return res.status(400).json({ error: 'name and agent.name required' });
  db.business = { ...db.business, ...b, id: db.business.id };
  saveDb(db);
  res.json(db.business);
});

app.get('/api/calls', (req, res) => {
  const calls = [...db.calls].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 100);
  res.json(calls);
});

app.get('/api/appointments', (req, res) => res.json(upcomingAppointments()));

app.delete('/api/appointments/:id', (req, res) => {
  const appt = db.appointments.find((a) => a.id === req.params.id);
  if (!appt) return res.status(404).json({ error: 'not found' });
  appt.status = 'cancelled';
  saveDb(db);
  res.json({ ok: true });
});

app.post('/api/demo/reset', (req, res) => {
  db.calls = [];
  db.appointments = [];
  db.seededDemo = false;
  seedDemoContent(db);
  db.seededDemo = true;
  sessions.clear();
  saveDb(db);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- Twilio voice webhooks (real phone calls)

const escXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const twiml = (inner) => `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;

function gatherTwiml(sayText) {
  return twiml(
    `<Say voice="Polly.Joanna">${escXml(sayText)}</Say>` +
    `<Gather input="speech" action="/voice/respond" method="POST" speechTimeout="auto" timeout="8" speechModel="phone_call">` +
    `<Say voice="Polly.Joanna">Is there anything else I can help with?</Say>` +
    `</Gather>` +
    `<Redirect method="POST">/voice/timeout</Redirect>`
  );
}

// Twilio hits this when someone calls your number
app.post('/voice/incoming', (req, res) => {
  const callSid = req.body.CallSid || ('test-' + Date.now());
  const sessionId = 'phone-' + callSid;
  const session = brain.newSession(sessionId, 'phone');
  sessions.set(sessionId, session);
  const call = getCall(sessionId, 'phone');
  call.from = req.body.From || 'unknown';
  const greeting = brain.greetingFor(getBusiness());
  call.transcript.push({ role: 'ai', text: greeting, at: Date.now() });
  saveDb(db);
  res.type('text/xml').send(gatherTwiml(greeting));
});

// Twilio posts each caller utterance here; we reply and keep listening
app.post('/voice/respond', async (req, res) => {
  try {
    const callSid = req.body.CallSid || 'test';
    const heard = (req.body.SpeechResult || '').trim();
    const sessionId = 'phone-' + callSid;
    if (!heard) {
      return res.type('text/xml').send(gatherTwiml("Sorry, I didn't catch that. Could you say it again?"));
    }
    const out = await handleMessage(sessionId, 'phone', heard.slice(0, 1000));
    if (out.handoff && getBusiness().agent.handoff) {
      // Transfer the live call to the business team
      return res.type('text/xml').send(twiml(
        `<Say voice="Polly.Joanna">${escXml(out.reply)}</Say><Dial timeout="25">${escXml(getBusiness().agent.handoff)}</Dial>`
      ));
    }
    res.type('text/xml').send(gatherTwiml(out.reply));
  } catch (err) {
    console.error(err);
    res.type('text/xml').send(gatherTwiml("Sorry — I'm having trouble right now. Please try again in a moment."));
  }
});

// Caller went silent → polite goodbye
app.post('/voice/timeout', (req, res) => {
  res.type('text/xml').send(twiml(
    `<Say voice="Polly.Joanna">Thanks for calling ${escXml(getBusiness().name)} — have a great day!</Say><Hangup/>`
  ));
});

// Friendly page routes
app.get('/demo', (req, res) => res.sendFile(path.join(__dirname, 'public', 'demo.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));

app.listen(PORT, BIND, () => {
  console.log(`\n📞 Neurio Voice running → http://${BIND}:${PORT}`);
  console.log(`   Brain: ${USE_OPENAI ? 'OpenAI ' + OPENAI_MODEL : 'built-in (offline)'}`);
  console.log(`   Twilio webhook: POST /voice/incoming\n`);
});
