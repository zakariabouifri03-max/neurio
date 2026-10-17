# MONKEY CO. — Ultra Professional T-Shirt Store

An ultra-professional, fun & colorful e-commerce store for monkey t-shirts — built for the browser with Three.js, no build step, no external APIs. Inspired by your Rabona wobbly style but now as a premium streetwear brand.

**Live Preview:** Port 8000 → `RABONA ULTRA — Wobbly Football` (now Monkey Co.)

## Features — Ultra Professional

**Brand & Design**
- Fun & colorful monkey cartoon style like Rabona, but premium
- 8 unique monkey characters: Banana Bandit 🍌, Skate 🛹, DJ 🎧, Astro 🚀, Ninja 🥷, Chef 👨‍🍳, Gamer 🎮, Surf 🏄
- Each monkey hand-drawn on canvas (eyes with iris/pupil highlight, accessories)
- Glassmorphism header (sticky blur), dark theme (#0f0f0f), accent yellow #ffe066 + pink + blue
- Barlow Condensed + DM Sans + Plex Mono fonts, all local

**Hero — 3D**
- Live 3D t-shirt rotating (Three.js, PBR, ACESFilmic, shadows)
- Drag to rotate, auto spin, fabric texture + monkey canvas combined
- Badges: LIVE 3D, NEW DROP, stats (8 designs, 4.8★, 50k sold)

**Shop — E-commerce**
- Product grid (8 tees), each with:
  - 2D t-shirt preview canvas (generated)
  - Badges: NEW, BESTSELLER, SALE % off
  - Price + original + rating + reviews
  - Hover actions: quick view + add to cart
- Filters: ALL, NEW, BESTSELLER, BANANA, SKATE, DJ + search
- Product modal:
  - 3D t-shirt viewer (drag to rotate, same PBR as hero)
  - Color selector (8 base colors, visual dots, active outline)
  - Size selector (XS-XXL, disabled if not available)
  - Quantity with +/- 
  - Stock + free shipping note
  - Add to cart

**Cart & Checkout — Everything**
- Cart sidebar (slide-in animation, backdrop blur)
- Items with 2D preview, color/size, qty +/- , remove, subtotal
- Subtotal + free shipping over $50 + 30-day returns
- Checkout modal:
  - Email, name, address, city, ZIP, card (demo)
  - Order summary with subtotal, shipping $8, total
  - Fake payment, but ultra professional UI
- Success modal with order ID (MNK-...), total, ETA 2-3 days, continue shopping

**Ultra Professional Details**
- Canvas-generated textures: fabric noise, monkey faces, t-shirt shape, badges
- PBR materials: roughness, metalness, clearcoat, sheen
- Shadows: PCFSoft, 1024 map, contact shadows
- Particles? No, clean e-commerce
- Animations: hover lift, slide-in cart, toast, loading track
- Responsive: 1280 → 390 mobile, no horizontal overflow, touch friendly
- Persistence: `monkey-store-cart-v1` + `monkey-store-orders-v1` in localStorage
- Toast notifications
- PWA: `monkey-v1` caches 14 assets, network-first, offline reload works

**Previous Games Preserved**
- `src/rabona/` — Rabona wobbly football ultra (high-poly players, 4096 shadows, dust, trail)
- `src/royale/` — Outrun battle royale
- Not loaded, but in repo history

## How to Run

```bash
npm start
# 0.0.0.0:8000, safe static server (blocks dotfiles, node_modules)
# Open http://localhost:8000
# ?test=1 skips SW
```

## Architecture

- `index.html`: header, hero with canvas, product grid, modals (product, cart, checkout, success), footer
- `src/monkey-store/style.css`: ultra professional e-commerce styling, responsive, animations
- `src/monkey-store/rules.js`: MONKEY_TYPES (8), BASE_COLORS (8), SIZES (6), PRODUCTS (8), createMonkeyCanvas (512px cartoon monkey with accessories), seeded RNG, formatPrice
- `src/monkey-store/models.js`: createTShirtModel (extruded shape + sleeves + neck + shadow, PBR), applyMonkeyTexture (combines base color + monkey canvas + fabric noise + tag)
- `src/monkey-store/store.js`: MonkeyStore class — cart CRUD, total/count, detailed items, checkout with order ID, localStorage
- `src/monkey-store/main.js`: Three.js hero + modal scenes (ambient + directional + fill lights, ACESFilmic, shadows, drag rotate), renderProducts, modals, cart, checkout, search, filters, toast, boot
- `vendor/three.module.js`: Three r170
- `assets/fonts/`: local WOFF2
- `tools/serve.mjs`: safe static server
- `sw.js`: monkey-v1, 14 assets
- `manifest.webmanifest`: PWA

## Tests

```bash
npm test              # 7 unit tests: product validity, colors/sizes, formatPrice, RNG, canvas fn, cart ops, checkout
npm run test:browser  # real WebGL: lobby, product grid, modal open, 3D canvas, color/size select, add to cart, qty, checkout, order success, cart cleared, mobile layout, offline reload, zero errors
```

Browser tests use bundled Chromium via @sparticuz/chromium.

## Limitations

- Demo store, no real payment backend — UI is ultra professional but checkout is fake
- No real backend, no user accounts
- 3D t-shirt is procedural, not Marvelous Designer quality, but PBR and high-poly
- Images are canvas-generated, not photoshoots — keeps it 100% local and offline

## Credits

Original code, textures, 3D models, store logic. Fonts OFL. Three.js MIT. Inspired by Rabona fun style, now as Monkey Co. streetwear.
