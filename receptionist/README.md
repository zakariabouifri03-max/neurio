# 📞 Neurio Voice — AI Receptionist for Small Business

Never miss another customer call. Neurio Voice answers every call **24/7**, books
appointments, answers FAQs, and hands tricky callers off to a human — for less
than one missed job a month.

Built for **dentists, plumbers & HVAC, salons, lawyers, auto shops, clinics** —
any US small business that loses money on missed calls.

## ✨ What's inside

| Page | URL | What it does |
|---|---|---|
| Landing page (US-targeted) | `/` | Hero, live chat demo, pricing, FAQ |
| Voice demo | `/demo` | Talk to the AI in your browser (mic + voice, or type) |
| Owner dashboard | `/dashboard` | Business profile, agent settings, calls, appointments, go-live checklist |

**AI brain** (`brain.js`) — works **offline, zero API keys**: understands hours /
directions / pricing questions, books appointments in one sentence
("a cleaning tomorrow morning"), handles changes, cancellations, and human
handoff. Set `OPENAI_API_KEY` to upgrade replies to GPT (with validation so it
can never double-book).

**Real phone calls** — Twilio webhooks included: buy a US number, point it at
`/voice/incoming`, and the AI answers actual calls with a human-like voice.

## 🚀 Quickstart

```bash
cd receptionist
npm install
node server.js
# → http://localhost:3000
```

Optional GPT upgrade:

```bash
OPENAI_API_KEY=sk-... OPENAI_MODEL=gpt-4o-mini node server.js
```

## 📞 Answering real calls (Twilio)

1. Sign up at [twilio.com](https://www.twilio.com) → buy a US local number (~$1.15/mo).
2. Deploy this server somewhere public (Render / Railway / any VPS, Node 20+).
3. In your Twilio number's **Voice Configuration**, set webhook:
   `POST https://YOUR-SERVER/voice/incoming`
4. Call your number and book an appointment by voice. It lands in `/dashboard`.

How it works: Twilio calls `/voice/incoming` → AI greets → every caller
utterance posts to `/voice/respond` → AI replies and keeps listening → say
"human" and the live call transfers to your cell (`agent.handoff`).

## 💳 Getting paid (Stripe)

The pricing buttons on the landing page are ready for **Stripe Payment Links**:
create one link per plan in your Stripe dashboard and paste the URLs into the
`data-stripe` buttons in `public/index.html`.

Suggested pricing: **Starter $149/mo · Growth $299/mo · Scale custom**.

## 🗂️ Project structure

```
receptionist/
├── server.js          # Express: pages, REST API, Twilio webhooks, GPT hookup
├── brain.js           # Rule-based AI receptionist (offline, no keys)
├── openai.js          # Optional GPT brain (validated, never double-books)
├── db.seed.json       # Demo business: Bright Smile Dental, Austin TX
├── db.json            # Runtime database (auto-created, git-ignored)
├── public/
│   ├── index.html     # Landing page + live chat widget
│   ├── demo.html      # Browser voice demo
│   ├── dashboard.html # Owner dashboard
│   ├── css/style.css
│   └── js/            # app.js (landing) · demo.js (voice) · dashboard.js
└── README.md
```

## 🔌 API reference

- `GET /api/status` — brain mode, business/agent names
- `GET /api/greeting` — current greeting (landing widget, demo)
- `POST /api/chat` — `{sessionId?, text}` or `{start:true}` → `{sessionId, reply, event, appointment?}`
- `GET /api/business` · `PUT /api/business` — business + agent config
- `GET /api/calls` — transcripts, newest first
- `GET /api/appointments` · `DELETE /api/appointments/:id`
- `POST /api/demo/reset` — restore sample demo data
- `POST /voice/incoming` · `POST /voice/respond` · `POST /voice/timeout` — Twilio

## 🛣️ Roadmap ideas

- SMS confirmations & reminders (Twilio SMS)
- Google Calendar two-way sync
- Multi-location / multi-tenant accounts + login
- Call recordings + sentiment summary emails
- Spanish-speaking agent mode 🇪🇸🇲🇽 (huge in Texas/California!)

---
MIT — built with Neurio. Every missed call is money walking away. 📞
