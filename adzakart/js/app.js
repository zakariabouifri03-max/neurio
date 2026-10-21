/* ==========================================================================
   adzakART storefront
   Vanilla JS. Hash routing, live search, saved designs, Etsy checkout links.
   ========================================================================== */
(function () {
  "use strict";

  var CFG = window.ADZAK_CONFIG;
  var CATALOG = window.ADZAK_CATALOG;
  if (!CFG || !CATALOG) {
    console.error("adzakART: config or catalog failed to load.");
    return;
  }

  var DESIGNS = CATALOG.designs;
  var BY_ID = new Map(DESIGNS.map(function (d) { return [d.id, d]; }));
  var PRICE = "$" + (CFG.price % 1 === 0 ? CFG.price : CFG.price.toFixed(2));
  var TOTAL = DESIGNS.length;
  var STORE_KEY = "adzakart:saved:v1";

  var main = document.getElementById("main");
  var head = document.getElementById("siteHead");
  var searchOverlay = document.getElementById("searchOverlay");
  var searchInput = document.getElementById("searchInput");
  var searchClear = document.querySelector("[data-clear-search]");
  var searchResults = document.getElementById("searchResults");
  var searchMeta = document.getElementById("searchMeta");
  var searchChips = document.getElementById("searchChips");
  var drawer = document.getElementById("savedDrawer");
  var drawerScrim = document.getElementById("drawerScrim");
  var savedList = document.getElementById("savedList");
  var savedCount = document.getElementById("savedCount");
  var mobileMenu = document.getElementById("mobileMenu");
  var toastEl = document.getElementById("toast");

  var state = {
    saved: loadSaved(),
    shop: { cat: "all", sort: "newest", limit: 24 },
    search: "",
  };

  var toastTimer = null;
  var revealObserver = null;

  /* ------------------------------------------------------------------ */
  /* helpers                                                             */
  /* ------------------------------------------------------------------ */
  function esc(value) {
    return String(value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function norm(value) {
    return String(value)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function $$(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function loadSaved() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(list) ? list.filter(function (id) { return BY_ID.has(id); }) : []);
    } catch (err) {
      return new Set();
    }
  }

  function persistSaved() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(Array.from(state.saved)));
    } catch (err) {
      /* storage may be disabled — the session still works */
    }
  }

  var PLACEHOLDER =
    "data:image/svg+xml;charset=utf-8," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">' +
        '<rect width="400" height="300" fill="#efe8dc"/>' +
        '<g fill="none" stroke="#c9b9a2" stroke-width="1.2">' +
        '<circle cx="200" cy="150" r="19"/>' +
        '<path d="M200 131c0-26 8-43 8-43s12 20 12 43M200 169c0 26-8 43-8 43s-12-20-12-43M219 150c26 0 43 8 43 8s-20 12-43 12M181 150c-26 0-43-8-43-8s20-12 43-12"/>' +
        "</g></svg>"
    );

  function image(design, options) {
    options = options || {};
    var src = options.large ? design.imageLarge : design.imageCard;
    var alt = options.alt === undefined ? "" : options.alt;
    return (
      '<img src="' + esc(src) + '"' +
      (alt ? ' alt="' + esc(alt) + '"' : ' alt=""') +
      (options.eager ? "" : ' loading="lazy"') +
      ' decoding="async" referrerpolicy="no-referrer" data-img' +
      ' data-fallback="' + esc(design.image) + '">'
    );
  }

  function starString(n) {
    return "★★★★★".slice(0, n) + "☆☆☆☆☆".slice(0, 5 - n);
  }

  /* ------------------------------------------------------------------ */
  /* cards                                                               */
  /* ------------------------------------------------------------------ */
  function designCard(design, index) {
    var saved = state.saved.has(design.id);
    return (
      '<article class="card reveal" style="transition-delay:' + Math.min(index || 0, 8) * 32 + 'ms">' +
        '<a class="card-media" href="#/design/' + design.id + '" aria-label="View ' + esc(design.short) + '">' +
          image(design) +
          '<span class="price-pill">' + PRICE + "</span>" +
        "</a>" +
        '<button class="save-btn' + (saved ? " saved" : "") + '" type="button" data-save="' + design.id + '" aria-pressed="' + saved + '" aria-label="' + (saved ? "Remove from saved" : "Save this design") + '">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.3 4.6 13a4.9 4.9 0 0 1 7-7l.4.5.4-.4a4.9 4.9 0 0 1 7 7Z"/></svg>' +
        "</button>" +
        '<div class="card-body">' +
          '<p class="card-cat">' + esc(design.categoryLabel) + "</p>" +
          '<a class="card-title" href="#/design/' + design.id + '">' + esc(design.short) + "</a>" +
          '<div class="card-foot"><span class="card-tag">Transparent PNG</span><span aria-hidden="true">↗</span></div>' +
        "</div>" +
      "</article>"
    );
  }

  function designGrid(list) {
    return '<div class="grid-designs">' + list.map(designCard).join("") + "</div>";
  }

  function sectionHead(eyebrow, title, side) {
    return (
      '<div class="section-head reveal">' +
        "<div><p class=\"eyebrow\">" + eyebrow + "</p><h2>" + title + "</h2></div>" +
        '<div class="head-side">' + (side || "") + "</div>" +
      "</div>"
    );
  }

  /* ------------------------------------------------------------------ */
  /* home                                                                */
  /* ------------------------------------------------------------------ */
  var THEMES = ["Halloween", "Fall", "Thanksgiving", "Christmas", "Patriotic", "Mexico", "Western", "Sports", "Teacher", "Cowgirl", "Pets", "Everyday"];

  function heroArt() {
    var mainDesign = BY_ID.get(CFG.hero.main) || DESIGNS[0];
    var top = BY_ID.get(CFG.hero.top) || DESIGNS[1];
    var bottom = BY_ID.get(CFG.hero.bottom) || DESIGNS[2];
    return (
      '<div class="hero-art">' +
        '<span class="png-tag">Transparent PNG</span>' +
        '<figure class="hero-shot shot-top">' + image(top, { eager: true, alt: top.short + " design by adzakART" }) + "</figure>" +
        '<figure class="hero-shot shot-main">' + image(mainDesign, { eager: true, alt: mainDesign.short + " design by adzakART" }) + "</figure>" +
        '<figure class="hero-shot shot-bottom">' + image(bottom, { eager: true, alt: bottom.short + " design by adzakART" }) + "</figure>" +
        '<div class="price-sticker"><b>' + PRICE + "</b><small>every design</small></div>" +
        '<div class="spin-badge" aria-hidden="true">' +
          '<svg viewBox="0 0 120 120">' +
            '<defs><path id="badgeCircle" d="M60,60 m-43,0 a43,43 0 1,1 86,0 a43,43 0 1,1 -86,0"/></defs>' +
            '<text><textPath href="#badgeCircle">ONE PNG · NO BACKGROUND · INSTANT DOWNLOAD · </textPath></text>' +
          "</svg>" +
          '<svg class="petal" viewBox="0 0 40 40"><g fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="20" cy="20" r="4"/><path d="M20 16c0-5 1.6-8.5 1.6-8.5S24 11.5 24 16M20 24c0 5-1.6 8.5-1.6 8.5S16 28.5 16 24M24 20c5 0 8.5 1.6 8.5 1.6S28.5 24 24 24M16 20c-5 0-8.5-1.6-8.5-1.6S11.5 16 16 16"/></g></svg>' +
        "</div>" +
      "</div>"
    );
  }

  function tilesSection() {
    var tiles = CFG.tiles
      .map(function (tile) {
        var cat = CATALOG.categories.filter(function (c) { return c.id === tile.category; })[0];
        var design = BY_ID.get(tile.id);
        if (!cat || !design || !cat.count) return "";
        return (
          '<a class="tile reveal" href="#/shop/' + cat.id + '">' +
            image(design, { alt: "" }) +
            '<span class="tile-inner">' +
              '<span class="tile-kicker">' + cat.count + " designs</span>" +
              "<h3>" + esc(cat.label) + "</h3>" +
              "<p>" + esc(tile.line) + "</p>" +
            "</span>" +
            '<span class="tile-arrow" aria-hidden="true">→</span>' +
          "</a>"
        );
      })
      .join("");

    return (
      '<section class="section-tight">' +
        '<div class="wrap">' +
          sectionHead(
            "Shop by mood",
            "Find your <em>people</em>",
            '<p class="side-note">Ten little worlds. Pick the one that feels like you — or take the whole folder.</p>'
          ) +
          '<div class="tiles">' + tiles +
            '<a class="tile tile-all reveal" href="#/shop">' +
              '<span class="tile-inner"><span class="tile-kicker">The whole folder</span><h3>All ' + TOTAL + " designs</h3><p>Every ghost, goose and cowboy boot in one place.</p></span>" +
              '<span class="tile-arrow" aria-hidden="true">→</span>' +
            "</a>" +
          "</div>" +
        "</div>" +
      "</section>"
    );
  }

  function storySection() {
    var ids = ["4559706923", "4548734138", "4531113155"];
    var figures = ids
      .map(function (id) {
        var d = BY_ID.get(id);
        return d ? "<figure>" + image(d, { alt: d.short + " design" }) + "</figure>" : "";
      })
      .join("");
    return (
      '<section class="section">' +
        '<div class="wrap story-grid">' +
          '<div class="story-visual reveal"><div class="story-stack">' + figures +
            '<div class="story-seal"><b>' + TOTAL + "</b>original<br>designs</div>" +
          "</div></div>" +
          '<div class="story-copy reveal">' +
            '<p class="eyebrow">The studio</p>' +
            "<h2>Made by hand.<br><em>Priced for everyone.</em></h2>" +
            "<p>adzakART is a one-person studio in Sefrou, Morocco. I draw the kind of graphics I want to wear myself — a little spooky, a little preppy, always with a sense of humour — then cut them out cleanly so they are ready for your press, printer or cutting machine.</p>" +
            "<p>No agency, no middlemen, no $29 price tag. The shop stays small on purpose: one designer, one flat price, and every file checked by hand before it goes live.</p>" +
            '<div class="story-pills">' +
              '<span class="pill">Transparent background</span>' +
              '<span class="pill">300 DPI</span>' +
              '<span class="pill">Commercial use</span>' +
              '<span class="pill">Instant download</span>' +
            "</div>" +
            '<div class="signature"><span class="sig">Mohammed</span><span class="who">Founder &amp; designer<br>adzakART</span></div>' +
          "</div>" +
        "</div>" +
      "</section>"
    );
  }

  function statsSection() {
    return (
      '<section class="section-tight"><div class="wrap"><div class="stats reveal">' +
        '<div class="stat"><b>' + TOTAL + "</b><span>Original designs</span></div>" +
        '<div class="stat"><b>' + CATALOG.shop.sales + "</b><span>Sales on Etsy</span></div>" +
        '<div class="stat"><b>' + CATALOG.shop.rating + "★</b><span>Average rating</span></div>" +
        '<div class="stat"><b>' + PRICE + "</b><span>Every single design</span></div>" +
      "</div></div></section>"
    );
  }

  function stepsSection() {
    return (
      '<section class="section" id="how-it-works">' +
        '<div class="wrap">' +
          sectionHead("How it works", "From screen to <em>shirt</em>", '<a class="link-arrow" href="#/faq">More questions →</a>') +
          '<div class="steps">' +
            '<div class="step reveal"><span class="step-num">01</span><h3>Pick your design</h3><p>Browse all ' + TOTAL + " originals. Every one is " + PRICE + ", with the full artwork and the transparent background included.</p></div>" +
            '<div class="step reveal"><span class="step-num">02</span><h3>Check out securely</h3><p>Pay by card, PayPal, Apple Pay or Klarna through Etsy checkout. No account needed on this site.</p></div>' +
            '<div class="step reveal"><span class="step-num">03</span><h3>Download &amp; make</h3><p>Your PNG is ready immediately — in your Etsy purchases and your inbox. Drop it into Canva, Cricut or Photoshop and go.</p></div>' +
          "</div>" +
        "</div>" +
      "</section>"
    );
  }

  function reviewCards(list) {
    return list
      .map(function (r) {
        var design = r.designId ? BY_ID.get(r.designId) : null;
        return (
          '<article class="review reveal">' +
            '<div class="review-stars" aria-label="' + r.stars + ' out of 5 stars">' + starString(r.stars) + "</div>" +
            "<blockquote>“" + esc(r.quote) + "”</blockquote>" +
            (r.reply ? '<p class="review-reply">' + esc(r.reply) + "</p>" : "") +
            '<div class="review-who"><b>' + esc(r.name) + "</b><i></i><span>" + esc(r.date) + "</span></div>" +
            (design ? '<a class="review-link" href="#/design/' + design.id + '">See the design →</a>' : "") +
          "</article>"
        );
      })
      .join("");
  }

  function reviewsSection() {
    return (
      '<section class="section">' +
        '<div class="wrap">' +
          sectionHead(
            "Kind words",
            "Loved by <em>makers</em>",
            '<a class="link-arrow" href="https://www.etsy.com/shop/adzakART#reviews" target="_blank" rel="noopener">Read all reviews ↗</a>'
          ) +
          '<div class="reviews-grid">' + reviewCards(CFG.reviews.slice(0, 3)) + "</div>" +
          '<div class="reviews-foot">' +
            '<div class="rating-line"><b>' + CATALOG.shop.rating + "</b><span>average from " + CATALOG.shop.reviewCount + " reviews<br>" + CATALOG.shop.sales + " sales and counting</span></div>" +
            '<a class="link-arrow" href="https://www.etsy.com/shop/adzakART" target="_blank" rel="noopener">Visit the Etsy shop ↗</a>' +
          "</div>" +
        "</div>" +
      "</section>"
    );
  }

  function faqMarkup(items) {
    return items
      .map(function (item) {
        return (
          "<details class=\"faq-item\">" +
            "<summary>" + esc(item.q) + "</summary>" +
            '<div class="faq-a">' + item.a + "</div>" +
          "</details>"
        );
      })
      .join("");
  }

  function faqSectionHome() {
    return (
      '<section class="section">' +
        '<div class="wrap faq-grid">' +
          '<div class="faq-intro reveal">' +
            '<p class="eyebrow">Good to know</p>' +
            "<h2>Questions, <em>answered.</em></h2>" +
            "<p>Everything you might want to check before you buy a digital design. Still unsure? The studio replies to every message.</p>" +
            '<p style="margin-top:22px"><a class="link-arrow" href="#/faq">All questions →</a></p>' +
          "</div>" +
          '<div class="faq-list reveal">' + faqMarkup(CFG.faq.slice(0, 4)) + "</div>" +
        "</div>" +
      "</section>"
    );
  }

  function ctaBand() {
    return (
      '<section class="section-tight"><div class="wrap"><div class="cta-band reveal">' +
        "<div><h2>One design.<br><em>Two dollars.</em><br>Zero background.</h2>" +
        "<p>No subscription. No shipping. No fuss.</p></div>" +
        '<div class="cta-actions">' +
          '<a class="btn btn-light btn-large" href="#/shop">Shop the collection <span aria-hidden="true">→</span></a>' +
          '<a class="btn btn-ghost btn-large" style="border-color:rgba(255,243,234,.4);color:#fff3ea" href="' + esc(CFG.studio.messageUrl) + '" target="_blank" rel="noopener">Ask for a custom design ↗</a>' +
        "</div>" +
      "</div></div></section>"
    );
  }

  function homePage() {
    var newOnes = DESIGNS.slice(0, 8);
    var picks = CFG.staffPicks
      .map(function (id) { return BY_ID.get(id); })
      .filter(Boolean)
      .filter(function (d, i, arr) { return arr.indexOf(d) === i; })
      .slice(0, 8);

    return (
      '<section class="hero">' +
        '<div class="wrap hero-grid">' +
          '<div class="hero-copy">' +
            '<p class="eyebrow">Digital design studio · ' + esc(CFG.studio.place) + "</p>" +
            "<h1>Small designs.<br><em>Big personality.</em></h1>" +
            '<p class="hero-sub">Original PNG artwork for tees, totes, tumblers and the people who wear them. One transparent file, one honest price — <strong>' + PRICE + "</strong>.</p>" +
            '<div class="hero-actions">' +
              '<a class="btn btn-ink btn-large" href="#/shop">Shop all ' + TOTAL + ' designs <span aria-hidden="true">→</span></a>' +
              '<button class="btn btn-ghost btn-large" type="button" data-scroll-to="how-it-works">How it works</button>' +
            "</div>" +
            '<div class="hero-proof">' +
              '<span class="stars" aria-hidden="true">★ ' + CATALOG.shop.rating + "</span><span>from " + CATALOG.shop.reviewCount + " reviews</span><i></i>" +
              "<span>" + CATALOG.shop.sales + " sales on Etsy</span><i></i><span>Instant download</span>" +
            "</div>" +
          "</div>" +
          heroArt() +
        "</div>" +
      "</section>" +
      '<div class="band-wrap"><div class="band"><div class="band-track">' +
        '<span class="track-group">' + THEMES.map(function (t) { return "<span>" + t + "</span>"; }).join("") + "</span>" +
        '<span class="track-group">' + THEMES.map(function (t) { return "<span>" + t + "</span>"; }).join("") + "</span>" +
      "</div></div></div>" +
      '<section class="section">' +
        '<div class="wrap">' +
          sectionHead("Fresh off the desk", "New <em>this week</em>", '<a class="link-arrow" href="#/shop">All ' + TOTAL + " designs →</a>") +
          designGrid(newOnes) +
        "</div>" +
      "</section>" +
      tilesSection() +
      storySection() +
      statsSection() +
      stepsSection() +
      '<section class="section">' +
        '<div class="wrap">' +
          sectionHead("Hand-picked", "Studio <em>picks</em>", '<p class="side-note">The designs that start the most conversations — and the most t-shirts.</p>') +
          designGrid(picks) +
        "</div>" +
      "</section>" +
      reviewsSection() +
      faqSectionHome() +
      ctaBand()
    );
  }

  /* ------------------------------------------------------------------ */
  /* shop                                                                */
  /* ------------------------------------------------------------------ */
  function shopList() {
    var list = DESIGNS.slice();
    if (state.shop.cat !== "all") {
      list = list.filter(function (d) { return d.tags.indexOf(state.shop.cat) !== -1; });
    }
    if (state.shop.sort === "az") {
      list.sort(function (a, b) { return a.short.localeCompare(b.short); });
    } else if (state.shop.sort === "category") {
      list.sort(function (a, b) {
        return a.categoryLabel.localeCompare(b.categoryLabel) || a.index - b.index;
      });
    }
    return list;
  }

  function shopChips(active) {
    var chips = [
      '<a class="chip' + (active === "all" ? " active" : "") + '" href="#/shop">All <b>' + TOTAL + "</b></a>",
    ];
    CATALOG.categories.forEach(function (cat) {
      if (!cat.count) return;
      chips.push(
        '<a class="chip' + (active === cat.id ? " active" : "") + '" href="#/shop/' + cat.id + '">' +
          esc(cat.label) + " <b>" + cat.count + "</b></a>"
      );
    });
    return chips.join("");
  }

  function shopPage(categoryId) {
    var valid = categoryId === "all" || CATALOG.categories.some(function (c) { return c.id === categoryId && c.count; });
    state.shop.cat = valid ? categoryId : "all";
    state.shop.limit = 24;

    var cat = CATALOG.categories.filter(function (c) { return c.id === state.shop.cat; })[0];
    var title = state.shop.cat === "all" ? "Every design, <em>$2</em>" : esc(cat.label);
    var lead =
      state.shop.cat === "all"
        ? "The whole collection: " + TOTAL + " original designs, one transparent PNG each, one flat price. New work lands most weeks."
        : CFG.collectionCopy[state.shop.cat] || "Original designs, ready to download.";
    var list = shopList();
    var visible = list.slice(0, state.shop.limit);

    return (
      '<div class="wrap"><div class="page-intro">' +
        '<p class="eyebrow">The collection</p>' +
        "<h1>" + title + "</h1>" +
        '<div class="page-intro-row"><p class="lead">' + esc(lead) + '</p><p class="count-note" id="shopCount">' + list.length + " designs · instant download</p></div>" +
      "</div></div>" +
      '<div class="shop-tools"><div class="wrap tools-inner">' +
        '<div class="chips">' + shopChips(state.shop.cat) + "</div>" +
        '<div class="tool-right">' +
          '<button class="shop-search-btn" type="button" data-open-search><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4.5 4.5"/></svg><span>Search</span></button>' +
          '<label class="select-wrap"><span class="sr-only">Sort designs</span>' +
            '<select id="sortSelect" aria-label="Sort designs">' +
              '<option value="newest"' + (state.shop.sort === "newest" ? " selected" : "") + ">Newest first</option>" +
              '<option value="az"' + (state.shop.sort === "az" ? " selected" : "") + ">A – Z</option>" +
              '<option value="category"' + (state.shop.sort === "category" ? " selected" : "") + ">By collection</option>" +
            "</select></label>" +
        "</div>" +
      "</div></div>" +
      '<div class="wrap">' +
        '<div class="grid-designs" id="shopGrid">' + visible.map(designCard).join("") + "</div>" +
        '<div class="load-wrap" id="loadWrap">' + loadMarkup(list, visible.length) + "</div>" +
      "</div>"
    );
  }

  function loadMarkup(list, shown) {
    if (!list.length) {
      return '<div class="empty"><p class="big">Nothing here yet.</p><p>This collection is still being drawn. Try another mood.</p><a class="btn btn-ghost" href="#/shop">See all designs</a></div>';
    }
    if (shown >= list.length) {
      return '<p class="load-note">You have seen all ' + list.length + " designs in this collection.</p>";
    }
    var next = Math.min(24, list.length - shown);
    return (
      '<button class="btn btn-ghost btn-large" type="button" data-load-more>Load ' + next + " more designs</button>" +
      '<p class="load-note">Showing ' + shown + " of " + list.length + " · every design " + PRICE + "</p>"
    );
  }

  function renderShopGrid() {
    var grid = document.getElementById("shopGrid");
    var loadWrap = document.getElementById("loadWrap");
    var count = document.getElementById("shopCount");
    if (!grid || !loadWrap) return;
    var list = shopList();
    var visible = list.slice(0, state.shop.limit);
    grid.innerHTML = visible.map(designCard).join("");
    loadWrap.innerHTML = loadMarkup(list, visible.length);
    if (count) count.textContent = list.length + " designs · instant download";
    markLoadedImages();
    initObserver();
  }

  /* ------------------------------------------------------------------ */
  /* product                                                             */
  /* ------------------------------------------------------------------ */
  function relatedDesigns(design) {
    var scored = DESIGNS
      .filter(function (d) { return d.id !== design.id; })
      .map(function (d) {
        var score = 0;
        if (d.category === design.category) score += 4;
        design.tags.forEach(function (t) { if (d.tags.indexOf(t) !== -1) score += 2; });
        return { design: d, score: score };
      })
      .filter(function (item) { return item.score > 0; })
      .sort(function (a, b) { return b.score - a.score || a.design.index - b.design.index; });

    var picks = scored.slice(0, 4).map(function (item) { return item.design; });
    if (picks.length < 4) {
      DESIGNS.forEach(function (d) {
        if (picks.length < 4 && d.id !== design.id && picks.indexOf(d) === -1) picks.push(d);
      });
    }
    return picks;
  }

  function productPage(id) {
    var d = BY_ID.get(id);
    if (!d) return notFoundPage();
    var related = relatedDesigns(d);
    var saved = state.saved.has(d.id);
    var isBundle = /bundle|bundlle/i.test(d.title);
    var specs = CFG.specs.map(function (spec, i) {
      if (i === 0 && isBundle) return { label: spec.label, value: "PNG bundle" };
      return spec;
    });

    return (
      '<div class="wrap">' +
        '<nav class="crumbs" aria-label="Breadcrumb">' +
          '<a href="#/">Home</a><span class="sep">/</span>' +
          '<a href="#/shop">Shop</a><span class="sep">/</span>' +
          '<a href="#/shop/' + d.category + '">' + esc(d.categoryLabel) + "</a><span class=\"sep\">/</span>" +
          "<span>" + esc(d.short) + "</span>" +
        "</nav>" +
        '<div class="product-grid">' +
          '<div class="product-media-col">' +
            '<div class="product-media">' +
              image(d, { large: true, eager: true, alt: d.short + " — transparent PNG design by adzakART" }) +
              '<span class="media-tag">Transparent PNG</span>' +
              '<span class="media-index">' + PRICE + " · instant download</span>" +
            "</div>" +
            '<p class="media-caption">Flat preview · your download arrives with a transparent background</p>' +
          "</div>" +
          '<div class="product-copy">' +
            '<p class="card-cat"><a href="#/shop/' + d.category + '">' + esc(d.categoryLabel) + "</a></p>" +
            "<h1>" + esc(d.short) + "</h1>" +
            '<p class="product-full-title">' + esc(d.title) + "</p>" +
            '<div class="price-row"><span class="price">' + PRICE + " <small>USD</small></span><span class=\"price-note\">One flat price<br>no subscription</span></div>" +
            '<div class="buy-actions">' +
              '<a class="btn btn-ink btn-large btn-full" href="' + esc(d.etsy) + '" target="_blank" rel="noopener" data-buy="' + d.id + '">Get this design — ' + PRICE + ' <span aria-hidden="true">↗</span></a>' +
              '<p class="buy-note"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg> Secure checkout &amp; instant download on Etsy</p>' +
            "</div>" +
            '<div class="secondary-actions">' +
              '<button class="ghost-pill' + (saved ? " saved" : "") + '" type="button" data-save="' + d.id + '" aria-pressed="' + saved + '">' +
                '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.3 4.6 13a4.9 4.9 0 0 1 7-7l.4.5.4-.4a4.9 4.9 0 0 1 7 7Z"/></svg>' +
                '<span class="save-label">' + (saved ? "Saved" : "Save") + "</span>" +
              "</button>" +
              '<button class="ghost-pill" type="button" data-share="' + d.id + '">' +
                '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 13v6h14v-6"/></svg> Share' +
              "</button>" +
              '<a class="ghost-pill" href="' + esc(d.etsy) + '" target="_blank" rel="noopener">Etsy listing ↗</a>' +
            "</div>" +
            '<dl class="spec-grid">' +
              specs.map(function (s) {
                return '<div class="spec"><dt>' + esc(s.label) + "</dt><dd>" + esc(s.value) + "</dd></div>";
              }).join("") +
            "</dl>" +
            '<div class="product-acc">' +
              '<details class="faq-item" open><summary>What&rsquo;s in your download</summary><div class="faq-a">' +
                (isBundle
                  ? "<p>Every design in this bundle, delivered as high-resolution PNGs with clean transparent backgrounds. No watermark, no white box, no mockups to crop.</p>"
                  : "<p>One high-resolution PNG of this exact design, cut out with a clean transparent background. No watermark, no white box, no extra files to dig through.</p>") +
                "<ul><li>" + (isBundle ? "PNG bundle" : "PNG") + " with alpha transparency</li><li>High-resolution files, 300 DPI</li><li>Ready for sublimation, DTF and print-on-demand</li><li>Instant download after checkout</li></ul>" +
              "</div></details>" +
              '<details class="faq-item"><summary>How to use it</summary><div class="faq-a">' +
                "<p>Open the PNG in Canva, Cricut Design Space, Silhouette Studio, Photoshop, Procreate or your printing software. Scale it up or down without losing the clean edges, then print, press or cut.</p>" +
              "</div></details>" +
              '<details class="faq-item"><summary>License</summary><div class="faq-a">' +
                "<p>" + esc(CFG.license.summary) + ". Print it on physical products you make and sell. You may not resell or share the file itself. <a href=\"#/license\">Read the full license</a>.</p>" +
              "</div></details>" +
              '<details class="faq-item"><summary>Delivery &amp; refunds</summary><div class="faq-a">' +
                "<p>Your files are delivered instantly by Etsy after payment — no shipping, no waiting. Because digital downloads cannot be returned, all sales are final; if anything is wrong with your file, <a href=\"" + esc(CFG.studio.messageUrl) + "\" target=\"_blank\" rel=\"noopener\">message the studio</a> and we will fix it quickly.</p>" +
              "</div></details>" +
            "</div>" +
            '<div class="product-share"><span>Design #' + (d.index + 1) + " of " + TOTAL + "</span><span>Made in " + esc(CFG.studio.place) + "</span></div>" +
          "</div>" +
        "</div>" +
      "</div>" +
      '<section class="related-section"><div class="wrap">' +
        sectionHead("Keep looking", "You might also <em>like</em>", '<a class="link-arrow" href="#/shop/' + d.category + '">More ' + esc(d.categoryLabel.toLowerCase()) + " →</a>") +
        designGrid(related) +
      "</div></section>" +
      '<div class="buybar" id="buybar">' +
        '<span class="buybar-thumb">' + image(d) + "</span>" +
        '<span class="buybar-info"><b>' + esc(d.short) + "</b><span>" + PRICE + " · transparent PNG</span></span>" +
        '<a class="btn btn-ink" href="' + esc(d.etsy) + '" target="_blank" rel="noopener">Buy ' + PRICE + "</a>" +
      "</div>"
    );
  }

  /* ------------------------------------------------------------------ */
  /* about / faq / license / 404                                         */
  /* ------------------------------------------------------------------ */
  function aboutPage() {
    var a = BY_ID.get("4558355282");
    var b = BY_ID.get("4592914998");
    return (
      '<div class="wrap"><section class="about-hero">' +
        "<div>" +
          '<p class="eyebrow">The studio</p>' +
          "<h1>A small studio with a <em>big folder</em> of ideas.</h1>" +
          "<p>adzakART is the work of one designer in Sefrou, Morocco. It started with a folder of drawings, a Cricut and a stubborn belief that good design should not cost a week of groceries.</p>" +
          "<p>Today the shop holds " + TOTAL + " original designs and has sent " + CATALOG.shop.sales + " files to makers around the world. Every design is still drawn, checked and packed by the same pair of hands.</p>" +
        "</div>" +
        '<div class="about-art reveal">' +
          (a ? "<figure>" + image(a, { alt: a.short }) + "</figure>" : "") +
          (b ? "<figure>" + image(b, { alt: b.short }) + "</figure>" : "") +
        "</div>" +
      "</section></div>" +
      statsSection() +
      '<section class="section"><div class="wrap">' +
        sectionHead("What we believe", "Three simple <em>rules</em>", "") +
        '<div class="values">' +
          '<article class="value reveal"><span class="num">01</span><h3>One designer</h3><p>No stock library, no outsourced pack. The ideas come from the same sketchbook — which is why the shop feels like one shop.</p></article>' +
          '<article class="value reveal"><span class="num">02</span><h3>One honest price</h3><p>' + PRICE + " for every design, every day. No fake countdowns, no tiers, no subscription to forget about.</p></article>" +
          '<article class="value reveal"><span class="num">03</span><h3>One clean file</h3><p>A transparent PNG that behaves the way it should: crisp edges, no background, ready to press the moment it lands.</p></article>' +
        "</div>" +
      "</div></section>" +
      '<section class="section"><div class="wrap">' +
        sectionHead("Kind words", "What buyers <em>say</em>", '<a class="link-arrow" href="https://www.etsy.com/shop/adzakART#reviews" target="_blank" rel="noopener">All reviews on Etsy ↗</a>') +
        '<div class="reviews-grid">' + reviewCards(CFG.reviews) + "</div>" +
      "</div></section>" +
      ctaBand()
    );
  }

  function faqPage() {
    return (
      '<div class="wrap"><div class="page-intro">' +
        '<p class="eyebrow">Help &amp; info</p>' +
        "<h1>Everything you <em>need to know.</em></h1>" +
        '<p class="lead">Short answers about files, backgrounds, licenses and delivery. If your question is not here, the studio is one message away.</p>' +
      "</div></div>" +
      '<div class="wrap" style="max-width:920px">' +
        '<div class="faq-list">' + faqMarkup(CFG.faq) + "</div>" +
      "</div>" +
      '<div class="section-tight"><div class="wrap"><div class="cta-band">' +
        "<div><h2>Still <em>curious?</em></h2><p>Custom work, sizing questions, or a design you cannot find — just ask.</p></div>" +
        '<div class="cta-actions"><a class="btn btn-light btn-large" href="' + esc(CFG.studio.messageUrl) + '" target="_blank" rel="noopener">Message the studio ↗</a></div>' +
      "</div></div></div>"
    );
  }

  function licensePage() {
    return (
      '<div class="wrap"><div class="page-intro">' +
        '<p class="eyebrow">The fine print, in plain English</p>' +
        "<h1>Buy it once. <em>Make good things.</em></h1>" +
        '<p class="lead">Every adzakART purchase comes with a personal and small-business commercial license. Here is exactly what that means.</p>' +
      "</div>" +
      '<div class="license-grid">' +
        '<section class="license-card"><h2><span class="tick">✓</span> You can</h2><ul>' +
          CFG.license.allowed.map(function (item) { return "<li>" + esc(item) + "</li>"; }).join("") +
        "</ul></section>" +
        '<section class="license-card no"><h2><span class="tick">✕</span> You cannot</h2><ul>' +
          CFG.license.notAllowed.map(function (item) { return "<li>" + esc(item) + "</li>"; }).join("") +
        "</ul></section>" +
      "</div>" +
      '<p class="license-note">This license applies to purchases made through the adzakART Etsy shop and this storefront. It is granted to the buyer and is not transferable. If you need an extended or wholesale license, <a href="' + esc(CFG.studio.messageUrl) + '" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:underline">get in touch</a>. adzakART retains copyright of all artwork.</p>' +
      "</div>" +
      ctaBand()
    );
  }

  function notFoundPage() {
    return (
      '<div class="wrap"><div class="notfound">' +
        '<div class="code">404</div>' +
        "<h1 style=\"font-family:var(--serif);font-weight:300;font-size:clamp(32px,4vw,48px);letter-spacing:-.03em\">This design wandered off.</h1>" +
        '<p class="muted" style="margin:12px 0 26px">The link may be old, or the design moved to a new home.</p>' +
        '<a class="btn btn-ink btn-large" href="#/shop">Browse all ' + TOTAL + ' designs <span aria-hidden="true">→</span></a>' +
      "</div></div>"
    );
  }

  /* ------------------------------------------------------------------ */
  /* overlays                                                            */
  /* ------------------------------------------------------------------ */
  function lockBody(lock) {
    document.body.classList.toggle("locked", lock);
  }

  function openSearch() {
    closeSaved();
    closeMenu();
    renderSearch();
    searchOverlay.classList.add("open");
    searchOverlay.setAttribute("aria-hidden", "false");
    lockBody(true);
    window.setTimeout(function () { searchInput.focus(); }, 80);
  }

  function closeSearch() {
    searchOverlay.classList.remove("open");
    searchOverlay.setAttribute("aria-hidden", "true");
    lockBody(false);
    searchInput.value = "";
    if (searchClear) searchClear.hidden = true;
    state.search = "";
  }

  function renderSearchChips() {
    searchChips.innerHTML = ["ghost", "cowboy", "goose", "teacher", "mexico", "christmas", "coquette", "leopard"]
      .map(function (term) { return '<button class="search-chip" type="button" data-search-term="' + term + '">' + term + "</button>"; })
      .join("");
  }

  function renderSearch() {
    var q = state.search.trim();
    var list;
    if (!q) {
      list = DESIGNS.slice(0, 8);
      searchMeta.textContent = "Popular right now — the newest arrivals from the studio.";
    } else {
      var words = norm(q).split(/\s+/).filter(Boolean);
      list = DESIGNS.filter(function (d) {
        var hay = norm(d.title + " " + d.short + " " + d.categoryLabel + " " + d.tagLabels.join(" "));
        return words.every(function (w) { return hay.indexOf(w) !== -1; });
      });
      searchMeta.textContent = list.length + " design" + (list.length === 1 ? "" : "s") + " for “" + q + "”";
    }
    searchResults.innerHTML = list.length
      ? list.slice(0, 24).map(designCard).join("")
      : '<div class="search-empty"><b>No designs found.</b><p>Try a broader word — “ghost”, “cow”, “teacher” — or browse the full collection.</p><a class="btn btn-ghost" href="#/shop" data-close-search>See all ' + TOTAL + " designs</a></div>";
    initObserver();
  }

  function openSaved() {
    closeSearch();
    closeMenu();
    renderSaved();
    drawerScrim.hidden = false;
    window.requestAnimationFrame(function () {
      drawerScrim.classList.add("show");
      drawer.classList.add("open");
    });
    drawer.setAttribute("aria-hidden", "false");
    lockBody(true);
  }

  function closeSaved() {
    if (!drawer.classList.contains("open")) return;
    drawer.classList.remove("open");
    drawerScrim.classList.remove("show");
    drawer.setAttribute("aria-hidden", "true");
    window.setTimeout(function () { drawerScrim.hidden = true; }, 320);
    lockBody(false);
  }

  function renderSaved() {
    var ids = Array.from(state.saved).reverse();
    if (!ids.length) {
      savedList.innerHTML =
        '<div class="drawer-empty">' +
          '<svg class="mark" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.2" d="M12 20.3 4.6 13a4.9 4.9 0 0 1 7-7l.4.5.4-.4a4.9 4.9 0 0 1 7 7Z"/></svg>' +
          "<h3>Nothing saved yet</h3><p>Tap the heart on any design to keep it here while you decide.</p>" +
        "</div>";
      return;
    }
    savedList.innerHTML = ids
      .map(function (id) {
        var d = BY_ID.get(id);
        return (
          '<div class="saved-item">' +
            '<a class="saved-thumb" href="#/design/' + d.id + '" data-close-saved aria-label="Open ' + esc(d.short) + '">' + image(d) + "</a>" +
            "<div><a href=\"#/design/" + d.id + "\" data-close-saved><h3>" + esc(d.short) + "</h3></a><p>" + esc(d.categoryLabel) + " · " + PRICE + "</p></div>" +
            '<button class="saved-remove" type="button" data-remove="' + d.id + '" aria-label="Remove ' + esc(d.short) + ' from saved"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5l14 14M19 5 5 19"/></svg></button>' +
          "</div>"
        );
      })
      .join("");
  }

  function updateSavedCount() {
    var n = state.saved.size;
    savedCount.textContent = n;
    savedCount.hidden = n === 0;
    var trigger = document.querySelector("[data-open-saved]");
    if (trigger) {
      trigger.setAttribute("aria-label", n ? "Saved designs, " + n + " saved" : "Saved designs");
    }
  }

  function syncSaveButtons() {
    $$("[data-save]").forEach(function (btn) {
      var id = btn.getAttribute("data-save");
      var saved = state.saved.has(id);
      btn.classList.toggle("saved", saved);
      btn.setAttribute("aria-pressed", String(saved));
      var label = btn.querySelector(".save-label");
      if (label) label.textContent = saved ? "Saved" : "Save";
      if (btn.classList.contains("save-btn")) {
        btn.setAttribute("aria-label", saved ? "Remove from saved" : "Save this design");
      }
    });
    updateSavedCount();
  }

  function toggleSaved(id) {
    if (!BY_ID.has(id)) return;
    if (state.saved.has(id)) {
      state.saved.delete(id);
      showToast("Removed from saved designs");
    } else {
      state.saved.add(id);
      showToast("Saved — find it in your collection");
    }
    persistSaved();
    syncSaveButtons();
    if (drawer.classList.contains("open")) renderSaved();
  }

  function openMenu() {
    mobileMenu.classList.add("open");
    mobileMenu.setAttribute("aria-hidden", "false");
    var burger = document.querySelector("[data-open-menu]");
    if (burger) burger.setAttribute("aria-expanded", "true");
    lockBody(true);
  }

  function closeMenu() {
    mobileMenu.classList.remove("open");
    mobileMenu.setAttribute("aria-hidden", "true");
    var burger = document.querySelector("[data-open-menu]");
    if (burger) burger.setAttribute("aria-expanded", "false");
    if (!searchOverlay.classList.contains("open") && !drawer.classList.contains("open")) lockBody(false);
  }

  function showToast(message) {
    toastEl.textContent = message;
    toastEl.classList.add("show");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () { toastEl.classList.remove("show"); }, 2400);
  }

  function shareDesign(id) {
    var d = BY_ID.get(id);
    if (!d) return;
    var url = window.location.origin + window.location.pathname + "#/design/" + id;
    var data = { title: d.short + " — adzakART", text: "Original PNG design — " + PRICE + " at adzakART", url: url };
    if (navigator.share) {
      navigator.share(data).catch(function () {});
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(
        function () { showToast("Link copied to clipboard"); },
        function () { showToast("Copy this link: " + url); }
      );
    } else {
      showToast("Copy this link: " + url);
    }
  }

  /* ------------------------------------------------------------------ */
  /* routing                                                             */
  /* ------------------------------------------------------------------ */
  function routeParts() {
    var raw = window.location.hash.replace(/^#\/?/, "");
    return raw.split("?")[0].split("/").filter(Boolean);
  }

  function setMeta(title, description, imageUrl) {
    document.title = title;
    var desc = document.querySelector('meta[name="description"]');
    if (desc) desc.setAttribute("content", description);
    var ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) ogTitle.setAttribute("content", title);
    var ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogDesc) ogDesc.setAttribute("content", description);
    if (imageUrl) {
      var ogImage = document.querySelector('meta[property="og:image"]');
      if (ogImage) ogImage.setAttribute("content", imageUrl);
    }
  }

  function setProductSchema(design) {
    var existing = document.getElementById("product-schema");
    if (existing) existing.remove();
    if (!design) return;
    var script = document.createElement("script");
    script.type = "application/ld+json";
    script.id = "product-schema";
    script.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Product",
      name: design.title,
      image: [design.imageLarge, design.image],
      description: design.short + " — an original adzakART PNG design with a transparent background, delivered instantly.",
      brand: { "@type": "Brand", name: "adzakART" },
      offers: {
        "@type": "Offer",
        url: design.etsy,
        priceCurrency: "USD",
        price: CFG.price.toFixed(2),
        availability: "https://schema.org/InStock",
      },
    });
    document.head.appendChild(script);
  }

  function render() {
    var parts = routeParts();
    var route = parts[0] || "home";
    var html;
    var meta;

    document.body.classList.toggle("product-route", route === "design");

    if (route === "home") {
      html = homePage();
      meta = {
        title: "adzakART — Original PNG Designs, $2 Each · Transparent Background",
        desc: "139 original digital designs for t-shirts, tumblers, totes and gifts. Every design is $2, delivered instantly as a high-resolution PNG with a transparent background.",
        image: null,
      };
    } else if (route === "shop") {
      html = shopPage(parts[1] || "all");
      var cat = CATALOG.categories.filter(function (c) { return c.id === state.shop.cat; })[0];
      meta = {
        title: (state.shop.cat === "all" ? "All " + TOTAL + " designs" : cat.label + " PNG designs") + " — adzakART",
        desc: state.shop.cat === "all"
          ? "Browse all " + TOTAL + " original adzakART PNG designs. Every design is $2 with a transparent background and instant download."
          : CFG.collectionCopy[state.shop.cat] || "Original transparent PNG designs, $2 each.",
        image: null,
      };
    } else if (route === "design") {
      var design = BY_ID.get(parts[1]);
      if (!design) {
        html = notFoundPage();
        meta = { title: "Design not found — adzakART", desc: "This design could not be found." };
      } else {
        html = productPage(design.id);
        meta = {
          title: (/(^|\s)PNG(\s|$)/i.test(design.short) ? design.short : design.short + " PNG") + " — $2 | adzakART",
          desc: (/(^|\s)PNG(\s|$)/i.test(design.short) ? design.short : design.short + " PNG") + " — original transparent design by adzakART. High-resolution, instant download, $2. " + design.title,
          image: design.imageLarge,
        };
      }
    } else if (route === "about") {
      html = aboutPage();
      meta = { title: "The studio — adzakART", desc: "adzakART is a one-person design studio in Sefrou, Morocco, making original transparent PNG artwork for makers and small businesses." };
    } else if (route === "faq") {
      html = faqPage();
      meta = { title: "FAQ — adzakART", desc: "Answers about adzakART files, transparent backgrounds, licenses, delivery and refunds." };
    } else if (route === "license") {
      html = licensePage();
      meta = { title: "License — adzakART", desc: "The plain-English commercial use license for adzakART digital designs." };
    } else {
      html = notFoundPage();
      meta = { title: "Page not found — adzakART", desc: "The page you were looking for does not exist." };
    }

    main.innerHTML = html;
    main.classList.remove("page-in");
    void main.offsetWidth;
    main.classList.add("page-in");
    markLoadedImages();

    window.scrollTo(0, 0);
    setMeta(meta.title, meta.desc, meta.image);
    setProductSchema(route === "design" ? BY_ID.get(parts[1]) : null);
    syncSaveButtons();
    initObserver();
    updateActiveNav(route, parts[1]);
    closeSearch();
    closeSaved();
    closeMenu();
    onScroll();
  }

  function updateActiveNav(route, sub) {
    $$(".head-nav a").forEach(function (link) {
      var href = link.getAttribute("href");
      var target = route === "shop"
      ? (state.shop.cat === "all" ? "#/shop" : "#/shop/" + state.shop.cat)
      : "#/" + route;
      link.classList.toggle("is-active", href === target);
      if (href === target) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  }

  /* ------------------------------------------------------------------ */
  /* observers + events                                                  */
  /* ------------------------------------------------------------------ */
  function markLoadedImages() {
    $$("img[data-img]").forEach(function (img) {
      if (img.complete && img.naturalWidth) img.classList.add("loaded");
    });
  }

  function initObserver() {
    if (!("IntersectionObserver" in window)) {
      $$(".reveal").forEach(function (el) { el.classList.add("in"); });
      return;
    }
    if (!revealObserver) {
      revealObserver = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) {
              entry.target.classList.add("in");
              revealObserver.unobserve(entry.target);
            }
          });
        },
        { rootMargin: "0px 0px -6% 0px", threshold: 0.05 }
      );
    }
    $$(".reveal:not(.in)").forEach(function (el) { revealObserver.observe(el); });
  }

  function onScroll() {
    if (head) head.classList.toggle("scrolled", window.scrollY > 8);
    var buybar = document.getElementById("buybar");
    if (buybar) buybar.classList.toggle("show", window.scrollY > 420);
  }

  function onClick(event) {
    if (event.target.closest("[data-clear-search]")) {
      clearSearchInput();
      return;
    }
    var target = event.target;

    if (target.closest(".skip-link")) {
      event.preventDefault();
      main.focus();
      return;
    }

    var saveBtn = target.closest("[data-save]");
    if (saveBtn) {
      event.preventDefault();
      toggleSaved(saveBtn.getAttribute("data-save"));
      return;
    }

    var removeBtn = target.closest("[data-remove]");
    if (removeBtn) {
      event.preventDefault();
      toggleSaved(removeBtn.getAttribute("data-remove"));
      return;
    }

    var shareBtn = target.closest("[data-share]");
    if (shareBtn) {
      event.preventDefault();
      shareDesign(shareBtn.getAttribute("data-share"));
      return;
    }

    if (target.closest("[data-open-search]")) { event.preventDefault(); openSearch(); return; }
    if (target.closest("[data-close-search]")) { event.preventDefault(); closeSearch(); return; }
    if (target.closest("[data-open-saved]")) { event.preventDefault(); openSaved(); return; }
    if (target.closest("[data-close-saved]")) { closeSaved(); return; }
    if (target.closest("[data-open-menu]")) { event.preventDefault(); openMenu(); return; }
    if (target.closest("[data-close-menu]")) { event.preventDefault(); closeMenu(); return; }

    var scrollBtn = target.closest("[data-scroll-to]");
    if (scrollBtn) {
      event.preventDefault();
      var el = document.getElementById(scrollBtn.getAttribute("data-scroll-to"));
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    var term = target.closest("[data-search-term]");
    if (term) {
      event.preventDefault();
      state.search = term.getAttribute("data-search-term");
      searchInput.value = state.search;
      if (searchClear) searchClear.hidden = false;
      renderSearch();
      searchInput.focus();
      return;
    }

    if (target.closest("[data-load-more]")) {
      event.preventDefault();
      state.shop.limit += 24;
      renderShopGrid();
      return;
    }

    var navLink = target.closest("a[href^='#/']");
    if (navLink) {
      closeSearch();
      closeSaved();
      closeMenu();
    }
  }

  function onInput(event) {
    if (event.target === searchInput) {
      state.search = searchInput.value;
      if (searchClear) searchClear.hidden = state.search.length === 0;
      renderSearch();
    }
  }

  function clearSearchInput() {
    state.search = "";
    searchInput.value = "";
    if (searchClear) searchClear.hidden = true;
    if (searchClear) searchClear.hidden = true;
    renderSearch();
    searchInput.focus();
  }

  function onChange(event) {
    if (event.target && event.target.id === "sortSelect") {
      state.shop.sort = event.target.value;
      state.shop.limit = 24;
      renderShopGrid();
    }
  }

  function onKey(event) {
    if (event.key === "Escape") {
      if (searchOverlay.classList.contains("open")) closeSearch();
      else if (drawer.classList.contains("open")) closeSaved();
      else if (mobileMenu.classList.contains("open")) closeMenu();
      return;
    }
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (event.key === "/" && !typing && !searchOverlay.classList.contains("open")) {
      event.preventDefault();
      openSearch();
    }
  }

  document.addEventListener("click", onClick);
  document.addEventListener("input", onInput);
  document.addEventListener("change", onChange);
  document.addEventListener("keydown", onKey);
  window.addEventListener("hashchange", render);
  window.addEventListener("scroll", onScroll, { passive: true });

  document.addEventListener("load", function (event) {
    var img = event.target;
    if (img instanceof HTMLImageElement && img.hasAttribute("data-img")) img.classList.add("loaded");
  }, true);

  document.addEventListener("error", function (event) {
    var img = event.target;
    if (!(img instanceof HTMLImageElement) || !img.hasAttribute("data-img")) return;
    var fallback = img.getAttribute("data-fallback");
    if (fallback && img.src !== fallback) {
      img.src = fallback;
      return;
    }
    img.removeAttribute("data-fallback");
    img.src = PLACEHOLDER;
    img.classList.add("loaded");
  }, true);

  /* ------------------------------------------------------------------ */
  /* boot                                                                */
  /* ------------------------------------------------------------------ */
  if (document.getElementById("year")) document.getElementById("year").textContent = new Date().getFullYear();
  searchInput.placeholder = "Search " + TOTAL + " designs — ghosts, cowboys, geese…";
  renderSearchChips();
  updateSavedCount();
  render();
})();
