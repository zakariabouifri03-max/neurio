# 🛍️ T-SHIRT A–Z — digital product store

A complete, self-contained sales page for a **26-design t-shirt bundle (A–Z)**.
One HTML file, no build step, no dependencies, works offline.

> **Live page:** `tshirt-store/index.html` → open it directly or host it anywhere.
> **Direct download link (GitHub):**
> `https://raw.githubusercontent.com/zakariabouifri03-max/neurio/arena/b0a2e0ba-neurio/tshirt-store/index.html`

---

## ✨ What's inside

| | |
|---|---|
| **Landing page** | hero mockup, 26-design gallery, what's-included, 3-step explainer, print-on-tee gallery, pricing, FAQ, final CTA |
| **Checkout** | buy buttons open your PayPal link → returning visitors get a “I've paid — open my files” step |
| **Delivery page** (`#files`) | order number + date, version switcher (white tee / black tee), **26 individual PNG downloads**, **one-click ZIP** (26 PNGs + license + print guide), print guide |
| **Artwork** | 6 generative design families × 26 letters, drawn on `<canvas>` and exported as real **3000 × 3600 px PNG, 300 DPI, transparent background** |
| **Languages** | AR (default, RTL) · FR · EN — switches everything, including the page direction |
| **Persistence** | language, chosen version and unlock state are kept in `localStorage` |

The artwork is generated **in the buyer's browser**, so the file is tiny and the exports are genuinely
crisp — not upscaled previews.

---

## ⚙️ Configure it (one block, top of the file)

Search for `const CONFIG` in `index.html`:

```js
const CONFIG = {
  paypalUrl:    'https://www.paypal.com/ncp/payment/ETCSHU9TFAYEE', // ← your PayPal link
  price:        { ar: '149 درهم', fr: '149 DH', en: '149 DH' },     // ← shown everywhere
  supportEmail: '',   // 'hello@yourshop.com' → shows contact blocks
  whatsapp:     '',   // '212612345678'
  instagram:    ''    // 'your.shop'
};
```

* `price` is a `{PRICE}` token used by every language string — change it once.
* ⚠️ **Keep the price here in sync with the amount configured in your PayPal payment link.**
  If PayPal charges in another currency (USD/EUR), write that currency on the page too so the
  buyer is never surprised.
* `EXPORT_PX` (just below) controls the exported file size — 3000 × 3600 @ 300 DPI is the
  standard 10" × 12" print area.

---

## 🔓 How the delivery page unlocks

After clicking **Buy**, the PayPal page opens in a new tab and a yellow “pending payment”
bar appears. When the buyer comes back they click **«خلّصت — فتح الملفات» / “I've paid — open my files”**
and the delivery page opens instantly.

This is a **buyer-trust gate**, not a payment verification: a static HTML page cannot ask PayPal
whether a payment succeeded, so a determined visitor could open the files without paying.
For a launch/portfolio page that's usually an acceptable trade-off, and it never blocks a real buyer.

**If you want hard verification**, keep this page as-is and move the delivery behind one of these:

1. **Payhip / Gumroad / Lemon Squeezy** — upload the ZIP, they host the file, handle receipts,
   VAT, refunds and auto-delivery. Replace `CONFIG.paypalUrl` with the product URL.
2. **PayPal + a serverless function** — PayPal redirects back with a `txn_id`; the function asks the
   PayPal API if it is paid, then returns the file (Netlify/Vercel function, ~40 lines).
3. **PayPal webhook + email** — the paid delivery is emailed; this page stays as the “sales page”.

Everything needed for (1) is already produced by the ZIP button.

---

## 🚀 Hosting

* **Any static host:** drag `index.html` into Netlify / Vercel / Cloudflare Pages — done.
* **GitHub Pages:** Settings → Pages → deploy from a branch → folder `/tshirt-store`.
* **Locally:** `python3 -m http.server` in this folder, then open `index.html`.
* The file also works when opened directly from disk (`file://`); only the web fonts need internet.

---

## 🧾 Files the buyer gets

```
TSHIRT-AZ_pack_white-tee.zip
├── TSHIRT-AZ_A_white-tee_300dpi.png   … 26 files
├── LICENSE.txt                        (commercial license, non-exclusive)
└── PRINT-GUIDE.txt                    (size, file rules, DTG/DTF, washing)
```

* `white-tee` files = dark ink → for white / light shirts
* `black-tee` files = light cream ink → for black / dark shirts
* Background is genuinely transparent (holes in the letters stay holes — no white box)

---

## 🧪 Verified

* 26 designs render in both versions and export as valid 3000 × 3600 PNGs (≈300 KB each).
* The ZIP is a valid archive (8 MB, `unzip -t` clean) with 26 PNGs + license + guide.
* Flow tested headlessly: boot → gallery → design modal → version switch → pay gate →
  unlock → single PNG → ZIP → AR/FR/EN switch → routing, with zero JS errors.

---

## ⚖️ Licensing notes

* **Typeface:** [Anton](https://fonts.google.com/specimen/Anton) by Vernon Adams, **SIL Open Font
  License 1.1** — embedded (base64) so the artwork looks identical on every device. UI text uses
  Noto Kufi Arabic / Space Grotesk / IBM Plex Sans Arabic from Google Fonts.
* **Artwork:** generated by this page's own code — you own the output.
* No cookies, no analytics, no third-party scripts other than the font stylesheet.
