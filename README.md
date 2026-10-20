# Sunday Supply Co. — Weekend Club digital T-shirt pack

A US-focused storefront for **The Weekend Club**, a digital download containing four original T-shirt graphics. The store is in `index.html`; the post-checkout delivery page is `success.html`.

## Product files

`downloads/sunday-supply-weekend-club.zip` contains:
- 4 transparent PNGs at 3000 × 3600 px (10 × 12 in at 300 DPI)
- 4 matching editable SVG vector files
- A README and small-business print license (up to 500 physical products per design)

There is no physical garment in this product. The PayPal page displays the final price before payment.

## Local preview

```bash
python3 -m http.server 8000 --bind 0.0.0.0
```

Open `http://localhost:8000/` for the storefront. `http://localhost:8000/success.html` is the delivery page.

## PayPal and deployment

1. Host the site on HTTPS.
2. In the PayPal payment link settings, set the successful-payment return/Auto Return URL to `https://your-domain.com/success.html` (replace with the deployed domain), if this PayPal link type supports a return URL. Verify the setting using a completed test payment before launch.
3. Confirm that the PayPal link's item name and amount match **The Weekend Club — digital T-shirt design pack** (the site does not invent a price). The checkout button uses the supplied PayPal URL: `https://www.paypal.com/ncp/payment/ETCSHU9TFAYEE`.

**Fulfillment limitation:** the site is static. It cannot verify the payment or protect the download; anyone who knows the delivery URL can open it. For secure delivery, use a backend that verifies PayPal payment capture/webhooks and issues a private, expiring download URL. This limitation is disclosed on the storefront and delivery page.

## Rebuild the artwork bundle

Requires Node.js and the dependencies in `package.json`:

```bash
npm install
npm run build:shirt-pack
```

The PNGs are rendered from the source SVGs in `downloads/weekend-club/`, then bundled into the ZIP.

## Repository note

The repository also contains an older, separate browser racing-game project (`game.html` and its source files). It is **not** the product being sold by this storefront.
