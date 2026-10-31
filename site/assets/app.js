/* =========================================================
   Neurio storefront — vanilla JS
   ========================================================= */
(() => {
  "use strict";

  /* ---------------------------------------------------------
     Data
     --------------------------------------------------------- */
  const PRODUCTS = [
    {
      id: "nova-dashboard",
      title: "Nova — SaaS Dashboard Kit",
      by: "Lumen Studio", cat: "UI Kits", glyph: "i-layout",
      price: 48, old: 68, rating: 5.0, reviews: 412, sold: 1284,
      tone: "violet", tags: ["Bestseller"], banner: "Figma",
      desc: "A complete SaaS analytics interface with 96 components, 18 ready screens and dark/light themes wired to Figma variables. Built for teams that need to go from wireframe to shipped in days.",
      includes: ["96 components + 18 screens", "Figma variables & token library", "Light and dark themes", "Dev handoff guide (PDF)"],
      formats: ["Figma", "Variables", "Auto layout"]
    },
    {
      id: "orbit-marketing",
      title: "Orbit — Marketing Site Templates",
      by: "Foundry 52", cat: "Templates", glyph: "i-grid",
      price: 39, old: null, rating: 5.0, reviews: 187, sold: 642,
      tone: "cyan", tags: [], banner: "Framer",
      desc: "Twelve conversion-focused marketing pages — pricing, changelog, docs, careers and more. Responsive down to 320px, with real copy structure you can replace in minutes.",
      includes: ["12 responsive page templates", "Framer + Webflow versions", "CMS collections pre-wired", "Copy structure guide"],
      formats: ["Framer", "Webflow", "Responsive"]
    },
    {
      id: "design-systems",
      title: "Design Systems Masterclass",
      by: "Maya Jensen", cat: "Courses", glyph: "i-play",
      price: 129, old: 199, rating: 5.0, reviews: 96, sold: 377,
      tone: "indigo", tags: ["Bestseller"], banner: "8h video",
      desc: "Eight hours of build-along lessons on tokens, component APIs, documentation and governance — taught from real work, not slides. Includes the exact audit spreadsheets used with clients.",
      includes: ["8 hours of video lessons", "Token audit spreadsheets", "Component API checklist", "Private community access"],
      formats: ["Video", "PDF workbook", "Notion"]
    },
    {
      id: "pricing-playbook",
      title: "The Pricing Playbook",
      by: "Sofia Rossi", cat: "E-books", glyph: "i-book",
      price: 24, old: null, rating: 5.0, reviews: 233, sold: 1902,
      tone: "amber", tags: [], banner: "PDF",
      desc: "A 142-page field guide to pricing digital products: value metrics, packaging, anchoring and the six experiments worth running before you raise your prices.",
      includes: ["142-page PDF + EPUB", "12 pricing teardowns", "Experiment tracker (Notion)", "Lifetime updates"],
      formats: ["PDF", "EPUB", "Notion"],
      discountNote: true
    },
    {
      id: "ops-os",
      title: "Ops OS — Notion Command Centre",
      by: "Northwind", cat: "Notion", glyph: "i-note",
      price: 29, old: null, rating: 5.0, reviews: 611, sold: 3187,
      tone: "lime", tags: ["Bestseller"], banner: "Notion",
      desc: "Run projects, clients and finances in one Notion workspace. Tasks roll up automatically, invoices are tracked per client, and the weekly review fills itself in.",
      includes: ["Projects, clients & finance hubs", "Auto-rollup dashboards", "12 automations incl. recurring tasks", "30-minute setup walkthrough"],
      formats: ["Notion", "Automations", "Video"]
    },
    {
      id: "lumen-luts",
      title: "Lumen — Film LUTs & Presets",
      by: "Kite Studio", cat: "Presets", glyph: "i-sliders",
      price: 18, old: null, rating: 5.0, reviews: 84, sold: 421,
      tone: "rose", tags: [], banner: "18 LUTs",
      desc: "Eighteen cinematic LUTs built on real film stock scans, plus matching Lightroom presets. Skin tones stay intact across daylight, tungsten and mixed light.",
      includes: ["18 LUTs (.cube)", "24 Lightroom presets", "Camera-specific tuning notes", "Before/after gallery"],
      formats: ["LUTs", "Lightroom", "Capture One"]
    },
    {
      id: "glyph-forge",
      title: "Glyph Forge — 900 Icons",
      by: "Orbital", cat: "Icons", glyph: "i-shapes",
      price: 22, old: null, rating: 5.0, reviews: 141, sold: 738,
      tone: "slate", tags: [], banner: "SVG",
      desc: "Nine hundred pixel-aligned icons in three weights, delivered as SVG, an icon font and a Figma library with a synced naming convention.",
      includes: ["900 icons, 3 weights", "SVG + icon font + Figma library", "Synced naming convention", "Free updates"],
      formats: ["SVG", "Figma", "Icon font"]
    },
    {
      id: "banking-kit",
      title: "Vault — Mobile Banking UI Kit",
      by: "Amine Kabbaj", cat: "UI Kits", glyph: "i-layout",
      price: 56, old: null, rating: 5.0, reviews: 118, sold: 289,
      tone: "teal", tags: ["New"], banner: "Figma",
      desc: "Forty mobile screens for fintech products: onboarding, cards, transfers, budgets and insights. Every state documented, every number a real variable.",
      includes: ["40 screens, 5 flows", "Documented empty & error states", "Component variants for accessibility", "Prototype included"],
      formats: ["Figma", "Prototype", "iOS + Android"]
    },
    {
      id: "sprint-os",
      title: "Sprint OS — Solo Team Workflow",
      by: "Northwind", cat: "Notion", glyph: "i-note",
      price: 19, old: null, rating: 5.0, reviews: 302, sold: 1544,
      tone: "violet", tags: [], banner: "Notion",
      desc: "A lightweight weekly operating system for people who work alone but need the clarity of a team: one board, one inbox, one review ritual.",
      includes: ["Weekly board + backlog", "Meeting & decision log", "Quarterly planning template", "5 automations"],
      formats: ["Notion", "Automations"]
    },
    {
      id: "portfolio-kit",
      title: "Frame — Portfolio Kit",
      by: "Kite Studio", cat: "Templates", glyph: "i-grid",
      price: 34, old: null, rating: 5.0, reviews: 76, sold: 214,
      tone: "rose", tags: ["New"], banner: "Framer",
      desc: "A quiet, editorial portfolio for designers who would rather show the work than talk about it. Case study layout, CMS-driven archive and a fast, accessible build.",
      includes: ["6 page templates", "CMS archive & filters", "Lighthouse 99 build", "Loom walkthrough"],
      formats: ["Framer", "CMS", "Responsive"]
    },
    {
      id: "ship-it",
      title: "Ship It — Solo Founder Course",
      by: "Daniel Okafor", cat: "Courses", glyph: "i-play",
      price: 99, old: null, rating: 5.0, reviews: 63, sold: 188,
      tone: "amber", tags: [], banner: "6h video",
      desc: "From idea to first paying customer in six weeks, with the unglamorous parts included: pricing conversations, churn, support, and saying no.",
      includes: ["6 hours of lessons", "Launch checklist & templates", "Teardown of 9 launches", "Office hours replay library"],
      formats: ["Video", "Templates", "Notion"]
    },
    {
      id: "cinematic-vol2",
      title: "Cinematic Presets Vol. 2",
      by: "Lumen Studio", cat: "Presets", glyph: "i-sliders",
      price: 26, old: null, rating: 5.0, reviews: 57, sold: 176,
      tone: "indigo", tags: ["New"], banner: "Lightroom",
      desc: "Twenty-two muted, film-inspired presets for editorial and travel work, with grain recipes and a calibration guide for Sony, Canon and Fuji sensors.",
      includes: ["22 desktop & mobile presets", "Grain & texture recipes", "Sensor calibration guide", "Raw sample files"],
      formats: ["Lightroom", "ACR", "Mobile"]
    },
    {
      id: "analytics-kit",
      title: "Pulse — Analytics UI Kit",
      by: "Lumen Studio", cat: "UI Kits", glyph: "i-layout",
      price: 64, old: null, rating: 5.0, reviews: 204, sold: 867,
      tone: "lime", tags: [], banner: "Figma",
      desc: "Charts, filters and dense data tables that stay readable at 12px. Includes a chart component set and a tokens file that maps straight to CSS variables.",
      includes: ["28 screens + 9 chart types", "Dense table system", "Tokens → CSS variable mapping", "Accessibility annotations"],
      formats: ["Figma", "Tokens", "CSS"]
    },
    {
      id: "cold-email",
      title: "The Cold Email Compendium",
      by: "Sofia Rossi", cat: "E-books", glyph: "i-book",
      price: 19, old: null, rating: 5.0, reviews: 158, sold: 1103,
      tone: "cyan", tags: [], banner: "PDF",
      desc: "Ninety-four tested email structures, with the psychology behind each and the exact edits that took reply rates from 2% to 11% for a design studio.",
      includes: ["94 email structures", "12 annotated rewrites", "Follow-up sequences", "Deliverability checklist"],
      formats: ["PDF", "Docs", "Notion"]
    },
    {
      id: "line-icons",
      title: "1,200 Line Icons",
      by: "Orbital", cat: "Icons", glyph: "i-shapes",
      price: 16, old: 29, rating: 5.0, reviews: 340, sold: 2411,
      tone: "violet", tags: ["Sale"], banner: "SVG",
      desc: "The icon set we use on every client project — 1,200 line icons on a 24px grid, with an optimized SVG pipeline that keeps each file under 1KB.",
      includes: ["1,200 icons, 24px grid", "Optimized SVG + sprite sheet", "Figma component library", "MIT-style commercial licence"],
      formats: ["SVG", "Figma", "Sprite"]
    },
    {
      id: "studio-os",
      title: "Studio OS for Creatives",
      by: "Maya Jensen", cat: "Notion", glyph: "i-note",
      price: 39, old: null, rating: 5.0, reviews: 189, sold: 903,
      tone: "cyan", tags: [], banner: "Notion",
      desc: "The full studio back office: proposals, project intake, time tracking, invoices and a profitability view that tells you which clients to stop taking.",
      includes: ["Proposal & contract templates", "Time tracking + invoicing", "Client profitability dashboard", "Video setup guide"],
      formats: ["Notion", "Docs", "Video"]
    },
    {
      id: "pricing-pages",
      title: "Pricing Page Library",
      by: "Foundry 52", cat: "Templates", glyph: "i-grid",
      price: 28, old: null, rating: 5.0, reviews: 92, sold: 331,
      tone: "teal", tags: [], banner: "HTML",
      desc: "Fourteen pricing page layouts with toggles, comparison tables and FAQ blocks — shipped as clean HTML/CSS and as Figma frames.",
      includes: ["14 layouts", "Comparison tables & FAQ blocks", "HTML/CSS + Figma", "Copy examples"],
      formats: ["HTML", "CSS", "Figma"]
    },
    {
      id: "color-type",
      title: "Color & Type Bootcamp",
      by: "Kite Studio", cat: "Courses", glyph: "i-play",
      price: 79, old: null, rating: 5.0, reviews: 71, sold: 245,
      tone: "rose", tags: [], banner: "4h video",
      desc: "Four hours of practical exercises on contrast, rhythm and scale — the two skills that quietly decide whether a layout reads as professional.",
      includes: ["4 hours of lessons", "14 design exercises", "Critique library", "Certificate"],
      formats: ["Video", "Exercises", "Figma"]
    }
  ];

  const PAGE_SIZE = 9;
  const money = (n) => "$" + n.toFixed(2);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const state = {
    filter: "all",
    query: "",
    sort: "popular",
    page: 1,
    wishOnly: false
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  /* ---------------------------------------------------------
     Storage helpers
     --------------------------------------------------------- */
  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
    }
  };

  const cart = new Map(store.get("neurio.cart", []).map((it) => [it.id, it.qty]));
  let wishlist = new Set(store.get("neurio.wish", []));
  let promo = null;

  const P = (id) => PRODUCTS.find((p) => p.id === id);
  const cartCount = () => [...cart.values()].reduce((a, b) => a + b, 0);
  const cartItems = () => [...cart.entries()].map(([id, qty]) => ({ ...P(id), qty })).filter((p) => p.id);

  const persist = () => {
    store.set("neurio.cart", [...cart.entries()].map(([id, qty]) => ({ id, qty })));
    store.set("neurio.wish", [...wishlist]);
  };

  /* ---------------------------------------------------------
     Toasts
     --------------------------------------------------------- */
  const toast = (message, icon = "i-check") => {
    const wrap = $("#toasts");
    const el = document.createElement("div");
    el.className = "toast";
    el.innerHTML = `<svg class="ico" aria-hidden="true"><use href="#${icon}"/></svg><span>${esc(message)}</span>`;
    wrap.appendChild(el);
    setTimeout(() => {
      el.classList.add("toast--out");
      el.addEventListener("animationend", () => el.remove(), { once: true });
    }, 2600);
  };

  /* ---------------------------------------------------------
     Product card markup
     --------------------------------------------------------- */
  const coverMarkup = (p, extraClass = "") =>
    `<div class="cover cover--${p.tone} ${extraClass}"><svg class="cover__glyph" aria-hidden="true"><use href="#${p.glyph}"/></svg></div>`;

  const badgeMarkup = (p) => {
    const out = [];
    if (p.tags.includes("Bestseller")) out.push('<span class="badge badge--best">Bestseller</span>');
    if (p.tags.includes("New")) out.push('<span class="badge badge--new">New</span>');
    if (p.tags.includes("Sale")) out.push('<span class="badge badge--sale">Sale</span>');
    return out.join("");
  };

  const cardMarkup = (p, i) => {
    const saved = wishlist.has(p.id);
    const inCart = cart.has(p.id);
    return `
      <article class="card" data-id="${p.id}" style="animation-delay:${Math.min(i, 8) * 40}ms">
        <div class="card__media" data-quick="${p.id}">
          ${coverMarkup(p)}
          <div class="card__badges">${badgeMarkup(p)}</div>
          <button class="card__save ${saved ? "is-on" : ""}" type="button" data-wish="${p.id}"
            aria-label="${saved ? "Remove from saved" : "Save product"}" aria-pressed="${saved}">
            <svg class="ico"><use href="#i-heart"/></svg>
          </button>
          <span class="card__type"><svg class="ico"><use href="#${p.glyph}"/></svg>${esc(p.cat)}</span>
        </div>
        <div class="card__body">
          <h3 class="card__title"><button type="button" data-quick="${p.id}">${esc(p.title)}</button></h3>
          <p class="card__by"><i aria-hidden="true">${esc(p.by.slice(0, 2).toUpperCase())}</i>${esc(p.by)}</p>
          <div class="card__meta">
            <span class="card__rating">
              <svg class="ico" aria-hidden="true"><use href="#i-star"/></svg>
              ${p.rating.toFixed(1)} <span>(${p.reviews})</span>
            </span>
            <span class="card__price">
              <span class="price">${money(p.price)}</span>
              ${p.old ? `<span class="price--old">${money(p.old)}</span>` : ""}
            </span>
          </div>
          <button class="card__add ${inCart ? "is-added" : ""}" type="button" data-add="${p.id}">
            <svg class="ico" aria-hidden="true"><use href="#${inCart ? "i-check" : "i-plus"}"/></svg>
            ${inCart ? "In cart" : "Add to cart"}
          </button>
        </div>
      </article>`;
  };

  /* ---------------------------------------------------------
     Filter + render catalog
     --------------------------------------------------------- */
  const matches = (p) => {
    if (state.wishOnly && !wishlist.has(p.id)) return false;
    if (state.filter !== "all" && !state.wishOnly && p.cat !== state.filter) return false;
    if (!state.query) return true;
    const hay = [p.title, p.by, p.cat, p.desc, ...p.formats].join(" ").toLowerCase();
    return state.query
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .every((term) => hay.includes(term));
  };

  const sorters = {
    popular: (a, b) => b.sold - a.sold,
    new: (a, b) => Number(b.tags.includes("New")) - Number(a.tags.includes("New")),
    rating: (a, b) => b.rating - a.rating || b.reviews - a.reviews,
    "price-asc": (a, b) => a.price - b.price,
    "price-desc": (a, b) => b.price - a.price
  };

  const relevance = (p, terms) => {
    const t = p.title.toLowerCase();
    const c = p.cat.toLowerCase();
    const b = p.by.toLowerCase();
    const f = p.formats.join(" ").toLowerCase();
    return terms.reduce((score, term) =>
      score + (t.includes(term) ? 6 : 0) + (c.includes(term) ? 4 : 0) + (b.includes(term) ? 2 : 0) + (f.includes(term) ? 1 : 0), 0);
  };

  const render = () => {
    let list = PRODUCTS.filter(matches);
    const terms = state.query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length && state.sort === "popular") {
      list = list.sort((a, b) => relevance(b, terms) - relevance(a, terms) || b.sold - a.sold);
    } else {
      list = list.sort(sorters[state.sort]);
    }
    const shown = list.slice(0, state.page * PAGE_SIZE);
    const grid = $("#productGrid");

    grid.innerHTML = shown.map(cardMarkup).join("");
    $("#empty").hidden = list.length > 0;

    const chipLabel =
      state.wishOnly ? "saved" :
      state.filter === "all" ? "" :
      state.filter.toLowerCase();

    $("#results").innerHTML = list.length
      ? `<strong>${list.length}</strong> ${list.length === 1 ? "product" : "products"}${chipLabel ? ` in ${esc(chipLabel)}` : ""}${state.query ? ` for “${esc(state.query)}”` : ""}`
      : "";

    $("#gridFootnote").innerHTML = list.length
      ? `Showing <strong>${shown.length}</strong> of ${list.length} matching ${list.length === 1 ? "product" : "products"}`
      : `No matches in the current view`;

    const more = $("#loadMore");
    more.hidden = shown.length >= list.length;
    more.innerHTML = `Load more products <svg class="ico"><use href="#i-arrow"/></svg>`;
  };

  const setChip = (value) => {
    state.filter = value;
    state.wishOnly = value === "wish";
    $$(".chip").forEach((chip) => {
      const active = chip.dataset.filter === value;
      chip.classList.toggle("is-active", active);
      chip.setAttribute("aria-pressed", String(active));
    });
  };

  const setSearch = (value) => {
    state.query = value.trim();
    state.page = 1;
    $("#catalogSearch").value = value;
    render();
  };

  /* ---------------------------------------------------------
     Catalog events
     --------------------------------------------------------- */
  const catalog = $("#catalog");

  catalog.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (chip) {
      setChip(chip.dataset.filter);
      state.page = 1;
      render();
      return;
    }
  });

  $$(".cat-card").forEach((card) => {
    card.addEventListener("click", () => {
      setChip(card.dataset.cat);
      state.query = "";
      state.page = 1;
      $("#catalogSearch").value = "";
      render();
      catalog.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  $("#sort").addEventListener("change", (e) => {
    state.sort = e.target.value;
    state.page = 1;
    render();
  });

  $("#catalogSearch").addEventListener("input", (e) => {
    state.query = e.target.value.trim();
    state.page = 1;
    render();
  });

  $("#loadMore").addEventListener("click", () => {
    state.page += 1;
    render();
  });

  $("#resetFilters").addEventListener("click", () => {
    state.query = "";
    state.page = 1;
    setChip("all");
    $("#catalogSearch").value = "";
    $("#sort").value = "popular";
    state.sort = "popular";
    render();
  });

  /* hero search */
  $("#heroSearch").addEventListener("submit", (e) => {
    e.preventDefault();
    const value = $("#q").value;
    setSearch(value);
    setChip("all");
    catalog.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  $$(".tag").forEach((tag) => {
    tag.addEventListener("click", () => {
      $("#q").value = tag.dataset.tag;
      setSearch(tag.dataset.tag);
      setChip("all");
      catalog.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  $$("[data-focus-search]").forEach((btn) => {
    btn.addEventListener("click", () => {
      catalog.scrollIntoView({ behavior: "smooth", block: "start" });
      setTimeout(() => $("#catalogSearch").focus({ preventScroll: true }), 420);
    });
  });

  $("#wishBtn").addEventListener("click", () => {
    setChip("wish");
    state.page = 1;
    render();
    catalog.scrollIntoView({ behavior: "smooth", block: "start" });
    toast(wishlist.size ? `${wishlist.size} saved ${wishlist.size === 1 ? "product" : "products"}` : "Nothing saved yet — tap a heart to keep something", "i-heart");
  });

  /* ---------------------------------------------------------
     Cart
     --------------------------------------------------------- */
  const drawer = $("#cartDrawer");
  const scrim = $("#scrim");

  const syncCartUI = () => {
    const count = cartCount();
    const total = cartItems().reduce((sum, p) => sum + p.price * p.qty, 0);
    const discount = promo ? total * promo.rate : 0;

    ["#cartCount", "#cartBadge"].forEach((sel) => {
      const el = $(sel);
      if (!el) return;
      el.textContent = count;
      el.hidden = count === 0;
    });

    $("#cartEmpty").hidden = count !== 0;
    $("#cartFoot").hidden = count === 0;
    $("#cartList").innerHTML = cartItems().map((p) => `
      <li class="cart-item" data-id="${p.id}">
        <span class="cart-item__cover cover cover--${p.tone}"><svg class="ico" aria-hidden="true"><use href="#${p.glyph}"/></svg></span>
        <div class="cart-item__main">
          <p class="cart-item__title">${esc(p.title)}</p>
          <p class="cart-item__meta">${esc(p.cat)} · by ${esc(p.by)}</p>
          <div class="cart-item__row">
            <div class="qty">
              <button type="button" data-qty="-1" aria-label="Decrease quantity"><svg class="ico"><use href="#i-minus"/></svg></button>
              <span>${p.qty}</span>
              <button type="button" data-qty="1" aria-label="Increase quantity"><svg class="ico"><use href="#i-plus"/></svg></button>
            </div>
            <button class="cart-item__remove" type="button" data-remove>Remove</button>
          </div>
        </div>
        <span class="cart-item__price">${money(p.price * p.qty)}</span>
      </li>`).join("");

    $("#subtotal").textContent = money(total);
    $("#discountRow").hidden = !promo;
    if (promo) {
      $("#discount").textContent = "−" + money(discount);
      $("#discountTag").textContent = promo.code;
    }
    $("#total").textContent = money(total - discount);

    $$("[data-add]").forEach((btn) => {
      const inCart = cart.has(btn.dataset.add);
      btn.classList.toggle("is-added", inCart);
      btn.innerHTML = `<svg class="ico" aria-hidden="true"><use href="#${inCart ? "i-check" : "i-plus"}"/></svg>${inCart ? "In cart" : "Add to cart"}`;
    });
  };

  const addToCart = (id) => {
    const p = P(id);
    if (!p) return;
    cart.set(id, (cart.get(id) || 0) + 1);
    persist();
    syncCartUI();
    toast(`${p.title} added to cart`, "i-cart");
    $$(`[data-add="${id}"]`).forEach((btn) => {
      btn.classList.add("is-added");
      btn.innerHTML = '<svg class="ico" aria-hidden="true"><use href="#i-check"/></svg>In cart';
    });
  };

  $("#productGrid").addEventListener("click", (e) => {
    const add = e.target.closest("[data-add]");
    if (add) { addToCart(add.dataset.add); return; }

    const wish = e.target.closest("[data-wish]");
    if (wish) { toggleWish(wish.dataset.wish); return; }

    const quick = e.target.closest("[data-quick]");
    if (quick) openQuickView(quick.dataset.quick);
  });

  $("#cartList").addEventListener("click", (e) => {
    const row = e.target.closest(".cart-item");
    if (!row) return;
    const id = row.dataset.id;

    const remove = e.target.closest("[data-remove]");
    if (remove) {
      cart.delete(id);
      persist(); syncCartUI();
      toast("Removed from cart");
      return;
    }

    const qtyBtn = e.target.closest("[data-qty]");
    if (qtyBtn) {
      const next = (cart.get(id) || 0) + Number(qtyBtn.dataset.qty);
      if (next < 1) cart.delete(id); else cart.set(id, next);
      persist(); syncCartUI();
    }
  });

  const openCart = () => {
    syncCartUI();
    lastFocus = document.activeElement;
    drawer.classList.add("is-open");
    drawer.setAttribute("aria-hidden", "false");
    scrim.hidden = false;
    requestAnimationFrame(() => scrim.classList.add("is-on"));
    document.body.classList.add("is-locked");
    setTimeout(() => $(".drawer__head [data-close]", drawer)?.focus(), 60);
  };

  const resetCartView = () => {
    $("#cartList").innerHTML = "";
    $("#cartEmpty").hidden = false;
  };

  const closeCart = () => {
    drawer.classList.remove("is-open");
    drawer.setAttribute("aria-hidden", "true");
    scrim.classList.remove("is-on");
    document.body.classList.remove("is-locked");
    setTimeout(() => { scrim.hidden = true; }, 260);
    if (cartCount() === 0) resetCartView();
    if (lastFocus) lastFocus.focus({ preventScroll: true });
  };

  $("#openCart").addEventListener("click", openCart);

  /* promo */
  $("#applyPromo").addEventListener("click", () => {
    const code = $("#promo").value.trim().toUpperCase();
    const msg = $("#promoMsg");
    const codes = {
      LAUNCH30: { code: "LAUNCH30", rate: 0.3 },
      WELCOME10: { code: "WELCOME10", rate: 0.1 }
    };
    if (!code) return;
    if (codes[code]) {
      promo = codes[code];
      msg.textContent = `${code} applied — ${Math.round(promo.rate * 100)}% off`;
      msg.classList.remove("is-bad");
      syncCartUI();
      toast(`Code ${code} applied`);
    } else {
      promo = null;
      msg.textContent = "That code isn’t valid. Try LAUNCH30.";
      msg.classList.add("is-bad");
      syncCartUI();
    }
  });

  $("#promo").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); $("#applyPromo").click(); }
  });

  /* checkout */
  $("#checkout").addEventListener("click", () => {
    const btn = $("#checkout");
    const items = cartItems();
    if (!items.length) return;

    btn.disabled = true;
    btn.textContent = "Processing…";

    setTimeout(() => {
      const order = "NR-" + Math.random().toString(36).slice(2, 7).toUpperCase();
      const rows = items.map((p) => `
        <li>
          <span class="cart-item__cover cover cover--${p.tone}"><svg class="ico" aria-hidden="true"><use href="#${p.glyph}"/></svg></span>
          <span class="cart-item__main">
            <span class="cart-item__title">${esc(p.title)}</span>
            <span class="cart-item__meta">${p.qty} × licence · lifetime updates</span>
          </span>
          <button class="card__add" type="button" data-download="${p.id}" style="padding:8px 12px;width:auto;margin:0">
            <svg class="ico" aria-hidden="true"><use href="#i-download"/></svg>
          </button>
        </li>`).join("");

      $("#cartList").innerHTML = `
        <div class="cart-empty" style="padding:34px 8px 18px">
          <span class="cart-empty__icon" style="color:var(--mint);background:rgba(52,226,181,.12);border:1px solid rgba(52,226,181,.3)">
            <svg class="ico"><use href="#i-check"/></svg>
          </span>
          <h3>Order ${order} complete</h3>
          <p>This is a demo checkout — nothing was charged. Your files would be waiting in your library.</p>
        </div>
        <ul class="cart-list" style="gap:8px">${rows}</ul>`;

      $("#cartEmpty").hidden = true;
      $("#cartFoot").hidden = true;
      cart.clear();
      promo = null;
      persist();
      ["#cartCount", "#cartBadge"].forEach((sel) => { const el = $(sel); if (el) { el.hidden = true; el.textContent = "0"; } });
      $("#promoMsg").textContent = "";
      $("#promo").value = "";
      btn.disabled = false;
      btn.textContent = "Checkout";
      toast(`Demo order ${order} confirmed — no payment taken`);
      render();
    }, 950);
  });

  drawer.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) closeCart();
    const dl = e.target.closest("[data-download]");
    if (dl) toast("Demo only — no file attached", "i-download");
  });

  /* ---------------------------------------------------------
     Wishlist
     --------------------------------------------------------- */
  function toggleWish(id) {
    if (wishlist.has(id)) {
      wishlist.delete(id);
      toast("Removed from saved", "i-heart");
    } else {
      wishlist.add(id);
      toast("Saved for later", "i-heart");
    }
    persist();
    const count = $("#wishCount");
    count.textContent = wishlist.size;
    count.hidden = wishlist.size === 0;

    $$(`[data-wish="${id}"]`).forEach((btn) => {
      const on = wishlist.has(id);
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-pressed", String(on));
      btn.setAttribute("aria-label", on ? "Remove from saved" : "Save product");
    });

    if (state.wishOnly) render();
  }

  /* ---------------------------------------------------------
     Quick view modal
     --------------------------------------------------------- */
  const qv = $("#quickView");
  let lastFocus = null;

  function openQuickView(id) {
    const p = P(id);
    if (!p) return;
    lastFocus = document.activeElement;
    const saved = wishlist.has(p.id);
    const inCart = cart.has(p.id);

    $("#qvContent").innerHTML = `
      <div class="qv">
        <div class="qv__media">
          ${coverMarkup(p)}
          <div class="qv__media-tags">${badgeMarkup(p)}</div>
        </div>
        <div class="qv__body">
          <p class="qv__cat">${esc(p.cat)}</p>
          <h2 class="qv__title" id="qvTitle">${esc(p.title)}</h2>
          <p class="qv__by"><i aria-hidden="true">${esc(p.by.slice(0, 2).toUpperCase())}</i> by ${esc(p.by)}
            <span aria-hidden="true">·</span>
            <span class="card__rating" style="font-size:.78rem">
              <svg class="ico" aria-hidden="true"><use href="#i-star"/></svg>${p.rating.toFixed(1)}
              <span>(${p.reviews} reviews)</span>
            </span>
          </p>
          <p class="qv__desc">${esc(p.desc)}</p>

          <ul class="qv__list">
            ${p.includes.map((item) => `<li><svg class="ico" aria-hidden="true"><use href="#i-check"/></svg>${esc(item)}</li>`).join("")}
          </ul>

          <div class="qv__meta">${p.formats.map((f) => `<span>${esc(f)}</span>`).join("")}<span>${p.sold.toLocaleString("en-US")} sold</span></div>

          <div class="qv__buy">
            <span class="qv__price">
              <span class="price">${money(p.price)}</span>
              ${p.old ? `<span class="price--old">${money(p.old)}</span>` : ""}
            </span>
            <div class="qv__actions">
              <button class="qv__save ${saved ? "is-on" : ""}" type="button" data-qv-wish="${p.id}" aria-label="Save product" aria-pressed="${saved}">
                <svg class="ico"><use href="#i-heart"/></svg>
              </button>
              <button class="btn btn--primary" type="button" data-qv-add="${p.id}">
                <svg class="ico" aria-hidden="true"><use href="#${inCart ? "i-check" : "i-cart"}"/></svg>
                ${inCart ? "In cart" : "Add to cart"}
              </button>
            </div>
          </div>
          <p class="qv__trust">
            <span><svg class="ico"><use href="#i-bolt"/></svg>Instant download</span>
            <span><svg class="ico"><use href="#i-refresh"/></svg>Lifetime updates</span>
            <span><svg class="ico"><use href="#i-shield"/></svg>14-day guarantee</span>
          </p>
        </div>
      </div>`;

    openModal(qv);
  }

  qv.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]") || e.target === qv) { closeModal(qv); return; }

    const add = e.target.closest("[data-qv-add]");
    if (add) {
      addToCart(add.dataset.qvAdd);
      add.innerHTML = '<svg class="ico" aria-hidden="true"><use href="#i-check"/></svg>In cart';
      return;
    }

    const wish = e.target.closest("[data-qv-wish]");
    if (wish) {
      toggleWish(wish.dataset.qvWish);
      const on = wishlist.has(wish.dataset.qvWish);
      wish.classList.toggle("is-on", on);
      wish.setAttribute("aria-pressed", String(on));
    }
  });

  /* ---------------------------------------------------------
     Generic modal plumbing
     --------------------------------------------------------- */
  function openModal(modal) {
    lastFocus = document.activeElement;
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("is-locked");
    const focusable = modal.querySelector("button, [href], input, select, textarea");
    setTimeout(() => focusable?.focus({ preventScroll: true }), 80);
  }

  function closeModal(modal) {
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    if (!drawer.classList.contains("is-open")) document.body.classList.remove("is-locked");
    if (lastFocus) lastFocus.focus({ preventScroll: true });
  }

  /* seller modal */
  const sellModal = $("#sellModal");
  $$("[data-open-sell]").forEach((btn) => {
    btn.addEventListener("click", () => {
      $("#mobileNav").hidden = true;
      $("#burger").setAttribute("aria-expanded", "false");
      openModal(sellModal);
    });
  });

  sellModal.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]") || e.target === sellModal) closeModal(sellModal);
  });

  $("#sellForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("#sName");
    const email = $("#sEmail");
    let ok = true;
    [name, email].forEach((input) => {
      const bad = !input.value.trim() || (input.type === "email" && !/^\S+@\S+\.\S+$/.test(input.value));
      input.classList.toggle("is-bad", bad);
      if (bad) ok = false;
    });
    if (!ok) { toast("Please add your name and a valid email", "i-mail"); return; }

    closeModal(sellModal);
    toast("Application received — we reply within 1 business day");
    e.target.reset();
  });

  /* ---------------------------------------------------------
     Global listeners: scrim, esc, focus trap
     --------------------------------------------------------- */
  scrim.addEventListener("click", closeCart);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (qv.classList.contains("is-open")) closeModal(qv);
      if (sellModal.classList.contains("is-open")) closeModal(sellModal);
      if (drawer.classList.contains("is-open")) closeCart();
      if (!$("#mobileNav").hidden) {
        $("#mobileNav").hidden = true;
        $("#burger").setAttribute("aria-expanded", "false");
      }
    }

    if (e.key === "Tab") {
      const active = drawer.classList.contains("is-open") ? drawer :
        qv.classList.contains("is-open") ? qv :
        sellModal.classList.contains("is-open") ? sellModal : null;
      if (!active) return;
      const items = $$('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', active)
        .filter((el) => !el.disabled && el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }

    if (e.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
      e.preventDefault();
      catalog.scrollIntoView({ behavior: "smooth", block: "start" });
      setTimeout(() => $("#catalogSearch").focus({ preventScroll: true }), 400);
    }
  });

  /* ---------------------------------------------------------
     Header, mobile nav, reveals, counters
     --------------------------------------------------------- */
  const header = $("#header");
  window.addEventListener("scroll", () => {
    header.classList.toggle("is-stuck", window.scrollY > 12);
  }, { passive: true });

  const burger = $("#burger");
  const mobileNav = $("#mobileNav");
  burger.addEventListener("click", () => {
    const open = burger.getAttribute("aria-expanded") === "true";
    burger.setAttribute("aria-expanded", String(!open));
    burger.setAttribute("aria-label", open ? "Open menu" : "Close menu");
    mobileNav.hidden = open;
  });

  mobileNav.addEventListener("click", (e) => {
    if (e.target.closest("a")) {
      mobileNav.hidden = true;
      burger.setAttribute("aria-expanded", "false");
    }
  });

  const revealer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-in");
      revealer.unobserve(entry.target);
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -40px" });
  $$(".reveal, .dash, .value").forEach((el) => revealer.observe(el));

  /* animated stats */
  const statObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      const target = Number(el.dataset.count);
      const suffix = el.dataset.suffix || "";
      const start = performance.now();
      const dur = 1400;

      const tick = (now) => {
        const t = Math.min((now - start) / dur, 1);
        const eased = 1 - Math.pow(1 - t, 3);
        const value = Math.round(target * eased);
        el.textContent = value.toLocaleString("en-US") + suffix;
        if (t < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      statObserver.unobserve(el);
    });
  }, { threshold: 0.6 });
  $$("[data-count]").forEach((el) => statObserver.observe(el));

  /* newsletter */
  $("#newsForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const form = e.target;
    const input = $("#email");
    if (!/^\S+@\S+\.\S+$/.test(input.value)) {
      $("#newsNote").textContent = "That email doesn’t look right — mind checking it?";
      input.focus();
      return;
    }
    form.classList.add("is-done");
    $("#newsNote").textContent = `You’re in. The next drop lands Friday in ${input.value}.`;
    toast("Subscribed to the Friday drop");
    input.value = "";
  });

  /* footer year */
  $("#year").textContent = new Date().getFullYear();

  /* ---------------------------------------------------------
     Init
     --------------------------------------------------------- */
  $("#wishCount").textContent = wishlist.size;
  $("#wishCount").hidden = wishlist.size === 0;
  syncCartUI();
  render();
})();
