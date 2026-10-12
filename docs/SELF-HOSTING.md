# Self-hosting Neurio

Neurio exists so that a group of people can chat without renting a service. This guide covers the
server side: running it, keeping it alive, backing it up, exposing it safely, and updating it.
Everything here uses free and open-source software only.

---

## 1. Which artefact to run

| Situation | Command |
| --- | --- |
| You have the source checkout | `npm run server -- --host 0.0.0.0 --port 8790` |
| You only have the built desktop app installed | the app starts a private server automatically; nothing to do |
| A server, headless (VPS, Pi, NAS) | build once, then `node dist-electron/server/index.cjs --host 0.0.0.0 --port 8790 --data-dir /var/lib/neurio` |
| A server that also serves the web UI | add `--static /path/to/dist`, then open `http://server:8790` in a browser |

Flags (all optional):

```
--port <n>            listen port                      (default 8790)
--host <addr>         bind address                     (default 0.0.0.0)
--data-dir <path>     SQLite file + uploads            (default: per-OS app data dir)
--static <dir>        serve the built renderer there   (browser mode)
--no-registration     close sign-ups after your own account exists
--log-level <level>   debug | info | warn | error
--help / --version
```

Environment: `NEURIO_DATA_DIR`, `NEURIO_ICE_SERVERS`, `NEURIO_TURN_USERNAME`,
`NEURIO_TURN_CREDENTIAL`, `NEURIO_TRUST_PROXY` (set to `1` **only** behind a proxy you control).

The first account you create becomes the **server operator** and sees the Admin tab in
Settings (user list, server stats, sign-up toggle). The second and later accounts are ordinary
members.

## 2. Create the workspace

```bash
npm run seed                       # demo data: operator/alice/bob/carol + "Neurio HQ"
npm run seed -- --no-start         # seed an already-running server over HTTP
npm run seed -- --data-dir /var/lib/neurio
```

Passwords come from `--password` (operator, default `neurio-operator`) and `--member-password`
(demo members, default `neurio-demo`). **Change them** before letting anyone else in — the
Settings → Profile screen has a change-password form, or call
`POST /api/users/@me/password`.

Running the seed twice is safe: it detects `Neurio HQ` and does nothing.

## 3. Keep it running (systemd)

```ini
# /etc/systemd/system/neurio.service
[Unit]
Description=Neurio chat server
After=network-online.target

[Service]
Type=simple
User=neurio
WorkingDirectory=/opt/neurio
ExecStart=/usr/bin/node /opt/neurio/dist-electron/server/index.cjs \
          --host 0.0.0.0 --port 8790 --data-dir /var/lib/neurio --static /opt/neurio/dist
Restart=on-failure
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
sudo useradd -r -s /usr/sbin/nologin neurio
sudo mkdir -p /var/lib/neurio && sudo chown neurio:neurio /var/lib/neurio
sudo systemctl enable --now neurio
journalctl -u neurio -f
```

On Windows, `sc.exe create Neurio binPath= "C:\Program Files\nodejs\node.exe C:\neurio\dist-electron\server\index.cjs --host 0.0.0.0 --port 8790" start= auto`
does the same job, or use NSSM if you prefer a UI.

## 4. HTTPS and WSS with Caddy or nginx

The app speaks plain HTTP/WS fine on a LAN. On the public internet, terminate TLS in front of it —
the WebSocket upgrade has to be proxied too, and long timeouts matter for idle voice sockets.

**Caddy** (obtains and renews certificates automatically):

```caddyfile
chat.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:8790
}
```

Caddy handles the `Upgrade`/`Connection` headers and long-lived connections by itself.

**nginx**:

```nginx
server {
    listen 443 ssl http2;
    server_name chat.example.com;
    ssl_certificate     /etc/letsencrypt/live/chat.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/chat.example.com/privkey.pem;

    client_max_body_size 30m;              # uploads are capped at 25 MB by default

    location / {
        proxy_pass http://127.0.0.1:8790;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 3600s;          # keep voice/typing sockets alive
        proxy_send_timeout 3600s;
    }
}
```

Then start the server with `NEURIO_TRUST_PROXY=1` so rate limiting sees real client IPs, and point
everyone's server address at `https://chat.example.com`.

## 5. Attachments and the database

* `neurio.sqlite`, `neurio.sqlite-wal`, `neurio.sqlite-shm` — all the structured data.
* `uploads/<shard>/<id>` — one file per attachment, avatar or server icon.

Both live in `--data-dir`. To back up while running, either stop the service briefly, or use
SQLite's online backup (`sqlite3 neurio.sqlite ".backup '/backup/neurio-$(date +%F).sqlite'"`)
and copy `uploads/` afterwards (rsync is fine, files are immutable once written).

Orphaned uploads (a file uploaded but never sent, or a message deleted while the server was down)
are removed by the periodic sweep — 24 hours after they were created.

## 6. Updating

```bash
git pull
npm install
npm run verify                    # typecheck + build + 98 tests
npm run build                     # refresh dist/ and dist-electron/
sudo systemctl restart neurio
```

Migrations run automatically on start-up and are idempotent, so a newer server on an older
database just upgrades it. Downgrades are not supported — take the backup in §5 first.

## 7. Scaling and limits (be honest with your users)

* A single Node process handles hundreds of concurrent text users comfortably; SQLite in WAL mode
  handles the write load of a friends-and-family server without breaking a sweat.
* Voice/video is a **peer-to-peer mesh**: the server relays signalling only, so hosting is cheap,
  but every participant uploads one stream per other participant. The UI warns above 6 people in
  one channel. Large calls need an SFU (mediasoup/Janus) — not implemented here.
* Attachments are capped at 25 MB each and 10 per message by default. Change the cap with
  `maxUploadBytes` in `server/config.ts` if your reverse proxy allows it.
* Nothing is encrypted at rest beyond the operating system's own disk encryption. If that matters
  for your group, enable BitLocker/LUKS on the server, and put a TLS proxy in front for transport.

## 8. Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| Sign-in says "Cannot reach a Neurio server at …" | Wrong address, server not started, or a firewall. `curl http://host:8790/api/health` should return JSON. |
| Gateway shows "reconnecting…" | A proxy without WebSocket upgrade support, or a timeout that is too short (§4). |
| Uploads fail with 413 | Your reverse proxy's body limit is lower than the file. Raise `client_max_body_size`. |
| "Slowmode is on — wait Ns" | The channel has slowmode enabled; an admin can change it in Channel settings. |
| Voice connects but no audio | Add STUN/TURN — see [NETWORKING.md](NETWORKING.md#5-stun-and-turn-for-voicevideo). |
| Attachments disappear after a restart | The `--data-dir` changed between runs; point it back at the old folder. |
| Forgot the operator password | Nobody can reset it for you: edit the user row through `sqlite3` or re-seed a fresh data directory (this deletes data). |
