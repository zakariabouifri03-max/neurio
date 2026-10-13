# Online play: running a BlockStrike Royale dedicated server

Online matchmaking, online custom rooms and friend presence/invites need a **dedicated server that you host**.
Nothing in the game talks to the internet unless a server address is entered in **Settings > Online**.
LAN play (same Wi-Fi) and offline play vs bots work without any server.

## What the server does

* Runs the authoritative simulation for every room: movement (from player inputs), shooting, damage,
  loot, zone, rounds, results. Clients only send inputs and receive state - they cannot set their own
  position, health or ammo.
* Hosts many rooms at once (custom rooms with 6-letter codes + automatic quick-play rooms).
* Matchmaking queues per mode (ranked and unranked). A queue starts a match when it is full or after
  15 seconds - empty slots are filled with bots.
* Lag compensation (shots are checked against where targets were on the shooter's screen, up to 300 ms),
  client-side prediction with server reconciliation for the local player, 15 Hz snapshots, 30 Hz simulation.
* If a player disconnects mid-match a bot takes over their character so the match continues.

## Requirements

* Godot 4.7.2 Linux binary (editor build works headless: `Godot_v4.7.2-stable_linux.x86_64`).
  A dedicated-server export template also works.
* 1 vCPU / 512 MB RAM is enough for a few rooms. One 32-player BR room costs about 1 ms of CPU per
  30 Hz tick (measured in CI with 32 bots).
* One open **UDP** port (default 7777).

## Run it

```bash
cd blockstrike
godot --headless --path . -- --server --port=7777
```

You should see:

```
[server] BlockStrike Royale dedicated server v0.3.0 listening on UDP 7777
```

Open UDP 7777 in your firewall / router / cloud security group. Then on each phone:
**Settings > Online > Online server address** = your server's public IP or hostname, port 7777.
After that, **ONLINE + FIND MATCH**, **ROOMS > Online**, and friend presence work.

### systemd example

```ini
[Unit]
Description=BlockStrike Royale server
After=network.target

[Service]
WorkingDirectory=/opt/blockstrike
ExecStart=/opt/godot/godot --headless --path /opt/blockstrike -- --server --port=7777
Restart=always
User=blockstrike

[Install]
WantedBy=multi-user.target
```

## Protocol / versioning

* Transport: ENet over UDP (Godot `ENetMultiplayerPeer`), max 128 peers per server process.
* Clients and server must have the same `NET_PROTOCOL` (see `scripts/autoload/db.gd`); mismatching
  clients get a "Version mismatch" message.

## Honest limitations (not implemented)

* No accounts or cloud saves: profiles (level, coins, cosmetics, rank) are stored **on the phone**.
  A modified client could edit its own local profile - this never affects other players' matches,
  because match results are decided by the server, but the progression itself is not server-verified.
* No reconnect into a running match after a disconnect (a bot takes over instead).
* No NAT traversal / relay: the server needs a reachable public address.
* Friend lists are local; presence and invites only work for friends connected to the same server.
* Ranked RP is computed on the device from the server-reported result.
