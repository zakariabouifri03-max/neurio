# Networking: what works out of the box, and what genuinely does not

Neurio is peer-to-peer for media and client-server for everything else. That single sentence
explains every limitation on this page. Being precise about it is more useful than pretending the
app "just works everywhere".

---

## 1. The three rings

| Ring | Setup | Voice/video | Text |
| --- | --- | --- | --- |
| **One machine** | nothing | ✅ (loopback, no ICE needed) | ✅ |
| **Same LAN / Wi-Fi** | nothing but the server's LAN address | ✅ usually (host candidates are enough) | ✅ |
| **Across the internet** | a reachable server + STUN/TURN | ⚠️ needs STUN, sometimes TURN | ✅ |

"Reachable server" means: the machine running `neurio server` must be reachable from the other
person's computer. Home routers use NAT, which silently drops unsolicited incoming connections —
that is a property of the internet, not of Neurio.

## 2. Same machine

The desktop app starts its own server on `127.0.0.1:8790` and talks to it. Nothing to configure.
Several people **cannot** share one desktop app installation this way; each person needs their own
account on the same server (see below).

## 3. Same local network (works out of the box)

1. On the machine that will host, run:

   ```bash
   npm run server -- --host 0.0.0.0 --port 8790
   ```

   It prints a banner with the LAN URL, e.g. `http://192.168.1.20:8790`.
2. If Windows Firewall asks, allow Node.js on **private** networks (or add a rule for TCP 8790).
3. Everyone else installs the app, and in the sign-in screen sets **Server address** to that URL,
   then registers an account.

Voice and video normally work here: both machines are on the same subnet, so WebRTC finds a direct
path with host candidates. If one of them is on a VPN or a guest network with client isolation,
add a STUN server (next section).

## 4. Across the internet

You need **one** of these three routes. None of them require a paid service.

### Route A — put the server on a VPS (most reliable)

Any small Linux VPS (or a spare machine at a friend's house, or a Raspberry Pi with a port
forward) works:

```bash
npm run server -- --host 0.0.0.0 --port 8790
# or the bundled build, no node_modules needed:
node dist-electron/server/index.cjs --host 0.0.0.0 --port 8790 --data-dir /var/lib/neurio
```

Then either connect straight to `http://your-host:8790`, or — better — put a reverse proxy with
TLS in front, so the app uses `https://` and `wss://` (see
[SELF-HOSTING.md](SELF-HOSTING.md#4-https-and-wss-with-caddy-or-nginx)). In the desktop app, point
the server address field at that URL. That is the whole configuration.

### Route B — port forwarding at home

Forward TCP 8790 on your router to the machine running the server, and give people your public
IP (or a free dynamic-DNS name). Caveats: your IP changes unless you use DDNS, the server is
exposed to the internet (use a strong first password, or `--no-registration`), and some ISPs use
CGNAT, which makes this impossible — in that case use Route A or C.

### Route C — a VPN overlay (zero cost, zero exposure)

Install [Tailscale](https://tailscale.com) (free tier for personal use), ZeroTier or plain
WireGuard on both machines. Everyone gets a stable private IP (e.g. `100.x.y.z`); run the server
with `--host 0.0.0.0` and use `http://100.x.y.z:8790`. No port forwarding, no public exposure, and
voice/video work because the overlay gives a direct path. This is the easiest option for a small
group of friends.

## 5. STUN and TURN (for voice/video)

Text chat needs nothing extra. Media needs help discovering a path:

* **STUN** — tells each peer its public address/port. Free public servers exist, and a self-hosted
  `coturn` provides it too. Without STUN, peers behind NAT usually fail to connect.
* **TURN** — relays the media when a direct path is impossible (symmetric NAT, strict corporate
  firewalls, CGNAT). It costs bandwidth, which is why paid TURN services exist — but `coturn` is
  free and open source and does the same job on your own VPS.

Point Neurio at your servers with environment variables (all optional):

```bash
# STUN only (public example — run your own when you can)
NEURIO_ICE_SERVERS="stun:stun.l.google.com:19302" npm run server

# STUN + your own coturn (credentials are reused for the TURN entry)
NEURIO_ICE_SERVERS="stun:turn.example.org:3478|turn:turn.example.org:3478" \
NEURIO_TURN_USERNAME="neurio" \
NEURIO_TURN_CREDENTIAL="a-long-secret" \
npm run server
```

They are handed to clients through `GET /api/config` → `ice_servers`, so every participant gets
them automatically. A minimal coturn config:

```ini
# /etc/turnserver.conf
listening-port=3478
realm=turn.example.org
fingerprint
lt-cred-mech
user=neurio:a-long-secret
external-ip=YOUR.PUBLIC.IP
min-port=49152
max-port=65535
```

Open TCP/UDP 3478 and the UDP relay range (49152–65535) in the firewall. That is the entire
"TURN service" a paid provider would sell you.

## 6. Which ports are involved

| Port | Where | Purpose |
| --- | --- | --- |
| 8790 (configurable) | server | REST API + WebSocket gateway + uploads. Forward/proxy this one. |
| 3478 + relay range | coturn | STUN/TURN for calls. Only needed across NAT. |
| ephemeral UDP | both peers | The actual WebRTC media. Nothing to forward — it is peer-to-peer by design. |
| 5173 | dev only | Vite dev server when you use `npm run dev:web`. |

## 7. Why the mesh size is limited

Neurio uses a full mesh: every participant sends their media directly to every other participant.
That keeps the server out of the media path (cheap hosting, low latency, no central recording), but
upstream bandwidth grows linearly — with **n** people you upload **n−1** copies. The server tells
clients `recommended_max_mesh_peers: 6` and the voice view shows a warning above that. For large
calls you would need an SFU (Selective Forwarding Unit) such as [mediasoup](https://mediasoup.org)
or [Janus](https://janus.conf.meetecho.com) — a significant addition, not currently implemented.

## 8. Checklist when a call will not connect

1. Do text messages work between the two people? If not, it is a server-reachability problem
   (routes A–C above), not a media problem.
2. Are both people in the **same voice channel**? The server refuses to relay signalling to peers
   outside the channel — that is intentional.
3. Does `http://<server>:8790/api/config` show your `ice_servers`? If it is empty and the two
   people are behind different NATs, add STUN.
4. Corporate/university networks often block UDP entirely. Only TURN (over TCP/TLS) can help
   there; add it to `NEURIO_ICE_SERVERS`.
5. Still stuck? Check the server log — signalling relays are logged at `--log-level debug`, and
   `VOICE_SIGNAL` entries show whether the offer/answer actually left the client.
