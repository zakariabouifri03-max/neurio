# Playing the ROADFALL browser preview

The browser preview is a local WebGL build. It is not opened by double-clicking the file because browsers restrict JavaScript modules loaded from `file://` URLs.

From the repository root, run:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000/web/roadfall.html
```

The preview includes its own local `three.module.js`, so after downloading the repository ZIP it does not need a CDN or internet connection.

In Arena, use the **Live Preview** card for the running server instead of typing `localhost` into a different browser/device. A phone cannot access the computer's `localhost`; use the network URL from the machine running the server or deploy the folder to a static host.
