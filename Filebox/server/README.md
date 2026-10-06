# Filebox backup server

Serveur WebDAV sghir, **bla dependencies** — ghir Node 18+.

```bash
node server.mjs --port 8200 --dir ./backups --user zakaria --pass s3cr3t
```

F l-app: **Settings → Backup → URL** = `http://<ip-dyal-l-machine>:8200`

## Options

| flag | default | chnu kaydir |
|---|---|---|
| `--port` | `8200` | port |
| `--host` | `0.0.0.0` | interface |
| `--dir` | `./backups` | wine kaytsajlo l-coffres |
| `--user` | `filebox` | utilisateur (Basic auth) |
| `--pass` | `filebox` | mot de passe |
| `--max-mb` | `4096` | limite dyal fichier wa7ed |

## Methods

`PROPFIND` · `MKCOL` · `PUT` · `GET` · `OPTIONS` — kolhom b HTTP Basic auth.

Ma kayn ta `DELETE` 3amd: l-serveur dyal backup makaymsahch.

## Aman

- Path traversal mblouki: `PUT /../../etc/evil` kaytkteb f `<dir>/etc/evil`,
  machi f `/etc/evil`.
- **Ila bghiti tkhdmo mn bra dyal LAN, dir reverse proxy b TLS.** Basic auth
  bla HTTPS katsift l-mot de passe clair.

## Wla khdm serveur WebDAV akhor

L-app katkhdm m3a ay WebDAV:

- **Nextcloud** → `https://cloud.dyalek/remote.php/dav/files/<user>/`
- **Freebox** → `http://mafreebox.freebox.fr/` (WebDAV f parametres)
- **Synology / QNAP** → WebDAV Server package
- **nginx** → `dav_methods PUT DELETE MKCOL COPY MOVE;`
