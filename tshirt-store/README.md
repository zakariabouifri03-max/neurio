# 🖤 INKWEAR — Vol. 01

A complete, self-contained digital-product store for a **9-design t-shirt art pack**.
One HTML file + a folder of real image files. No build step, no framework, no database.

> **Page:** `tshirt-store/index.html`
> **Direct download (GitHub):**
> `https://raw.githubusercontent.com/zakariabouifri03-max/neurio/arena/b0a2e0ba-neurio/tshirt-store/index.html`
> (for a working copy that includes the images, clone/download the repo folder — see *Hosting*)

---

## What's in the box

| | |
|---|---|
| **Landing page** | hero on a real t-shirt photo, 9-design collection, what's inside, 3-step flow, on-tee gallery, pricing, FAQ, final CTA |
| **Checkout** | every buy button opens your PayPal link in a new tab, then a “pending payment” bar follows the buyer back |
| **Delivery page** (`#files` → “I've paid — open my files”) | order number + date, **9 artwork PNGs**, **9 tee mockups**, and a **one-click ZIP** (artwork + mockups + licence + print guide) |
| **Artwork** | 9 original illustrations — Lion, Wolf, Eagle, Tiger, Bear, Skull, Snake, Gorilla, Panther |
| **Files** | `assets/art/*.png` = 3000 × 3000 px, 300 DPI, truecolor RGBA with real transparency · `assets/mock/*.png` = photo-real mockups on a black tee · `assets/thumbs/*.webp` = 600 px web thumbnails |
| **English only**, no cookies, no analytics, no external JS |

The ZIP is built **in the browser** (a small hand-written ZIP writer), so the buyer gets one file
without any server work.

---

## ⚙️ Configure (one block, top of `index.html`)

```js
const CONFIG = {
  paypalUrl:    'https://www.paypal.com/ncp/payment/ETCSHU9TFAYEE',
  price:        '$19',
  supportEmail: '',   // 'hello@inkwear.studio' → shows contact links
  whatsapp:     '',   // '212612345678'
  instagram:    ''    // 'inkwear.studio'
};
```

Also worth editing: the `DESIGNS` array just below it (name, tag and description of each design —
the cards, the modal and the delivery list all read from it).

> ⚠️ Keep the price on the page in sync with the amount configured in the PayPal payment link.
> If PayPal charges in another currency, write that currency on the page.

---

## 🔓 How the files unlock

Buy → PayPal opens in a new tab → the buyer returns and clicks **“I've paid — open my files”** →
the delivery page opens. The unlock is remembered in `localStorage`, so it survives a refresh.

This is a **buyer-trust gate**: a static HTML page cannot ask PayPal whether a payment succeeded,
so someone determined could open the files without paying. It never blocks a real buyer, and for a
launch page it is the standard no-backend trade-off.

**If you want hard verification**, keep this page as the shop window and move delivery behind:

1. **Payhip / Gumroad / Lemon Squeezy** — upload the same ZIP, they host it, send receipts, handle
   VAT/refunds and deliver automatically. Point `CONFIG.paypalUrl` at the product page.
2. **PayPal + serverless function** — the redirect carries a `txn_id`; verify it against the PayPal
   API in a Netlify/Vercel function and only then return the file (~40 lines).
3. **PayPal webhook + email delivery**.

---

## 🚀 Hosting

* **Any static host** (Netlify, Vercel, Cloudflare Pages, cPanel…): upload the whole `tshirt-store`
  folder — `index.html` **and** `assets/`.
* **GitHub Pages:** Settings → Pages → deploy from `hooome` → folder `/tshirt-store`.
* **Local test:** `python3 -m http.server -d tshirt-store 8000` → <http://localhost:8000>
  (a local server is required for the ZIP button, because browsers block `fetch` on `file://`).

---

## 🧪 Verified

Headless run of the real page (jsdom + real files over HTTP) — **27/27 checks pass**, zero console errors:

* 9 cards render with real thumbnails; hero uses the real mockup; English-only/LTR.
* Design modal opens with the mockup, the artwork thumbnail switches the view.
* Buy → pending bar → “I've paid” → delivery page → 9 file rows.
* Single artwork / mockup download targets and filenames are correct.
* Every artwork is a valid **3000 × 3000**, **truecolor RGBA (colorType 6)** PNG with alpha = 0 corners.
* ZIP: **42.6 MB, 20 entries**, `unzip -t` clean.

---

## ⚖️ Notes

* **Artwork:** generated with an AI image model and then processed (background cut out, squared,
  upscaled to 3000 px, exported as lossless RGBA PNG). Check your platform's policy on
  AI-generated artwork before reselling — most marketplaces accept it, some ask you to disclose it.
* **Typeface:** Anton (SIL Open Font License 1.1) is embedded as base64 so headings and the favicon
  look identical offline. Body text uses Space Grotesk from Google Fonts (falls back to system fonts offline).
* **Tee photo:** `assets/tee-black.webp` is the flat black-tee image supplied by the shop owner and is
  used to build the mockups in `assets/mock/`.
