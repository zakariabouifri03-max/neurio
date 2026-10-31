# Fourthwall — light shop + 5 stars

## 1. L'mochkil f screenshot (custom code disabled)

Message `Custom code is disabled for your shop because it was flagged for verification`
**machi mochkil f code** — Fourthwall 3aṭla l'injection dyal HTML/JS f shop dyalek
ma7sus b verification. Ma ghadi ykheles ḥetta snippet s7i7 ḥit l'champ mgheled men
jihat l'platform.

- ṣift email l **support@fourthwall.com**
- 3ṭihom: URL dyal shop, w goul: *"Please review and re-enable custom code for my shop."*
- Melli yfteḥ l'champ, l'snippet li l'tḥt ghadi yekhdem nishan.

(La ma bghitich tsenna: l'partie B kayn fiha site kamel f fichier wa7ed, ma
muḥtaja ḥetta permission.)

## 2. 3lach ma nqderch nlaṣṣeq site kamel f dak l'champ

| Champ Fourthwall | Limite |
| --- | --- |
| Header code | 30,000 caractères |
| Footer code | 30,000 caractères |

Site kamel = **~128,000 caractères** (HTML + CSS + JS) + les images. W zid:
header/footer code kay-injecti CSS/JS/markup f page dyalhom, ma kaybeddelch
l'layout dyal shop. Donc kayn jouj ḥouloul.

---

## A) Tẓid l'look dyal Neurio 3la Fourthwall (snippets)

**Jouj fichiers** — wa7ed l Header code w wa7ed l Footer code:

| Champ | Fichier | Ḥajm | Ach kayzid |
| --- | --- | --- | --- |
| Header code | `snippets/fourthwall-header.html` | 6,177 | Barre fateḥa 5★ (perks + promo, tsedd) + background fateḥ |
| Footer code | `snippets/fourthwall-footer.html` | 10,184 | Band dyal reviews 5★ + badge flottant + AggregateRating |

(Optionnel: `snippets/fourthwall-trust-header.html` = kolchi f wa7ed champ, 8,639 caractères.)

Kayzid:

- **Barre fateḥa** f l'3ali: `★★★★★ 5.0` + perks + code promo, w tqder tsedha (katsjjel 24h f localStorage)
- **Badge flottant** `5.0 ★★★★★ · 3,200+ happy customers` (kay-3di l `#reviews`)
- **AggregateRating** structured data (SEO)
- Bla fonts externes, bla images, bla libraries — SVG inline, responsive, `prefers-reduced-motion`

**Kifach:**
1. Ḥell l'champ (melli support yfteḥo).
2. Kopi `fourthwall-header.html` kamel → paste f **Header code** → ✔ **Enable header code**.
3. Kopi `fourthwall-footer.html` kamel → paste f **Footer code** → ✔ **Enable footer code**.
4. **Save**, mn ba3d 3mel refresh w chouf l'pages (home, produit, checkout).
5. Beddel l'`CONFIG` f l'wel dyal kol script: `rating`, `reviews`, `promo`, `perks`, `quotes`, `badgeLink`, `schema`.

> ⚠️ `schema: true` kayb3at `ratingValue` l Google. Ila l'notes machi ḥaqiqiya,
> bedel l'reviews b l'ra9m l'ḥaqiqi wla dir `schema: false` — Google kay3aqeb
> structured data kadba.

**Beẓẓ l'look fateḥ f Fourthwall (bla CSS hacks):** Theme editor → colors:

| Token | Valeur |
| --- | --- |
| Background | `#f5f6fb` |
| Surface / cards | `#ffffff` |
| Text | `#0c1222` |
| Muted text | `#566073` |
| Accent / buttons | `#6a4cf5` |
| Accent 2 | `#0b8f6b` |
| Border radius | `16px` |

W f les réglages dyal product: fa3el **reviews** bach bano les étoiles 5/5 3la
kol produit (Fourthwall kayb3at ghir les avis ḥaqiqiyin).

---

## B) Hoster site kamel (fichier wa7ed)

Fichier: **`site/neurio-standalone.html`** — 287 KB, kolchi dakhel (CSS, JS, font, image).
Ma kayḥtajch ḥetta serveur wla build.

1. Ḥell [app.netlify.com/drop](https://app.netlify.com/drop) wla Vercel.
2. Jbed l'fichier `neurio-standalone.html` (drag & drop).
3. 3andek site ḥay b URL.
4. F l'site bdel `data-open-sell` / boutons d'achat bach y3diw l Fourthwall dyalek,
   wla khelli checkout dyal demo.

Ila bghit t3awed tbeni l'fichier melli tbedel chi ḥaja:

```bash
node site/tools/build-standalone.mjs
```

## 3. Fin ach kayn

| Fichier | Ach kaydir |
| --- | --- |
| `site/neurio-standalone.html` | Site kamel f fichier wa7ed (hosting) |
| `site/snippets/fourthwall-header.html` | Header code (< 30k) |
| `site/snippets/fourthwall-footer.html` | Footer code (< 30k) |
| `site/snippets/fourthwall-trust-header.html` | Version all-in-one (champ wa7ed) |
| `site/tools/build-standalone.mjs` | Build dyal l'fichier wa7ed |
| `site/index.html` + `assets/` | L'source (dev) |
